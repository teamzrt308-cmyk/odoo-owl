/**
 * Test jsdom du DURCISSEMENT MULTI-BASES (garde de base) :
 *  - withDb() : étiquetage ?db= des URLs offline_sync ;
 *  - ensureCacheOwnership(uid, stamp) : purge si changement d'utilisateur
 *    OU de base/serveur (tampon db_stamp dans cache_meta) ;
 *  - verifyLocalStamp() : divergence URL (hors ligne) ou base (ping) ->
 *    confirmation + export JSON (pending) -> purge + déconnexion ;
 *  - Login OWL : champ « Base de données » -> ?db= au POST, tampon
 *    {db, serverUrl} dans la session.
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
Object.defineProperty(dom.window.navigator, "onLine", { value: true, configurable: true });
Object.defineProperty(globalThis.navigator, "onLine", { value: true, configurable: true });
dom.window.alert = () => {};
dom.window.open = () => {};
localStorage.clear();

// ── confirm contrôlable par scénario ──
let confirmAnswer = true;
dom.window.confirm = () => confirmAnswer;
globalThis.confirm = () => confirmAnswer;

// ── fetch stub : ping (base contrôlable), login, security, css ──
const CONFIG_URL = "http://localhost:8069";
let pingDb = null; // null -> renvoie la base demandée (tautologie réaliste)
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes("/offline_sync/ping")) {
    const requested = new URL(u).searchParams.get("db");
    return { ok: true, json: async () => ({ status: "ok", db: pingDb || requested || null }) };
  }
  if (u.includes("/offline_sync/login")) {
    return { ok: true, json: async () => ({ uid: 7, name: "Alice", api_key: "k-test", db: new URL(u).searchParams.get("db") || "defaut" }) };
  }
  if (u.includes("/offline_sync/security_info")) {
    throw new TypeError("hors ligne (stub)");
  }
  if (u.includes(".css")) {
    return { ok: true, text: async () => "" };
  }
  throw new TypeError("fetch stub : URL inattendue " + u);
};

// ── Fake Dexie : transaction exécute le callback, anyOf supporté ──
class FakeTable {
  constructor(rows = [], keyFn = null) { this.rows = rows; this.keyFn = keyFn; }
  async put(obj) {
    if (this.keyFn) {
      const existing = this.rows.find((r) => this.keyFn(r) !== undefined && this.keyFn(r) === this.keyFn(obj));
      if (existing) { Object.assign(existing, obj); return; }
    }
    this.rows.push(obj);
  }
  async add(obj) { this.rows.push(obj); return { id: this.rows.length }; }
  async clear() { this.rows.length = 0; }
  async get(key) {
    if (!this.keyFn) return undefined;
    return this.rows.find((r) => this.keyFn(r) === key);
  }
  async toArray() { return [...this.rows]; }
  async count() { return this.rows.length; }
  where(clause) {
    const rows = this.rows;
    if (typeof clause === "string") {
      const coll = (list) => ({
        toArray: async () => list,
        first: async () => list[0],
        count: async () => list.length,
      });
      return {
        equals: (value) => coll(rows.filter((r) => r[clause] === value)),
        anyOf: (values) => coll(rows.filter((r) => values.includes(r[clause]))),
      };
    }
    return { toArray: async () => [...rows], count: async () => rows.length };
  }
}
class FakeDexie {
  constructor() {
    this.sync_queue = new FakeTable();
    this.reference_records = new FakeTable();
    this.cache_meta = new FakeTable([], (r) => r.key);
    this.catalog_cache = new FakeTable();
    this.security_info = new FakeTable();
    this.module_manifests = new FakeTable();
    this.record_cache = new FakeTable();
    this.installed_apps = new FakeTable();
    this.list_cache = new FakeTable();
    this.sync_conflicts = new FakeTable();
  }
  get tables() {
    return ["sync_queue", "reference_records", "cache_meta", "catalog_cache", "security_info",
            "module_manifests", "record_cache", "installed_apps", "list_cache", "sync_conflicts"]
      .map((n) => this[n]);
  }
  version() { return { stores() {} }; }
  async transaction(_mode, _tables, fn) { return await fn(); }
}
globalThis.Dexie = FakeDexie;

const { db } = await import(REPO + "/static/src/core/orm_service.js");
const { CONFIG, saveSession, getSession, withDb, clearSession } =
  await import(REPO + "/static/src/core/browser/session.js");
const { mountOwlApp } = await import(REPO + "/static/src/owl/app.js");

// Ré-import frais du cache_owner par scénario (verdict mémoïsé).
let caseNo = 0;
async function freshGuard() {
  caseNo += 1;
  return await import(`${REPO}/static/src/core/cache_owner.js?case=${caseNo}`);
}
// Session brute (simule une session posée quand CONFIG pointait ailleurs ;
// saveSession grave toujours l'URL courante -- c'est le comportement voulu).
function rawSession(session) {
  localStorage.setItem("offline_sync_session", JSON.stringify(session));
}
function resetDb() {
  for (const t of db.tables) t.rows.length = 0;
}
async function seedPending(n) {
  for (let i = 0; i < n; i++) {
    await db.sync_queue.add({ local_uuid: `u${i}`, status: "pending", model_name: "sale.order" });
  }
}
async function stampRow() {
  return await db.cache_meta.get("db_stamp");
}

// ═════════ 1. withDb ═════════
ok(withDb(`${CONFIG_URL}/offline_sync/ping`) === `${CONFIG_URL}/offline_sync/ping`, "withDb : sans base en session -> URL inchangée");
saveSession({ uid: 7, name: "Alice", api_key: "k", db: "vente1" });
ok(withDb(`${CONFIG_URL}/offline_sync/ping`) === `${CONFIG_URL}/offline_sync/ping?db=vente1`, "withDb : ?db= ajouté depuis la session");
ok(withDb(`${CONFIG_URL}/offline_sync/login`, "achat") === `${CONFIG_URL}/offline_sync/login?db=achat`, "withDb : base explicite (login)");
ok(withDb(`${CONFIG_URL}/x?a=1`) === `${CONFIG_URL}/x?a=1&db=vente1`, "withDb : &db= si query existante");

// ═════════ 2. Login : champ base -> ?db= + tampon de session ═════════
{
  localStorage.clear();
  const { Login } = await import(`${REPO}/static/src/webclient/login/login.js`);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const actions = [];
  await mountOwlApp(Login, host, { params: {}, env: { doAction: async (a) => actions.push(a) } });
  host.querySelector("#login-email").value = "alice@test.mg";
  host.querySelector("#login-password").value = "pwd";
  host.querySelector("#login-db").value = "vente1";
  host.querySelector("#login-btn").click();
  for (let i = 0; i < 100 && !getSession(); i++) await tick();
  const session = getSession();
  ok(!!session && session.db === "vente1", "login : session sauvée avec la base résolue");
  ok(!session.api_key && !!localStorage.getItem("offline_sync_vault") &&
     sessionStorage.getItem("offline_sync_unlocked_key") === "k-test",
     "login : M9 -- clé chiffrée dans le coffre, déverrouillée pour l'onglet");
  ok(session.serverUrl === CONFIG.ODOO_BASE_URL, "login : tampon serverUrl dans la session");
  const stamp = await stampRow();
  ok(!!stamp && stamp.value.db === "vente1", "login : tampon db_stamp écrit dans cache_meta");
  host.remove();
}

// ═════════ 3. verifyLocalStamp ═════════
// 3a. nominal : même serveur, ping -> même base : rien ne bouge
{
  resetDb();
  localStorage.clear();
  saveSession({ uid: 7, name: "Alice", api_key: "k", db: "vente1" });
  await db.record_cache.add({ model: "sale.order", record_id: 42 });
  pingDb = null;
  const guard = await freshGuard();
  const verdict = await guard.verifyLocalStamp();
  ok(verdict.ok === true && (await db.record_cache.count()) === 1, "garde : nominal -> aucune purge");
}

// 3b. session legacy (sans tampon) : tolérée
{
  resetDb();
  localStorage.clear();
  saveSession({ uid: 7, name: "Alice", api_key: "k" });
  const guard = await freshGuard();
  const verdict = await guard.verifyLocalStamp();
  ok(verdict.ok === true && verdict.legacy === true, "garde : session sans tampon (ancienne) -> tolérée");
}

// 3c. pas de session -> ok
{
  resetDb();
  localStorage.clear();
  const guard = await freshGuard();
  const verdict = await guard.verifyLocalStamp();
  ok(verdict.ok === true, "garde : pas de session -> rien à vérifier");
}

// 3d. URL serveur changée -> purge + déconnexion (pending + confirm OK)
{
  resetDb();
  localStorage.clear();
  rawSession({ uid: 7, name: "Alice", api_key: "k", db: "vente1", serverUrl: "http://ancien-serveur:8069" });
  await seedPending(2);
  await db.record_cache.add({ model: "sale.order", record_id: 42 });
  confirmAnswer = true;
  const guard = await freshGuard();
  const verdict = await guard.verifyLocalStamp();
  ok(verdict.sessionCleared === true && verdict.purged === true, "garde : URL changée -> divergence détectée");
  ok(!getSession(), "garde : session effacée après divergence URL");
  ok((await db.record_cache.count()) === 0 && (await db.sync_queue.count()) === 0, "garde : caches + file purgés (confirm OK)");
}

// 3e. URL changée + pending + confirm ANNULÉ -> données conservées, déconnexion
{
  resetDb();
  localStorage.clear();
  rawSession({ uid: 7, name: "Alice", api_key: "k", db: "vente1", serverUrl: "http://ancien-serveur:8069" });
  await seedPending(3);
  confirmAnswer = false;
  const guard = await freshGuard();
  const verdict = await guard.verifyLocalStamp();
  ok(verdict.sessionCleared === true && verdict.purged === false, "garde : confirm annulé -> pas de purge");
  ok((await db.sync_queue.count()) === 3, "garde : actions non synchronisées CONSERVÉES (récupérables)");
  ok(!getSession(), "garde : déconnexion malgré tout (re-login obligatoire)");
}

// 3f. même serveur, ping -> AUTRE base -> purge + déconnexion
{
  resetDb();
  localStorage.clear();
  saveSession({ uid: 7, name: "Alice", api_key: "k", db: "vente1", serverUrl: CONFIG.ODOO_BASE_URL });
  await db.record_cache.add({ model: "sale.order", record_id: 42 });
  pingDb = "stock2"; // la base de la session n'existe plus côté serveur
  const guard = await freshGuard();
  const verdict = await guard.verifyLocalStamp();
  ok(verdict.sessionCleared === true && verdict.purged === true, "garde : ping -> base différente -> purge");
  ok((await db.record_cache.count()) === 0 && !getSession(), "garde : cache purgé + session effacée (changement de base)");
}

// ═════════ 4. ensureCacheOwnership : base + utilisateur ═════════
// 4a. premier login : pas de purge
{
  resetDb();
  const guard = await freshGuard();
  await db.record_cache.add({ model: "sale.order", record_id: 1 });
  const res = await guard.ensureCacheOwnership(7, { db: "vente1", serverUrl: CONFIG.ODOO_BASE_URL });
  ok(res.purged === false && (await db.record_cache.count()) === 1, "ownership : premier login -> aucune purge");
}
// 4b. même uid + même tampon : pas de purge
{
  const guard = await freshGuard();
  const res = await guard.ensureCacheOwnership(7, { db: "vente1", serverUrl: CONFIG.ODOO_BASE_URL });
  ok(res.purged === false && (await db.record_cache.count()) === 1, "ownership : même uid + même base -> aucune purge");
}
// 4c. même uid, AUTRE base : purge (les ids n'ont rien en commun)
{
  const guard = await freshGuard();
  const res = await guard.ensureCacheOwnership(7, { db: "stock2", serverUrl: CONFIG.ODOO_BASE_URL });
  ok(res.purged === true && (await db.record_cache.count()) === 0, "ownership : même uid + base différente -> purge");
}
// 4d. régression : utilisateur différent -> purge
{
  const guard = await freshGuard();
  await db.record_cache.add({ model: "sale.order", record_id: 2 });
  const res = await guard.ensureCacheOwnership(9, { db: "stock2", serverUrl: CONFIG.ODOO_BASE_URL });
  ok(res.purged === true && (await db.record_cache.count()) === 0, "ownership : utilisateur différent -> purge (régression)");
}

console.log("\n✅ TOUS LES TESTS DB-GARD (MULTI-BASES) PASSENT");
