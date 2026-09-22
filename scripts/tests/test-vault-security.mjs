/**
 * Test jsdom du COFFRE DE SESSION (M9, « mot de passe », pas de PIN) :
 *  - createVault/unlockVault : aller-retour, mauvais mot de passe,
 *    coffre corrompu, itérations PBKDF2 ;
 *  - session : plus de clé en clair au login, clé déverrouillée en
 *    sessionStorage, repli legacy, clearSession purge tout ;
 *  - écran unlock OWL : mauvais mot de passe -> erreur, bon mot de
 *    passe -> doAction(redirectTo) ;
 *  - garde doAction : coffre présent -> redirection "unlock".
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
dom.window.alert = () => {};
dom.window.open = () => {};
localStorage.clear();
sessionStorage.clear();
// Node 22 fournit globalThis.crypto (webcrypto) : utilisé par vault.js.

// fetch stub : login contrôlable, security en échec (non bloquant).
let loginOk = true;
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes("/offline_sync/login")) {
    if (!loginOk) return { ok: false, json: async () => ({ error: "Incorrect email or password" }) };
    return { ok: true, json: async () => ({ uid: 7, name: "Alice", api_key: "k-vault", db: "vente1" }) };
  }
  if (u.includes(".css")) return { ok: true, text: async () => "" };
  throw new TypeError("hors ligne (stub)");
};

// ── Fake Dexie minimal (login -> ensureCacheOwnership -> orm_service) ──
class FakeTable {
  constructor(rows = [], keyFn = null) { this.rows = rows; this.keyFn = keyFn; }
  async put(obj) {
    if (this.keyFn) {
      const existing = this.rows.find((r) => this.keyFn(r) === this.keyFn(obj));
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
  where() { return { equals: () => ({ toArray: async () => [], first: async () => undefined, count: async () => 0, anyOf: async () => [] }), anyOf: () => ({ toArray: async () => [] }) }; }
}
class FakeDexie {
  constructor() {
    this.sync_queue = new FakeTable();
    this.cache_meta = new FakeTable([], (r) => r.key);
    this.record_cache = new FakeTable();
  }
  get tables() { return [this.sync_queue, this.cache_meta, this.record_cache]; }
  version() { return { stores() {} }; }
  async transaction(_mode, _tables, fn) { return await fn(); }
}
globalThis.Dexie = FakeDexie;

const { saveSession, getSession, getApiKey, setUnlockedKey, clearSession } =
  await import(REPO + "/static/src/core/browser/session.js");
const { createVault, unlockVault, vaultExists, clearVault, PBKDF2_ITERATIONS } =
  await import(REPO + "/static/src/core/browser/vault.js");
const { mountOwlApp } = await import(REPO + "/static/src/owl/app.js");

// ═════════ 1. vault : primitives ═════════
ok(PBKDF2_ITERATIONS >= 100000, "vault : PBKDF2 >= 100 000 itérations");
await createVault("MotDePasseOdoo!", "k-secret-123");
ok(vaultExists(), "vault : coffre persisté");
const vaultRaw = JSON.parse(localStorage.getItem("offline_sync_vault"));
ok(!JSON.stringify(vaultRaw).includes("k-secret-123"), "vault : la clé n'apparaît NULLE PART en clair dans le coffre");
ok(await unlockVault("MotDePasseOdoo!") === "k-secret-123", "vault : bon mot de passe -> clé restituée");
ok((await unlockVault("mauvais")) === null, "vault : mauvais mot de passe -> null");
vaultRaw.ct = vaultRaw.ct.slice(0, -4) + "AAAA";
localStorage.setItem("offline_sync_vault", JSON.stringify(vaultRaw));
ok((await unlockVault("MotDePasseOdoo!")) === null, "vault : coffre corrompu -> null (pas de fuite)");
clearVault();
ok(!vaultExists(), "vault : clearVault purge le coffre");

// ═════════ 2. session : clé déverrouillée + legacy + purge ═════════
saveSession({ uid: 7, name: "Alice", db: "vente1" }); // session « coffre » : pas d'api_key
ok(getApiKey() === null, "session : sans déverrouillage -> getApiKey() null");
setUnlockedKey("k-secret-123");
ok(getApiKey() === "k-secret-123", "session : clé déverrouillée (sessionStorage) visible");
await createVault("MotDePasseOdoo!", "k-secret-123");
clearSession();
ok(!getSession() && !vaultExists() && getApiKey() === null, "session : clearSession purge session + coffre + clé déverrouillée");
saveSession({ uid: 1, name: "Bob", api_key: "k-legacy", db: "x" }); // legacy d'avant le coffre
ok(getApiKey() === "k-legacy", "session : repli legacy (clé en clair d'avant coffre) conservé");
clearSession();

// ═════════ 3. login OWL : coffre créé, plus de clé en clair ═════════
{
  const { Login } = await import(`${REPO}/static/src/webclient/login/login.js`);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const actions = [];
  await mountOwlApp(Login, host, { params: {}, env: { doAction: async (a) => actions.push(a) } });
  host.querySelector("#login-email").value = "alice@test.mg";
  host.querySelector("#login-password").value = "MotDePasseOdoo!";
  host.querySelector("#login-db").value = "vente1";
  host.querySelector("#login-btn").click();
  for (let i = 0; i < 200 && !getSession(); i++) await tick();
  const session = getSession();
  ok(!!session && session.db === "vente1", "login : session sauvée (identité + base)");
  ok(!session.api_key, "M9 : PLUS de clé API en clair dans la session");
  ok(vaultExists(), "M9 : coffre créé au login");
  ok(getApiKey() === "k-vault", "M9 : clé déverrouillée pour l'onglet (flux utilisable)");
  host.remove();
}
clearSession();

// ═════════ 4. écran unlock OWL ═════════
{
  await createVault("MotDePasseOdoo!", "k-vault");
  const { Unlock } = await import(`${REPO}/static/src/webclient/login/unlock.js`);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const actions = [];
  await mountOwlApp(Unlock, host, { params: { redirectTo: { tag: "home_menu" } }, env: { doAction: async (a, o) => actions.push([a, o]) } });
  const input = host.querySelector("#unlock-password");

  // 4a. mauvais mot de passe -> erreur, pas de redirection
  input.value = "mauvais";
  input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  host.querySelector("button[type=submit]").click();
  for (let i = 0; i < 100 && !host.querySelector(".alert-danger"); i++) await tick();
  ok(!!host.querySelector(".alert-danger"), "unlock : mauvais mot de passe -> message d'erreur");
  ok(getApiKey() === null && actions.length === 0, "unlock : mauvais mot de passe -> rien déverrouillé");

  // 4b. bon mot de passe -> clé déverrouillée + redirection
  input.value = "MotDePasseOdoo!";
  input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  host.querySelector("button[type=submit]").click();
  for (let i = 0; i < 200 && !actions.length; i++) await tick();
  ok(getApiKey() === "k-vault", "unlock : bon mot de passe -> clé déverrouillée");
  ok(actions.length === 1 && actions[0][0].tag === "home_menu", "unlock : redirection vers l'écran demandé");
  host.remove();
}
clearSession();

// ═════════ 5. « Mot de passe oublié » : purge + login ═════════
{
  saveSession({ uid: 7, name: "Alice", db: "vente1" });
  await createVault("MotDePasseOdoo!", "k-vault");
  setUnlockedKey("k-vault");
  const { Unlock } = await import(`${REPO}/static/src/webclient/login/unlock.js`);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const actions = [];
  await mountOwlApp(Unlock, host, { params: {}, env: { doAction: async (a, o) => actions.push([a, o]) } });
  host.querySelector("a.text-muted").click();
  for (let i = 0; i < 200 && !actions.length; i++) await tick();
  ok(!getSession() && !vaultExists() && getApiKey() === null, "unlock oublié : coffre + session purgés");
  ok(actions.length === 1 && actions[0][0].tag === "login", "unlock oublié : redirection login");
  host.remove();
}

console.log("\n✅ TOUS LES TESTS COFFRE (M9 MOT DE PASSE) PASSENT");
