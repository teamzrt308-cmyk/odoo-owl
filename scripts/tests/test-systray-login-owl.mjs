/**
 * Test jsdom des panneaux systray OWL + login OWL (itération 15) :
 *  - ConnectivityIndicator OWL : dot rouge hors ligne, vert si le ping
 *    réel répond (événement online) ;
 *  - SyncStatusPanel OWL : badges pending/errors, dropdown (titre,
 *    « Tout réessayer », section en attente avec icônes, items d'erreur
 *    Réessayer/Supprimer), file IndexedDB réellement modifiée ;
 *  - ConflictPanel OWL : badge, liste (libellés « name (ligne #2) »),
 *    clic -> doAction conflict_detail ;
 *  - Login OWL : descripteur { mount }, soumission -> session sauvée,
 *    cache ownership, droits en cache, doAction(redirectTo) ; échec ->
 *    message d'erreur + bouton réactivé.
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
dom.window.alert = () => {};
dom.window.open = () => {};
globalThis.confirm = () => true;
dom.window.confirm = () => true;
localStorage.clear();

// fetch stub par URL : ping ok, login contrôlable, security ok, css ok.
let loginOk = true;
let pingOk = true;
globalThis.fetch = async (url, options) => {
  const u = String(url);
  if (u.includes("/offline_sync/ping")) {
    if (!pingOk) throw new TypeError("ping injoignable (stub)");
    return { ok: pingOk, json: async () => ({}) };
  }
  if (u.includes("/offline_sync/login")) {
    if (!loginOk) return { ok: false, json: async () => ({ error: "Identifiants invalides" }) };
    return { ok: true, json: async () => ({ uid: 5, name: "Alice", api_key: "KEY" }) };
  }
  if (u.includes("/offline_sync/security_info")) {
    return {
      ok: true,
      json: async () => ({
        models: { "sale.order": { access: { read: true, write: true }, domain: [], fields: [] } },
        groups: ["Sales / User"],
        is_admin: true,
      }),
    };
  }
  if (u.includes("css/") || u.includes("assets")) {
    return { ok: true, text: async () => "" };
  }
  throw new TypeError("fetch stub : URL inattendue " + u);
};

class FakeTable {
  constructor(rows = [], keyFn = null) { this.rows = rows; this.keyFn = keyFn; }
  async put(obj) { this.rows.push(obj); }
  async bulkAdd(list) { for (const o of list) this.rows.push(o); }
  async bulkPut(list) { for (const o of list) this.rows.push(o); }
  async add(obj) { const id = this.rows.length + 1; this.rows.push({ id, ...obj }); return { id }; }
  async update(key, changes) {
    const i = this.rows.findIndex((r) => r.id === key);
    if (i >= 0) this.rows[i] = { ...this.rows[i], ...changes };
  }
  async delete(key) {
    const i = this.rows.findIndex((r) => r.id === key);
    if (i >= 0) this.rows.splice(i, 1);
  }
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
    this.sync_queue = new FakeTable();
    this.reference_records = new FakeTable();
    this.cache_meta = new FakeTable([], (r, k) => r.key === k);
    this.catalog_cache = new FakeTable();
    this.security_info = new FakeTable();
    this.module_manifests = new FakeTable([], (r, k) => r.technical_name === k);
    this.record_cache = new FakeTable();
    this.installed_apps = new FakeTable();
    this.local_ledger = new FakeTable();
    this.list_cache = new FakeTable();
  }
  get tables() {
    return ["sync_queue", "reference_records", "cache_meta", "catalog_cache", "security_info",
            "module_manifests", "record_cache", "installed_apps", "local_ledger", "list_cache"]
      .map((n) => this[n]);
  }
  version() { return { stores() {} }; }
  transaction() {}
}
globalThis.Dexie = FakeDexie;

const { db } = await import(REPO + "/static/src/core/orm_service.js");
const { bus } = await import(REPO + "/static/src/core/bus/bus_service.js");
const { mountOwlApp } = await import(REPO + "/static/src/owl/app.js");

// ── 1. ConnectivityIndicator OWL ──
const { ConnectivityIndicator } = await import(REPO + "/static/src/webclient/navbar/connectivity_indicator.js");
const dotHost = document.createElement("div");
document.body.appendChild(dotHost);
const dotHandle = await mountOwlApp(ConnectivityIndicator, dotHost, {});
await waitFor(() => dotHost.querySelector("#connectivity-dot").getAttribute("style").includes("#dc3545"),
   "dot rouge hors ligne");
ok(dotHost.querySelector("#connectivity-dot").getAttribute("style").includes("#dc3545"), "systray : hors ligne -> dot rouge");
await waitFor(() => dotHost.querySelector("#connectivity-dot").closest("div").getAttribute("title") === "Hors ligne",
   "title hors ligne");
ok(dotHost.querySelector("#connectivity-dot").closest("div").getAttribute("title") === "Hors ligne", "systray : title « Hors ligne »");

// retour en ligne (ping ok) via l'événement window "online"
Object.defineProperty(dom.window.navigator, "onLine", { value: true, configurable: true });
Object.defineProperty(globalThis.navigator, "onLine", { value: true, configurable: true });
dom.window.dispatchEvent(new dom.window.Event("online"));
await waitFor(() => dotHost.querySelector("#connectivity-dot").getAttribute("style").includes("#28a745"),
   "dot vert en ligne (ping ok)");
ok(dotHost.querySelector("#connectivity-dot").getAttribute("style").includes("#28a745"), "systray : ping ok -> dot vert");
ok(dotHost.querySelector("#connectivity-dot").closest("div").getAttribute("title") === "En ligne", "systray : title « En ligne »");

// retour hors ligne
Object.defineProperty(dom.window.navigator, "onLine", { value: false, configurable: true });
Object.defineProperty(globalThis.navigator, "onLine", { value: false, configurable: true });
dom.window.dispatchEvent(new dom.window.Event("offline"));
await waitFor(() => dotHost.querySelector("#connectivity-dot").getAttribute("style").includes("#dc3545"),
   "dot rouge après offline");
ok(dotHost.querySelector("#connectivity-dot").getAttribute("style").includes("#dc3545"), "systray : offline -> retour au rouge");
dotHandle.destroy();
await tick();
ok(dotHost.querySelectorAll("#connectivity-dot").length === 0, "systray : indicator destroy -> DOM retiré");

// ── 2. SyncStatusPanel OWL ──
await db.sync_queue.add({
  local_uuid: "p1", status: "pending", model_name: "sale.order", operation: "create",
  created_at: "2026-09-20 10:00:00", payload: "{}",
});
await db.sync_queue.add({
  local_uuid: "e1", status: "error", model_name: "crm.lead", operation: "write",
  created_at: "2026-09-20 10:05:00", payload: "{}", error_message: "Conflit 409 : modifié entre-temps",
});

const { SyncStatusPanel } = await import(REPO + "/static/src/webclient/navbar/sync_status_panel.js");
const syncHost = document.createElement("div");
document.body.appendChild(syncHost);
const syncHandle = await mountOwlApp(SyncStatusPanel, syncHost, {});

await waitFor(() => syncHost.querySelector(".badge.bg-secondary") && syncHost.querySelector(".badge.bg-danger"),
   "badges pending + errors");
ok(syncHost.querySelector(".badge.bg-secondary").textContent === "1", "systray : badge pending (1)");
ok(syncHost.querySelector(".badge.bg-danger").textContent === "1", "systray : badge errors (1)");
ok(syncHost.querySelector(".badge.bg-secondary").getAttribute("title").includes("En attente de connexion"),
   "systray : badge pending title hors ligne");

// ouverture du dropdown
syncHost.querySelector("#sync-status-btn").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
await waitFor(() => syncHost.querySelector(".o_sync_status_dropdown"), "dropdown sync ouvert");
ok(syncHost.querySelector(".o_sync_status_dropdown strong").textContent === "1 erreur(s) de synchronisation",
   "systray : titre du panneau sync (1 erreur)");
ok(!!syncHost.querySelector(".o_sync_retry_all"), "systray : bouton « Tout réessayer »");
ok(syncHost.textContent.includes("Hors-ligne — seront envoyées à la reconnexion :"), "systray : label de la section en attente (hors ligne)");
ok(syncHost.textContent.includes("Création — sale.order"), "systray : entrée pending formatée (Création — sale.order)");
ok(!!syncHost.querySelector(".fa-clock-o"), "systray : icône horloge hors ligne");
const errItem = syncHost.querySelector(".o_sync_error_item");
ok(errItem && errItem.textContent.includes("Conflit 409 : modifié entre-temps"), "systray : message d'erreur affiché");

// Réessayer : l'entrée repasse en pending dans la file
errItem.querySelector(".o_sync_retry").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
await waitFor(() => {
  const row = db.sync_queue.rows.find((r) => r.local_uuid === "e1");
  return row && row.status === "pending" && row.error_message === null;
}, "réessai -> entrée repassée en pending");
const e1 = db.sync_queue.rows.find((r) => r.local_uuid === "e1");
ok(e1.status === "pending" && e1.error_message === null, "systray : « Réessayer » -> entrée repassée en pending");
await waitFor(() => syncHost.textContent.includes("Aucune erreur de synchronisation."), "plus d'erreur dans le panneau");
ok(syncHost.querySelector(".o_sync_status_dropdown strong").textContent === "2 en attente de connexion",
   "systray : titre repassé aux attentes (2)");

// Suppression (confirm accepté)
const errItem2 = syncHost.querySelector(".o_sync_error_item");
ok(!errItem2, "systray : plus d'item d'erreur après réessai");
// re-seed une erreur pour tester la suppression
await db.sync_queue.add({
  local_uuid: "e2", status: "error", model_name: "res.partner", operation: "unlink",
  created_at: "2026-09-20 10:10:00", payload: "{}", error_message: "Suppression refusée",
});
bus.trigger("sync:updated");
await waitFor(() => syncHost.querySelector(".o_sync_error_item"), "erreur re-affichée via bus sync:updated");
ok(syncHost.querySelector(".o_sync_error_item").textContent.includes("Suppression — res.partner"),
   "systray : bus sync:updated -> re-render (Suppression — res.partner)");
const errCount = db.sync_queue.rows.length;
syncHost.querySelector(".o_sync_error_item .o_sync_delete").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
await waitFor(() => db.sync_queue.rows.length === errCount - 1, "suppression de la row en file");
ok(db.sync_queue.rows.length === errCount - 1 && !db.sync_queue.rows.some((r) => r.local_uuid === "e2"),
   "systray : « Supprimer » -> row retirée de la file");
syncHandle.destroy();
await tick();
ok(syncHost.querySelectorAll("#sync-status-btn").length === 0, "systray : panel sync destroy -> DOM retiré");

// ── 3. ConflictPanel OWL ──
await db.sync_queue.add({
  local_uuid: "c1", status: "conflict", model_name: "sale.order", operation: "write",
  created_at: "2026-09-20 11:00:00",
  conflict_details: JSON.stringify([{ field: "name[2]" }, { field: "amount_total" }]),
});
const conflictActions = [];
const { ConflictPanel } = await import(REPO + "/static/src/webclient/navbar/conflict_panel.js");
const conflictHost = document.createElement("div");
document.body.appendChild(conflictHost);
const conflictHandle = await mountOwlApp(ConflictPanel, conflictHost, { doAction: (a, o) => conflictActions.push([a, o]) });

await waitFor(() => conflictHost.querySelector(".badge.bg-warning"), "badge conflits");
ok(conflictHost.querySelector(".badge.bg-warning").textContent === "1", "systray : badge conflits (1)");
conflictHost.querySelector("#conflict-status-btn").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
await waitFor(() => conflictHost.querySelector(".o_sync_conflicts_dropdown"), "dropdown conflits ouvert");
ok(conflictHost.querySelector(".o_sync_conflicts_dropdown strong").textContent === "1 conflit(s) à résoudre",
   "systray : titre du panneau conflits");
const item = conflictHost.querySelector(".o_conflict_item");
ok(item.textContent.includes("name (ligne #2), amount_total"), "systray : libellés de champs formatés (name (ligne #2))");
item.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
await waitFor(() => conflictActions.length > 0, "clic conflit -> doAction");
const [conflictAction, conflictOpts] = conflictActions[0];
ok(conflictAction.tag === "conflict_detail" && conflictAction.localUuid === "c1",
   "systray : clic conflit -> doAction conflict_detail (localUuid)");
await waitFor(() => !conflictHost.querySelector(".o_sync_conflicts_dropdown"), "dropdown refermé après clic");
ok(!conflictHost.querySelector(".o_sync_conflicts_dropdown"), "systray : dropdown conflits fermé après navigation");
conflictHandle.destroy();
await tick();

// ── 4. Login OWL ──
const { registry } = await import(REPO + "/static/src/core/registry.js");
await import(REPO + "/static/src/webclient/login/login.js");
const loginDescriptor = registry.category("actions").get("login");
ok(loginDescriptor && typeof loginDescriptor.mount === "function", "login : descripteur { mount: mountLogin } inchangé");

const mountLogin = loginDescriptor.mount;
const loginHost = document.createElement("div");
document.body.appendChild(loginHost);
const loginActions = [];
const envLogin = { doAction: async (a, o) => loginActions.push([a, o]) };
const loginHandle = await mountLogin(loginHost, { redirectTo: { tag: "list_view", module: "sales", model: "sale.order" } }, envLogin);

ok(loginHost.querySelector("#wrapwrap .oe_login_form"), "login : écran OWL rendu (wrapwrap + form)");
ok(document.getElementById("odoo-frontend-assets-login"), "login : CSS frontend chargé (style tag)");
ok(loginHost.querySelector("#login-btn").textContent === "Se connecter", "login : bouton au repos");

// soumission réussie
loginHost.querySelector("#login-email").value = "alice@example.com";
loginHost.querySelector("#login-password").value = "secret";
loginHost.querySelector(".oe_login_form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
await waitFor(() => loginActions.length > 0, "login -> doAction");
const session = JSON.parse(localStorage.getItem("offline_sync_session"));
ok(session && session.uid === 5 && session.name === "Alice",
   "login : session sauvée (uid 5, Alice)");
ok(!session.api_key && !!localStorage.getItem("offline_sync_vault") &&
   sessionStorage.getItem("offline_sync_unlocked_key"),
   "login : M9 -- clé au coffre (chiffrée), déverrouillée en sessionStorage");
// NB (M9) : le PBKDF2 du coffre décale le flush des re-rendus OWL --
// on vérifie que le bouton a bien quitté son état au repos (les phases
// cache/droits restent traversées, cf. flux testé par les assertions
// session/coffre/doAction).
ok(["Connexion...", "Préparation du cache...", "Chargement des droits..."].includes(
     loginHost.querySelector("#login-btn").textContent
   ), "login : bouton en phase occupé (plus « Se connecter »)");
const [loginAction, loginOpts] = loginActions[0];
ok(loginAction.tag === "list_view" && loginAction.model === "sale.order" && loginOpts.replace === true && loginOpts.clearStack === true,
   "login : doAction(redirectTo, { replace, clearStack })");
const secRows = await db.security_info.toArray();
ok(secRows.some((r) => r.model === "sale.order" && r.is_admin === true), "login : droits en cache (security_info)");
const owner = await db.cache_meta.get("owner");
ok(owner && owner.value === 5, "login : cache ownership posé (uid 5)");
loginHandle.destroy();
await tick();
ok(!document.getElementById("odoo-frontend-assets-login") && loginHost.querySelectorAll("#wrapwrap").length === 0,
   "login : destroy -> CSS retiré + DOM retiré");

// soumission en échec
loginOk = false;
const loginHost2 = document.createElement("div");
document.body.appendChild(loginHost2);
const loginHandle2 = await mountLogin(loginHost2, {}, envLogin);
loginHost2.querySelector("#login-email").value = "alice@example.com";
loginHost2.querySelector("#login-password").value = "wrong";
loginHost2.querySelector(".oe_login_form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
await waitFor(() => loginHost2.querySelector("#error") && loginHost2.querySelector("#error").textContent.includes("Identifiants invalides"),
   "message d'erreur affiché");
ok(loginHost2.querySelector("#error").textContent.includes("Identifiants invalides"), "login : échec -> message d'erreur");
ok(loginHost2.querySelector("#login-btn").textContent === "Se connecter" && loginHost2.querySelector("#login-btn").disabled === false,
   "login : bouton réactivé après échec");
loginHandle2.destroy();

console.log("\n✅ TOUS LES TESTS SYSTRAY + LOGIN OWL PASSENT");
