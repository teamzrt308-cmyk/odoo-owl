/**
 * Test du moteur de workflow hors ligne (itération 20) :
 *  - bucket "object_action" : verrous fromStates (canRunObjectAction)
 *    et mises à jour optimistes (computeOptimisticStateUpdate) portés
 *    des méthodes Odoo 17 (sale.order, purchase.order, stock.picking) ;
 *  - cascade de calcul enrichie : remise ligne -> price_subtotal ->
 *    amount_untaxed/amount_tax/amount_total (comme _compute_amounts) ;
 *  - e2e contrôleur form : clic « Confirmer » sur un devis -> état
 *    appliqué immédiatement (re-render), boutons header permutés par
 *    leurs expressions invisible, method call en file, persistance.
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

// ── Stub Dexie ──
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
    this.reference_records = new FakeTable([
      { model: "res.partner", id: 1, display_name: "Alice" },
      { model: "product.product", id: 5, display_name: "Desk" },
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

// ── Moteur de règles (workflow inclus via allRules) ──
const { initRulesEngine, canRunObjectAction, computeOptimisticStateUpdate, runDocumentRules } =
  await import(REPO + "/static/src/model/rules_engine/rules_engine.js");
const { allRules } = await import(REPO + "/static/src/model/rules_engine/rules/index.js");
initRulesEngine(allRules);

// ── A. Verrous de workflow (canRunObjectAction) ──
let v = canRunObjectAction("sale.order", "action_confirm", { root: { state: "draft" } });
ok(v.ok === true && v.covered === true, "wf : action_confirm depuis draft -> autorisé");

v = canRunObjectAction("sale.order", "action_confirm", { root: { state: "sale" } });
ok(v.ok === false && /non applicable/.test(v.message), "wf : action_confirm depuis sale -> refusé avec message");

v = canRunObjectAction("sale.order", "action_draft", { root: { state: "sale" } });
ok(v.ok === true, "wf : action_draft depuis sale -> autorisé");

v = canRunObjectAction("sale.order", "action_confirm", { root: {} });
ok(v.ok === true, "wf : état absent -> permissif (pas de faux blocage)");

v = canRunObjectAction("sale.order", "methode_inconnue", { root: { state: "draft" } });
ok(v.ok === true && v.covered === false, "wf : méthode non couverte -> comportement historique (file)");

v = canRunObjectAction("purchase.order", "button_approve", { root: { state: "to approve" } });
ok(v.ok === true, "wf : button_approve depuis « to approve » -> autorisé");
v = canRunObjectAction("purchase.order", "button_approve", { root: { state: "draft" } });
ok(v.ok === false, "wf : button_approve depuis draft -> refusé");

v = canRunObjectAction("purchase.order", "button_confirm", { root: { state: "sent" } });
ok(v.ok === true, "wf : button_confirm depuis sent -> autorisé");

v = canRunObjectAction("stock.picking", "action_assign", { root: { state: "confirmed" } });
ok(v.ok === true, "wf : action_assign depuis confirmed -> autorisé");
v = canRunObjectAction("stock.picking", "action_assign", { root: { state: "draft" } });
ok(v.ok === false, "wf : action_assign depuis draft -> refusé");

v = canRunObjectAction("sale.order", "action_quotation_send", { root: { state: "draft" } });
ok(v.ok === true && v.covered === true, "wf : action_quotation_send (mail serveur) -> couvert sans verrou");

// ── B. Mises à jour optimistes (fusion stock_effect + object_action) ──
let opt = computeOptimisticStateUpdate("sale.order", "action_confirm", { root: { state: "draft" } });
ok(opt.root.state === "sale", "wf : action_confirm -> state optimiste « sale »");

opt = computeOptimisticStateUpdate("sale.order", "action_unlock", { root: { state: "sale" } });
ok(opt.root.locked === false, "wf : action_unlock -> locked=false");

opt = computeOptimisticStateUpdate("purchase.order", "button_done", { root: { state: "purchase" } });
ok(opt.root.state === "done", "wf : button_done -> state « done » (verrouillage)");

opt = computeOptimisticStateUpdate("stock.picking", "button_validate", { root: { state: "assigned" }, lines: {} });
ok(opt.root.state === "done" && opt.lineUpdates.picked === true,
   "wf : régression stock — button_validate garde state done + lignes picked");

opt = computeOptimisticStateUpdate("sale.order", "methode_inconnue", { root: {} });
ok(Object.keys(opt.root).length === 0 && Object.keys(opt.lineUpdates).length === 0,
   "wf : méthode non couverte -> aucune mise à jour optimiste");

// ── C. Cascade de calcul (remise -> sous-totaux -> montants commande) ──
const docGraph = {
  root: { id: 42, state: "draft", order_line: [] },
  lines: {
    order_line: {
      model: "sale.order.line",
      rows: [
        { id: 11, product_id: [5, "Desk"], product_uom_qty: 2, price_unit: 100, discount: 5 },
        { id: 12, product_id: [5, "Desk"], product_uom_qty: 2, price_unit: 70, discount: 0 },
      ],
    },
  },
};
const updatedGraph = await runDocumentRules("sale.order", docGraph);
const [l1, l2] = updatedGraph.lines.order_line.rows;
ok(l1.price_subtotal === 190, "calc : remise 5 % -> price_subtotal 190 (2×100−5 %)");
ok(l2.price_subtotal === 140, "calc : sans remise -> price_subtotal 140");
ok(updatedGraph.root.amount_untaxed === 330, "calc : amount_untaxed = Σ sous-totaux (330)");
ok(updatedGraph.root.amount_tax === 0, "calc : amount_tax = 0 hors ligne (écart documenté)");
ok(updatedGraph.root.amount_total === 330, "calc : amount_total = HT + TVA (330)");

// __subtotal générique toujours actif (règle wildcard)
const genericGraph = {
  root: {},
  lines: { order_line: { model: "autre.model", rows: [{ id: 1, __qty: 3, __price: 10 }] } },
};
const updatedGeneric = await runDocumentRules("autre.model", genericGraph);
ok(updatedGeneric.lines.order_line.rows[0].__subtotal === 30, "calc : wildcard __qty×__price->__subtotal intact");

// ── D. e2e contrôleur form : clic Confirmer -> état + boutons + file ──
const fieldsInfo = {
  name: { type: "char", label: "Référence" },
  state: {
    type: "selection", label: "État",
    selection: [["draft", "Devis"], ["sent", "Envoyé"], ["sale", "Commande client"], ["cancel", "Annulé"]],
  },
  amount_total: { type: "monetary", label: "Total" },
};
const formArch = `<form>
  <header>
    <field name="state" widget="statusbar"/>
    <button name="action_confirm" type="object" string="Confirmer" class="oe_highlight" invisible="state != 'draft' and state != 'sent'"/>
    <button name="action_draft" type="object" string="Revenir au devis" invisible="state != 'sale' and state != 'cancel'"/>
  </header>
  <sheet>
    <group>
      <field name="name"/>
      <field name="amount_total"/>
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
  data: { id: 42, name: "SO017", state: "draft", amount_total: 330, order_line: [] },
});

const { registry } = await import(REPO + "/static/src/core/registry.js");
await import(REPO + "/static/src/views/form/form_view.js");
const { mountView } = await import(REPO + "/static/src/views/view.js");
const container = document.createElement("div");
document.body.appendChild(container);
const envStub = { doAction: () => {}, goBack: () => {} };
await mountView(container, { view: "form", module: "sales", model: "sale.order", id: 42, actionId: "sale_action" }, envStub);

let formEl = null;
for (let i = 0; i < 200; i++) {
  formEl = container.querySelector(".o_form_view");
  if (formEl && formEl.querySelector("#field-name")) break;
  await tick();
}
ok(!!formEl, "wf e2e : formulaire rendu");

const visibleButtons = () =>
  [...container.querySelectorAll(".o_statusbar_buttons button")].map((b) => b.textContent.trim());
ok(visibleButtons().includes("Confirmer") && !visibleButtons().includes("Revenir au devis"),
   "wf e2e : en draft, « Confirmer » visible et « Revenir au devis » masqué (invisible)");

const confirmBtn = [...container.querySelectorAll(".o_statusbar_buttons button")].find((b) => b.textContent.trim() === "Confirmer");
confirmBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
// queueMethodCall + effets optimistes + re-render : on poll
let swapped = false;
for (let i = 0; i < 200 && !swapped; i++) {
  swapped = visibleButtons().includes("Revenir au devis") && !visibleButtons().includes("Confirmer");
  if (!swapped) await tick();
}
ok(swapped, "wf e2e : clic Confirmer -> boutons permutés (état optimiste appliqué + re-render)");

const callEntry = syncQueueRows.find((r) => {
  if (r.operation !== "call_method" || !r.payload) return false;
  const p = typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload;
  return p.method === "action_confirm";
});
ok(!!callEntry && callEntry.model_name === "sale.order", "wf e2e : method call action_confirm en file");


let sbOk = false;
for (let i = 0; i < 200 && !sbOk; i++) {
  sbOk = container.textContent.includes("Commande client");
  if (!sbOk) await tick();
}
ok(sbOk, "wf e2e : statusbar affiche « Commande client » (label selection, mount widget différé)");

// Persistance : le patch optimiste est écrit dans record_cache
// le stub pousse les put (Dexie ferait un upsert sur [model+record_id])
// -> on considère la DERNIÈRE ligne correspondante, comme le ferait Dexie
const lastCached = () => {
  const matches = db.record_cache.rows.filter((r) => r.model === "sale.order" && String(r.record_id) === "42");
  return matches.length ? matches[matches.length - 1] : null;
};
let cached = null;
for (let i = 0; i < 200 && !cached; i++) {
  cached = lastCached();
  if (cached && cached.data.state !== "sale") { cached = null; await tick(); }
}
ok(cached && cached.data.state === "sale", "wf e2e : état optimiste persisté dans record_cache");

destroyView(container);
function destroyView(c) {
  // destroy via le bouton du contrôleur n'est pas exposé ici : on vide
  // simplement le conteneur (la suite e2e vérifie le destroy ailleurs).
  c.innerHTML = "";
}

console.log("\n✅ TOUS LES TESTS WORKFLOW (règles métier + boutons) PASSENT");
