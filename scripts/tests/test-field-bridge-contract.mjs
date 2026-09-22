/**
 * Test du CONTRAT field_bridge (principe architectural du moteur hors
 * ligne : Arch XML -> sérialisation -> field_bridge -> DOM, SANS
 * composants <Field> OWL) :
 *  - valeur/type   : couverts par test-widgets-owl / test-relational-owl ;
 *  - invisible     : ré-évaluation LIVE (cellule masquée/rendue) ;
 *  - required      : attribut + marqueur visuel sur la cellule ;
 *  - readonly      : ré-évaluation live (déjà couvert) ;
 *  - événements    : les widgets OWL relationnels diffusent `change` ->
 *                    règles RACINE recalculées (amount_total après edit
 *                    d'une LIGNE one2many) ;
 *  - widget        : registre widget="..." (test-widgets-owl).
 * Boot via mountView (contrôleur form complet : listeners câblés).
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
  async toArray() { return [...this.rows]; }
  where(clause) {
    const rows = this.rows;
    return {
      equals: () => ({ toArray: async () => rows, first: async () => rows[0], count: async () => rows.length }),
      toArray: async () => rows.filter((r) => Object.entries(clause || {}).every(([k, v]) => r[k] === v)),
    };
  }
}
class FakeDexie {
  constructor() {
    this.sync_queue = new FakeTable(syncQueueRows);
    // price présent : l'onchange produit reprend TOUJOURS le prix du
    // catalogue à chaque passe (comme Odoo recharge le prix).
    this.reference_records = new FakeTable([
      { model: "product.product", id: 5, display_name: "Desk", price: 50 },
    ]);
    this.cache_meta = new FakeTable();
    this.catalog_cache = new FakeTable();
    this.security_info = new FakeTable();
    this.module_manifests = new FakeTable([], (r, k) => r.technical_name === k);
    this.record_cache = new FakeTable([], (r, k) => Array.isArray(k) && r.model === k[0] && String(r.record_id) === String(k[1]));
    this.installed_apps = new FakeTable();
    this.local_ledger = new FakeTable();
  }
  version() { return { stores() {} }; }
  transaction() {}
}
globalThis.Dexie = FakeDexie;

const { initRulesEngine } = await import(REPO + "/static/src/model/rules_engine/rules_engine.js");
const { allRules } = await import(REPO + "/static/src/model/rules_engine/rules/index.js");
initRulesEngine(allRules);

// ── Amorçage : commande avec 1 ligne (1 × 50 = 50) ──
const fieldsInfo = {
  state: { type: "selection", label: "État", selection: [["draft", "Devis"], ["done", "Validé"]] },
  internal_note: { type: "char", label: "Note interne" },
  delivery_note: { type: "char", label: "Conditions" },
  amount_total: { type: "monetary", label: "Total" },
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
  <header><field name="state" widget="statusbar"/></header>
  <sheet>
    <group>
      <field name="state"/>
      <field name="internal_note" invisible="state == 'done'"/>
      <field name="delivery_note" required="state == 'done'"/>
      <field name="amount_total"/>
      <field name="order_line"/>
    </group>
  </sheet>
</form>`;

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
  model: "sale.order", record_id: 42,
  data: {
    id: 42, name: "SO017", state: "draft", amount_total: 50, delivery_note: "",
    order_line: [{ id: 11, product_id: [5, "Desk"], product_uom_qty: 1, price_unit: 50, price_subtotal: 50 }],
  },
});

const { mountView } = await import(REPO + "/static/src/views/view.js");
const container = document.createElement("div");
document.body.appendChild(container);
await mountView(container, { view: "form", module: "sales", model: "sale.order", id: 42, actionId: "sale_action" }, { doAction: () => {}, goBack: () => {} });

let formEl = null;
for (let i = 0; i < 200; i++) {
  formEl = container.querySelector(".o_form_view");
  if (formEl && formEl.querySelector("#field-state")) break;
  await tick();
}
ok(!!formEl, "contrat : formulaire rendu");

const noteCell = () => container.querySelector('[data-field-row="internal_note"]');
const deliveryCell = () => container.querySelector('[data-field-row="delivery_note"]');

// ── 1. INVISIBLE dynamique LIVE ──
ok(noteCell() && noteCell().style.display !== "none", "contrat : en draft, la note interne est visible");
const stateSelect = container.querySelector("#field-state");
stateSelect.value = "done";
stateSelect.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
let hiddenOk = false;
for (let i = 0; i < 200 && !hiddenOk; i++) {
  hiddenOk = noteCell() && noteCell().style.display === "none";
  if (!hiddenOk) await tick();
}
ok(hiddenOk, "contrat : state=done -> note interne masquée SANS re-render (invisible live)");
ok(deliveryCell().classList.contains("o_field_required"),
   "contrat : state=done -> marqueur visuel required sur « Conditions » (o_field_required)");

// retour en draft : reset -> visible + marqueur retiré
stateSelect.value = "draft";
stateSelect.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
let resetOk = false;
for (let i = 0; i < 200 && !resetOk; i++) {
  resetOk = noteCell().style.display !== "none" && !deliveryCell().classList.contains("o_field_required");
  if (!resetOk) await tick();
}
ok(resetOk, "contrat : retour draft -> cellule rendue + marqueur required retiré (reset avant ré-évaluation)");

// ── 2. ÉVÉNEMENTS : une LIGNE o2m modifiée recalcule la RACINE ──
const o2mHost = container.querySelector('[data-one2many="order_line"] [data-o2m-root="true"]');
ok(!!o2mHost && o2mHost._owlOne2many, "contrat : widget o2m monté (APIs sur l'hôte)");
const comp = o2mHost._owlComponent;
ok(!!comp && typeof comp.onCellChange === "function", "contrat : composant o2m exposé via field_bridge (_owlComponent)");

// édition réelle d'une cellule : qty 1 -> 3 (onCellChange = chemin des
// inputs réels) -> runLineRules (sous-total 150) -> `change` diffusé ->
// scheduleDocumentRulesSync -> runDocumentRules RACINE -> amount_total 150
comp.onCellChange(comp.lineItems[0], { field: "product_uom_qty" }, 3);
let totalOk = false;
for (let i = 0; i < 200 && !totalOk; i++) {
  const el = container.querySelector("#field-amount_total");
  totalOk = el && Math.abs(parseFloat(el.value) - 150) < 0.001;
  if (!totalOk) await tick();
}
ok(totalOk, "contrat : qty ligne 1->3 => amount_total RACINE 150 (événement o2m -> règles racine)");

// ── 3. Le sérialiseur lit toujours le contrat (#field-<name>) ──
const { collectFormData } = await import(REPO + "/static/src/views/form/form_serializer.js");
const data = collectFormData(container.querySelector(".o_form_view"), fieldsInfo);
ok(data.state === "draft" && data.amount_total === 150, "contrat : collectFormData -> état + total cohérents");
ok(Array.isArray(data.order_line) && data.order_line[0].product_uom_qty === 3,
   "contrat : collectFormData -> lignes o2m via getLines()");

console.log("\n✅ TOUS LES TESTS CONTRAT FIELD_BRIDGE PASSENT");
