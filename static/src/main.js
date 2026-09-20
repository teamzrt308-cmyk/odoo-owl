import { registry } from "./core/registry.js";
import { bus } from "./core/bus/bus_service.js";
import { router } from "./core/browser/router_service.js";
import { initRulesEngine } from "./model/rules_engine/rules_engine.js";
import { allRules } from "./model/rules_engine/rules/index.js";

import "./webclient/login/login.js";
import { mountWebclient } from "./webclient/webclient.js";
import "./views/view.js";
import "./webclient/home_menu/home_menu.js";


// OWL — les widgets de champ sont tous rendus par OWL : les types simples
// via owl/field_bridge.js (char, text, integer, float, boolean, selection,
// date, datetime, monetary), les relationnels many2one/many2many_tags et
// le tableau one2many (sous-composants OWL par cellule, état réactif des
// lignes) ; les vues kanban (kanban_arch_parser) et form
// (form_arch_parser::buildFormTemplate) sont des composants OWL dont le
// template est compilé depuis l'arch ; le contrôleur form est lui-même
// un composant OWL monté par views/view.js via le descripteur
// { Controller } de la vue — le contrôleur list (et kanban) suit le
// même modèle ; le control panel est un composant OWL embeddé dans les
// contrôleurs (props display/breadcrumb/pager/views + callbacks).
// Voir static/src/owl/README.md.

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

async function boot() {
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

  // mountWebclient est async depuis la migration de la navbar en OWL
  // (it. 14) : le shell (navbar + panneaux systray) est monté avant la
  // restauration de l'état routeur (dans mountWebclient).
  const actionService = await mountWebclient();
  window.__pwa_debug__ = { registry, bus, router, actionService };
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
