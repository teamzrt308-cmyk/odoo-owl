/**
 * Test jsdom des règles métier « comme Odoo » (itération 17) :
 *  - @api.constrains : contraintes portées (quantités strictement
 *    positives, dates cohérentes) -> validateDocument bloque avec le
 *    message, comme un raise ValidationError ;
 *  - avertissements d'onchange (dict {'warning': ...} Python) :
 *    extraits des mises à jour (aucune pollution des valeurs),
 *    diffusés sur le bus rules:warning ;
 *  - checkRequiredFields : 0 est une valeur, false/""/tuple [false,""]
 *    sont vides ;
 *  - e2e : sauvegarde bloquée par un champ requis (statut + toast
 *    danger, rien en file), puis débloquée une fois rempli.
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
const waitFor = async (fn, label) => {
  for (let i = 0; i < 200; i++) {
    if (fn()) return true;
    await tick();
  }
  ok(false, "timeout : " + label);
  return false;
};

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
Object.defineProperty(dom.window.navigator, "onLine", { value: false, configurable: true });
Object.defineProperty(globalThis.navigator, "onLine", { value: false, configurable: true });
dom.window.alert = () => { throw new Error("alert() ne doit plus être appelé"); };
localStorage.clear();
localStorage.setItem("offline_sync_session", JSON.stringify({ uid: 5, name: "Alice", api_key: "KEY" }));
globalThis.fetch = () => Promise.reject(new TypeError("hors ligne (stub)"));

class FakeTable {
  constructor(rows = [], keyFn = null) { this.rows = rows; this.keyFn = keyFn; }
  async put(obj) { this.rows.push(obj); }
  async bulkAdd(list) { for (const o of list) this.rows.push(o); }
  async bulkPut() {}
  async add(obj) { const id = this.rows.length + 1; this.rows.push({ id, ...obj }); return { id }; }
  async update() {}
  async clear() { this.rows.length = 0; }
  async get(key) {
    if (!this.keyFn) return undefined;
    for (let i = this.rows.length - 1; i >= 0; i--) {
      if (this.keyFn(this.rows[i], key)) return this.rows[i];
    }
    return undefined;
  }
  async toArray() { return [...this.rows]; }
  where(clause) {
    const rows = this.rows;
    if (typeof clause === "string") {
      return {
        equals: (value) => {
          const filtered = rows.filter((r) => r[clause] === value);
          return { toArray: async () => filtered, first: async () => filtered[0], count: async () => filtered.length };
        },
      };
    }
    const filtered = () => rows.filter((r) => Object.entries(clause || {}).every(([k, v]) => r[k] === v));
    return { toArray: async () => filtered(), first: async () => filtered()[0], count: async () => filtered().length };
  }
}
class FakeDexie {
  constructor() {
    for (const t of ["sync_queue", "catalog_cache", "security_info", "installed_apps", "local_ledger", "list_cache"]) {
      this[t] = new FakeTable();
    }
    // clé composée [model, record_id] (getCachedRecord/patchCachedRecord)
    this.record_cache = new FakeTable([], (r, k) => Array.isArray(k) && r.model === k[0] && String(r.id) === String(k[1]));
    this.cache_meta = new FakeTable([], (r, k) => r.key === k);
    this.module_manifests = new FakeTable([], (r, k) => r.technical_name === k);
    this.reference_records = new FakeTable([
      { model: "product.product", id: 5, display_name: "Desk", price: 30 },
      { model: "product.product", id: 7, display_name: "Service sans prix", price: 0 },
      { model: "product.product", id: 8, display_name: "Chaise", price: 100 },
    ], (r, k) => Array.isArray(k) ? r.model === k[0] && String(r.id) === String(k[1]) : r.model === k);
  }
  version() { return { stores() {} }; }
  transaction() {}
}
globalThis.Dexie = FakeDexie;

const { db } = await import(REPO + "/static/src/core/orm_service.js");
const { bus } = await import(REPO + "/static/src/core/bus/bus_service.js");

const { initRulesEngine } = await import(REPO + "/static/src/model/rules_engine/rules_engine.js");
const { allRules } = await import(REPO + "/static/src/model/rules_engine/rules/index.js");
initRulesEngine(allRules);

const rulesEngine = await import(REPO + "/static/src/model/rules_engine/rules_engine.js");

// ── 1. @api.constrains portées : validateDocument bloque avec le message ──
{
  const valid = await rulesEngine.validateDocument("sale.order", {
    root: { name: "SO001", date_order: "2026-01-10", commitment_date: "2026-01-20" },
    lines: { order_line: { model: "sale.order.line", rows: [
      { product_id: [5, "Desk"], product_uom_qty: 2, price_unit: 30 },
    ] } },
  });
  ok(valid.valid === true && valid.errors.length === 0, "constrains : document valide -> aucun error");

  const invalid = await rulesEngine.validateDocument("sale.order", {
    root: { name: "SO002", date_order: "2026-01-10", commitment_date: "2026-01-05" },
    lines: { order_line: { model: "sale.order.line", rows: [
      { product_id: [5, "Desk"], product_uom_qty: 0, price_unit: 30 },
    ] } },
  });
  ok(invalid.valid === false && invalid.errors.length === 2, "constrains : deux contraintes violées (dates + quantité)");
  const messages = invalid.errors.map((e) => e.message).join(" | ");
  ok(messages.includes("La quantité vendue doit être strictement positive."), "constrains : message _check_quantity (vente)");
  ok(messages.includes("La date de livraison souhaitée précède la date de commande."), "constrains : message _check_dates");
  ok(invalid.errors.every((e) => e.method && e.model), "constrains : errors tracées avec model + method (comme l'exception Python)");

  const lineMissingQty = await rulesEngine.validateDocument("sale.order", {
    root: { name: "SO003" },
    lines: { order_line: { model: "sale.order.line", rows: [{ product_id: [5, "Desk"] }] } },
  });
  ok(lineMissingQty.valid === true, "constrains : quantité absente (ligne en cours) -> rien à vérifier");

  const purchaseInvalid = await rulesEngine.validateDocument("purchase.order", {
    root: { name: "PO001" },
    lines: { order_line: { model: "purchase.order.line", rows: [
      { product_id: [5, "Desk"], product_qty: -1, price_unit: 30 },
    ] } },
  });
  ok(purchaseInvalid.valid === false &&
     purchaseInvalid.errors.some((e) => e.message.includes("La quantité achetée doit être strictement positive.")),
     "constrains : message _check_quantity (achat, product_qty)");
}

// ── 2. Avertissements d'onchange (dict warning Python) ──
{
  const warnings = [];
  bus.addEventListener("rules:warning", (ev) => warnings.push(ev.detail));

  const snapshot = {
    get: (model, id) => ({ 7: { display_name: "Service sans prix", price: 0 }, 8: { display_name: "Chaise", price: 100 } })[id] || null,
  };

  // produit sans prix : warning + mises à jour SANS clé warning
  const updates = rulesEngine.runLineRules("purchase.order.line", { product_id: 7 }, { dbSnapshot: snapshot });
  await tick();
  ok(updates.name === "Service sans prix" && updates.price_unit === 0, "onchange warning : mises à jour appliquées (name + price 0)");
  ok(!("warning" in updates), "onchange warning : clé warning STRIPPEE des mises à jour");
  await waitFor(() => warnings.length === 1, "bus rules:warning émis");
  ok(warnings[0] && warnings[0].model === "purchase.order.line" && warnings[0].method === "_onchange_product_id" &&
     warnings[0].title === "Prix fournisseur manquant" && warnings[0].message.includes("Service sans prix"),
     "onchange warning : bus rules:warning {model, method, title, message}");

  // produit avec prix : aucun warning
  rulesEngine.runLineRules("purchase.order.line", { product_id: 8 }, { dbSnapshot: snapshot });
  await tick();
  ok(warnings.length === 1, "onchange warning : produit avec prix -> aucun warning");

  // runDocumentRules : le warning d'une LIGNE remonte aussi
  const graph = await rulesEngine.runDocumentRules("purchase.order", {
    root: { name: "PO002" },
    lines: { order_line: { model: "purchase.order.line", rows: [{ product_id: 7, product_qty: 1, price_unit: 0 }] } },
  });
  await waitFor(() => warnings.length === 2, "runDocumentRules : warning de ligne remonté");
  ok(graph.lines.order_line.rows[0].name === "Service sans prix" && !("warning" in graph.lines.order_line.rows[0]),
     "onchange warning : graph mis à jour sans clé warning");
}

// ── 3. checkRequiredFields ──
{
  const fieldsInfo = {
    name: { type: "char", label: "Référence", required: true },
    partner_id: { type: "many2one", label: "Client", required: true },
    qty: { type: "float", label: "Quantité", required: true },
    note: { type: "text", label: "Note", required: true },
    state: { type: "selection", label: "État" },
  };
  const missing = rulesEngine.checkRequiredFields("sale.order", {
    name: "", partner_id: false, qty: 0, note: "ok",
  }, fieldsInfo);
  ok(missing.join(",") === "Référence,Client", "required : «» et false vides ; 0 est une VALEUR (qty absent des manquants)");

  const missing2 = rulesEngine.checkRequiredFields("sale.order", {
    name: "SO", partner_id: [3, "Alice"], qty: 1, note: undefined,
  }, fieldsInfo);
  ok(missing2.join(",") === "Note", "required : tuple m2o [3,\"Alice\"] et 0 sont des valeurs ; undefined est vide");
  ok(rulesEngine.checkRequiredFields("sale.order", { name: "SO", partner_id: [3, "Alice"], qty: 1, note: "x" }, fieldsInfo).length === 0,
     "required : document complet -> aucun manquant");
}

// ── 4. E2E : sauvegarde bloquée par un champ requis, puis OK ──
const fieldsInfo = {
  name: { type: "char", label: "Référence", required: true },
  state: { type: "selection", label: "État", selection: [["draft", "Brouillon"], ["done", "Validé"]] },
};
const formArch = `<form>
  <header><field name="state" widget="statusbar"/></header>
  <sheet><group><field name="name"/></group></sheet>
</form>`;
await db.module_manifests.put({
  technical_name: "sales",
  module: { name: "sales" },
  models: ["sale.order"],
  fields: { "sale.order": fieldsInfo },
  views: { "sale.order": { default: { form: { arch: formArch } } } },
  menus: [],
});
await db.record_cache.put({
  model: "sale.order", id: 42,
  data: { id: 42, name: "SO017", state: "draft" },
});

// conteneur de notifications (toasts) pour les assertions
const { mountNotificationContainer } = await import(REPO + "/static/src/core/notifications/notification_container.js");
const notifHost = document.createElement("div");
document.body.appendChild(notifHost);
const destroyNotif = await mountNotificationContainer(notifHost);

await import(REPO + "/static/src/views/view.js");
const { mountView } = await import(REPO + "/static/src/views/view.js");
const container = document.createElement("div");
document.body.appendChild(container);
const destroy = await mountView(container, { view: "form", module: "sales", model: "sale.order", id: 42, actionId: "a1" }, { doAction: () => {}, goBack: () => {} });
await waitFor(() => container.querySelector("#field-name"), "e2e form rendu");

// champ requis vidé -> sauvegarde bloquée
const nameInput = container.querySelector("#field-name");
nameInput.value = "";
nameInput.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
container.querySelector(".o_control_panel .o_form_button_save").click();
await waitFor(() => container.querySelector("#status-msg").textContent.includes("Enregistrement bloqué"),
   "save bloquée (requis)");
ok(container.querySelector("#status-msg").textContent.includes("Champs requis manquants : Référence"),
   "e2e : statut « Champs requis manquants : Référence »");
await waitFor(() => notifHost.querySelector(".o_notification"), "toast requis visible");
ok(notifHost.querySelector(".o_notification").textContent.includes("Champs requis manquants") &&
   notifHost.querySelector(".o_notification").className.includes("text-bg-danger"),
   "e2e : toast danger « Champs requis »");
await tick();
ok(db.sync_queue.rows.length === 0, "e2e : RIEN en file quand la sauvegarde est bloquée");

// champ rempli -> la sauvegarde passe (constraints non violées)
nameInput.value = "SO017-bis";
nameInput.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
container.querySelector(".o_control_panel .o_form_button_save").click();
await waitFor(() => db.sync_queue.rows.some((r) => r.operation === "write"), "save -> write en file");
ok(db.sync_queue.rows.some((r) => r.operation === "write" && r.model_name === "sale.order" && r.payload.includes("SO017-bis")),
   "e2e : sauvegarde débloquée -> queueAction(model, write)");
ok(container.querySelector("#status-msg").textContent.includes("Enregistré localement"), "e2e : statut « Enregistré localement »");

destroy();
destroyNotif();

console.log("\n✅ TOUS LES TESTS RÈGLES MÉTIER PASSENT");
