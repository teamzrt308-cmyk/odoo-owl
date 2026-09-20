/**
 * core/effects/rainbow_man.js
 * ===========================
 * Service d'EFFETS + RainbowMan -- l'équivalent hors ligne du couple
 * effect_service / rainbow_man d'Odoo 17 : une action peut demander un
 * effet de célébration (doAction(..., { effect }) ou prop `effect` d'une
 * action serveur), affiché en plein écran par le composant OWL
 * RainbowMan monté une seule fois par le webclient.
 *
 * Comme pour les notifications : l'état vit dans le service, le
 * composant s'abonne au bus "effect:changed" et remplace son état de
 * premier niveau (pattern réactif fiable du moteur).
 */

import { registry } from "../registry.js";
import { bus } from "../bus/bus_service.js";
import { mountOwlApp } from "../../owl/app.js";

let hideTimer = null;

export const effects = {
  /**
   * Affiche un effet (pour l'instant : rainbow_man).
   * @param {Object} [options]
   * @param {string} [options.type] - "rainbow_man" (seul type supporté)
   * @param {string} [options.title] - titre affiché (défaut « Bien joué ! »)
   * @param {string} [options.message] - message secondaire
   * @param {number} [options.showSeconds] - ms d'affichage (défaut 2500)
   */
  show(options = {}) {
    const { type = "rainbow_man", title = "Bien joué !", message = "", showSeconds = 2500 } = options;
    bus.trigger("effect:changed", { active: true, type, title, message, showSeconds });
  },

  hide() {
    bus.trigger("effect:changed", { active: false });
  },
};

registry.category("services").add("effect", {
  start() {
    return effects;
  },
});

export class RainbowMan extends owl.Component {
  static template = owl.xml`
    <div t-if="state.active" class="o_rainbow_man position-fixed top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center"
         style="z-index: 3000; background: linear-gradient(135deg, rgba(255,0,150,0.25), rgba(255,200,0,0.25), rgba(0,200,255,0.25));"
         t-on-click="dismiss">
      <div class="bg-white rounded-4 p-5 shadow text-center" style="max-width: 420px;">
        <div style="font-size: 64px;" aria-hidden="true">🌈</div>
        <h3 class="o_rainbow_man_title fw-bold mt-2" t-esc="state.title"/>
        <p t-if="state.message" class="text-muted o_rainbow_man_message mt-2" t-esc="state.message"/>
        <button type="button" class="btn btn-primary o_rainbow_man_close mt-3" t-on-click.stop="dismiss">Fermer</button>
      </div>
    </div>`;

  setup() {
    this.state = owl.useState({ active: false, title: "", message: "" });
    this.onChange = (ev) => {
      const detail = ev.detail || {};
      this.state.active = !!detail.active;
      this.state.title = detail.title || "";
      this.state.message = detail.message || "";
      clearTimeout(hideTimer);
      if (detail.active) {
        hideTimer = setTimeout(() => effects.hide(), detail.showSeconds || 2500);
      }
    };
    bus.addEventListener("effect:changed", this.onChange);
    owl.onWillDestroy(() => {
      clearTimeout(hideTimer);
      bus.removeEventListener("effect:changed", this.onChange);
    });
  }

  dismiss() {
    effects.hide();
  }
}

/**
 * Montage du RainbowMan (contrat : async -> destroy) -- appelé une
 * seule fois par webclient.js.
 */
export async function mountRainbowMan(target) {
  const { destroy } = await mountOwlApp(RainbowMan, target, {});
  return destroy;
}
