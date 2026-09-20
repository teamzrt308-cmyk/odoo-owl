/**
 * Test de fumée jsdom du renderer list OWL (itération 9) :
 *  - list_arch_parser : colonnes depuis l'arch (handle, column_invisible,
 *    string, optional, decoration-*)
 *  - ListRenderer : rendu, tri (direction + inversion), colonnes
 *    optionnelles (engrenage + persistance), sélection (ligne + tout),
 *    badges decoration-*, formats (m2o, float/monetary, boolean),
 *    état vide, clic de ligne, destroy
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

class FakeTable {
  constructor() {}
  async put() {} async bulkPut() {} async add() { return { id: 1 }; } async get() { return undefined; }
  where() { return { equals: () => ({ toArray: async () => [] }), toArray: async () => [] }; }
}
globalThis.Dexie = class {
  constructor() { for (const t of ["sync_queue", "reference_records", "cache_meta", "catalog_cache", "security_info", "module_manifests", "record_cache", "installed_apps", "list_cache", "local_ledger"]) this[t] = new FakeTable(); }
  version() { return { stores() {} }; }
  transaction() {}
};

const { mountListView } = await import(REPO + "/static/src/views/list/list_renderer.js");
const { parseListArch } = await import(REPO + "/static/src/views/list/list_arch_parser.js");

const fieldsInfo = {
  sequence: { type: "integer", label: "Séq." },
  name: { type: "char", label: "Référence" },
  partner_id: { type: "many2one", relation: "res.partner", label: "Client" },
  amount_total: { type: "monetary", label: "Total" },
  state: { type: "selection", label: "État", selection: [["draft", "Brouillon"], ["done", "Validé"]] },
  active: { type: "boolean", label: "Actif" },
  internal_note: { type: "char", label: "Note interne" },
};

const arch = `<list>
  <field name="sequence" widget="handle"/>
  <field name="name" string="Numéro"/>
  <field name="partner_id"/>
  <field name="amount_total"/>
  <field name="state" decoration-success="state == 'done'" decoration-danger="state == 'draft'"/>
  <field name="active"/>
  <field name="internal_note" column_invisible="1"/>
  <field name="hidden_by_default" optional="hide"/>
</list>`;
// hidden_by_default absent de fieldsInfo -> ignoré par le parseur (comme l'ancien)
const archUsable = arch.replace('<field name="hidden_by_default" optional="hide"/>',
  '<field name="internal_note" optional="hide"/>');

const records = [
  { id: 1, sequence: 2, name: "SO002", partner_id: [2, "Bob"], amount_total: 120.5, state: "draft", active: true, internal_note: "n1" },
  { id: 2, sequence: 1, name: "SO001", partner_id: [1, "Alice"], amount_total: 99, state: "done", active: false, internal_note: "n2" },
];

// ── 1. parseListArch ──
{
  const parsed = parseListArch(archUsable, fieldsInfo);
  ok(!parsed.error && Array.isArray(parsed.columns), "list-owl : parseListArch -> colonnes");
  const names = parsed.columns.map((c) => c.field);
  ok(!names.includes("sequence"), "list-owl : widget=handle exclu");
  // internal_note apparaît 2x dans l'arch : column_invisible='1' exclu,
  // la déclaration optional=hide incluse (une seule fois au final).
  ok(names.filter((n) => n === "internal_note").length === 1, "list-owl : column_invisible='1' exclu, optional gardé");
  ok(names.join(",") === "name,partner_id,amount_total,state,active,internal_note",
     "list-owl : ordre des colonnes de l'arch (optional=hide gardé)");
  ok(parsed.columns[0].label === "Numéro", "list-owl : label depuis l'attribut string");
  const stateCol = parsed.columns.find((c) => c.field === "state");
  ok(stateCol.decoration.success === "state == 'done'", "list-owl : decorations extraites de l'arch");
  const bad = parseListArch("<not-xml", fieldsInfo);
  ok(!!bad.error, "list-owl : arch invalide -> erreur explicite");
}

// ── 2. Rendu + formats ──
const target = document.createElement("div");
document.body.appendChild(target);
localStorage.clear();
const clicks = [];
const { destroy } = await mountListView(target, archUsable, fieldsInfo, records, (id) => clicks.push(id), "test_model");
await tick(); await tick();

const rows = () => [...target.querySelectorAll("tr.o_data_row")];
ok(rows().length === 2, "list-owl : 2 lignes rendues");
ok(rows()[0].querySelector("td.o_data_cell").textContent === "SO002", "list-owl : cellule char");
ok(rows()[1].querySelector("td.o_data_cell").textContent === "SO001", "list-owl : ordre des records (pas de tri initial)");
ok(target.querySelector('[data-name="partner_id"]') && target.querySelector('[data-name="partner_id"]').textContent === "Client",
   "list-owl : en-tête avec label fields_get");
ok(rows()[1].cells[2].textContent === "Alice", "list-owl : tuple m2o -> libellé");
const money = rows()[0].cells[3];
ok(money.textContent === "120.50" && money.querySelector(".fw-bold"), "list-owl : monetary -> toFixed(2) + gras");
const badge = rows()[0].cells[4].querySelector(".badge");
ok(badge && badge.textContent === "Brouillon" && badge.className.includes("text-bg-danger"),
   "list-owl : badge selection + decoration-danger");
const badge2 = rows()[1].cells[4].querySelector(".badge");
ok(badge2.className.includes("text-bg-success"), "list-owl : decoration-success sur l'autre état");
ok(rows()[0].cells[5].textContent === "✓" && rows()[1].cells[5].textContent === "",
   "list-owl : boolean -> ✓/vide");
ok(!target.querySelector('[data-name="internal_note"]'), "list-owl : colonne optional=hide masquée par défaut");

// ── 3. Tri ──
target.querySelector('th[data-name="name"]').dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
await tick();
ok(rows()[0].querySelector("td.o_data_cell").textContent === "SO001", "list-owl : tri asc sur name");
ok(target.querySelector('th[data-name="name"] .fa-angle-down:not(.opacity-0)'), "list-owl : icône asc");
target.querySelector('th[data-name="name"]').dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
await tick();
ok(rows()[0].querySelector("td.o_data_cell").textContent === "SO002", "list-owl : second clic -> tri desc");

// ── 4. Colonnes optionnelles : engrenage + persistance ──
const gear = target.querySelector(".o_optional_columns_dropdown_toggle");
ok(!!gear, "list-owl : engrenage présent");
gear.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
await tick();
const menu = target.querySelector(".o_optional_columns_dropdown.show");
ok(!!menu, "list-owl : menu optionnel ouvert au clic");
const optCheckbox = menu.querySelector('input[type=checkbox]');
ok(optCheckbox && !optCheckbox.checked, "list-owl : optional=hide décochée");
optCheckbox.checked = true;
optCheckbox.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
await tick();
ok(!!target.querySelector('[data-name="internal_note"]'), "list-owl : colonne ré-affichée via l'engrenage");
const saved = JSON.parse(localStorage.getItem("pwa_optional_columns:test_model") || "{}");
ok(saved.internal_note === true, "list-owl : préférence persistée par modèle");
// clic extérieur -> menu fermé
document.body.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
await tick();
ok(!target.querySelector(".o_optional_columns_dropdown.show"), "list-owl : clic extérieur ferme le menu (useExternalListener)");

// ── 5. Sélection ──
const rowCheckbox = rows()[0].querySelector('input[type=checkbox]');
rowCheckbox.click();
await tick();
ok(target._owlRowsSelected === undefined || true, "list-owl : (sanity)");
// le clic sur la checkbox ne doit PAS déclencher le clic de ligne
ok(clicks.length === 0, "list-owl : clic checkbox sans propagation (pas de doAction)");
const selAll = target.querySelector(".o_list_record_selector thead input, thead .o_list_record_selector input");
target.querySelector("thead .o_list_record_selector input").click();
await tick();
ok(target.querySelectorAll("tbody input[type=checkbox]:checked").length === 2, "list-owl : tout sélectionner -> 2 cochées");
target.querySelector("thead .o_list_record_selector input").click();
await tick();
ok(target.querySelectorAll("tbody input[type=checkbox]:checked").length === 0, "list-owl : décocher tout");

// ── 6. Clic de ligne ──
rows()[0].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
await tick();
// après le tri desc de la section 3, rows()[0] = SO002 (id 1)
ok(clicks.join(",") === "1", "list-owl : clic ligne -> onRowClick(id)");

// ── 7. État vide ──
const target2 = document.createElement("div");
document.body.appendChild(target2);
const second = await mountListView(target2, archUsable, fieldsInfo, [], null, "test_model");
await tick(); await tick();
ok(target2.textContent.includes("Aucun enregistrement."), "list-owl : état vide");
second.destroy();
ok(target2.childElementCount === 0, "list-owl : destroy -> DOM retiré");

destroy();
ok(target.childElementCount === 0, "list-owl : destroy du mount principal -> DOM retiré");

// ── 8. Group by (itération 10) ──
const gbFields = {
  name: { type: "char", label: "Référence" },
  partner_id: { type: "many2one", relation: "res.partner", label: "Client" },
  amount_total: { type: "monetary", label: "Total" },
  state: { type: "selection", label: "État", selection: [["draft", "Brouillon"], ["done", "Validé"]] },
  active: { type: "boolean", label: "Actif" },
};
const gbArch = `<list><field name="name"/><field name="partner_id"/><field name="amount_total"/><field name="state"/><field name="active"/></list>`;
const gbRecords = [
  { id: 1, name: "SO001", partner_id: [1, "Alice"], amount_total: 100, state: "done", active: true },
  { id: 2, name: "SO002", partner_id: [1, "Alice"], amount_total: 50.5, state: "draft", active: false },
  { id: 3, name: "SO003", partner_id: [2, "Bob"], amount_total: 30, state: "draft", active: true },
  { id: 4, name: "SO004", partner_id: false, amount_total: 10, state: "draft", active: false },
];

// many2one : groupes par libellé, somme du montant, groupe "Aucun"
const gbTarget = document.createElement("div");
document.body.appendChild(gbTarget);
const gbHandle = await mountListView(gbTarget, gbArch, gbFields, gbRecords, null, "gb_model", "partner_id");
await tick(); await tick();
const headers = [...gbTarget.querySelectorAll("tr.o_group_header")];
ok(headers.length === 3, "list-owl groupby : 3 groupes (Alice, Bob, Aucun)");
ok(headers.map((h) => h.querySelector("span").textContent).join(",") === "Alice,Aucun,Bob",
   "list-owl groupby : libellés triés avec « Aucun » en milieu alphabétique");
ok(headers[0].querySelector(".o_group_count").textContent === "(2)", "list-owl groupby : compteur (2)");
const aliceSum = headers[0].textContent;
ok(aliceSum.includes("150.50"), "list-owl groupby : somme des montants du groupe (150.50)");
ok(gbTarget.querySelectorAll("tr.o_data_row").length === 4, "list-owl groupby : 4 lignes déployées");

// dépli/repli réactif au clic d'en-tête
headers[0].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
await tick();
ok(gbTarget.querySelectorAll("tr.o_data_row").length === 2, "list-owl groupby : clic en-tête -> groupe replié (2 lignes restantes)");
ok(headers[0] && gbTarget.querySelectorAll("tr.o_group_header")[0].querySelector(".fa-caret-right"),
   "list-owl groupby : caret droit quand replié");
gbTarget.querySelectorAll("tr.o_group_header")[0].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
await tick();
ok(gbTarget.querySelectorAll("tr.o_data_row").length === 4, "list-owl groupby : re-déplié");

// selection -> libellés ; boolean -> Oui/Non
const gbTarget2 = document.createElement("div");
document.body.appendChild(gbTarget2);
await mountListView(gbTarget2, gbArch, gbFields, gbRecords, null, "gb_model", "state");
await tick(); await tick();
const selHeaders = [...gbTarget2.querySelectorAll("tr.o_group_header")].map((h) => h.querySelector("span").textContent);
ok(selHeaders.join(",") === "Brouillon,Validé", "list-owl groupby : groupes selection par libellé");
gbTarget2.querySelectorAll("tr.o_group_header")[0].parentElement; // noop
const gbTarget3 = document.createElement("div");
document.body.appendChild(gbTarget3);
await mountListView(gbTarget3, gbArch, gbFields, gbRecords, null, "gb_model", "active");
await tick(); await tick();
const boolHeaders = [...gbTarget3.querySelectorAll("tr.o_group_header")].map((h) => h.querySelector("span").textContent);
ok(boolHeaders.join(",") === "Non,Oui", "list-owl groupby : groupes boolean Oui/Non");

// groupBy null -> table à plat sans en-tête
const gbTarget4 = document.createElement("div");
document.body.appendChild(gbTarget4);
await mountListView(gbTarget4, gbArch, gbFields, gbRecords, null, "gb_model", null);
await tick(); await tick();
ok(gbTarget4.querySelectorAll("tr.o_group_header").length === 0 && gbTarget4.querySelectorAll("tr.o_data_row").length === 4,
   "list-owl groupby : null -> table à plat");

// groupBy + état vide
const gbTarget5 = document.createElement("div");
document.body.appendChild(gbTarget5);
await mountListView(gbTarget5, gbArch, gbFields, [], null, "gb_model", "partner_id");
await tick(); await tick();
ok(gbTarget5.textContent.includes("Aucun enregistrement."), "list-owl groupby : vide -> message unique");
gbHandle.destroy();

console.log("\n✅ TOUS LES TESTS LIST OWL PASSENT");
