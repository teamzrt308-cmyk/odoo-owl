/**
 * views/view.js
 * =============
 * Dispatcher de vues, calqué sur le flux d'Odoo :
 *
 *   action_service (ir.actions.act_window)
 *     -> résolution du TYPE de vue (params.view, défaut selon id/isNew)
 *     -> registry.category("views")[type].mount(...)   [chez Odoo : Controller]
 *
 * Chez Odoo, les vues ne s'enregistrent PAS dans le registre "actions" :
 * elles vivent dans registry.category("views") (voir form_view.js /
 * list_view.js / kanban_view.js) et c'est cette couche qui les résout.
 * Les trois tags "actions" ci-dessous ne sont que des fines entrées de
 * compatibilité avec l'ActionService hors ligne (deep links #action=...).
 */

import { registry } from "../core/registry.js";

// Effets de bord : enregistrement des descripteurs de vues.
import "./form/form_view.js";
import "./list/list_view.js";
import "./kanban/kanban_view.js";

/**
 * Résolution du type de vue, comme le fait l'ActionService d'Odoo à
 * partir de l'action act_window : la vue demandée d'abord, sinon
 * formulaire si un enregistrement est ciblé, sinon liste.
 */
function resolveViewType(params) {
  if (params.view) return params.view;
  if (params.id || params.isNew) return "form";
  return "list";
}

/**
 * Main dispatcher: resolves the view type from the action params and
 * mounts the matching registered view (list, form, kanban...).
 */
export async function mountView(container, params, env) {
  const viewType = resolveViewType(params);

  const viewsRegistry = registry.category("views");
  if (!viewsRegistry.contains(viewType)) {
    console.error(`[view.js] Aucune vue enregistrée pour le type "${viewType}".`);
    container.innerHTML = "";
    const el = document.createElement("div");
    el.className = "o_view_not_found p-4 text-muted";
    el.textContent = `Vue "${viewType}" non disponible pour ce modèle.`;
    container.appendChild(el);
    return () => {};
  }

  return viewsRegistry.get(viewType).mount(container, params, env);
}

/**
 * Entrées de compatibilité dans le registre "actions" : l'ActionService
 * hors ligne route les tags d'URL (#action=list_view...) vers ce module.
 * "ir.actions.act_window" est le format natif Odoo : le descripteur reçu
 * du menu (action_id, modèle, vue par défaut) est dispatché par
 * resolveViewType exactement comme le ferait le vrai webclient.
 */
function mountActionView(container, params, env) {
  return mountView(container, params, env);
}

registry.category("actions").add("list_view", { mount: mountActionView });
registry.category("actions").add("form_view", { mount: mountActionView });
registry.category("actions").add("ir.actions.act_window", { mount: mountActionView });
