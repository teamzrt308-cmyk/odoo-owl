/**
 * Test jsdom du LOT SÉCURITÉ (PWA) :
 *  - CSP meta dans index.html (mesure 2) ;
 *  - fetch_guard : 401 offline_sync -> session effacée + bus "auth:expired"
 *    (mesure 4) ; pas de fausse alerte sur les autres URLs / sans session ;
 *  - logoutServeur : no-op hors ligne ; en ligne -> POST Bearer ?db=
 *    (mesure 4, révocation serveur).
 */
import { JSDOM } from "jsdom";
import fs from "node:fs";
import path from "node:path";

const REPO = "/home/user/odoo-owl";
const ok = (cond, label) => {
  if (!cond) { console.error("✗ ÉCHEC :", label); process.exit(1); }
  console.log("✓", label);
};

// ── 1. CSP (mesure 2) ──
const html = fs.readFileSync(path.join(REPO, "index.html"), "utf8");
const cspMatch = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/);
ok(!!cspMatch, "sécurité : meta CSP présente dans index.html");
const csp = cspMatch ? cspMatch[1] : "";
ok(csp.includes("script-src 'self'"), "sécurité : script-src 'self' (pas de script tiers)");
ok(csp.includes("default-src 'self'"), "sécurité : default-src 'self'");
ok(csp.includes("object-src 'none'"), "sécurité : object-src 'none' (plugins bloqués)");
ok(csp.includes("http://localhost:8069"), "sécurité : connect-src autorise l'origine Odoo documentée");

// ── Environnement jsdom minimal ──
const dom = new JSDOM(`<!DOCTYPE html><html><body></body></html>`, {
  url: "https://pwa.test/index.html", runScripts: "outside-only", pretendToBeVisual: true,
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
Object.defineProperty(dom.window.navigator, "onLine", { value: false, configurable: true });
Object.defineProperty(globalThis.navigator, "onLine", { value: false, configurable: true });
localStorage.clear();

let fetchCalls = [];
let fetchMode = "ok";
const rawFetch = async (url, options) => {
  fetchCalls.push({ url: String(url), options: options || {} });
  if (fetchMode === "network-error") throw new TypeError("hors ligne (stub)");
  return { ok: fetchMode === "ok", status: fetchMode === "unauthorized" ? 401 : 200, json: async () => ({}) };
};

const { CONFIG, saveSession, getSession, clearSession, withDb } =
  await import(REPO + "/static/src/core/browser/session.js");
const { bus } = await import(REPO + "/static/src/core/bus/bus_service.js");
const { installFetchGuard, logoutServeur } =
  await import(REPO + "/static/src/core/network/fetch_guard.js");

// ── 2. fetch_guard : 401 (mesure 4) ──
// jsdom ne fournit PAS window.fetch : on le pose comme le ferait le
// navigateur, PUIS on installe la garde (qui l'enrobe).
dom.window.fetch = rawFetch;
installFetchGuard();
globalThis.fetch = dom.window.fetch; // les appels du test passent par le wrapper
ok(dom.window.fetch !== rawFetch, "sécurité : fetch guard installé (window.fetch enrobé)");

// 2a. 401 offline_sync AVEC session -> purge + événement
saveSession({ uid: 7, name: "Alice", api_key: "k-sec", db: "vente1" });
let expiredEvents = 0;
const unsubscribe = bus.subscribe("auth:expired", () => { expiredEvents += 1; });
fetchMode = "unauthorized";
await fetch(`${CONFIG.ODOO_BASE_URL}/offline_sync/push?db=vente1`);
ok(!getSession(), "sécurité : 401 offline_sync -> session LOCALE effacée");
ok(expiredEvents === 1, "sécurité : événement bus auth:expired émis (toast + login)");

// 2b. 401 SANS session (login raté) -> pas d'événement
fetchMode = "unauthorized";
await fetch(`${CONFIG.ODOO_BASE_URL}/offline_sync/login`);
ok(expiredEvents === 1, "sécurité : 401 au login (sans session) -> pas d'auth:expired");

// 2c. 401 hors offline_sync -> ignoré par la garde
saveSession({ uid: 7, name: "Alice", api_key: "k-sec", db: "vente1" });
fetchMode = "unauthorized";
await fetch("https://tiers.example/api");
ok(!!getSession(), "sécurité : 401 d'une URL non-offline_sync -> session conservée");
unsubscribe();

// ── 3. logoutServeur (mesure 4) ──
// 3a. hors ligne -> no-op (aucun appel)
fetchCalls = [];
const off = await logoutServeur();
ok(off === false && fetchCalls.length === 0, "sécurité : logoutServeur hors ligne = no-op");

// 3b. en ligne -> POST Bearer sur /offline_sync/logout étiqueté ?db=
Object.defineProperty(dom.window.navigator, "onLine", { value: true, configurable: true });
Object.defineProperty(globalThis.navigator, "onLine", { value: true, configurable: true });
fetchMode = "ok";
const on = await logoutServeur();
ok(on === true, "sécurité : logoutServeur en ligne -> true");
ok(fetchCalls.length === 1 && fetchCalls[0].url.includes("/offline_sync/logout"), "sécurité : POST /offline_sync/logout appelé");
ok((fetchCalls[0].options.headers || {}).Authorization === "Bearer k-sec", "sécurité : logout avec Bearer <clé>");
ok(fetchCalls[0].url.endsWith("db=vente1"), "sécurité : logout étiqueté ?db= (multi-bases)");

// 3c. serveur injoignable -> false sans lever
fetchMode = "network-error";
const err = await logoutServeur();
ok(err === false, "sécurité : logoutServeur en échec réseau -> false (jamais bloquant)");

console.log("\n✅ TOUS LES TESTS SÉCURITÉ (LOT 11 MESURES) PASSENT");
