/**
 * TEST GLOBAL -- boot complet de l'application (itération 17, outillage)
 * ======================================================================
 * Monte l'app RÉELLE (main.js, comme index.html) dans jsdom et vérifie
 * le parcours de bout en bout :
 *   boot -> garde d'authentification -> LOGIN -> HOME MENU (grille des
 *   apps) -> clic app -> LISTE (contrôleur OWL) -> bascule KANBAN
 *   (colonnes group by) -> ouverture d'une fiche -> FORMULAIRE ->
 *   sauvegarde -> file de synchronisation.
 * Le shell (navbar + systray OWL), les notifications, le router (hash)
 * et les caches hors ligne sont exercés par la même occasion.
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
  for (let i = 0; i < 400; i++) {
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
globalThis.history = dom.window.history;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
Object.defineProperty(dom.window.navigator, "onLine", { value: false, configurable: true });
Object.defineProperty(globalThis.navigator, "onLine", { value: false, configurable: true });
dom.window.alert = () => { throw new Error("alert() ne doit plus être appelé"); };
dom.window.open = () => {};
// jsdom n'implémente pas matchMedia (utilisé par detectTouchDevice au boot).
dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
localStorage.clear();

// ── fetch stub : login/droits OK, CSS OK, tout le reste hors ligne ──
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes("/offline_sync/login")) {
    return { ok: true, json: async () => ({ uid: 5, name: "Alice", api_key: "KEY" }) };
  }
  if (u.includes("/offline_sync/security_info")) {
    return {
      ok: true,
      json: async () => ({
        models: { "sale.order": { access: { read: true, write: true, create: true, unlink: false }, domain: [], fields: [] } },
        groups: ["Sales / User"],
        is_admin: true,
      }),
    };
  }
  if (u.includes("css/") || u.includes("assets")) {
    return { ok: true, text: async () => "" };
  }
  throw new TypeError("hors ligne (stub) : " + u);
};

class FakeTable {
  constructor(rows = [], keyFn = null) { this.rows = rows; this.keyFn = keyFn; }
  async put(obj) { this.rows.push(obj); }
  async bulkAdd(list) { for (const o of list) this.rows.push(o); }
  async bulkPut(list) { for (const o of list) this.rows.push(o); }
  async add(obj) { const id = this.rows.length + 1; this.rows.push({ id, ...obj }); return { id }; }
  async update() {}
  async delete() {}
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
    for (const t of ["sync_queue", "catalog_cache", "installed_apps", "local_ledger"]) {
      this[t] = new FakeTable();
    }
    // clé = "model" ou "model::actionId" (buildListCacheKey)
    this.list_cache = new FakeTable([], (r, k) => r.model === k);
    this.cache_meta = new FakeTable([], (r, k) => r.key === k);
    this.module_manifests = new FakeTable([], (r, k) => r.technical_name === k);
    this.record_cache = new FakeTable([], (r, k) => Array.isArray(k) && r.model === k[0] && String(r.id) === String(k[1]));
    this.security_info = new FakeTable();
    this.reference_records = new FakeTable([
      { model: "res.partner", id: 1, display_name: "Alice Corp" },
      { model: "product.product", id: 5, display_name: "Desk", price: 30 },
      { model: "product.product", id: 7, display_name: "Chaise", price: 100 },
    ], (r, k) => Array.isArray(k) ? r.model === k[0] && String(r.id) === String(k[1]) : r.model === k);
  }
  version() { return { stores() {} }; }
  transaction() {}
}
globalThis.Dexie = FakeDexie;

const { db } = await import(REPO + "/static/src/core/orm_service.js");

// ── Amorçage des caches (état après une première connexion en ligne) ──
const fieldsInfo = {
  name: { type: "char", label: "Référence", required: true },
  state: { type: "selection", label: "État", selection: [["draft", "Brouillon"], ["done", "Validé"]] },
  partner_id: { type: "many2one", relation: "res.partner", label: "Client" },
  amount_total: { type: "monetary", label: "Total" },
};
const listArch = `<list><field name="name"/><field name="state"/><field name="amount_total"/></list>`;
const kanbanArch = `<?xml version="1.0"?>
<kanban default_group_by="state">
  <field name="name"/><field name="state"/>
  <templates><t t-name="kanban-box">
    <div class="oe_kanban_card oe_kanban_global_click"><field name="name"/></div>
  </t></templates>
</kanban>`;
const formArch = `<form>
  <header><field name="state" widget="statusbar"/></header>
  <sheet><group><field name="name"/><field name="partner_id"/></group></sheet>
</form>`;

await db.module_manifests.put({
  technical_name: "sales",
  module: { name: "sales", label: "Ventes" },
  models: ["sale.order"],
  fields: { "sale.order": fieldsInfo },
  views: { "sale.order": { default: { list: { arch: listArch }, kanban: { arch: kanbanArch }, form: { arch: formArch } } } },
  menus: [
    { id: 1, name: "Ventes", parent_id: null, sequence: 1, model: null, action_id: null, default_view: null },
    { id: 2, name: "Devis", parent_id: 1, sequence: 1, model: "sale.order", action_id: "sale_action", default_view: "list" },
  ],
});
const listRecords = [
  { id: 42, name: "SO017", state: "draft", partner_id: [1, "Alice Corp"], amount_total: 100 },
  { id: 43, name: "SO018", state: "done", partner_id: [1, "Alice Corp"], amount_total: 250 },
  { id: 44, name: "SO019", state: "draft", partner_id: [1, "Alice Corp"], amount_total: 80 },
];
await db.list_cache.put({ model: "sale.order::sale_action", records: listRecords, total: listRecords.length });
await db.record_cache.put({
  model: "sale.order", id: 42,
  data: {
    id: 42, name: "SO017", state: "draft", partner_id: [1, "Alice Corp"], amount_total: 100,
    order_line: [],
  },
});
await db.installed_apps.put({ technical_name: "sales", label: "Ventes", main_model: "sale.order", icon_base64: null });

// ══ BOOT de l'app réelle (main.js) ══
const bootErrors = [];
const origConsoleError = console.error;
console.error = (...args) => { bootErrors.push(args.map(String).join(" ")); origConsoleError(...args); };
await import(REPO + "/static/src/main.js");

await waitFor(() => !!window.__pwa_debug__, "boot complet (window.__pwa_debug__)");
ok(!!window.__pwa_debug__, "global : main.js boote sans erreur (services + rules engine + shell)");

// ── 1. Garde d'authentification -> LOGIN ──
await waitFor(() => document.querySelector("#wrapwrap .oe_login_form"), "écran de login");
ok(!!document.querySelector("#wrapwrap .oe_login_form"), "global : garde d'authentification -> écran LOGIN (wrapwrap)");
ok(location.hash.includes("tag=login") && location.hash.includes("redirectTo=%7B") && !location.hash.includes("object"), "global : hash #tag=login + redirectTo sérialisé JSON (deep-link réparé)");
ok(document.getElementById("odoo-frontend-assets-login"), "global : CSS frontend login chargé");

// ── 2. Login -> HOME MENU ──
document.querySelector("#login-email").value = "alice@example.com";
document.querySelector("#login-password").value = "secret";
document.querySelector(".oe_login_form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
await waitFor(() => document.querySelector(".dashboard-container"), "home menu après login");
ok(!!document.querySelector(".dashboard-container"), "global : login OK -> HOME MENU (grille des apps)");
const session = JSON.parse(localStorage.getItem("offline_sync_session"));
ok(session && session.uid === 5 && session.api_key === "KEY", "global : session sauvée (Alice / KEY)");
const secRows = await db.security_info.toArray();
ok(secRows.some((r) => r.model === "sale.order" && r.is_admin === true), "global : droits Security Engine en cache");
ok(location.hash.includes("tag=home_menu"), "global : hash #tag=home_menu (redirectTo appliqué)");

// ── 3. Shell OWL : navbar + systray + conteneurs transverses ──
await waitFor(() => document.querySelector("header.o_navbar") && document.querySelector("header.o_navbar").style.display !== "none",
   "navbar visible sur home");
ok(document.querySelector("header.o_navbar").style.display !== "none", "global : navbar OWL visible");
ok(document.body.classList.contains("o_web_client"), "global : body.o_web_client");
ok(document.getElementById("odoo-assets-dynamic"), "global : assets CSS Odoo chargés (loadOdooAssets)");
await waitFor(() => document.querySelector(".o_user_avatar") && document.querySelector(".o_user_avatar").textContent === "A",
   "avatar initial (fallback session hors ligne)");
ok(document.querySelector(".o_user_avatar").textContent === "A", "global : avatar « A » (dashboard_info hors ligne -> session)");
ok(!!document.querySelector(".o_notification_container"), "global : conteneur de notifications OWL monté");
ok(!document.querySelector(".o_rainbow_man"), "global : RainbowMan non actif au repos");

// ── 4. Grille des apps -> clic Ventes -> LISTE ──
await waitFor(() => document.querySelectorAll(".module-card").length === 1, "grille home (1 app)");
const card = document.querySelector(".module-card");
ok(card.textContent.includes("Ventes") && card.className.includes("ready"), "global : carte Ventes prête");
ok(card.querySelector(".download-btn").textContent === "Mis à jour", "global : pré-téléchargement (manifest en cache -> « Mis à jour »)");
card.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
await tick(); await tick(); await tick();

await waitFor(() => document.querySelectorAll(".o_data_row").length === 3, "liste des devis rendue");
ok(document.querySelectorAll(".o_data_row").length === 3, "global : LISTE rendue (3 devis, cache hors ligne)");
ok(location.hash.includes("tag=list_view"), "global : hash #tag=list_view");
await waitFor(() => document.querySelector("#app-title") && document.querySelector("#app-title").textContent === "Ventes", "titre d'app");
ok(document.querySelector("#app-title").textContent === "Ventes", "global : navbar titre « Ventes »");
const sectionBtns = [...document.querySelectorAll(".o_navbar_section_item")].map((s) => s.textContent.trim());
ok(sectionBtns.join(",") === "Devis", "global : menu horizontal (section Devis depuis le manifest)");
const controlPanel = document.querySelector(".o_control_panel");
ok(!!controlPanel && !!controlPanel.querySelector(".o_filters_button") && !!controlPanel.querySelector(".o_favorites_button"),
   "global : ControlPanel avec menus Filtres + Favoris (itération 12)");

// ── 5. Bascule KANBAN -> colonnes du group by ──
// group by État depuis le menu Grouper par (it. 10), puis bascule
// kanban -> colonnes (la branche kanban du ListController groupe si un
// group by est actif -- it. 11)
const groupbyBtn = document.querySelector(".o_groupby_button");
ok(!!groupbyBtn, "global : menu Grouper par présent");
groupbyBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
await waitFor(() => document.querySelector(".o_groupby_menu"), "menu Grouper par ouvert");
const etatItem = [...document.querySelectorAll(".o_groupby_menu a.dropdown-item")].find((a) => a.textContent.includes("État"));
ok(!!etatItem, "global : candidat « État » (champ selection de l'arch)");
etatItem.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
await waitFor(() => document.querySelectorAll(".o_group_header").length === 2, "groupes liste (2 en-têtes)");
ok(document.querySelectorAll(".o_group_header").length === 2, "global : LISTE groupée par État (2 en-têtes)");

const kanbanBtn = [...document.querySelectorAll(".o_cp_switch_buttons button")].find((b) => b.title === "Kanban");
ok(!!kanbanBtn, "global : bouton Kanban du view switcher");
kanbanBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
await waitFor(() => document.querySelectorAll(".o_kanban_group").length === 2, "kanban groupée par état");
ok(document.querySelectorAll(".o_kanban_group").length === 2, "global : KANBAN groupée (Brouillon + Validé)");
const draftCol = [...document.querySelectorAll(".o_kanban_group")].find((g) => g.querySelector(".o_kanban_group_title").textContent === "Brouillon");
ok(draftCol && draftCol.querySelectorAll(".o_kanban_record").length === 2, "global : 2 cartes en colonne Brouillon");
ok(!!draftCol.querySelector(".o_kanban_quick_add"), "global : « + Créer » de quick create présent (itération 13)");

// retour liste -> ouverture de la fiche 42
const listBtn = [...document.querySelectorAll(".o_cp_switch_buttons button")].find((b) => b.title === "List");
listBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
await waitFor(() => document.querySelectorAll(".o_data_row").length === 3, "retour liste");
const row42 = [...document.querySelectorAll(".o_data_row")].find((r) => r.textContent.includes("SO017"));
row42.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
await waitFor(() => document.querySelector("#field-name"), "formulaire ouvert");
ok(document.querySelector("#field-name").value === "SO017", "global : FORMULAIRE ouvert (fiche 42, cache record)");
ok(location.hash.includes("tag=form_view") && location.hash.includes("id=42"), "global : hash #tag=form_view&id=42");

// ── 6. Édition + sauvegarde -> file de synchronisation ──
const nameInput = document.querySelector("#field-name");
nameInput.value = "SO017-test-global";
nameInput.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
document.querySelector(".o_control_panel .o_form_button_save").click();
await waitFor(() => db.sync_queue.rows.some((r) => r.operation === "write"), "sauvegarde -> file");
const writeRow = db.sync_queue.rows.find((r) => r.operation === "write");
ok(writeRow && writeRow.model_name === "sale.order" && writeRow.payload.includes("SO017-test-global"),
   "global : sauvegarde -> queueAction(write) avec la nouvelle valeur");
ok(document.querySelector("#status-msg").textContent.includes("Enregistré localement"), "global : statut « Enregistré localement »");
ok(db.sync_queue.rows.filter((r) => r.status === "pending").length === 1, "global : 1 action pending (hors ligne, pas de sync)");

// ── 7. Fil d'ariane + retour via breadcrumb ──
ok(document.querySelector(".o_control_panel .breadcrumb") || document.querySelector(".o_breadcrumb"),
   "global : breadcrumb présent sur la fiche");

// Aucune erreur console fatale attendue (les warn/info hors ligne sont normaux)
const fatal = bootErrors.filter((e) => !e.includes("hors ligne") && !e.includes("dashboard") && !e.includes("Impossible de charger les infos"));
ok(fatal.length === 0, "global : aucune erreur console inattendue (" + (fatal.length ? fatal[0].slice(0, 120) : "0") + ")");

console.log("\n✅ TEST GLOBAL : PARCOURS COMPLET OK (login -> home -> liste -> kanban -> form -> save)");
process.exit(0); // l'app reste montée (interval de connectivité) : fin explicite
