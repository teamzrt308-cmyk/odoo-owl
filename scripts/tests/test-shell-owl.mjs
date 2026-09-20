/**
 * Test jsdom du shell webclient OWL (itération 14) :
 *  - Navbar OWL : visibilité par tag d'action + classes de body + assets,
 *    titre d'app + sections (manifest -> arbre), atterrissage naturel,
 *    dropdown de section (entrées groupées), Accueil, bus "user:info"
 *    (avatar/nom/société/badges), ancrages des panneaux systray vanilla ;
 *  - UserMenu OWL : menu principal, vue « Mon compte » (caches locaux),
 *    déconnexion (confirmation si file non synchronisée -> doAction login) ;
 *  - HomeMenu OWL : grille des apps (cache), carte désactivée, recherche,
 *    ouverture d'app (doAction list_view), refresh hors ligne, classe
 *    dashboard-body sur le conteneur, bus user:info hors ligne.
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
dom.window.confirm = () => true;
globalThis.confirm = () => true;
globalThis.open = () => {};
// fetch en échec INSTANTANÉ (hors ligne déterministe) : le fetch node
// réel peut pendre plusieurs secondes sur un hôte irroutable, ce qui
// dépasserait les pollings de la suite.
globalThis.fetch = () => Promise.reject(new TypeError("Failed to fetch (stub hors ligne)"));
localStorage.clear();

class FakeTable {
  constructor(rows = [], keyFn = null) { this.rows = rows; this.keyFn = keyFn; }
  async put(obj) { this.rows.push(obj); }
  async bulkAdd(list) { for (const o of list) this.rows.push(o); }
  async bulkPut() {}
  async add(obj) { const id = this.rows.length + 1; this.rows.push({ id, ...obj }); return { id }; }
  async update() {}
  async clear() { this.rows.length = 0; }
  async get(key) {
    if (!this.keyFn) return undefined;
    // dernier match = « last write wins » (put est un upsert côté Dexie)
    const rows = this.rows;
    for (let i = rows.length - 1; i >= 0; i--) {
      if (this.keyFn(rows[i], key)) return rows[i];
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
  version() { return { stores() {} }; }
  transaction() {}
}
globalThis.Dexie = FakeDexie;

const salesMenus = [
  { id: 1, name: "Ventes", parent_id: null, sequence: 1, model: null, action_id: null, default_view: null },
  { id: 2, name: "Devis", parent_id: 1, sequence: 1, model: "sale.order", action_id: "quote_action", default_view: "list" },
  { id: 3, name: "Clients", parent_id: 1, sequence: 2, model: null, action_id: null, default_view: null },
  { id: 4, name: "Tous les clients", parent_id: 3, sequence: 1, model: "res.partner", action_id: "partner_action", default_view: "kanban" },
  { id: 5, name: "Rapports", parent_id: 1, sequence: 3, model: null, action_id: null, default_view: null },
  { id: 6, name: "Analyse", parent_id: 5, sequence: 1, model: null, action_id: null, default_view: null },
  { id: 7, name: "Par commercial", parent_id: 6, sequence: 1, model: "sale.report", action_id: "report_action", default_view: "list" },
];

const { db } = await import(REPO + "/static/src/core/orm_service.js");
await db.module_manifests.put({
  technical_name: "sales",
  module: { label: "Ventes" },
  menus: salesMenus,
  fields: {},
  views: {},
});

const { bus } = await import(REPO + "/static/src/core/bus/bus_service.js");

// ── 1. Navbar OWL ──
const { mountNavbar } = await import(REPO + "/static/src/webclient/navbar/navbar_component.js");
const navHost = document.createElement("div");
document.body.appendChild(navHost);
const actions = [];
const doAction = (a, o) => actions.push([a, o]);
const { destroy: destroyNavbar } = await mountNavbar(navHost, { doAction });

ok(navHost.querySelector("header.o_navbar"), "shell : header o_navbar rendu par OWL");
ok(navHost.querySelector("header.o_navbar").style.display === "none", "shell : navbar masquée avant toute action");
// systray 100% OWL (itération 15) : les composants rendent leurs ids historiques
ok(navHost.querySelector("#connectivity-dot") && navHost.querySelector("#sync-status-btn") && navHost.querySelector("#conflict-status-btn"),
   "shell : systray OWL rendue (connectivité, sync, conflits)");

// tag non visible -> body bg-100, navbar masquée
bus.trigger("action:changed", { tag: "login", params: {} });
ok(document.body.classList.contains("bg-100"), "shell : tag login -> body bg-100");

// action list_view -> navbar visible, titre + sections chargées, atterrissage naturel
bus.trigger("action:changed", { tag: "list_view", params: { module: "sales", model: "other.model" } });
await waitFor(() => navHost.querySelector("#app-title").textContent === "Ventes", "titre d'app");
ok(document.body.classList.contains("o_web_client"), "shell : body o_web_client");
ok(navHost.querySelector("header.o_navbar").style.display !== "none", "shell : navbar visible");
let landing = actions.find(([a]) => a && a.tag === "list_view" && a.model === "sale.order");
ok(!!landing && landing[0].actionId === "quote_action", "shell : atterrissage naturel -> première entrée avec modèle (sale.order)");
let sectionEls = [...navHost.querySelectorAll(".o_navbar_section_item")];
ok(sectionEls.length === 3 && sectionEls.map((s) => s.textContent.trim()).join(",") === "Devis,Clients,Rapports",
   "shell : 3 sections du menu horizontal (Devis, Clients, Rapports)");

// section avec sous-menu -> dropdown, entrée groupée sous header
const clientsBtn = sectionEls.find((s) => s.textContent.includes("Clients")).querySelector("button");
clientsBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
await waitFor(() => navHost.querySelector(".o_section_dropdown"), "dropdown de section");
let entries = [...navHost.querySelectorAll(".o_section_dropdown a.dropdown-item")];
ok(entries.length === 1 && entries[0].textContent.trim() === "Tous les clients", "shell : entrée simple du dropdown");
entries[0].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
await waitFor(() => !navHost.querySelector(".o_section_dropdown"), "dropdown refermé après clic");
let navAction = actions[actions.length - 1];
ok(navAction[0].tag === "list_view" && navAction[0].model === "res.partner" && navAction[0].view === "kanban",
   "shell : clic d'entrée -> doAction list_view (res.partner, kanban)");
ok(sectionEls.find((s) => s.textContent.includes("Clients")).className.includes("active"), "shell : section active marquée");

// section avec groupes (header + sous-entrées)
sectionEls = [...navHost.querySelectorAll(".o_navbar_section_item")];
sectionEls.find((s) => s.textContent.includes("Rapports")).querySelector("button").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
await waitFor(() => navHost.querySelector(".o_section_dropdown .dropdown-header"), "header groupé");
ok(navHost.querySelector(".o_section_dropdown .dropdown-header").textContent === "Analyse", "shell : header de groupe « Analyse »");
const groupedEntry = navHost.querySelector(".o_section_dropdown .o_dropdown_menu_group_entry");
ok(groupedEntry.textContent.trim() === "Par commercial", "shell : sous-entrée groupée");
groupedEntry.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
await tick();
navAction = actions[actions.length - 1];
ok(navAction[0].model === "sale.report", "shell : sous-entrée groupée -> doAction (sale.report)");

// section feuille -> navigation directe
sectionEls = [...navHost.querySelectorAll(".o_navbar_section_item")];
sectionEls.find((s) => s.textContent.includes("Devis")).querySelector("button").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
await tick();
navAction = actions[actions.length - 1];
ok(navAction[0].model === "sale.order" && !navHost.querySelector(".o_section_dropdown"),
   "shell : section feuille -> doAction direct");

// bouton Accueil
navHost.querySelector("#back-btn").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
await tick();
ok(actions[actions.length - 1][0] === "home_menu" && actions[actions.length - 1][1].clearStack === true,
   "shell : bouton Accueil -> doAction('home_menu', {clearStack})");

// home_menu : titre + sections vidés
bus.trigger("action:changed", { tag: "home_menu", params: {} });
await tick();
ok(navHost.querySelector("#app-title").textContent === "" && navHost.querySelectorAll(".o_navbar_section_item").length === 0,
   "shell : home_menu -> titre et sections vidés");

// bus user:info -> avatar, nom, société, badges
bus.trigger("user:info", { initial: "A", name: "Alice", companyName: "Ma Société", unreadMessages: 3, pendingActivities: 2 });
await tick();
ok(navHost.querySelector(".o_user_avatar").textContent === "A", "shell : avatar initial (A)");
ok(navHost.querySelector(".o_user_menu .oe_topbar_name").textContent === "Alice", "shell : nom utilisateur (Alice)");
ok(navHost.querySelector("#shell-company-name").textContent === "Ma Société", "shell : société (Ma Société)");
ok(navHost.querySelector("#badge-messages").style.display === "inline-block" && navHost.querySelector("#badge-messages").textContent === "3",
   "shell : badge messages visible (3)");
ok(navHost.querySelector("#badge-activities").textContent === "2", "shell : badge activités (2)");

// ── 2. UserMenu OWL ──
navHost.querySelector(".o_user_menu .dropdown-toggle").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
await waitFor(() => navHost.querySelector(".o_user_menu_dropdown"), "menu utilisateur ouvert");
let userItems = [...navHost.querySelectorAll(".o_user_menu_dropdown a.dropdown-item")].map((a) => a.textContent.trim());
ok(userItems.join(",") === "Documentation,Support,Mon compte,Se déconnecter", `user menu : entrées (${userItems.join(" | ")})`);

// vue Mon compte (caches locaux)
const profile = await import(REPO + "/static/src/core/user_service.js");
await profile.saveCachedProfile({ name: "Alice", initial: "A", companyName: "Ma Société" });
await db.security_info.put({ model: "*", is_admin: true, groups: [] });
[...navHost.querySelectorAll(".o_user_menu_dropdown a.dropdown-item")].find((a) => a.textContent.includes("Mon compte"))
  .dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
await waitFor(() => navHost.querySelector(".o_user_menu_dropdown .o_account_back"), "vue Mon compte");
const accountText = navHost.querySelector(".o_user_menu_dropdown").textContent;
ok(accountText.includes("Ma Société") && accountText.includes("Administrateur"), "user menu : Mon compte (société + rôle, caches locaux)");

// retour au menu principal
navHost.querySelector(".o_account_back").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
await waitFor(() => [...navHost.querySelectorAll(".o_user_menu_dropdown a.dropdown-item")].some((a) => a.textContent.includes("Documentation")),
   "retour au menu principal");

// déconnexion sans file en attente : pas de confirmation, doAction login
const before = actions.length;
[...navHost.querySelectorAll(".o_user_menu_dropdown a.dropdown-item")].find((a) => a.textContent.includes("déconnecter"))
  .dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
await waitFor(() => actions.length > before && actions[actions.length - 1][0] === "login", "déconnexion -> doAction login");
ok(actions[actions.length - 1][1] && actions[actions.length - 1][1].clearStack === true, "user menu : déconnexion avec clearStack");
await waitFor(() => !navHost.querySelector(".o_user_menu_dropdown"), "menu fermé après déconnexion");

// déconnexion AVEC file en attente : confirmation
await db.sync_queue.put({ local_uuid: "u1", status: "pending", model_name: "x", operation: "create" });
let confirmCalled = false;
globalThis.confirm = () => { confirmCalled = true; return true; };
navHost.querySelector(".o_user_menu .dropdown-toggle").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
await waitFor(() => navHost.querySelector(".o_user_menu_dropdown"), "menu utilisateur rouvert");
[...navHost.querySelectorAll(".o_user_menu_dropdown a.dropdown-item")].find((a) => a.textContent.includes("déconnecter"))
  .dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
await waitFor(() => confirmCalled, "confirmation affichée (action non synchronisée)");
await waitFor(() => actions[actions.length - 1][0] === "login", "déconnexion confirmée");
ok(confirmCalled, "user menu : confirmation pour action en attente");

destroyNavbar();
await tick();
ok(navHost.querySelectorAll("header.o_navbar").length === 0, "shell : destroy -> navbar retirée");

// ── 3. HomeMenu OWL ──
// (navbar fraîche : l'instance précédente a été détruite pour le test destroy)
const homeNavHost = document.createElement("div");
document.body.appendChild(homeNavHost);
const { destroy: destroyHomeNavbar } = await mountNavbar(homeNavHost, { doAction });
await db.installed_apps.put({ technical_name: "sales", label: "Ventes", main_model: "sale.order", icon_base64: null });
await db.installed_apps.put({ technical_name: "legacy", label: "Sans modèle", main_model: null, icon_base64: null });
await profile.saveCachedProfile({ name: "Bob", initial: "B", companyName: "ACME" });

const { mountHomeMenu } = await import(REPO + "/static/src/webclient/home_menu/home_menu.js");
const homeHost = document.createElement("div");
document.body.appendChild(homeHost);
const homeActions = [];
const envHome = { doAction: (a, o) => homeActions.push([a, o]) };
const homeHandle = await mountHomeMenu(homeHost, {}, envHome);

ok(homeHost.classList.contains("dashboard-body"), "home : classe dashboard-body posée sur le conteneur");
await waitFor(() => homeHost.querySelectorAll(".module-card").length === 2, "grille des apps");
let cards = [...homeHost.querySelectorAll(".module-card")];
ok(cards[0].textContent.includes("Ventes") && cards[0].className.includes("ready"), "home : carte Ventes prête");
ok(cards[1].className.includes("disabled") && cards[1].textContent.includes("Non pris en charge"),
   "home : carte sans modèle désactivée");
// le manifest "sales" est déjà en cache (seed navbar) -> bouton « Mis à jour »
ok(cards[0].querySelector(".download-btn").textContent === "Mis à jour", "home : bouton de pré-téléchargement (manifest en cache)");

// recherche filtre la grille
const searchBox = homeHost.querySelector(".search-box input");
searchBox.value = "vent";
searchBox.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
await waitFor(() => homeHost.querySelectorAll(".module-card").length === 1, "recherche filtre la grille");
ok(homeHost.querySelectorAll(".module-card").length === 1 && homeHost.textContent.includes("Ventes"),
   "home : recherche « vent » -> 1 carte");
searchBox.value = "";
searchBox.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
await waitFor(() => homeHost.querySelectorAll(".module-card").length === 2, "recherche vidée -> 2 cartes");

// ouverture d'une app -> doAction list_view (atterrissage naturel du manifest)
cards[0].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
let opened = false;
for (let i = 0; i < 200 && !opened; i++) {
  opened = homeActions.some(([a]) => a.tag === "list_view" && a.module === "sales" && a.model === "sale.order");
  if (!opened) await tick();
}
ok(opened, "home : clic carte -> doAction list_view (landing du manifest sales)");

// refresh hors ligne -> message + cache
homeHost.querySelector("#refresh-modules-btn").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
await waitFor(() => homeHost.querySelector("#sync-status").textContent.includes("Hors ligne"), "refresh hors ligne");
ok(homeHost.querySelector("#sync-status").textContent.includes("Hors ligne — utilisation de la dernière liste connue"),
   "home : message hors ligne");

// infos utilisateur hors ligne -> bus user:info (profil en cache) -> navbar mise à jour
await waitFor(() => homeNavHost.querySelector(".o_user_avatar") && homeNavHost.querySelector(".o_user_avatar").textContent === "B",
   "home -> bus user:info -> navbar avatar");
ok(homeNavHost.querySelector("#shell-company-name").textContent === "ACME", "home : navbar société mise à jour (ACME)");

homeHandle.destroy();
destroyHomeNavbar();
await tick();
ok(!homeHost.classList.contains("dashboard-body") && homeHost.querySelectorAll(".module-card").length === 0,
   "home : destroy -> classe retirée + DOM retiré");

console.log("\n✅ TOUS LES TESTS SHELL OWL PASSENT");
