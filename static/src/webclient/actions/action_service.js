/**
 * webclient/actions/action_service.js
 * ===================================
 * Depuis l'itération 16, couvre en plus les actions SANS contrôleur
 * d'Odoo :
 *  - `ir.actions.act_url` ({ url, target: "new"|"self" }) -> window.open ;
 *  - `ir.actions.client` ({ clientTag, params }) -> dispatch vers le tag
 *    du registre "actions" (home_menu, login... sont des client actions
 *    au sens d'Odoo) ;
 *  - `ir.actions.server` ({ model, recordId, method, label }) ->
 *    queueMethodCall + sync + toast (notification service) -- pas de
 *    navigation, le contrôleur courant reste monté ;
 *  - options `effect` (doAction(action, { effect })) -> RainbowMan
 *    (effect_service), comme l'option effect d'Odoo.
 */

import { registry } from "../../core/registry.js";
import { router } from "../../core/browser/router_service.js";
import { bus } from "../../core/bus/bus_service.js";
import { getApiKey } from "../../core/browser/session.js";
import { notifications } from "../../core/notifications/notification_service.js";
import { effects } from "../../core/effects/rainbow_man.js";
import { queueMethodCall, syncPendingActions } from "../../core/network/rpc_service.js";

const DEFAULT_ACTION_TAG = "home_menu";

/** Normalizes an action descriptor (string or object) into { tag, ...params }. */
function normalizeActionDescriptor(actionDescriptor) {
  if (typeof actionDescriptor === "string") {
    return { tag: actionDescriptor };
  }
  return { ...actionDescriptor };
}

export class ActionService {
  /** @param {HTMLElement} container the single element where all actions are mounted */
  constructor(container) {
    this.container = container;
    this.currentController = null; 
    this.stack = [];

    this._env = {
      bus,
      doAction: this.doAction.bind(this),
      goBack: this.goBack.bind(this),
    };

    // Browser back/forward button -> restore state without
    // pushing onto the history stack (otherwise, infinite loop).
    router.onStateChange((state) => this.restoreState(state)); 
  }

  /**
   * Main entry point, called for any navigation:
   *   doAction("home_menu")
   *   doAction({ tag: "list_view", model: "res.partner" })
   * Options:
   *   - replace: true      -> replaces the history entry instead of stacking a new one
   *   - clearStack: true   -> clears the breadcrumb stack (e.g., return to root menu)
   *   - fromPopState: true -> internal use only (see restoreState)
   */
  async doAction(actionDescriptor, options = {}) {
    const { tag, ...params } = normalizeActionDescriptor(actionDescriptor);

    // --- Authentication Guard ---
    if (tag !== "login" && !getApiKey()) {
      return this.doAction(
        { tag: "login", redirectTo: { tag, ...params } },
        { replace: true }
      );
    }

    const actionsRegistry = registry.category("actions");

    // --- Actions sans contrôleur (comme l'action service natif) ---
    if (tag === "ir.actions.act_url") {
      const target = params.target === "self" ? "_self" : "_blank";
      window.open(params.url, target);
      return { url: params.url, target };
    }
    if (tag === "ir.actions.client") {
      const clientTag = params.clientTag;
      if (!clientTag || !actionsRegistry.contains(clientTag)) {
        notifications.add(
          `Action client inconnue : « ${clientTag || "(manquant)"} ».`,
          { title: "Action", type: "danger" }
        );
        return;
      }
      // Le client action est délégué à son propre tag du registre
      // "actions" (même résolution qu'Odoo : action.tag -> registre).
      return this.doAction({ tag: clientTag, ...(params.params || {}) }, options);
    }
    if (tag === "ir.actions.server") {
      return this.runServerAction(params);
    }

    if (!actionsRegistry.contains(tag)) {
      console.error(`[ActionService] Aucune action enregistrée pour "${tag}".`);
      this._renderUnknownAction(tag);
      return;
    }

    const actionDef = actionsRegistry.get(tag);

    this._destroyCurrentController();

    if (!options.fromPopState) {
      if (options.clearStack) {
        this.stack = [];
      } else if (this.currentController) {
        this.stack.push({
          tag: this.currentController.tag,
          params: this.currentController.params,
        });
      }
      if (options.replace) {
        router.replaceState({ tag, ...params });
      } else {
        router.pushState({ tag, ...params });
      }
    }

    this.container.innerHTML = "";
    const result = await actionDef.mount(this.container, params, this._env);
    const destroy = typeof result === "function" ? result : result?.destroy;

    this.currentController = { tag, params, destroy };
    bus.trigger("action:changed", { tag, params });

    // Effet demandé par l'appelant (comme l'option effect d'Odoo :
    // affiché après le montage de l'action).
    if (options.effect) {
      effects.show(typeof options.effect === "string" ? { message: options.effect } : options.effect);
    }
  }

  /**
   * ir.actions.server : exécution HORS LIGNE par la file de
   * synchronisation (queueMethodCall), synchronisation immédiate si en
   * ligne, retour par toast du service de notifications -- le
   * contrôleur courant n'est PAS détruit (pas de navigation).
   */
  async runServerAction(params) {
    const { model, recordId, method, label } = params;
    if (!model || !method) {
      notifications.add("Action serveur incomplète : modèle ou méthode manquant.", {
        title: "Action serveur",
        type: "danger",
      });
      return;
    }
    try {
      await queueMethodCall(model, recordId || null, method, params.args || [], params.kwargs || {});
      let syncResult = { synced: 0 };
      if (navigator.onLine) {
        try {
          syncResult = await syncPendingActions();
        } catch (err) {
          console.warn("[ActionService] sync post-action serveur échouée :", err);
        }
      }
      bus.trigger("sync:updated");
      notifications.add(
        `${label || method} : ${syncResult.synced > 0 ? "exécutée et synchronisée avec Odoo." : "enregistrée localement — sera synchronisée dès que possible."}`,
        { title: "Action serveur", type: "success" }
      );
      if (params.effect) {
        effects.show(typeof params.effect === "string" ? { message: params.effect } : params.effect);
      }
      return { ...syncResult, local: true };
    } catch (err) {
      console.error("[ActionService] ir.actions.server échouée :", err);
      notifications.add(`L'action « ${label || method} » a échoué : ${err.message}`, {
        title: "Action serveur",
        type: "danger",
      });
      return { error: err.message };
    }
  }

  /**
   * Rebuilds the current screen from a history state (browser
   * back/forward buttons, or deep link on initial
   * load — see main.js, which calls restoreState(router.current)).
   */
  async restoreState(state) {
    if (!state || !state.tag) {
      return this.doAction(DEFAULT_ACTION_TAG, { fromPopState: true, clearStack: true });
    }
    const { tag, ...params } = state;
    await this.doAction({ tag, ...params }, { fromPopState: true });
  }

  /**
   * Returns to the previous action in the local stack without going through
   * the browser history (useful for an in-interface "Back" button,
   * distinct from the browser's back button).
   */
  async goBack() {
    const previous = this.stack.pop();
    if (previous) {
      await this.doAction(previous.tag, { ...previous.params, replace: true });
    } else {
      await this.doAction(DEFAULT_ACTION_TAG, { replace: true, clearStack: true });
    }
  }

  _destroyCurrentController() {
    if (this.currentController?.destroy) {
      try {
        this.currentController.destroy();
      } catch (err) {
        console.warn("[ActionService] Erreur lors du démontage du contrôleur précédent :", err);
      }
    }
    this.currentController = null;
  }

  _renderUnknownAction(tag) {
    this.container.innerHTML = "";
    const el = document.createElement("div");
    el.className = "o_action_not_found p-4";
    el.textContent = `Action inconnue : "${tag}"`;
    this.container.appendChild(el);
  }
}

/** Creates the singleton instance of ActionService for the given container. */
export function createActionService(container) {
  return new ActionService(container);
}
