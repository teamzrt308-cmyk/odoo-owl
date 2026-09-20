/**
 * Test de fumée jsdom du contrôleur kanban dédié + colonnes de group by
 * (itération 11) :
 *  - parseKanbanArch : default_group_by + champs du template
 *  - mountKanbanView(groupBy) : colonnes (libellé, compteur, cartes)
 *  - KanbanController e2e : descripteur { Controller }, default_group_by
 *    appliqué, menu Grouper par (candidats depuis le template), retour à
 *    plat, recherche, clic carte -> form_view, switch vers la liste ->
 *    doAction(list_view), guard, destroy
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
    this.reference_records = new FakeTable();
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
  state: { type: "selection", label: "État", selection: [["draft", "Brouillon"], ["done", "Validé"]] },
  amount_total: { type: "monetary", label: "Total" },
};

const kanbanArch = `<?xml version="1.0"?>
<kanban default_group_by="state">
  <field name="name"/>
  <field name="amount_total"/>
  <templates>
    <t t-name="kanban-box">
      <div class="oe_kanban_card oe_kanban_global_click">
        <strong class="o_kanban_record_title"><field name="name"/></strong>
      </div>
    </t>
  </templates>
</kanban>`;
const listArch = `<list><field name="name"/></list>`;

const records = [
  { id: 1, name: "SO001", state: "done", amount_total: 100 },
  { id: 2, name: "SO002", state: "draft", amount_total: 50 },
  { id: 3, name: "SO003", state: "draft", amount_total: 30 },
  { id: 4, name: "SO004", state: false, amount_total: 10 },
];

// ── 1. parseKanbanArch : defaultGroupBy + fields ──
const { parseKanbanArch } = await import(REPO + "/static/src/views/kanban/kanban_arch_parser.js");
{
  const parsed = parseKanbanArch(kanbanArch);
  ok(!parsed.error && parsed.defaultGroupBy === "state", "kanban-ctrl : default_group_by extrait de l'arch");
  ok(parsed.fields.join(",") === "name,amount_total", "kanban-ctrl : champs du template collectés");
}

// ── 2. mountKanbanView avec groupBy : colonnes ──
const { mountKanbanView } = await import(REPO + "/static/src/views/kanban/kanban_renderer.js");
{
  const target = document.createElement("div");
  document.body.appendChild(target);
  const { destroy } = await mountKanbanView(target, kanbanArch, fieldsInfo, records, null, "state");
  await tick(); await tick();
  const groups = [...target.querySelectorAll(".o_kanban_group")];
  ok(groups.length === 3, "kanban-ctrl : 3 colonnes (Brouillon, Validé, Aucun)");
  const titles = groups.map((g) => g.querySelector(".o_kanban_group_title").textContent);
  ok(titles.join(",") === "Aucun,Brouillon,Validé", `kanban-ctrl : colonnes triées par libellé (${titles.join(" | ")})`);
  const counts = groups.map((g) => g.querySelector(".o_kanban_count").textContent);
  ok(counts.join(",") === "1,2,1", "kanban-ctrl : compteurs par colonne");
  const cards = [...groups[1].querySelectorAll(".o_kanban_record")];
  ok(cards.length === 2 && cards[0].textContent.includes("SO002"), "kanban-ctrl : cartes dans la bonne colonne");
  ok(target.querySelector(".o_kanban_renderer.o_kanban_grouped"), "kanban-ctrl : conteneur o_kanban_grouped");
  destroy();
  ok(target.childElementCount === 0, "kanban-ctrl : destroy -> DOM retiré");

  // à plat : groupBy null
  const target2 = document.createElement("div");
  document.body.appendChild(target2);
  await mountKanbanView(target2, kanbanArch, fieldsInfo, records, null);
  await tick(); await tick();
  ok(target2.querySelector(".o_kanban_renderer.o_kanban_ungrouped") && target2.querySelectorAll(".o_kanban_record").length === 4,
     "kanban-ctrl : groupBy null -> grille à plat (4 cartes)");
  document.body.removeChild(target2);
}

// ── 3. KanbanController e2e ──
const { db } = await import(REPO + "/static/src/core/orm_service.js");
await db.module_manifests.put({
  technical_name: "sales",
  fields: { "crm.lead": fieldsInfo },
  views: { "crm.lead": { default: { kanban: { arch: kanbanArch }, list: { arch: listArch } } } },
});
await db.list_cache.put({ model: "crm.lead::lead_action", records, total: records.length });

const { initRulesEngine } = await import(REPO + "/static/src/model/rules_engine/rules_engine.js");
const { allRules } = await import(REPO + "/static/src/model/rules_engine/rules/index.js");
initRulesEngine(allRules);

const { registry } = await import(REPO + "/static/src/core/registry.js");
await import(REPO + "/static/src/views/view.js");
const kanbanDescriptor = registry.category("views").get("kanban");
ok(kanbanDescriptor.Controller && kanbanDescriptor.Controller.name === "KanbanController",
   "kanban-ctrl : descripteur -> { Controller: KanbanController } (dédié)");

const { mountView } = await import(REPO + "/static/src/views/view.js");
const container = document.createElement("div");
document.body.appendChild(container);
const actions = [];
const envStub = { doAction: (a, o) => actions.push([a, o]), goBack: () => {} };

const destroy = await mountView(container, { view: "kanban", module: "sales", model: "crm.lead", actionId: "lead_action", label: "Opportunités" }, envStub);
ok(typeof destroy === "function", "kanban-ctrl : mountView retourne destroy()");

// default_group_by appliqué automatiquement
let groups = null;
for (let i = 0; i < 200; i++) {
  groups = container.querySelectorAll(".o_kanban_group");
  if (groups.length > 0) break;
  await tick();
}
ok(groups && groups.length === 3, "kanban-ctrl : contrôleur -> colonnes rendues (default_group_by)");
ok(container.querySelector(".o_control_panel"), "kanban-ctrl : control panel présent");
ok(container.querySelector(".o_groupby_button"), "kanban-ctrl : menu Grouper par présent");

// candidats depuis le template kanban (name ; amount_total monetary exclu)
container.querySelector(".o_groupby_button").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
await tick();
const items = [...container.querySelectorAll(".o_groupby_menu a.dropdown-item")].map((a) => a.textContent.trim());
ok(items.join(",") === "Aucun groupe,Référence", `kanban-ctrl : candidats depuis le template (${items.join(" | ")})`);

// retour à plat via « Aucun groupe »
const noGroup = [...container.querySelectorAll(".o_groupby_menu a.dropdown-item")].find((a) => a.textContent.includes("Aucun groupe"));
noGroup.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
let flat = false;
for (let i = 0; i < 200 && !flat; i++) {
  flat = container.querySelector(".o_kanban_renderer.o_kanban_ungrouped") && container.querySelectorAll(".o_kanban_record").length === 4;
  if (!flat) await tick();
}
ok(flat, "kanban-ctrl : « Aucun groupe » -> grille à plat");

// recherche -> filtre les cartes
const searchInput = container.querySelector(".o_control_panel .o_searchview_input");
searchInput.value = "SO003";
searchInput.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
let cardsAfterSearch = 0;
for (let i = 0; i < 200 && cardsAfterSearch !== 1; i++) {
  cardsAfterSearch = container.querySelectorAll(".o_kanban_record").length;
  if (cardsAfterSearch !== 1) await tick();
}
ok(cardsAfterSearch === 1 && container.textContent.includes("SO003"), "kanban-ctrl : recherche filtre les cartes");

// reset recherche, clic carte -> form_view
searchInput.value = "";
searchInput.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
let cardsBack = 0;
for (let i = 0; i < 200 && cardsBack !== 4; i++) {
  cardsBack = container.querySelectorAll(".o_kanban_record").length;
  if (cardsBack !== 4) await tick();
}
container.querySelector(".o_kanban_record").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
await tick();
const cardAction = actions[actions.length - 1];
ok(cardAction && cardAction[0].tag === "form_view" && typeof cardAction[0].id === "number",
   "kanban-ctrl : clic carte -> doAction form_view (id)");

// bascule vers la liste : remonte au dispatcher
const listBtn = [...container.querySelectorAll(".o_cp_switch_buttons button")].find((b) => b.title === "List");
ok(!!listBtn, "kanban-ctrl : bouton List du view switcher");
listBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
await tick();
const switchAction = actions[actions.length - 1];
ok(switchAction && switchAction[0].tag === "list_view" && switchAction[0].model === "crm.lead",
   "kanban-ctrl : switch list -> doAction(list_view)");

// guard descripteur incomplet
const container2 = document.createElement("div");
document.body.appendChild(container2);
const destroy2 = await mountView(container2, { view: "kanban", module: null, model: null }, envStub);
await tick(); await tick();
ok(actions.some(([a]) => a === "home_menu"), "kanban-ctrl : descripteur incomplet -> doAction('home_menu')");
destroy2();

// destroy
destroy();
await tick();
ok(container.querySelectorAll(".o_kanban_record").length === 0 && container.querySelectorAll(".o_control_panel").length === 0,
   "kanban-ctrl : destroy -> zones retirées du DOM");

console.log("\n✅ TOUS LES TESTS CONTRÔLEUR KANBAN OWL PASSENT");
