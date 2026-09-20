/**
 * Test de fumée jsdom du contrôleur form OWL (itération 5) :
 *  - descripteur de vue { Controller } (façon Odoo 17) + dispatch view.js
 *  - FormController : zones OWL (control panel / statut / renderer),
 *    chargement hors ligne depuis les caches Dexie, rendu du formulaire
 *  - sauvegarde hors ligne -> file de sync (queueAction write)
 *  - bouton objet -> file de sync (queueMethodCall)
 *  - destroy : DOM retiré, cleanup
 */
import { JSDOM } from "jsdom";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";

const REPO = "/home/user/odoo-owl";
const ok = (cond, label) => {
  if (!cond) { console.error("✗ ÉCHEC :", label); process.exit(1); }
  console.log("✓", label);
};
const tick = () => new Promise((r) => setTimeout(r, 25));

const dom = new JSDOM(`<!DOCTYPE html><html><body></body></html>`, {
  url: "https://pwa.test/index.html", runScripts: "outside-only", pretendToBeVisual: true,
});
vm.runInContext(fs.readFileSync(path.join(REPO, "static/lib/owl.iife.js"), "utf8"), dom.getInternalVMContext());
globalThis.owl = dom.window.owl;
globalThis.document = dom.window.document;
globalThis.window = dom.window;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;
globalThis.DOMParser = dom.window.DOMParser;
globalThis.XMLSerializer = dom.window.XMLSerializer;
globalThis.MutationObserver = dom.window.MutationObserver;
globalThis.location = dom.window.location;
globalThis.localStorage = dom.window.localStorage;
globalThis.sessionStorage = dom.window.sessionStorage;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
// Parcours 100 % hors ligne (les modules testent navigator.onLine)
Object.defineProperty(dom.window.navigator, "onLine", { value: false, configurable: true });
Object.defineProperty(globalThis.navigator, "onLine", { value: false, configurable: true });
const alerts = [];
dom.window.alert = (m) => alerts.push(m);

// ── Stub Dexie avec get() sémantique par table ──
const syncQueueRows = [];
class FakeTable {
  constructor(rows = [], keyFn = null) { this.rows = rows; this.keyFn = keyFn; }
  async put(obj) { this.rows.push(obj); }
  async bulkPut() {}
  async add(obj) { this.rows.push(obj); return { id: this.rows.length }; }
  async get(key) {
    if (this.keyFn) return this.rows.find((r) => this.keyFn(r, key)) || undefined;
    return undefined;
  }
  where(clause) {
    const rows = this.rows;
    return {
      equals: () => ({ toArray: async () => rows }),
      // Dexie où clause objet : where({ model }) -> rows filtrées
      toArray: async () => rows.filter((r) => Object.entries(clause || {}).every(([k, v]) => r[k] === v)),
    };
  }
}
class FakeDexie {
  constructor() {
    this.sync_queue = new FakeTable(syncQueueRows);
    this.reference_records = new FakeTable([
      { model: "res.partner", id: 1, display_name: "Alice" },
      { model: "product.product", id: 5, display_name: "Desk" },
    ]);
    this.cache_meta = new FakeTable();
    this.catalog_cache = new FakeTable();
    this.security_info = new FakeTable(); // vide -> getSecurityInfo -> undefined -> { is_admin: false }
    this.module_manifests = new FakeTable([], (r, k) => r.technical_name === k);
    this.record_cache = new FakeTable([], (r, k) => Array.isArray(k) && r.model === k[0] && String(r.id) === String(k[1]));
    this.installed_apps = new FakeTable();
    this.local_ledger = new FakeTable();
  }
  version() { return { stores() {} }; }
  transaction() {}
}
globalThis.Dexie = FakeDexie;

const fieldsInfo = {
  name: { type: "char", label: "Référence" },
  partner_id: { type: "many2one", relation: "res.partner", label: "Client" },
  amount: { type: "float", label: "Montant" },
  state: { type: "selection", label: "État", selection: [["draft", "Brouillon"], ["done", "Validé"]] },
  order_line: {
    type: "one2many", relation: "sale.order.line", label: "Lignes",
    sub_fields: {
      product_id: { type: "many2one", relation: "product.product", label: "Article" },
      product_uom_qty: { type: "float", label: "Quantité" },
      price_unit: { type: "float", label: "Prix" },
      price_subtotal: { type: "float", label: "Sous-total" },
    },
  },
};

const formArch = `<form>
  <header>
    <button name="action_confirm" type="object" string="Confirmer"/>
    <field name="state" widget="statusbar"/>
  </header>
  <sheet>
    <group>
      <field name="name"/>
      <field name="partner_id"/>
      <field name="amount"/>
    </group>
  </sheet>
</form>`;

// Amorçage des caches hors ligne (manifest + record), comme après une
// première connexion en ligne.
globalThis.__seedManifest = {
  module: { name: "sales" },
  models: ["sale.order"],
  fields: { "sale.order": fieldsInfo },
  views: { "sale.order": { default: { form: { arch: formArch }, list: { arch: "<list><field name='name'/></list>" } } } },
  menus: [],
};
await (globalThis.Dexie.prototype, null); // no-op lisibilité
const { db } = await import(REPO + "/static/src/core/orm_service.js");
await db.module_manifests.put({
  technical_name: "sales",
  module: { name: "sales" },
  models: ["sale.order"],
  fields: { "sale.order": fieldsInfo },
  views: { "sale.order": { default: { form: { arch: formArch }, list: { arch: "<list><field name='name'/></list>" } } } },
  menus: [],
});
await db.record_cache.put({
  model: "sale.order", id: 42,
  data: {
    id: 42, name: "SO017", partner_id: [1, "Alice"], amount: 250.5, state: "draft",
    order_line: [{ id: 11, product_id: [5, "Desk"], product_uom_qty: 2, price_unit: 30, price_subtotal: 60 }],
  },
});

const { initRulesEngine } = await import(REPO + "/static/src/model/rules_engine/rules_engine.js");
const { allRules } = await import(REPO + "/static/src/model/rules_engine/rules/index.js");
initRulesEngine(allRules);

// ── 1. Descripteur de vue façon Odoo 17 ──
const { registry } = await import(REPO + "/static/src/core/registry.js");
await import(REPO + "/static/src/views/form/form_view.js");
const formDescriptor = registry.category("views").get("form");
ok(formDescriptor && formDescriptor.Controller && formDescriptor.Controller.name === "FormController",
   "ctrl : descripteur form -> { Controller: FormController }");
ok(!formDescriptor.mount, "ctrl : plus d'entrée impérative mount pour form");

// ── 2. mountView dispatch via le composant Controller ──
const { mountView } = await import(REPO + "/static/src/views/view.js");
const container = document.createElement("div");
document.body.appendChild(container);
const actions = [];
const envStub = { doAction: (a, o) => actions.push([a, o]), goBack: () => actions.push(["goBack"]) };

const destroy = await mountView(container, { view: "form", module: "sales", model: "sale.order", id: 42, actionId: "sale_action" }, envStub);
ok(typeof destroy === "function", "ctrl : mountView retourne destroy()");

// Attente du rendu complet (chargement async caches + mount renderer)
let formEl = null;
for (let i = 0; i < 200; i++) {
  formEl = container.querySelector(".o_form_view");
  if (formEl && formEl.querySelector("#field-name") && container.querySelector("#status-msg").textContent !== "Chargement du formulaire...") break;
  await tick();
}
ok(!!formEl, "ctrl : formulaire rendu dans la zone du contrôleur");
ok(!!container.querySelector(".o_control_panel"), "ctrl : control panel présent (zone OWL du contrôleur)");
ok(container.querySelector("#field-name").value === "SO017", "ctrl : valeurs du record chargées depuis le cache hors ligne");
ok(container.querySelector("#field-partner_id").value === "Alice", "ctrl : tuple m2o résolu");
ok(container.querySelector("#status-msg").textContent.includes("hors-ligne"), "ctrl : statut « mode hors-ligne »");
// Le fil d'Ariane est mis à jour par une mutation d'état réactif APRÈS
// le chargement (re-render OWL asynchrone) : on attend son application.
let bcEl = null;
for (let i = 0; i < 200; i++) {
  bcEl = container.querySelector(".o_control_panel .breadcrumb-current, .o_control_panel [class*=breadcrumb]");
  if (bcEl && bcEl.textContent.includes("SO017")) break;
  await tick();
}
ok(bcEl && bcEl.textContent.includes("SO017"), "ctrl : fil d'ariane = nom du record");

// ── 3. Sauvegarde hors ligne -> file de sync ──
const nameInput = container.querySelector("#field-name");
nameInput.value = "SO017-modifié";
nameInput.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
await tick();
container.querySelector(".o_control_panel .o_form_button_save").click();
await tick(); await tick();
ok(syncQueueRows.length > 0, "ctrl : sauvegarde -> entrée dans la file de sync");
const writeEntry = syncQueueRows.find((r) => r.operation === "write");
ok(!!writeEntry && writeEntry.model_name === "sale.order", "ctrl : queueAction(model, write) hors ligne");
ok(container.querySelector("#status-msg").textContent.includes("Enregistré localement"),
   "ctrl : statut « Enregistré localement »");

// ── 4. Bouton objet -> file de sync (method call) ──
const confirmBtn = [...container.querySelectorAll(".o_statusbar_buttons button")].find((b) => b.textContent === "Confirmer");
ok(!!confirmBtn, "ctrl : bouton objet du header rendu");
confirmBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
await tick(); await tick(); await tick();
const callEntry = syncQueueRows.find((r) => r.operation === "call_method" || r.method);
ok(!!callEntry, "ctrl : bouton objet -> queueMethodCall dans la file");
ok(container.querySelector("#status-msg").textContent.includes("Action enregistrée localement"),
   "ctrl : statut « Action enregistrée localement »");

// ── 5. Descripteur incomplet -> retour accueil ──
const container2 = document.createElement("div");
document.body.appendChild(container2);
const destroy2 = await mountView(container2, { view: "form", module: null, model: null }, envStub);
await tick(); await tick();
ok(actions.some(([a]) => a === "home_menu"), "ctrl : descripteur incomplet -> doAction('home_menu')");
destroy2();

// ── 6. destroy : DOM retiré ──
destroy();
await tick();
ok(!document.body.contains(container.querySelector(".o_form_view")) && container.querySelectorAll(".o_form_view").length === 0,
   "ctrl : destroy -> formulaire retiré du DOM (renderer détruit via onWillDestroy)");

console.log("\n✅ TOUS LES TESTS CONTRÔLEUR OWL PASSENT");
