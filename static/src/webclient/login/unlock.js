/**
 * webclient/login/unlock.js
 * Écran de DÉVERROUILLAGE (lot sécurité, M9 -- « mot de passe », pas de
 * PIN). La session est chiffrée dans le coffre (vault.js) ; au boot,
 * tant que l'utilisateur n'a pas resaisi son MOT DE PASSE ODOO, l'app
 * est verrouillée : la garde d'authentification du doAction redirige
 * ici (au lieu du login) tant qu'un coffre existe.
 *
 * Flux : mot de passe -> PBKDF2 -> déchiffrement AES-GCM -> succès :
 * clé en sessionStorage (durée de l'onglet) + doAction(redirectTo) ;
 * échec : message d'erreur (aucun indice côté timing : même chemin de
 * code). « Se reconnecter » : purge du coffre + de la session -> login
 * (le serveur régénère la clé).
 */

import { registry } from "../../core/registry.js";
import { clearSession, setUnlockedKey } from "../../core/browser/session.js";
import { unlockVault, clearVault } from "../../core/browser/vault.js";
import { loadScopedCss, unloadScopedCss } from "../../core/assets.js";
import { mountOwlApp } from "../../owl/app.js";

export class Unlock extends owl.Component {
  static props = {
    params: { type: Object, optional: true },
    env: { optional: true },
  };

  static template = owl.xml`
    <div id="wrapwrap">
      <main>
        <div class="container py-5">
          <div class="card border-0 mx-auto bg-100" style="max-width: 300px;">
            <div class="card-body">
              <div class="text-center pb-3 border-bottom mb-4">
                <span style="font-size:2.4rem; font-weight:700; color:#714B67; letter-spacing:-1px">odoo</span>
              </div>

              <p class="text-muted small mb-3">
                Session verrouillée. Saisissez votre <b>mot de passe Odoo</b>
                pour déverrouiller les données locales de cet appareil.
              </p>

              <form t-on-submit.prevent="onSubmit">
                <div class="mb-3">
                  <label for="unlock-password" class="form-label">Mot de passe Odoo</label>
                  <input type="password" id="unlock-password" required="required"
                         autocomplete="current-password" class="form-control"
                         t-ref="password"/>
                </div>

                <div t-if="state.error" class="alert alert-danger py-2 small" role="alert">
                  {state.error}
                </div>

                <button type="submit" class="btn btn-primary w-100 o_form_button_save"
                        t-att-disabled="state.busy">
                  <t t-if="!state.busy">Déverrouiller</t>
                  <t t-else="1">Déverrouillage…</t>
                </button>
              </form>

              <div class="text-center mt-3">
                <a href="#" class="small text-muted"
                   t-on-click.prevent="relogin">Mot de passe oublié ? Se reconnecter</a>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  `;

  setup() {
    this.state = owl.useState({ error: "", busy: false });
    this.passwordRef = owl.useRef("password");
  }

  setError(message) {
    this.state.error = message;
    this.state.busy = false;
  }

  async onSubmit() {
    if (this.state.busy) return;
    this.state.busy = true;
    this.state.error = "";

    const password = this.passwordRef.el ? this.passwordRef.el.value : "";
    if (!password) {
      this.setError("Mot de passe requis");
      return;
    }

    let apiKey = null;
    try {
      apiKey = await unlockVault(password);
    } catch (err) {
      console.warn("[unlock] erreur de déverrouillage :", err);
      apiKey = null;
    }
    if (!apiKey) {
      this.setError("Mot de passe incorrect");
      return;
    }

    setUnlockedKey(apiKey);
    const target = (this.props.params && this.props.params.redirectTo) || { tag: "home_menu" };
    await this.props.env.doAction(target, { replace: true, clearStack: true });
  }

  async relogin() {
    // Mot de passe oublié : le déverrouillage hors ligne est impossible
    // (c'est le but) -> purge coffre + session, retour au login ; le
    // serveur régénérera la clé à la reconnexion.
    clearVault();
    clearSession();
    await this.props.env.doAction({ tag: "login" }, { replace: true, clearStack: true });
  }
}

/**
 * Montage de l'écran de déverrouillage (contrat { mount } du registre
 * "actions", identique au login). params.redirectTo (optionnel) :
 * l'action demandée avant la redirection par la garde.
 */
export async function mountUnlock(container, params, env) {
  loadScopedCss("css/web.assets_frontend.min.css", "odoo-frontend-assets-login");
  const { destroy } = await mountOwlApp(Unlock, container, { params, env });
  return {
    destroy() {
      destroy();
      unloadScopedCss("odoo-frontend-assets-login");
    },
  };
}

registry.category("actions").add("unlock", { mount: mountUnlock });
