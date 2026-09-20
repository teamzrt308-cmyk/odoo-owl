/**
 * webclient/navbar/navbar_component.js
 * ====================================
 * Navbar -- composant OWL, même architecture qu'Odoo 17
 * (web/static/src/webclient/navbar/navbar.js) : la barre de navigation
 * est un composant dont le template remplace l'ancien gabarit vanilla
 * NAVBAR_TEMPLATE de webclient.js. Les classes et ids sont CONSERVÉS à
 * l'identique : les panneaux systray restés vanilla (statut de
 * synchronisation, conflits, indicateur de connectivité) se montent
 * DANS le DOM rendu par OWL (webclient.js, après le mount), et le CSS
 * Odoo existant s'applique sans changement.
 *
 * Responsabilités repris de l'ancien code impératif :
 *  - visibilité selon le tag d'action (NAVBAR_VISIBLE_TAGS) + chargement
 *    des assets Odoo + classes de body ;
 *  - bus "action:changed" -> titre d'app + menu horizontal (manifest ->
 *    arbre -> sections) + atterrissage naturel (replace) ;
 *  - bus "user:info" (émis par le home menu) -> avatar, nom, société,
 *    badges messages/activités ;
 *  - bouton Accueil (apps) -> doAction("home_menu") ;
 *  - menu utilisateur = composant OWL UserMenu (user_menu_owl.js).
 *
 * Écarts assumés : Popper n'est pas utilisé -- les dropdowns OWL sont
 * positionnés en CSS (comme les menus du ControlPanel) ; les panneaux
 * sync/conflits/connectivité restent vanilla (prochaine étape).
 */

import { bus } from "../../core/bus/bus_service.js";
import { CONFIG, getApiKey } from "../../core/browser/session.js";
import { getModuleManifest } from "../../views/view_service.js";
import { buildMenuTree, findFirstModel } from "./navbar.js";
import { loadOdooAssets, unloadOdooAssets } from "../../core/assets.js";
import { mountOwlApp } from "../../owl/app.js";
import { UserMenu } from "../user_menu/user_menu_owl.js";

const NAVBAR_VISIBLE_TAGS = new Set(["home_menu", "list_view", "form_view", "ir.actions.act_window", "conflict_detail"]);

export class Navbar extends owl.Component {
  static components = { UserMenu };

  static props = {
    doAction: { type: Function, optional: true },
  };

  static template = owl.xml`
    <header class="o_navbar" t-att-style="state.visible ? '' : 'display:none;'">
      <nav class="o_main_navbar" data-command-category="disabled">
        <div class="o-dropdown dropdown o_navbar_apps_menu o-dropdown--no-caret">
          <button id="back-btn" type="button" class="dropdown-toggle" title="Accueil" tabindex="0" t-on-click="onHomeClick">
            <i class="oi oi-apps"/>
          </button>
        </div>
        <a id="app-title" class="dropdown-item o_menu_brand d-none d-md-flex" role="menuitem" tabindex="0" t-esc="state.appTitle"/>
        <div t-att-class="'o_menu_sections d-none d-md-flex flex-grow-1 flex-shrink-1 w-0' + (state.mobileOpen ? ' show' : '')" role="menu">
          <div t-foreach="state.sections" t-as="section" t-key="section.name"
               t-att-class="'o-dropdown dropdown o_navbar_section_item o-dropdown--no-caret' + (state.activeSection === section.name ? ' active' : '')">
            <button type="button" class="dropdown-toggle" t-esc="section.name"
                    t-on-click.stop="() => this.onSectionClick(section)"/>
            <div t-if="section.entries.length > 0 and state.openSection === section.name" class="dropdown-menu show o_section_dropdown">
              <t t-foreach="section.entries" t-as="entry" t-key="entry.header or entry.label">
                <div t-if="entry.header" class="dropdown-menu_group dropdown-header" style="padding-left: 20px;" t-esc="entry.header"/>
                <a t-if="!entry.header" href="#" class="dropdown-item" style="padding-left: 20px;" t-esc="entry.label"
                   t-on-click.prevent.stop="() => this.onSectionTargetClick(section, entry.target)"/>
                <!-- entry.items n'existe que pour un header : 'or []' rend la
                     boucle inerte pour une entrée simple (t-foreach est
                     évalué même sans t-if sur le même nœud). -->
                <t t-foreach="entry.items or []" t-as="sub" t-key="sub.label">
                  <a href="#" class="dropdown-item o_dropdown_menu_group_entry" style="padding-left: 32px;" t-esc="sub.label"
                     t-on-click.prevent.stop="() => this.onSectionTargetClick(section, sub.target)"/>
                </t>
              </t>
            </div>
          </div>
        </div>
        <div class="o_menu_systray d-flex flex-shrink-0 ms-auto" role="menu">
          <!-- Ancrages des panneaux systray vanilla (webclient.js) -->
          <div id="connectivity-indicator" class="d-flex align-items-center px-2" title="Statut de connexion">
            <span id="connectivity-dot" class="rounded-circle d-inline-block" style="width:10px; height:10px;"/>
          </div>
          <div class="o-dropdown dropdown o-mail-DiscussSystray-class o-dropdown--no-caret">
            <button type="button" class="dropdown-toggle" tabindex="0" aria-expanded="false">
              <i class="fa fa-lg fa-comments" role="img" aria-label="Messages"/>
              <span id="badge-messages" class="o-mail-MessagingMenu-counter badge rounded-pill"
                    t-att-style="state.user.unreadMessages > 0 ? 'display:inline-block;' : 'display:none;'"
                    t-esc="state.user.unreadMessages or ''"/>
            </button>
          </div>
          <div class="o-dropdown dropdown o-mail-DiscussSystray-class o-dropdown--no-caret">
            <button type="button" class="dropdown-toggle" tabindex="0" aria-expanded="false">
              <i class="fa fa-lg fa-clock-o" role="img" aria-label="Activités"/>
              <span id="badge-activities" class="o-mail-ActivityMenu-counter badge rounded-pill"
                    t-att-style="state.user.pendingActivities > 0 ? 'display:inline-block;' : 'display:none;'"
                    t-esc="state.user.pendingActivities or ''"/>
            </button>
          </div>
          <div class="o-dropdown dropdown o_sync_errors_menu o-dropdown--no-caret">
            <button id="sync-status-btn" type="button" class="dropdown-toggle position-relative" tabindex="0" aria-expanded="false" title="Synchronisation">
              <i class="fa fa-lg fa-cloud-upload" role="img" aria-label="Synchronisation"/>
              <span id="badge-sync-pending" class="o-mail-MessagingMenu-counter badge rounded-pill bg-secondary" style="display:none;"/>
              <span id="badge-sync-errors" class="o-mail-MessagingMenu-counter badge rounded-pill bg-danger" style="display:none;"/>
            </button>
            <div id="sync-status-dropdown" class="dropdown-menu dropdown-menu-end p-0" style="min-width: 340px; max-height: 420px; overflow-y: auto;"/>
          </div>
          <div class="o-dropdown dropdown o_sync_conflicts_menu o-dropdown--no-caret">
            <button id="conflict-status-btn" type="button" class="dropdown-toggle position-relative" tabindex="0" aria-expanded="false" title="Conflits de synchronisation">
              <i class="fa fa-lg fa-exclamation-triangle" role="img" aria-label="Conflits"/>
              <span id="badge-sync-conflicts" class="o-mail-MessagingMenu-counter badge rounded-pill bg-warning" style="display:none;"/>
            </button>
            <div id="conflict-status-dropdown" class="dropdown-menu dropdown-menu-end p-0" style="min-width: 340px; max-height: 420px; overflow-y: auto;"/>
          </div>
          <div class="o-dropdown dropdown o_switch_company_menu d-none d-md-block o-dropdown--no-caret">
            <button type="button" class="dropdown-toggle" tabindex="0" aria-expanded="false">
              <i class="fa fa-building d-lg-none"/>
              <span id="shell-company-name" class="oe_topbar_name d-none d-lg-block" t-esc="state.user.companyName"/>
            </button>
          </div>
          <div>
            <button class="o_mobile_menu_toggle o_nav_entry o-no-caret d-md-none border-0 pe-3" title="Basculer le menu" aria-label="Basculer le menu"
                    t-on-click.stop="toggleMobile">
              <i class="oi oi-panel-right"/>
            </button>
          </div>
          <UserMenu initial="state.user.initial" name="state.user.name" onLogout="() => this.onUserLogout()"/>
        </div>
      </nav>
    </header>`;

  setup() {
    this.state = owl.useState({
      visible: false,
      appTitle: "",
      sections: [],
      activeSection: null,
      openSection: null,
      mobileOpen: false,
      user: { initial: "", name: "", companyName: "", unreadMessages: 0, pendingActivities: 0 },
    });
    this.lastMenuModule = null;
    this.assetsLoaded = false;
    this.currentModule = null;

    // Anciens écouteurs bus de webclient.js, repris par le composant.
    this.onActionChanged = (ev) => this.handleActionChanged(ev.detail || {});
    // Remplacement de l'objet ENTIER (et pas Object.assign imbriqué) :
    // seul un set sur une clé de premier niveau de l'état réactif
    // déclenche le re-render fiable du template.
    this.onUserInfo = (ev) => {
      this.state.user = { ...this.state.user, ...(ev.detail || {}) };
    };
    bus.addEventListener("action:changed", this.onActionChanged);
    bus.addEventListener("user:info", this.onUserInfo);

    // Fermeture du menu mobile / des dropdowns de sections au clic
    // extérieur (comme l'ancien document.addEventListener).
    owl.useExternalListener(document.body, "click", () => {
      this.state.mobileOpen = false;
      this.state.openSection = null;
    });

    owl.onWillDestroy(() => {
      bus.removeEventListener("action:changed", this.onActionChanged);
      bus.removeEventListener("user:info", this.onUserInfo);
      if (this.assetsLoaded) unloadOdooAssets();
    });
  }

  // ── Réaction aux actions (ancien bus listener de webclient.js) ──

  handleActionChanged({ tag, params }) {
    const shouldShow = NAVBAR_VISIBLE_TAGS.has(tag);

    if (shouldShow && !this.assetsLoaded) {
      loadOdooAssets();
      this.assetsLoaded = true;
    } else if (!shouldShow && this.assetsLoaded) {
      unloadOdooAssets();
      this.assetsLoaded = false;
    }

    if (shouldShow) {
      document.body.classList.remove("bg-100");
      document.body.classList.add("o_web_client");
    } else {
      document.body.classList.remove("o_web_client");
      document.body.classList.add("bg-100");
    }

    this.state.visible = shouldShow;
    if (!shouldShow) {
      this.lastMenuModule = null;
      return;
    }

    if (tag === "home_menu") {
      this.state.appTitle = "";
      this.state.sections = [];
      this.lastMenuModule = null;
      return;
    }

    if (params && params.module) {
      this.ensureMenuForModule(params.module, params);
    }
  }

  // ── Menu horizontal (ancien ensureMenuForModule de webclient.js) ──

  async ensureMenuForModule(module, currentParams) {
    if (module === this.lastMenuModule) return;
    this.lastMenuModule = module;
    // Module courant (utilisé par navigate() au clic d'une section).
    this.currentModule = module;

    try {
      const manifest = await getModuleManifest(module, getApiKey(), CONFIG.ODOO_BASE_URL);
      this.state.appTitle = manifest.module.label;

      const tree = buildMenuTree(manifest.menus);
      let rootMenu = tree[0] || { children: [] };
      let maxChildren = rootMenu.children.length;
      for (const candidate of tree) {
        if (candidate.children.length > maxChildren) {
          rootMenu = candidate;
          maxChildren = candidate.children.length;
        }
      }

      this.state.sections = this.buildSections(rootMenu);
      this.state.activeSection = null;

      if (!currentParams.actionId) {
        const naturalLanding = rootMenu.model
          ? { model: rootMenu.model, name: rootMenu.name, actionId: rootMenu.action_id, defaultView: rootMenu.default_view }
          : findFirstModel(rootMenu);

        if (naturalLanding && (naturalLanding.model !== currentParams.model || naturalLanding.actionId)) {
          if (this.props.doAction) {
            this.props.doAction(
              { tag: "list_view", module, model: naturalLanding.model, actionId: naturalLanding.actionId, view: naturalLanding.defaultView, label: naturalLanding.name },
              { replace: true }
            );
          }
        }
      }
    } catch (err) {
      console.error("Impossible de charger le menu du module", module, err);
      this.state.appTitle = "Erreur de chargement";
    }
  }

  /**
   * View model des sections -- transforme les enfants de la racine en
   * structure affichable { name, target?, entries? } : l'équivalent du
   * DOM construit par renderHorizontalMenu (dropdown pour une entrée à
   * sous-menus, avec headers groupés), mais en données pour le template
   * OWL.
   */
  buildSections(rootMenu) {
    return rootMenu.children.map((item) => {
      if (item.children.length > 0) {
        const entries = [];
        for (const child of item.children) {
          if (child.children.length > 0) {
            const items = child.children
              .map((grandchild) => ({ label: grandchild.name, target: findFirstModel(grandchild) }))
              .filter((sub) => sub.target);
            if (items.length > 0) entries.push({ header: child.name, items });
          } else {
            const target = findFirstModel(child);
            if (target) entries.push({ label: child.name, target });
          }
        }
        return { name: item.name, entries };
      }
      return { name: item.name, target: findFirstModel(item), entries: [] };
    });
  }

  // ── Interactions ──

  onHomeClick() {
    if (this.props.doAction) this.props.doAction("home_menu", { clearStack: true });
  }

  onSectionClick(section) {
    const closing = this.state.openSection === section.name;
    this.state.openSection = closing ? null : section.name;
    if (closing) return;
    // Section sans sous-menu : navigation directe (comme renderHorizontalMenu).
    if (section.entries.length === 0 && section.target) {
      this.state.openSection = null;
      this.state.activeSection = section.name;
      this.navigate(section.target);
    }
  }

  onSectionTargetClick(section, target) {
    this.state.openSection = null;
    this.state.activeSection = section.name;
    this.navigate(target);
  }

  navigate(target) {
    if (!this.props.doAction) return;
    this.props.doAction({
      tag: "list_view",
      module: this.currentModule,
      model: target.model,
      actionId: target.actionId,
      view: target.defaultView,
      label: target.name,
    });
  }

  toggleMobile() {
    this.state.mobileOpen = !this.state.mobileOpen;
  }

  onUserLogout() {
    if (this.props.doAction) this.props.doAction("login", { replace: true, clearStack: true });
  }
}

/**
 * Montage de la Navbar (contrat : async -> destroy) -- appelé par
 * webclient.js ; les panneaux systray vanilla se montent APRÈS cette
 * promesse, dans le DOM OWL rendu (ids conservés).
 */
export async function mountNavbar(container, { doAction }) {
  const { destroy } = await mountOwlApp(Navbar, container, { doAction });
  return { destroy };
}
