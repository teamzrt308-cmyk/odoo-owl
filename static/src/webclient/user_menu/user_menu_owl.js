/**
 * webclient/user_menu/user_menu_owl.js
 * ====================================
 * UserMenu -- composant OWL, même architecture qu'Odoo 17
 * (web/static/src/webclient/user_menu/user_menu.js) : le menu utilisateur
 * est un composant de la systray de la Navbar (embeddé via static
 * components), avec ses deux vues internes (menu principal / « Mon
 * compte ») gérées par un état réactif -- plus de render() vanilla.
 *
 * Les entrées reprennent le comportement historique : Documentation et
 * Support (onglet navigateur), Mon compte (profil + résumé sécurité mis
 * en cache, consultables HORS LIGNE), Se déconnecter (confirmation si
 * des actions ne sont pas synchronisées, puis doAction("login") via la
 * prop onLogout remontée par la Navbar).
 */

import { getSession, clearSession } from "../../core/browser/session.js";
import { logoutServeur } from "../../core/network/fetch_guard.js";
import { getSyncQueueSummary } from "../../core/network/rpc_service.js";
import { getCachedProfile } from "../../core/user_service.js";
import { db } from "../../core/orm_service.js";

export class UserMenu extends owl.Component {
  static props = {
    initial: { type: String, optional: true },
    name: { type: String, optional: true },
    onLogout: { type: Function, optional: true },
  };

  static template = owl.xml`
    <div class="o-dropdown dropdown o_user_menu d-none d-md-block pe-0 o-dropdown--no-caret position-relative" t-on-click.stop="">
      <button type="button" class="dropdown-toggle py-1 py-lg-0" tabindex="0" aria-expanded="false"
              title="Menu utilisateur" t-on-click="toggle">
        <span class="o_avatar o_user_avatar rounded-circle d-inline-flex align-items-center justify-content-center" t-esc="props.initial || '?'" t-att-title="props.name"/>
        <small class="oe_topbar_name d-none ms-2 text-start lh-1 text-truncate" t-esc="props.name"/>
      </button>
      <div t-if="state.open" class="dropdown-menu dropdown-menu-end show o_user_menu_dropdown"
           style="min-width: 220px; position: absolute; top: 100%; right: 0; z-index: 1000;">
        <t t-if="state.view === 'menu'">
          <div class="px-3 py-2 border-bottom">
            <div class="fw-bold small" t-esc="sessionName"/>
          </div>
          <a href="#" class="dropdown-item small" t-on-click.prevent="openDocumentation">Documentation</a>
          <a href="#" class="dropdown-item small" t-on-click.prevent="openSupport">Support</a>
          <a href="#" class="dropdown-item small" t-on-click.prevent="switchToAccount">Mon compte</a>
          <a href="#" class="dropdown-item small text-danger" t-on-click.prevent="logout">Se déconnecter</a>
        </t>
        <t t-else="">
          <div class="d-flex align-items-center gap-2 px-3 py-2 border-bottom">
            <a href="#" class="text-muted o_account_back" title="Retour" t-on-click.prevent="() => this.switchView('menu')">←</a>
            <strong class="small">Mon compte</strong>
          </div>
          <div class="px-3 py-2">
            <div class="mb-2">
              <div class="text-muted" style="font-size:11px;">Nom</div>
              <div class="small" t-esc="sessionName || '—'"/>
            </div>
            <div class="mb-2">
              <div class="text-muted" style="font-size:11px;">Société</div>
              <div class="small" t-esc="state.account.companyName || '—'"/>
            </div>
            <div class="mb-2">
              <div class="text-muted" style="font-size:11px;">UID Odoo</div>
              <div class="small" t-esc="sessionUid === null ? '—' : sessionUid"/>
            </div>
            <div class="mb-2">
              <div class="text-muted" style="font-size:11px;">Rôle</div>
              <div class="small" t-esc="state.account.isAdmin ? 'Administrateur' : 'Utilisateur'"/>
            </div>
          </div>
        </t>
      </div>
    </div>`;

  setup() {
    this.state = owl.useState({
      open: false,
      view: "menu",
      account: { companyName: "—", isAdmin: false },
    });
    // Session lue au setup (elle ne change pas pendant la vie du menu :
    // la déconnexion repasse par une action "login" qui recharge le shell).
    this.session = getSession();
    // Fermeture au clic extérieur (comme createDropdown).
    owl.useExternalListener(document.body, "click", () => {
      if (this.state.open) this.close();
    });
  }

  get sessionName() {
    return (this.session && this.session.name) || "";
  }

  get sessionUid() {
    return this.session && this.session.uid !== undefined ? this.session.uid : null;
  }

  toggle() {
    if (this.state.open) {
      this.close();
      return;
    }
    // Toujours repartir du menu principal à l'ouverture (historique).
    this.state.view = "menu";
    this.state.open = true;
  }

  close() {
    this.state.open = false;
    this.state.view = "menu";
  }

  openDocumentation() {
    window.open("https://www.odoo.com/documentation/17.0/", "_blank");
  }

  openSupport() {
    window.open("https://www.odoo.com/help", "_blank");
  }

  switchView(view) {
    this.state.view = view;
  }

  async switchToAccount() {
    this.switchView("account");
    // Profil + résumé sécurité depuis les caches locaux : « Mon compte »
    // reste consultable hors ligne (comportement historique).
    try {
      const [profile, security] = await Promise.all([
        getCachedProfile(),
        this.getCachedSecuritySummary(),
      ]);
      this.state.account = {
        companyName: (profile && profile.companyName) || "—",
        isAdmin: !!security.isAdmin,
      };
    } catch (err) {
      console.warn("[user_menu] profil/ sécurité indisponibles :", err);
    }
  }

  async getCachedSecuritySummary() {
    const entries = await db.security_info.toArray();
    if (entries.length === 0) return { groups: [], isAdmin: false };
    return { groups: entries[0].groups || [], isAdmin: !!entries[0].is_admin };
  }

  async logout() {
    const summary = await getSyncQueueSummary();
    if (summary.pending > 0 || summary.error > 0) {
      const total = summary.pending + summary.error;
      const confirmed = confirm(`${total} action(s) non synchronisée(s) avec Odoo. Se déconnecter quand même ?`);
      if (!confirmed) return;
    }
    // Sécurité (mesure 4) : révocation SERVEUR de la clé (no-op hors
    // ligne), puis logout local immédiat. Le login régénère de toute
    // façon la clé : une clé non révocable maintenant sera invalide au
    // prochain login de l'utilisateur.
    await logoutServeur();
    clearSession();
    this.close();
    if (this.props.onLogout) this.props.onLogout();
  }
}
