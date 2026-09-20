/**
 * core/notifications/notification_service.js
 * ==========================================
 * Service de notifications -- même architecture qu'Odoo 17
 * (web/static/src/core/notifications/notification_service.js) : une API
 * `add(message, options)` centralisée, consommée par le composant OWL
 * NotificationContainer (notification_container.js) qui affiche les
 * toasts. Remplace les alert() natifs du moteur (bloquants) par des
 * toasts non bloquants.
 *
 * Le service est un singleton importable directement (`notifications`)
 * ET enregistré dans le registre "services" (contrat Odoo : le service
 * est résolu par le registry, ici `registry.category("services")
 * .get("notification").start()`).
 *
 * L'état vit DANS le service (liste simple) ; le composant s'abonne au
 * bus "notification:changed" (détail = copie de la liste) et remplace
 * SON état de premier niveau -- le pattern réactif fiable du moteur
 * (une mutation imbriquée de useState ne re-rend pas).
 */

import { registry } from "../registry.js";
import { bus } from "../bus/bus_service.js";

let nextId = 1;
const items = [];
const autoCloseTimers = new Map();

export const notifications = {
  /**
   * Ajoute une notification (toast) et retourne son id.
   * @param {string} message - texte principal du toast
   * @param {Object} [options]
   * @param {string} [options.title] - titre court (gras)
   * @param {string} [options.type] - "warning" | "danger" | "success" | "info"
   * @param {boolean} [options.sticky] - true = pas de fermeture automatique
   * @param {number} [options.autoCloseDelay] - ms (défaut 4000, ignoré si sticky)
   * @param {Array<{name, onClick, close?}>} [options.buttons] - boutons d'action
   * @param {string} [options.className] - classes additionnelles du toast
   * @returns {number} id (pour notifications.close(id))
   */
  add(message, options = {}) {
    const {
      title = "",
      type = "warning",
      sticky = false,
      autoCloseDelay = 4000,
      buttons = [],
      className = "",
    } = options;
    const id = nextId++;
    items.push({
      id,
      message: String(message ?? ""),
      title,
      type,
      buttons,
      className,
    });
    bus.trigger("notification:changed", [...items]);
    if (!sticky) {
      autoCloseTimers.set(
        id,
        setTimeout(() => notifications.close(id), autoCloseDelay)
      );
    }
    return id;
  },

  close(id) {
    const idx = items.findIndex((n) => n.id === id);
    if (idx < 0) return;
    items.splice(idx, 1);
    const timer = autoCloseTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      autoCloseTimers.delete(id);
    }
    bus.trigger("notification:changed", [...items]);
  },

  closeAll() {
    for (const n of [...items]) notifications.close(n.id);
  },
};

registry.category("services").add("notification", {
  start() {
    return notifications;
  },
});
