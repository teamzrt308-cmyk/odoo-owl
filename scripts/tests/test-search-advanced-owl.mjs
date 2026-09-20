/**
 * Test jsdom du search avancé -- filtres + favoris (itération 12) :
 *  - parseSearchArch : filtres (domaine), filtres de groupe (context) ;
 *  - repli : filtres dérivés des champs selection ;
 *  - ControlPanel e2e : menus Filtres/Favoris, facettes actives ;
 *  - ListController e2e : filtrage client (ET), enregistrement d'un
 *    favori (requête + filtres + group by), restauration sur un mount
 *    frais, suppression ; candidats « Grouper par » fusionnés avec les
 *    filtres de groupe du <search>.
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tick = () => sleep(25);

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
localStorage.clear();

class FakeTable {
  constructor(rows = [], keyFn = null) { this.rows = rows; this.keyFn = keyFn; }
  async put(obj) { this.rows.push(obj); }
  async bulkPut() {}
  async add(obj) { this.rows.push(obj); return { id: this.rows.length }; }
  async update() {}
  async get(key) { return this.keyFn ? (this.rows.find((r) => this.keyFn(r, key)) || undefined) : undefined; }
  where(clause) {
    const rows = this.rows;
    return {
      equals: () => ({ toArray: async () => rows, count: async () => rows.length }),
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

const searchArch = `<?xml version="1.0"?>
<search>
  <field name="name"/>
  <filter name="filter_done" string="Validés" domain="[('state','=','done')]"/>
  <filter name="filter_draft" string="Brouillons" domain="[('state','=','draft')]"/>
  <filter name="filter_amount" string="Avec montant" domain="[('amount_total','>',0)]"/>
  <group expand="0" string="Group By">
    <filter name="group_state" string="État" context="{'group_by': 'state'}"/>
  </group>
</search>`;

const listArch = `<list><field name="name"/><field name="state"/><field name="amount_total"/></list>`;

const records = [
  { id: 1, name: "SO001", state: "draft", amount_total: 100 },
  { id: 2, name: "SO002", state: "draft", amount_total: 0 },
  { id: 3, name: "SO003", state: "done", amount_total: 30 },
  { id: 4, name: "SO004", state: "done", amount_total: 0 },
];

// ── 1. parseSearchArch ──
const { parseSearchArch, parseSearchDomain, parseGroupByContext } = await import(REPO + "/static/src/search/search_arch_parser.js");
{
  const parsed = parseSearchArch(searchArch);
  ok(!parsed.error && parsed.filters.length === 3, "search : 3 filtres extraits de l'arch <search>");
  ok(parsed.filters[0].name === "filter_done" && parsed.filters[0].label === "Validés" &&
     JSON.stringify(parsed.filters[0].domain) === '[["state","=","done"]]',
     "search : domaine à quotes simples converti ([('state','=','done')])");
  ok(parsed.groupBys.length === 1 && parsed.groupBys[0].fieldName === "state",
     "search : filtre de groupe extrait du context { 'group_by': 'state' }");
  ok(parseSearchDomain("[('a','=','b')]")[0][0] === "a" && parseSearchDomain(null) === null,
     "search : parseSearchDomain tolère null");
  ok(parseGroupByContext("{'group_by':'name'}") === "name", "search : parseGroupByContext sans espace");

  const { buildSelectionFilters } = await import(REPO + "/static/src/search/search_utils.js");
  const fallback = buildSelectionFilters(fieldsInfo);
  ok(fallback.length === 2 && fallback[0].name === "state:draft" && fallback[0].label === "État : Brouillon",
     "search : repli filtres selection (« État : Brouillon »)");
}

// ── 2. E2E ListController avec arch <search> ──
const { db } = await import(REPO + "/static/src/core/orm_service.js");
await db.module_manifests.put({
  technical_name: "sales",
  fields: { "crm.lead": fieldsInfo },
  views: {
    "crm.lead": {
      default: { list: { arch: listArch }, search: { arch: searchArch } },
    },
  },
});
await db.list_cache.put({ model: "crm.lead::lead_action", records, total: records.length });
// deuxième jeu SANS arch search (repli selection)
await db.module_manifests.put({
  technical_name: "plain",
  fields: { "res.partner": fieldsInfo },
  views: { "res.partner": { default: { list: { arch: listArch } } } },
});
await db.list_cache.put({ model: "res.partner::plain_action", records, total: records.length });

const { initRulesEngine } = await import(REPO + "/static/src/model/rules_engine/rules_engine.js");
const { allRules } = await import(REPO + "/static/src/model/rules_engine/rules/index.js");
initRulesEngine(allRules);

const { mountView } = await import(REPO + "/static/src/views/view.js");
const envStub = { doAction: () => {}, goBack: () => {} };
const click = (el) => el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
const waitFor = async (fn, label) => {
  for (let i = 0; i < 200; i++) {
    if (fn()) return true;
    await tick();
  }
  ok(false, "timeout : " + label);
  return false;
};

const container = document.createElement("div");
document.body.appendChild(container);
let destroy = await mountView(container, { view: "list", module: "sales", model: "crm.lead", actionId: "lead_action", label: "Opportunités" }, envStub);

// start() est async (manifest puis candidats) : polling, pas d'assertion immédiate.
await waitFor(() => container.querySelector(".o_filters_button"), "bouton Filtres rendu");
ok(container.querySelector(".o_filters_button"), "list e2e : bouton Filtres présent");
ok(container.querySelector(".o_favorites_button"), "list e2e : bouton Favoris présent");

// menu Filtres : candidats de l'arch <search>
click(container.querySelector(".o_filters_button"));
await waitFor(() => container.querySelector(".o_filters_menu"), "menu Filtres ouvert");
let items = [...container.querySelectorAll(".o_filters_menu a.dropdown-item")].map((a) => a.textContent.trim());
ok(items.join(",") === "Validés,Brouillons,Avec montant", `search : items du menu Filtres (${items.join(" | ")})`);

// activation « Validés » : le menu reste ouvert, facette + filtrage
click([...container.querySelectorAll(".o_filters_menu a.dropdown-item")][0]);
await waitFor(() => container.querySelector(".o_searchview_facet"), "facette affichée");
ok(container.querySelector(".o_searchview_facet").textContent.includes("Validés"), "search : facette « Validés »");
let rows = () => container.querySelectorAll(".o_data_row").length;
await waitFor(() => rows() === 2, "lignes filtrées (2 validées)");
ok(rows() === 2, "search : filtre Validés -> 2 lignes (SO003/SO004)");
ok(container.querySelector(".o_filters_menu"), "search : le menu Filtres reste ouvert après bascule");
ok([...container.querySelectorAll(".o_filters_menu a.dropdown-item")][0].classList.contains("active"),
   "search : item actif coché");

// deuxième filtre : ET (Validés ET Avec montant -> SO003 seulement)
click([...container.querySelectorAll(".o_filters_menu a.dropdown-item")][2]);
await waitFor(() => rows() === 1, "intersection des deux filtres");
ok(rows() === 1 && container.textContent.includes("SO003"), "search : ET entre filtres (Validés + montant > 0)");

// retrait par la facette
click(container.querySelector(".o_searchview_facet .o_facet_remove"));
await waitFor(() => rows() === 2, "facette retirée -> 2 lignes");
ok(container.querySelectorAll(".o_searchview_facet").length === 1, "search : retrait d'une facette via ×");

// « Grouper par » : candidats fusionnés (arch liste + filtre de groupe)
click(container.querySelector(".o_groupby_button"));
await waitFor(() => container.querySelector(".o_groupby_menu"), "menu Grouper par ouvert");
const groupItems = [...container.querySelectorAll(".o_groupby_menu a.dropdown-item")].map((a) => a.textContent.trim());
// Référence + État viennent de l'arch liste ; « État » existait déjà ->
// dédoublonné (le filtre de groupe <search> n'ajoute rien de neuf ici).
ok(groupItems.join(",") === "Aucun groupe,Référence,État", `search : candidats fusionnés (${groupItems.join(" | ")})`);
click([...container.querySelectorAll(".o_groupby_menu a.dropdown-item")].find((a) => a.textContent.includes("État")));
await waitFor(() => container.querySelector(".o_group_header"), "groupe par État actif");

// enregistrement du favori (filtre actif + group by)
click(container.querySelector(".o_favorites_button"));
await waitFor(() => container.querySelector(".o_favorites_menu"), "menu Favoris ouvert");
click(container.querySelector(".o_add_favorite"));
await waitFor(() => container.querySelector(".o_favorite_name_input"), "champ nom du favori");
const favInput = container.querySelector(".o_favorite_name_input");
favInput.value = "Validés par état";
favInput.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
click(container.querySelector(".o_save_favorite_button"));
await waitFor(() => container.querySelectorAll(".o_favorites_menu .dropdown-item").length >= 1, "favori enregistré");
ok(JSON.parse(localStorage.getItem("pwa_search_favorites:crm.lead")).length === 1, "search : favori persisté (localStorage)");
ok(container.querySelector(".o_favorites_menu .active"), "search : favori courant coché");

// mount FRAIS (re-visite) : restauration du favori
destroy();
await tick();
const container2 = document.createElement("div");
document.body.appendChild(container2);
destroy = await mountView(container2, { view: "list", module: "sales", model: "crm.lead", actionId: "lead_action", label: "Opportunités" }, envStub);
await waitFor(() => container2.querySelector(".o_favorites_button"), "second mount prêt");
click(container2.querySelector(".o_favorites_button"));
await waitFor(() => container2.querySelector(".o_favorites_menu"), "menu Favoris (2e mount)");
click([...container2.querySelectorAll(".o_favorites_menu .dropdown-item")].find((d) => d.textContent.includes("Validés par état")));
await waitFor(() => container2.querySelector(".o_searchview_facet"), "favori appliqué : facette");
// Le favori a été pris après retrait de « Validés » : le filtre restant
// est « Avec montant » (filter_amount).
ok(container2.querySelector(".o_searchview_facet").textContent.includes("Avec montant"), "search : restauration du filtre actif");
await waitFor(() => container2.querySelector(".o_group_header"), "favori appliqué : group by");
ok(container2.querySelectorAll(".o_data_row").length === 2, "search : restauration -> 2 lignes");
ok(container2.querySelector(".o_searchview_input").value === "", "search : requête vide restaurée (favori sans requête)");

// favori avec requête texte (restauration de l'input)
click(container2.querySelector(".o_favorites_button"));
await waitFor(() => container2.querySelector(".o_add_favorite"), "menu Favoris ouvert");
click(container2.querySelector(".o_add_favorite"));
await waitFor(() => container2.querySelector(".o_favorite_name_input"), "champ nom du favori (2)");
const favInput2 = container2.querySelector(".o_favorite_name_input");
// requête texte : saisie + debounce 300ms
const searchInput = container2.querySelector(".o_searchview_input");
searchInput.value = "SO003";
searchInput.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
await sleep(400);
// attention : le menu s'est refermé au clic extérieur ? non -- saisie ne ferme pas ; mais le menu l'est déjà ouvert ci-dessus
favInput2.value = "SO003 validé";
favInput2.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
let saveBtn = container2.querySelector(".o_save_favorite_button");
ok(!!saveBtn, "search : bouton Enregistrer visible");
click(saveBtn);
await waitFor(() => JSON.parse(localStorage.getItem("pwa_search_favorites:crm.lead")).length === 2, "2 favoris persistés");
destroy();
await tick();

const container3 = document.createElement("div");
document.body.appendChild(container3);
destroy = await mountView(container3, { view: "list", module: "sales", model: "crm.lead", actionId: "lead_action", label: "Opportunités" }, envStub);
await waitFor(() => container3.querySelector(".o_favorites_button"), "troisième mount prêt");
click(container3.querySelector(".o_favorites_button"));
await waitFor(() => container3.querySelector(".o_favorites_menu"), "menu Favoris (3e mount)");
click([...container3.querySelectorAll(".o_favorites_menu .dropdown-item")].find((d) => d.textContent.includes("SO003 validé")));
await waitFor(() => container3.querySelector(".o_searchview_input").value === "SO003", "requête texte restaurée dans l'input");
ok(container3.querySelector(".o_searchview_input").value === "SO003", "search : requête texte restaurée (input non contrôlé)");
await waitFor(() => container3.querySelectorAll(".o_data_row").length === 1, "requête restaurée -> 1 ligne");
ok(container3.querySelectorAll(".o_data_row").length === 1 && container3.textContent.includes("SO003"),
   "search : favori avec requête -> 1 ligne (SO003)");

// suppression d'un favori
click(container3.querySelector(".o_favorites_button"));
await waitFor(() => container3.querySelector(".o_favorites_menu"), "menu Favoris (suppression)");
click(container3.querySelector(".o_favorites_menu .o_delete_favorite"));
await waitFor(() => JSON.parse(localStorage.getItem("pwa_search_favorites:crm.lead")).length === 1, "favori supprimé");
ok(JSON.parse(localStorage.getItem("pwa_search_favorites:crm.lead")).length === 1, "search : suppression persistée");

// ── 3. Repli sans arch <search> : filtres selection ──
destroy();
await tick();
const container4 = document.createElement("div");
document.body.appendChild(container4);
const destroy4 = await mountView(container4, { view: "list", module: "plain", model: "res.partner", actionId: "plain_action", label: "Contacts" }, envStub);
await waitFor(() => container4.querySelector(".o_filters_button"), "mount repli prêt");
click(container4.querySelector(".o_filters_button"));
await waitFor(() => container4.querySelector(".o_filters_menu"), "menu Filtres (repli)");
const fallbackItems = [...container4.querySelectorAll(".o_filters_menu a.dropdown-item")].map((a) => a.textContent.trim());
ok(fallbackItems.join(",") === "État : Brouillon,État : Validé", `search : repli selection (${fallbackItems.join(" | ")})`);
destroy4();

console.log("\n✅ TOUS LES TESTS SEARCH AVANCÉ PASSENT");
