/**
 * webclient/webclient.js
 * ======================
 * Assemblage du shell -- même rôle que le Webclient d'Odoo 17, mais à
 * la manière du moteur hors ligne : le gabarit vanilla de la navbar et
 * ses manipulations DOM impératives ont été migrés dans le composant
 * OWL Navbar (webclient/navbar/navbar_component.js), qui consomme
 * elle-même les bus "action:changed"/"user:info". Depuis l'itération
 * 15, TOUTE la systray est OWL (connectivité, synchronisation,
 * conflits, menu utilisateur -- composants embeddés dans la Navbar) :
 * il reste ici le squelette (racine navbar, conteneur d'action, toasts
 * de conflit), la création de l'ActionService (dispatcher du registre
 * "actions") et la restauration de l'état routeur.
 */

import "./conflict_detail/conflict_detail.js";
import { router } from "../core/browser/router_service.js";
import { createActionService } from "./actions/action_service.js";
import { mountNavbar } from "./navbar/navbar_component.js";
import { mountNotificationContainer } from "../core/notifications/notification_container.js";
import { mountRainbowMan } from "../core/effects/rainbow_man.js";

function detectTouchDevice() {
  if (navigator.maxTouchPoints > 0 || window.matchMedia("(pointer: coarse)").matches) {
    document.body.classList.add("o_touch_device");
  }
}

function ensureWebclientSkeleton() {
  let navbarRoot = document.getElementById("webclient-navbar-root");
  if (!navbarRoot) {
    navbarRoot = document.createElement("div");
    navbarRoot.id = "webclient-navbar-root";
    navbarRoot.style.display = "contents";
    document.body.appendChild(navbarRoot);
  }

  let container = document.getElementById("action-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "action-container";
    document.body.appendChild(container);
  }
  container.style.flex = "1";
  container.style.overflow = "auto";
  container.style.display = "flex";
  container.style.flexDirection = "column";

  return { navbarRoot, container };
}

export async function mountWebclient() {
  detectTouchDevice();

  const { navbarRoot, container } = ensureWebclientSkeleton();
  const actionService = createActionService(container);

  // Navbar OWL (itérations 14-15) : la visibilité, les assets, le
  // menu, les infos utilisateur ET toute la systray (connectivité,
  // synchronisation, conflits, menu utilisateur) sont des composants
  // OWL embeddés. Le bind est nécessaire : doAction est appelé en
  // callback.
  await mountNavbar(navbarRoot, { doAction: actionService.doAction.bind(actionService) });

  // Conteneurs OWL transverses, au-dessus de toutes les actions
  // (toasts du service de notifications + RainbowMan des effets).
  await mountNotificationContainer(navbarRoot);
  await mountRainbowMan(navbarRoot);

  actionService.restoreState(router.current);

  return actionService;
}
