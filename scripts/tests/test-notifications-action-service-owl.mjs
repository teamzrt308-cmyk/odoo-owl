/**
 * Test jsdom du service de notifications (toasts OWL) + ActionService
 * étendu (itération 16) :
 *  - service : add/close/closeAll, types, sticky, auto-close, boutons,
 *    registre "services" ;
 *  - NotificationContainer OWL : rendu des toasts (classe de type,
 *    titre, message, croix, bouton -> onClick + fermeture) ;
 *  - RainbowMan : effet affiché via le service, auto-dismiss, clic ;
 *  - ActionService : ir.actions.act_url (window.open),
 *    ir.actions.client (dispatch vers le registre), ir.actions.server
 *    (queueMethodCall -> file + toast success, erreur -> toast danger),
 *    option effect de doAction.
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
dom.window.alert = () => { throw new Error("alert() ne doit plus être appelé"); };
globalThis.alert = () => { throw new Error("alert() ne doit plus être appelé"); };
localStorage.clear();

// session pré-existante : la garde d'authentification laisse passer
localStorage.setItem("offline_sync_session", JSON.stringify({ uid: 5, name: "Alice", api_key: "KEY" }));

// fetch stub : aucune synchro réseau nécessaire hors ligne ; le ping
// échoue (indifférent ici).
globalThis.fetch = () => Promise.reject(new TypeError("hors ligne (stub)"));

class FakeTable {
  constructor(rows = [], keyFn = null) { this.rows = rows; this.keyFn = keyFn; }
  async put(obj) { this.rows.push(obj); }
  async bulkAdd(list) { for (const o of list) this.rows.push(o); }
  async bulkPut(list) { for (const o of list) this.rows.push(o); }
  async add(obj) { const id = this.rows.length + 1; this.rows.push({ id, ...obj }); return { id }; }
  async update() {}
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
    for (const t of ["sync_queue", "reference_records", "catalog_cache", "security_info", "record_cache", "installed_apps", "local_ledger", "list_cache"]) {
      this[t] = new FakeTable();
    }
    this.cache_meta = new FakeTable([], (r, k) => r.key === k);
    this.module_manifests = new FakeTable([], (r, k) => r.technical_name === k);
  }
  version() { return { stores() {} }; }
  transaction() {}
}
globalThis.Dexie = FakeDexie;

const { db } = await import(REPO + "/static/src/core/orm_service.js");
const { bus } = await import(REPO + "/static/src/core/bus/bus_service.js");
const { registry } = await import(REPO + "/static/src/core/registry.js");

// ── 1. Service de notifications ──
const { notifications } = await import(REPO + "/static/src/core/notifications/notification_service.js");
const serviceFromRegistry = registry.category("services").get("notification").start();
ok(serviceFromRegistry === notifications, "notif : service enregistré (registry services -> notifications)");

let events = 0;
bus.addEventListener("notification:changed", () => events++);

const id1 = notifications.add("Premier toast", { title: "Titre", type: "danger" });
const id2 = notifications.add("Second toast", { type: "success", sticky: true });
ok(Number.isInteger(id1) && Number.isInteger(id2) && id1 !== id2, "notif : add retourne des ids distincts");
ok(events === 2, "notif : bus notification:changed déclenché à chaque add");

const idAuto = notifications.add("Éphémère", { type: "info", autoCloseDelay: 80 });
await waitFor(() => {
  let gone = true;
  bus.addEventListener("notification:changed", () => {});
  return gone;
}, "noop");
// attente simple de l'auto-close (80ms) puis vérification via un add témoin
await new Promise((r) => setTimeout(r, 150));
events = 0;
const idProbe = notifications.add("témoin");
notifications.close(idProbe);
// le toast éphémère s'est fermé tout seul : close(idAuto) ne déclenche rien
events = 0;
notifications.close(idAuto);
ok(events === 0, "notif : auto-close après autoCloseDelay (close() sur id déjà parti = no-op)");

notifications.closeAll();
let remaining = null;
const probe = notifications.add("probe");
notifications.close(probe.id !== undefined ? probe.id : probe);
// closeAll a vidé : re-render des abonnés visible via le container ci-dessous

// ── 2. NotificationContainer OWL ──
const { mountNotificationContainer } = await import(REPO + "/static/src/core/notifications/notification_container.js");
const host = document.createElement("div");
document.body.appendChild(host);
const destroyContainer = await mountNotificationContainer(host);

notifications.closeAll();
const btnClicked = [];
notifications.add("Action requise", {
  title: "Confirmez",
  type: "warning",
  sticky: true,
  buttons: [{ name: "Recommencer", onClick: () => btnClicked.push("retry") }],
});
await waitFor(() => host.querySelector(".o_notification"), "toast rendu");
const toast = host.querySelector(".o_notification");
ok(toast.className.includes("text-bg-warning"), "notif : classe de type (text-bg-warning)");
ok(toast.querySelector(".o_notification_message").textContent === "Action requise", "notif : message rendu");
ok(toast.textContent.includes("Confirmez"), "notif : titre rendu");
ok(toast.querySelectorAll(".btn-close").length === 1, "notif : croix de fermeture");

// bouton : onClick + fermeture
toast.querySelector(".o_notification_button").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
await waitFor(() => btnClicked.length > 0 && !host.querySelector(".o_notification"), "bouton toast -> onClick + close");
ok(btnClicked.join(",") === "retry", "notif : bouton -> onClick exécuté");
ok(!host.querySelector(".o_notification"), "notif : bouton ferme le toast (close !== false)");

// types -> classes distinctes + closeAll vide le conteneur
notifications.add("a", { type: "danger", sticky: true });
notifications.add("b", { type: "success", sticky: true });
notifications.add("c", { type: "info", sticky: true });
await waitFor(() => host.querySelectorAll(".o_notification").length === 3, "3 toasts");
ok(host.querySelector(".o_notification").className.includes("text-bg-danger"), "notif : toast danger stylé");
notifications.closeAll();
await waitFor(() => host.querySelectorAll(".o_notification").length === 0, "closeAll -> conteneur vide");
ok(host.querySelectorAll(".o_notification").length === 0, "notif : closeAll vide le conteneur");

// ── 3. RainbowMan ──
const { mountRainbowMan, effects } = await import(REPO + "/static/src/core/effects/rainbow_man.js");
const rainbowHost = document.createElement("div");
document.body.appendChild(rainbowHost);
const destroyRainbow = await mountRainbowMan(rainbowHost);

effects.show({ title: "Inventaire validé !", message: "Toutes les lignes sont traitées.", showSeconds: 100 });
await waitFor(() => rainbowHost.querySelector(".o_rainbow_man"), "rainbow man affiché");
ok(rainbowHost.querySelector(".o_rainbow_man_title").textContent === "Inventaire validé !", "effet : titre affiché");
ok(rainbowHost.textContent.includes("Toutes les lignes sont traitées."), "effet : message affiché");
await waitFor(() => !rainbowHost.querySelector(".o_rainbow_man"), "rainbow man auto-dismiss");
ok(!rainbowHost.querySelector(".o_rainbow_man"), "effet : auto-dismiss après showSeconds");

effects.show({ message: "Bravo", showSeconds: 10000 });
await waitFor(() => !!rainbowHost.querySelector(".o_rainbow_man"), "rainbow man ré-affiché");
rainbowHost.querySelector(".o_rainbow_man").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
await waitFor(() => !rainbowHost.querySelector(".o_rainbow_man"), "rainbow man dismiss au clic");
ok(!rainbowHost.querySelector(".o_rainbow_man"), "effet : dismiss au clic (overlay)");

// ── 4. ActionService étendu ──
// home_menu s'enregistre par effet de bord au chargement du module
// (comme main.js côté app) -- nécessaire au dispatch ir.actions.client.
await import(REPO + "/static/src/webclient/home_menu/home_menu.js");
const { createActionService } = await import(REPO + "/static/src/webclient/actions/action_service.js");
const container = document.createElement("div");
document.body.appendChild(container);
const actionService = createActionService(container);

// window.open espion
const opened = [];
globalThis.open = (url, target) => opened.push([url, target]);
dom.window.open = (url, target) => opened.push([url, target]);

await actionService.doAction({ tag: "ir.actions.act_url", url: "https://odoo.com/docs", target: "new" });
ok(opened.length === 1 && opened[0][0] === "https://odoo.com/docs" && opened[0][1] === "_blank",
   "action : ir.actions.act_url -> window.open(_blank)");
await actionService.doAction({ tag: "ir.actions.act_url", url: "https://odoo.com", target: "self" });
ok(opened[1][1] === "_self", "action : act_url target self -> _self");
ok(container.childElementCount === 0, "action : act_url ne monte aucun contrôleur");

// ir.actions.client -> dispatch vers le registre "actions"
await actionService.doAction({ tag: "ir.actions.client", clientTag: "home_menu" }, { replace: true });
await waitFor(() => container.querySelector(".dashboard-container"), "client action -> home menu monté");
ok(!!container.querySelector(".dashboard-container"), "action : ir.actions.client -> home_menu (registre actions)");
let toasts = 0;
bus.addEventListener("notification:changed", () => toasts++);
await actionService.doAction({ tag: "ir.actions.client", clientTag: "inexistant" }, { replace: true });
await waitFor(() => container.textContent.includes("Action client inconnue") || toasts > 0, "client action inconnue -> toast danger");
ok(toasts > 0, "action : client action inconnue -> notification danger");

// ir.actions.server -> file + toast success (hors ligne : pas de sync)
const syncEvents = [];
bus.addEventListener("sync:updated", () => syncEvents.push(1));
const serverResult = await actionService.doAction({
  tag: "ir.actions.server", model: "stock.picking", recordId: 42, method: "button_validate", label: "Valider",
});
const callRow = db.sync_queue.rows.find((r) => r.operation === "call_method");
ok(!!callRow && callRow.model_name === "stock.picking", "action : ir.actions.server -> queueMethodCall (file)");
ok(JSON.parse(callRow.payload).method === "button_validate" && JSON.parse(callRow.payload).id === 42,
   "action : payload { id, method } correct");
ok(serverResult && serverResult.local === true, "action : ir.actions.server retourne { local: true } (hors ligne)");
ok(syncEvents.length > 0, "action : bus sync:updated déclenché");
await waitFor(() => host.querySelectorAll(".o_notification").length > 0, "toast success visible");
const successToast = [...host.querySelectorAll(".o_notification")].find((t) => t.textContent.includes("Valider"));
ok(successToast && successToast.className.includes("text-bg-success"), "action : toast success (exécutée localement)");

// erreur -> toast danger
const errResult = await actionService.doAction({ tag: "ir.actions.server" });
let incompleteToast = false;
for (let i = 0; i < 200 && !incompleteToast; i++) {
  incompleteToast = [...host.querySelectorAll(".o_notification")].some((t) => t.textContent.includes("incomplète"));
  if (!incompleteToast) await tick();
}
ok(errResult === undefined && incompleteToast, "action : action serveur incomplète -> toast danger");

// option effect de doAction : affiché après le montage de l'action
await actionService.doAction({ tag: "home_menu" }, { replace: true, effect: { title: "Bien joué", message: "Synchronisation réussie" } });
await waitFor(() => !!rainbowHost.querySelector(".o_rainbow_man") || !!document.querySelector(".o_rainbow_man"), "effect doAction -> rainbow man");
ok(!!document.querySelector(".o_rainbow_man"), "action : options.effect -> RainbowMan affiché");
effects.hide();

// doAction standard inchangé : le contrôleur courant est remplacé
ok(container.querySelector(".dashboard-container"), "action : navigation standard toujours opérationnelle");

console.log("\n✅ TOUS LES TESTS NOTIFICATIONS + ACTION SERVICE PASSENT");
