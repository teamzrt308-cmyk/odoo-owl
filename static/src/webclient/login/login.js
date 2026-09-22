/**
 * webclient/login/login.js
 * ========================
 * Login -- composant OWL, même architecture qu'Odoo 17 (l'écran de
 * connexion est un composant du webclient) : le gabarit vanilla
 * LOGIN_TEMPLATE et son listener de submit sont remplacés par un
 * composant OWL à état réactif (phases du bouton, message d'erreur).
 *
 * Le descripteur du registre "actions" est INCHANGÉ ({ mount:
 * mountLogin }) et le flux de connexion également : POST
 * /offline_sync/login -> saveSession -> purge du cache si changement
 * d'utilisateur (ensureCacheOwnership) -> droits (Security Engine) ->
 * retour à l'écran demandé avant la redirection (params.redirectTo) ou
 * au home menu.
 */

import { registry } from "../../core/registry.js";
import { CONFIG, saveSession, withDb, setUnlockedKey } from "../../core/browser/session.js";
import { createVault, cryptoAvailable } from "../../core/browser/vault.js";
import { fetchAndStoreSecurityInfo } from "../../core/user_service.js";
import { ensureCacheOwnership } from "../../core/cache_owner.js";
import { loadScopedCss, unloadScopedCss } from "../../core/assets.js";
import { mountOwlApp } from "../../owl/app.js";

export class Login extends owl.Component {
  static props = {
    params: { type: Object, optional: true },
    env: { optional: true },
  };

  static template = owl.xml`
    <div id="wrapwrap">
      <main>
        <div class="container py-5">
          <div class="card border-0 mx-auto bg-100 o_database_list" style="max-width: 300px;">
            <div class="card-body">
              <div class="text-center pb-3 border-bottom mb-4">
                <!-- Logo texte : une image externe serait bloquée par
                     la CSP (img-src 'self' data:) -->
                <span style="font-size:2.4rem; font-weight:700; color:#714B67; letter-spacing:-1px">odoo</span>
              </div>

              <form class="oe_login_form" role="form" t-on-submit.prevent="onSubmit">
                <div class="mb-3 field-login">
                  <label for="login-email" class="form-label">E-mail</label>
                  <input type="text" placeholder="E-mail" id="login-email" required="required"
                         autocomplete="username" autocapitalize="off" class="form-control" t-ref="email"/>
                </div>

                <div class="mb-3">
                  <label for="login-password" class="form-label">Mot de passe</label>
                  <input type="password" placeholder="Mot de passe" id="login-password" required="required"
                         autocomplete="current-password" maxlength="4096" class="form-control" t-ref="password"/>
                </div>

                <div class="mb-3">
                  <label for="login-db" class="form-label small text-muted mb-1">
                    Base de données <span class="text-muted fw-normal">(laisser vide en mono-base)</span>
                  </label>
                  <input type="text" placeholder="ex : vente1" id="login-db"
                         autocomplete="off" autocapitalize="off" spellcheck="false"
                         class="form-control form-control-sm" t-ref="dbname"/>
                </div>

                <div class="clearfix oe_login_buttons text-center gap-1 d-grid mb-1 pt-3">
                  <button type="submit" id="login-btn" class="btn btn-primary" t-att-disabled="state.submitting"
                          t-esc="buttonLabel"/>
                  <p t-if="state.error" id="error" class="text-danger small mt-2 mb-0" t-esc="state.error"/>
                </div>
                <div class="justify-content-between mt-2 d-flex small">
                  <a href="http://localhost:8069/web/signup?">Vous n'avez pas de compte ?</a>
                  <a href="http://localhost:8069/web/reset_password?">Réinitialiser le mot de passe</a>
                </div>
                <div class="o_login_auth"/>
                <input type="hidden" name="redirect"/>
              </form>

              <div class="text-center small mt-4 pt-3 border-top">
                <a class="border-end pe-2 me-1" href="http://localhost:8069/web/database/manager">Gestion des bases de données</a>
                <a href="https://www.odoo.com/?utm_source=db&amp;utm_medium=auth" target="_blank">Généré par <span>Odoo</span></a>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>`;

  setup() {
    this.emailRef = owl.useRef("email");
    this.passwordRef = owl.useRef("password");
    this.dbRef = owl.useRef("dbname");
    // phases : "" (repos), "login", "cache", "rights"
    this.state = owl.useState({ submitting: false, phase: "", error: "" });
  }

  get buttonLabel() {
    if (!this.state.submitting) return "Se connecter";
    return {
      login: "Connexion...",
      cache: "Vérification du cache local...",
      rights: "Chargement des droits...",
    }[this.state.phase] || "Se connecter";
  }

  setError(message) {
    this.state.error = message;
    this.state.submitting = false;
    this.state.phase = "";
  }

  async onSubmit() {
    const email = this.emailRef.el ? this.emailRef.el.value : "";
    const password = this.passwordRef.el ? this.passwordRef.el.value : "";

    this.state.error = "";
    this.state.submitting = true;
    this.state.phase = "login";

    try {
      // Sélecteur de base (durcissement multi-bases) : la base demandée
      // passe en ?db= (le dispatch d'Odoo la résout) ; la base RÉSOLUE
      // par le serveur fait foi dans la réponse (tampon de session).
      const dbSelection = this.dbRef.el ? this.dbRef.el.value.trim() : "";
      const loginUrl = withDb(`${CONFIG.ODOO_BASE_URL}/offline_sync/login`, dbSelection || null);
      const response = await fetch(loginUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login: email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        this.setError(data.error || "Erreur de connexion");
        return;
      }

      const resolvedDb = data.db || dbSelection || undefined;
      // M9 (coffre, « mot de passe », pas de PIN) : la clé API est
      // chiffrée AES-GCM avec une clé dérivée PBKDF2 du mot de passe
      // ODOO saisi -- aucun nouveau secret. Repli legacy (clé en clair)
      // si WebCrypto est indisponible (contexte non https).
      let vaultOk = false;
      if (cryptoAvailable()) {
        try {
          await createVault(password, data.api_key);
          vaultOk = true;
        } catch (vaultErr) {
          console.warn("Coffre de session impossible -- repli legacy (clé en clair)", vaultErr);
        }
      }
      saveSession(vaultOk
        ? { uid: data.uid, name: data.name, db: resolvedDb }
        : { uid: data.uid, name: data.name, db: resolvedDb, api_key: data.api_key });
      if (vaultOk) setUnlockedKey(data.api_key);

      // Purge le cache local s'il appartenait à un autre utilisateur OU
      // à une autre base (tampon {db, serverUrl} conservé dans cache_meta).
      this.state.phase = "cache";
      try {
        await ensureCacheOwnership(data.uid, resolvedDb ? { db: resolvedDb, serverUrl: CONFIG.ODOO_BASE_URL } : null);
      } catch (cacheErr) {
        console.error("Erreur lors de la vérification du cache local :", cacheErr);
        this.setError("Erreur lors de l'initialisation du cache local. Réessayez.");
        return;
      }

      // Récupère les droits (Security Engine) juste après la connexion.
      // Ne bloque pas la connexion en cas d'échec : l'app reste
      // utilisable, simplement sans droits en cache pour le moment.
      this.state.phase = "rights";
      try {
        await fetchAndStoreSecurityInfo(data.api_key, CONFIG.ODOO_BASE_URL);
      } catch (securityErr) {
        console.warn("Impossible de récupérer les droits (Security Engine) :", securityErr);
      }

      // Retourne à l'écran demandé avant la redirection d'authentification,
      // ou au home menu (connexion directe, sans deep link).
      const target = (this.props.params && this.props.params.redirectTo) || { tag: "home_menu" };
      await this.props.env.doAction(target, { replace: true, clearStack: true });
    } catch (err) {
      this.setError("Impossible de contacter le serveur. Vérifiez votre connexion.");
    }
  }
}

/**
 * Montage de l'écran de connexion (contrat { mount } du registre
 * "actions" conservé : sync -> { destroy }).
 * params.redirectTo (optionnel) : l'action que l'utilisateur essayait
 * d'atteindre avant d'être redirigé ici par la garde d'authentification.
 */
export async function mountLogin(container, params, env) {
  loadScopedCss("css/web.assets_frontend.min.css", "odoo-frontend-assets-login");
  const { destroy } = await mountOwlApp(Login, container, { params, env });
  return {
    destroy() {
      destroy();
      unloadScopedCss("odoo-frontend-assets-login");
    },
  };
}

registry.category("actions").add("login", { mount: mountLogin });
