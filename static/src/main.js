import { registry } from "./core/registry.js";
import { bus } from "./core/bus/bus_service.js";
import { router } from "./core/browser/router_service.js";
import { initRulesEngine } from "./model/rules_engine/rules_engine.js";
import { allRules } from "./model/rules_engine/rules/index.js";

import "./webclient/login/login.js";
import { mountWebclient } from "./webclient/webclient.js";
import "./views/view.js";
import "./webclient/home_menu/home_menu.js";


// OWL — les premières briques du moteur sont désormais rendues par OWL :
// les widgets de champ simples via owl/field_bridge.js (char, text,
// integer, float, boolean, selection, date, datetime, monetary) et la
// vue kanban via views/kanban/kanban_renderer.js (arch compilée en
// template OWL). Voir static/src/owl/README.md.

// Fusionné depuis core/browser/service_worker.js : chez Odoo l'enregistrement
// du Service Worker se fait directement au boot, sans fichier dédié.
function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register("/service-worker.js")
      .then(() => console.log("Service Worker enregistré"))
      .catch((err) => console.error("Échec Service Worker :", err));
  }
}

function startServices() {
  const started = {};
  for (const [name, service] of registry.category("services").getEntries()) {
    started[name] = service.start();
  }
  return started;
}

function boot() {
  startServices();

  // Doit être fait avant tout rendu de formulaire/liste : les règles
  // d'accès/défaut (model "*") sont consultées dès l'évaluation des
  // premières expressions invisible/readonly (voir py_utils.js).
  initRulesEngine(allRules);

  registerServiceWorker();

  bus.trigger("app:ready", {
    services: registry.category("services").getEntries().map(([k]) => k),
    initialRouterState: router.current,
  });

  const actionService = mountWebclient();
  window.__pwa_debug__ = { registry, bus, router, actionService };
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
