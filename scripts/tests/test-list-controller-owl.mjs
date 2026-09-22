/**
 * Test de fumée jsdom du contrôleur list OWL (itération 6) :
 *  - descripteurs { Controller } pour list et kanban (façon Odoo 17)
 *  - ListController : zones OWL (control panel / statut / dashboard /
 *    liste), chargement hors ligne depuis list_cache, rendu des lignes
 *  - recherche (debounce), pagination, bascule kanban (renderer OWL),
 *    bouton Nouveau, clic de ligne, pivot placeholder, destroy
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
// Parcours 100 % hors ligne
Object.defineProperty(dom.window.navigator, "onLine", { value: false, configurable: true });
Object.defineProperty(globalThis.navigator, "onLine", { value: false, configurable: true });
dom.window.alert = () => {};

class FakeTable {
  constructor(rows = [], keyFn = null) { this.rows = rows; this.keyFn = keyFn; }
  async put(obj) { this.rows.push(obj); }
  async bulkPut() {}
  async add(obj) { this.rows.push(obj); return { id: this.rows.length }; }
  async get(key) { return this.keyFn ? (this.rows.find((r) => this.keyFn(r, key)) || undefined) : undefined; }
  where(clause) {
    const rows = this.rows;
    return {
      equals: () => ({ toArray: async () => rows }),
      toArray: async () => rows.filter((r) => Object.entries(clause || {}).every(([k, v]) => r[k] === v)),
    };
  }
}
class FakeDexie {
  constructor() {
    this.sync_queue = new FakeTable();
    this.reference_records = new FakeTable([
      { model: "res.partner", id: 1, display_name: "Alice" },
      { model: "res.partner", id: 2, display_name: "Bob" },
    ]);
    this.cache_meta = new FakeTable();
    this.catalog_cache = new FakeTable();
    this.security_info = new FakeTable();
    this.module_manifests = new FakeTable([], (r, k) => r.technical_name === k);
    this.record_cache = new FakeTable();
    this.installed_apps = new FakeTable();
    this.local_ledger = new FakeTable();
    this.list_cache = new FakeTable([], (r, k) => r.model === k);
  }
  version() { return { stores() {} }; }
  transaction() {}
}
globalThis.Dexie = FakeDexie;

const fieldsInfo = {
  name: { type: "char", label: "Référence" },
  partner_id: { type: "many2one", relation: "res.partner", label: "Client" },
  amount_total: { type: "float", label: "Total" },
  state: { type: "selection", label: "État", selection: [["draft", "Brouillon"]] },
};

const listArch = `<list><field name="name"/><field name="partner_id"/><field name="amount_total"/></list>`;
const kanbanArch = `<?xml version="1.0"?>
<kanban>
  <field name="name"/>
  <templates>
    <t t-name="kanban-box">
      <div class="oe_kanban_card oe_kanban_global_click">
        <strong class="o_kanban_record_title"><field name="name"/></strong>
      </div>
    </t>
  </templates>
</kanban>`;

const records = Array.from({ length: 22 }, (_, i) => ({
  id: 100 + i,
  name: `SO${String(i + 1).padStart(3, "0")}`,
  partner_id: [1 + (i % 2), i % 2 === 0 ? "Alice" : "Bob"],
  amount_total: 50 * (i + 1),
  state: "draft",
}));

const { db } = await import(REPO + "/static/src/core/orm_service.js");
await db.module_manifests.put({
  technical_name: "sales",
  fields: { "sale.order": fieldsInfo }, // fields indexé PAR MODÈLE (contrat manifest)
  views: { "sale.order": { default: { list: { arch: listArch }, kanban: { arch: kanbanArch } } } },
});
await db.list_cache.put({ model: "sale.order::sale_action", records, total: records.length });

const { initRulesEngine } = await import(REPO + "/static/src/model/rules_engine/rules_engine.js");
const { allRules } = await import(REPO + "/static/src/model/rules_engine/rules/index.js");
initRulesEngine(allRules);

// ── 1. Descripteurs façon Odoo 17 ──
const { registry } = await import(REPO + "/static/src/core/registry.js");
await import(REPO + "/static/src/views/list/list_view.js");
await import(REPO + "/static/src/views/kanban/kanban_view.js");
const listDescriptor = registry.category("views").get("list");
const kanbanDescriptor = registry.category("views").get("kanban");
ok(listDescriptor.Controller && listDescriptor.Controller.name === "ListController",
   "list : descripteur -> { Controller: ListController }");
ok(!!kanbanDescriptor.Controller, "list : descripteur kanban -> { Controller } (enveloppe)");

// ── 2. Montage via le dispatcher ──
const { mountView } = await import(REPO + "/static/src/views/view.js");
const container = document.createElement("div");
document.body.appendChild(container);
const actions = [];
const envStub = { doAction: (a, o) => actions.push([a, o]), goBack: () => {} };

const destroy = await mountView(container, { view: "list", module: "sales", model: "sale.order", actionId: "sale_action", label: "Devis" }, envStub);
ok(typeof destroy === "function", "list : mountView retourne destroy()");

let firstRow = null;
for (let i = 0; i < 200; i++) {
  firstRow = container.querySelector("tr.o_data_row");
  if (firstRow && container.querySelector("#status-msg, .text-muted")?.textContent !== "Chargement de la liste...") break;
  await tick();
}
ok(!!firstRow, "list : lignes rendues dans la zone du contrôleur");
ok(container.textContent.includes("SO001") && container.textContent.includes("Alice"), "list : valeurs des enregistrements (name + m2o formaté)");
ok(container.querySelector(".o_control_panel .o_breadcrumb").textContent.includes("Devis"), "list : fil d'ariane = label de l'action");
// Le compteur du pager est alimenté par le mount async du renderer
// (re-render réactif du ControlPanel) : on attend son application.
let pagerOk = false;
for (let i = 0; i < 200 && !pagerOk; i++) {
  pagerOk = /1-20 \/ 22/.test(container.textContent);
  if (!pagerOk) await tick();
}
ok(pagerOk, "list : pager « 1-20 / 22 »");
ok(container.textContent.includes("hors-ligne"), "list : statut hors-ligne");

// ── 3. Pagination ──
container.querySelector(".o_control_panel .o_pager_next").click();
let pagerOk2 = false;
for (let i = 0; i < 200 && !pagerOk2; i++) {
  pagerOk2 = /21-22 \/ 22/.test(container.textContent);
  if (!pagerOk2) await tick();
}
ok(pagerOk2, "list : page suivante -> « 21-22 / 22 »");
ok(container.querySelectorAll("tr.o_data_row").length === 2, "list : 2 lignes sur la 2e page");

// ── 4. Recherche (debounce 300ms) ──
const searchInput = container.querySelector(".o_control_panel input[type=search], .o_control_panel input[type=text]");
ok(!!searchInput, "list : champ de recherche présent");
searchInput.value = "SO022";
searchInput.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
// Polling (attente fixe trop juste sous charge : debounce 300 ms du
// control panel + re-render) -- convention de la suite.
let searchOk = false;
for (let i = 0; i < 300 && !searchOk; i++) {
  searchOk = container.querySelectorAll("tr.o_data_row").length === 1 && container.textContent.includes("SO022");
  if (!searchOk) await new Promise((r) => setTimeout(r, 10));
}
ok(searchOk, "list : recherche filtre les enregistrements");
searchInput.value = "";
searchInput.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
await new Promise((r) => setTimeout(r, 400));

// ── 5. Clic de ligne -> form_view avec l'id ──
container.querySelector("tr.o_data_row").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
await tick();
const lastAction = actions[actions.length - 1];
ok(lastAction && lastAction[0].tag === "form_view" && typeof lastAction[0].id === "number",
   "list : clic de ligne -> doAction form_view (id du record)");

// ── 6. Bouton Nouveau -> form_view isNew ──
container.querySelector(".o_control_panel .o_list_button_add").click();
await tick();
const newAction = actions[actions.length - 1];
ok(newAction && newAction[0].tag === "form_view" && newAction[0].isNew === true,
   "list : bouton Nouveau -> doAction form_view isNew");

// ── 7. Bascule kanban (renderer OWL) ──
const kanbanBtn = [...container.querySelectorAll(".o_control_panel .o_cp_switch_buttons button")]
  .find((b) => b.title === "Kanban");
ok(!!kanbanBtn, "list : bouton du view switcher kanban présent");
kanbanBtn.click();
let kanbanCard = null;
let pagerOk3 = false;
for (let i = 0; i < 200 && !(kanbanCard && pagerOk3); i++) {
  kanbanCard = container.querySelector(".oe_kanban_card, .o_kanban_record");
  pagerOk3 = /1-20 \/ 22/.test(container.textContent);
  if (!(kanbanCard && pagerOk3)) await tick();
}
ok(!!kanbanCard && kanbanCard.textContent.includes("SO001"), "list : bascule kanban -> cartes OWL rendues");
ok(pagerOk3, "list : pager recalculé après bascule");

// Retour en liste (le renderer kanban est détruit sans erreur)
const listBtn = [...container.querySelectorAll(".o_control_panel .o_cp_switch_buttons button")].find((b) => b.title === "List");
listBtn.click();
await tick(); await tick();
ok(!!container.querySelector("tr.o_data_row"), "list : retour en liste OK (kanban détruite)");

// ── 8. Pivot : placeholder ──
const pivotBtn = [...container.querySelectorAll(".o_control_panel .o_cp_switch_buttons button")].find((b) => b.title === "Pivot");
if (pivotBtn) {
  pivotBtn.click();
  await tick(); await tick();
  ok(container.textContent.includes("Pivot : à venir"), "list : pivot -> placeholder « à venir »");
  // retour liste pour le destroy propre
  listBtn.click();
  await tick(); await tick();
}

// ── 8bis. Menu Grouper par (ControlPanel OWL) ──
const gbBtn = container.querySelector(".o_control_panel .o_groupby_button");
ok(!!gbBtn, "list : bouton « Grouper par » présent");
gbBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
await tick();
const gbMenu = container.querySelector(".o_control_panel .o_groupby_menu.show");
ok(!!gbMenu, "list : menu Grouper par ouvert");
// candidats = colonnes de l'arch de type regroupable : name + partner_id
// (state n'est pas une colonne de cette arch, amount_total float exclu)
const gbItems = [...gbMenu.querySelectorAll("a.dropdown-item")].map((a) => a.textContent.trim());
ok(gbItems.join(",") === "Aucun groupe,Référence,Client",
   `list : candidats depuis le parseur (${gbItems.join(" | ")})`);
const clientItem = [...gbMenu.querySelectorAll("a.dropdown-item")].find((a) => a.textContent.includes("Client"));
clientItem.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
let groupHeader = null;
for (let i = 0; i < 200 && !groupHeader; i++) {
  groupHeader = container.querySelector("tr.o_group_header");
  if (!groupHeader) await tick();
}
ok(!!groupHeader, "list : sélection Client -> groupes rendus");
ok(container.textContent.includes("Alice"), "list : groupe many2one affiché par libellé");
// retour à plat
gbBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
await tick();
const noGroupItem = [...container.querySelectorAll(".o_groupby_menu a.dropdown-item")].find((a) => a.textContent.includes("Aucun groupe"));
noGroupItem.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
let flatAgain = false;
for (let i = 0; i < 200 && !flatAgain; i++) {
  flatAgain = container.querySelectorAll("tr.o_group_header").length === 0 && container.querySelectorAll("tr.o_data_row").length > 0;
  if (!flatAgain) await tick();
}
ok(flatAgain, "list : « Aucun groupe » -> table à plat");

// ── 9. Descripteur incomplet -> accueil ──
const container2 = document.createElement("div");
document.body.appendChild(container2);
const destroy2 = await mountView(container2, { view: "list", module: null, model: null }, envStub);
await tick(); await tick();
ok(actions.some(([a]) => a === "home_menu"), "list : descripteur incomplet -> doAction('home_menu')");
destroy2();

// ── 10. destroy ──
destroy();
await tick();
ok(container.querySelectorAll("tr.o_data_row").length === 0 && container.querySelectorAll(".o_control_panel").length === 0,
   "list : destroy -> zones retirées du DOM");

console.log("\n✅ TOUS LES TESTS CONTRÔLEUR LIST OWL PASSENT");
