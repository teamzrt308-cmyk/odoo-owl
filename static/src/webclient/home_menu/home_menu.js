/**
 * webclient/home_menu/home_menu.js
 * ================================
 * HomeMenu -- composant OWL, même architecture qu'Odoo 17
 * (web/static/src/webclient/webclient/home_menu.js) : l'écran d'accueil
 * est un composant enregistré dans le registre "actions" (descripteur
 * { mount: mountHomeMenu }, contrat inchangé) dont le TEMPLATE est
 * désormais du OWL déclaratif -- plus de innerHTML + appendChild
 * vanilla : la grille des apps est un t-foreach alimenté par l'état
 * réactif (cache installed_apps), la recherche filtre par libellé.
 *
 * La logique hors ligne reste identique : rafraîchissement des apps
 * installées (401 -> login), pré-téléchargement d'une app
 * (offline_prefetch_service), dashboard_info -> profil mis en cache +
 * bus "user:info" (consommé par la Navbar OWL).
 */

import { CONFIG, getApiKey, getSession, clearSession } from "../../core/browser/session.js";
import { getCachedApps, saveCachedApps } from "../menus/menu_service.js";
import { getCachedModuleManifest, getModuleManifest } from "../../views/view_service.js";
import { downloadFullApp } from "../offline_prefetch_service.js";
import { registry } from "../../core/registry.js";
import { bus } from "../../core/bus/bus_service.js";
import { resolveNaturalLanding } from "../navbar/navbar.js";
import { saveCachedProfile, getCachedProfile } from "../../core/user_service.js";
import { mountOwlApp } from "../../owl/app.js";
import { withDb } from "../../core/browser/session.js";

const CUSTOM_IMPLEMENTATIONS = {};

const DASHBOARD_STYLE_ID = "offline-dashboard-style";

function loadDashboardStyle() {
  if (document.getElementById(DASHBOARD_STYLE_ID)) {
    return;
  }
  const link = document.createElement("link");
  link.id = DASHBOARD_STYLE_ID;
  link.rel = "stylesheet";
  link.href = "./static/src/webclient/home_menu/home_menu.css";
  document.head.appendChild(link);
}

function unloadDashboardStyle() {
  const link = document.getElementById(DASHBOARD_STYLE_ID);
  if (link) {
    link.remove();
  }
}

export class HomeMenu extends owl.Component {
  static props = {
    params: { type: Object, optional: true },
    env: { optional: true },
  };

  static template = owl.xml`
    <main class="dashboard-container">
      <div class="search-box">
        <span class="search-icon">
          <img src="assets/search.png" alt="Search" class="local-icon search-img"/>
        </span>
        <input type="text" placeholder="click here..." t-on-input="onSearchInput"/>
      </div>

      <button id="refresh-modules-btn" class="refresh-btn" t-esc="state.refreshing ? 'Actualisation...' : 'Actualiser les modules'" t-on-click="refreshInstalledApps"/>
      <p id="sync-status" class="sync-status" t-esc="state.status"/>

      <div class="modules-grid" id="modules-grid">
        <p t-if="state.apps.length === 0">Aucune app détectée. Connecte-toi en ligne au moins une fois.</p>
        <p t-elif="filteredApps.length === 0" class="text-muted">Aucune app ne correspond à la recherche.</p>
        <div t-else="" t-foreach="filteredApps" t-as="app" t-key="app.technical_name"
             t-att-class="'module-card ' + (app.isReady ? 'ready' : 'disabled')"
             t-att-style="state.loadingModule === app.technical_name ? 'opacity: 0.6;' : ''"
             t-on-click="(ev) => this.onCardClick(ev, app)">
          <div class="icon-wrapper"><img t-att-src="app.icon_base64 || 'assets/default-app.png'" t-att-alt="app.label"/></div>
          <p t-esc="app.label"/>
          <span class="module-badge" t-esc="app.isReady ? 'Disponible' : 'Non pris en charge'"/>
          <button t-if="app.isReady" type="button" class="download-btn" t-esc="state.downloads[app.technical_name] || (app.isCached ? 'Mis à jour' : 'Télécharger')"
                  t-on-click.stop="(ev) => this.onDownloadClick(ev, app)"/>
        </div>
      </div>
    </main>`;

  setup() {
    this.state = owl.useState({
      apps: [],
      status: "",
      refreshing: false,
      query: "",
      loadingModule: null,
      // Statut du pré-téléchargement par module (label du bouton).
      downloads: {},
    });
    owl.onMounted(() => {
      loadDashboardStyle();
      this.start();
    });
    owl.onWillDestroy(() => unloadDashboardStyle());
  }

  /** Apps filtrées par la recherche (libellé). */
  get filteredApps() {
    const q = this.state.query.trim().toLowerCase();
    if (!q) return this.state.apps;
    return this.state.apps.filter((app) => (app.label || "").toLowerCase().includes(q));
  }

  onSearchInput(ev) {
    this.state.query = ev.target.value;
  }

  async start() {
    // Comme l'ancien IIFE : cache d'abord, rafraîchissement, infos user.
    await this.renderAppsFromCache();
    await this.refreshInstalledApps();
    await this.loadDashboardInfo();
  }

  async renderAppsFromCache() {
    const apps = await this.prepareApps(await getCachedApps());
    this.state.apps = apps;
  }

  /** Enrichit les apps brutes avec isReady/isCached (comme l'ancienne grille). */
  async prepareApps(apps) {
    const prepared = [];
    for (const app of apps || []) {
      const isReady = !!CUSTOM_IMPLEMENTATIONS[app.technical_name] || !!app.main_model;
      const cachedManifest = isReady ? await getCachedModuleManifest(app.technical_name) : null;
      prepared.push({ ...app, isReady, isCached: !!cachedManifest });
    }
    return prepared;
  }

  async onCardClick(ev, app) {
    if (!app.isReady) return;
    const custom = CUSTOM_IMPLEMENTATIONS[app.technical_name];
    if (custom) {
      this.props.env.doAction(custom.action);
      return;
    }
    this.state.loadingModule = app.technical_name;
    try {
      const manifest = await getModuleManifest(app.technical_name, getApiKey(), CONFIG.ODOO_BASE_URL);
      const landing = resolveNaturalLanding(manifest);
      if (landing) {
        this.props.env.doAction({
          tag: "list_view",
          module: app.technical_name,
          model: landing.model,
          actionId: landing.actionId,
          view: landing.defaultView,
          label: landing.name,
        });
      } else {
        this.props.env.doAction({ tag: "list_view", module: app.technical_name, model: app.main_model });
      }
    } catch (err) {
      console.error(`Impossible de résoudre le menu de ${app.technical_name} :`, err);
      this.props.env.doAction({ tag: "list_view", module: app.technical_name, model: app.main_model });
    } finally {
      this.state.loadingModule = null;
    }
  }

  async onDownloadClick(ev, app) {
    const btn = ev.target;
    this.state.downloads[app.technical_name] = "Téléchargement...";
    try {
      const apiKey = getApiKey();
      await downloadFullApp(app.technical_name, apiKey, CONFIG.ODOO_BASE_URL, (message) => {
        this.state.downloads[app.technical_name] = message;
      });
      this.state.downloads[app.technical_name] = "Disponible hors-ligne";
    } catch (err) {
      console.error(err);
      this.state.downloads[app.technical_name] = "Échec — réessayer";
    }
  }

  async refreshInstalledApps() {
    if (!navigator.onLine) {
      this.state.status = "Hors ligne — utilisation de la dernière liste connue";
      await this.renderAppsFromCache();
      return;
    }

    this.state.refreshing = true;
    this.state.status = "";

    try {
      const response = await fetch(withDb(`${CONFIG.ODOO_BASE_URL}/offline_sync/installed_apps`), {
        headers: { Authorization: `Bearer ${getApiKey()}` },
      });

      if (!response.ok) {
        if (response.status === 401) {
          clearSession();
          this.props.env.doAction("login", { replace: true, clearStack: true });
          return;
        }
        throw new Error("Erreur serveur");
      }

      const data = await response.json();
      await saveCachedApps(data.apps);
      this.state.apps = await this.prepareApps(data.apps);
      this.state.status = `${data.apps.length} app(s) installée(s) détectée(s)`;
    } catch (err) {
      this.state.status = "Impossible de contacter Odoo — liste locale utilisée";
      await this.renderAppsFromCache();
    } finally {
      this.state.refreshing = false;
    }
  }

  async loadDashboardInfo() {
    try {
      const response = await fetch(withDb(`${CONFIG.ODOO_BASE_URL}/offline_sync/dashboard_info`), {
        headers: { Authorization: `Bearer ${getApiKey()}` },
      });
      if (!response.ok) {
        if (response.status === 401) {
          clearSession();
          this.props.env.doAction("login", { replace: true, clearStack: true });
        }
        return;
      }
      const data = await response.json();

      // Mise en cache pour que "Mon compte" reste disponible hors-ligne,
      // même depuis un écran autre que le dashboard.
      await saveCachedProfile({
        name: data.name,
        initial: data.initial,
        companyName: data.company_name,
      });

      bus.trigger("user:info", {
        initial: data.initial,
        name: data.name,
        companyName: data.company_name,
        unreadMessages: data.unread_messages,
        pendingActivities: data.pending_activities,
      });
    } catch (err) {
      const session = getSession();
      const cachedProfile = await getCachedProfile();

      if (cachedProfile) {
        bus.trigger("user:info", {
          initial: cachedProfile.initial,
          name: cachedProfile.name,
          companyName: cachedProfile.companyName,
        });
      } else if (session) {
        bus.trigger("user:info", { initial: (session.name || "?")[0].toUpperCase(), name: session.name });
      }
      console.warn("Impossible de charger les infos du tableau de bord (hors ligne ?)", err);
    }
  }
}

/**
 * Montage du composant (contrat { mount } du registre "actions"
 * conservé : async -> destroy, comme les autres actions du moteur).
 */
export async function mountHomeMenu(container, params, env) {
  // Le CSS du dashboard est scopé sous #action-container.dashboard-body
  // (home_menu.css) : la classe est posée sur le conteneur hôte, comme
  // l'ancien moteur, et retirée à la destruction.
  container.classList.add("dashboard-body");
  const { destroy } = await mountOwlApp(HomeMenu, container, { params, env });
  return {
    destroy() {
      container.classList.remove("dashboard-body");
      destroy();
    },
  };
}

registry.category("actions").add("home_menu", { mount: mountHomeMenu });

export { CUSTOM_IMPLEMENTATIONS };
