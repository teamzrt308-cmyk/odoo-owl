/**
 * views/list/list_controller.js
 * ================================
 * Contrôleur de la vue Liste (et Kanban, qui partage ce contrôleur) --
 * composant OWL, même architecture qu'Odoo 17 : le descripteur de la
 * vue (list_view.js) expose { Controller: ListController } et c'est le
 * dispatcher views/view.js qui monte le composant (props : params de
 * l'action + env du webclient).
 *
 * Le template OWL du contrôleur porte les quatre zones de la vue
 * (control panel, statut, bandeau dashboard, hôte de liste) ; la logique
 * hors ligne -- chargement des listes en cache, pagination, recherche,
 * bascule list/kanban (renderer OWL), dashboard achats, record rules --
 * vit dans des closures de setup(), attachée aux zones par refs ; la
 * migration de CHAQUE brique (control panel OWL, pager OWL...) se fera
 * par la suite sans changer ce contrat.
 *
 * Manages the loading of the record list, pagination,
 * text search, and switching between list and kanban views.
 */

import { CONFIG, getApiKey, getUserId } from "../../core/browser/session.js";
import { getSecurityInfo } from "../../core/user_service.js";
import { getModuleManifest, resolveModelViews } from "../view_service.js";
import { getListRecordsSmart, getPurchaseDashboardSmart } from "../../core/list_cache.js";
import { formatCellValue, recordMatchesQuery } from "./list_renderer_utils.js";
import { mountListView } from "./list_renderer.js";
import { parseListArch } from "./list_arch_parser.js";
import { mountKanbanView } from "../kanban/kanban_renderer.js";
import { renderPurchaseDashboard, buildPurchaseDashboardDomain } from "../purchase_dashboard.js";
import { ControlPanel } from "../../search/control_panel/control_panel.js";
import { parseSearchArch } from "../../search/search_arch_parser.js";
import { matchesSimpleDomain, applyFilters, buildSelectionFilters } from "../../search/search_utils.js";
import { getSearchFavorites, saveSearchFavorite, deleteSearchFavorite, matchFavorite } from "../../search/search_favorites.js";
import { filterByRecordRule } from "../../model/rules_engine/rules_engine.js";
import { mountOwlApp } from "../../owl/app.js";

const PAGE_SIZE = 20;

export class ListController extends owl.Component {
  static components = { ControlPanel };

  static props = {
    params: { type: Object, optional: true },
    env: { optional: true },
  };

  static template = owl.xml`
    <div class="o_list_controller d-flex flex-column h-100">
      <ControlPanel display="cpDisplay" breadcrumb="cpBreadcrumb" pager="cpPager" views="cpViews" groups="cpGroups"
                    filters="cpFilters" favorites="cpFavorites" query="cpQuery"
                    onNew="onNewClick" onSearch="onSearchQuery" onPage="onPageClick" onSwitch="onSwitchView" onGroupBy="onGroupBySelect"
                    onToggleFilter="onToggleFilter" onSaveFavorite="onSaveFavorite" onSelectFavorite="onSelectFavorite" onDeleteFavorite="onDeleteFavorite"/>
      <div t-ref="statusHost"/>
      <div t-ref="dashboardHost"/>
      <div t-ref="listHost"/>
    </div>`;

  /**
   * Props calculées du ControlPanel, lues dans l'état réactif ui (les
   * closures de setup() y écrivent ; le template du contrôleur les y lit).
   */
  get cpBreadcrumb() {
    return {
      listLabel: (this.ui && this.ui.listLabel) || null,
      recordLabel: (this.ui && this.ui.recordLabel) || "",
    };
  }

  get cpPager() {
    return this.ui && this.ui.pagerVisible ? this.ui.pager : null;
  }

  get cpViews() {
    return {
      available: (this.ui && this.ui.availableViews) || [],
      current: (this.ui && this.ui.currentView) || "list",
    };
  }

  get cpGroups() {
    // Menu Grouper par : candidats résolus par le parseur de l'arch liste,
    // proposé pour la vue LISTE uniquement (le kanban groupera en
    // colonnes, voir contrôleur kanban dédié).
    const ui = this.ui || {};
    return {
      available: ui.currentView === "list" ? ui.groupByCandidates || [] : [],
      current: ui.groupBy === undefined ? null : ui.groupBy,
    };
  }

  get cpFilters() {
    // Menu Filtres : candidats issus de l'arch <search> (ou dérivés des
    // champs selection), actifs partagés par toutes les vues du modèle.
    const ui = this.ui || {};
    return { available: ui.filterCandidates || [], active: ui.activeFilters || [] };
  }

  get cpFavorites() {
    const ui = this.ui || {};
    const current = matchFavorite(ui.favorites || [], {
      query: ui.searchQuery || "",
      activeFilters: ui.activeFilters || [],
      groupBy: ui.groupBy === undefined ? null : ui.groupBy,
    });
    return { available: ui.favorites || [], current: current ? current.name : null };
  }

  get cpQuery() {
    return (this.ui && this.ui.searchQuery) || "";
  }

  setup() {
    this.statusHostRef = owl.useRef("statusHost");
    this.dashboardHostRef = owl.useRef("dashboardHost");
    this.listHostRef = owl.useRef("listHost");

    const self = this;
    const params = this.props.params || {};
    const env = this.props.env;
    const { module, model, view = "list", actionId, label } = params;

    const apiKey = getApiKey();

    let currentPage = 0;
    let allRecordsRaw = [];
    let allRecords = [];
    let searchQuery = "";
    let currentView = view;
    let currentModelViews = null;
    let currentViewFieldsInfo = null;
    let activeDashboardFilter = null;
    // Défs des filtres (name -> {name,label,domain}) résolues par start()
    // à partir de l'arch <search> ou des champs selection.
    let filterDefsByName = {};
    // Vue actuellement montée dans la zone de liste (handle { destroy }
    // pour le renderer OWL kanban, élément DOM pour le renderer liste).
    let currentViewHandle = null;
    // Jeton anti-course : les changements de page/vue rapides pendant un
    // mount OWL asynchrone (kanban) ne doivent pas laisser deux vues vivres.
    let renderToken = 0;

    // --- Control panel OWL : état réactif + callbacks (le debounce de
    // recherche vit désormais dans le composant ControlPanel) ---
    self.cpDisplay = {
      withNewButton: true,
      withSearch: true,
      withPager: true,
      withViewSwitcher: true,
      withOptionsGear: true,
      withGroupBy: true,
      withFilters: true,
      withFavorites: true,
    };
    self.ui = owl.useState({
      listLabel: label || null,
      recordLabel: label || model,
      pager: { page: 0, pageSize: PAGE_SIZE, total: 0 },
      pagerVisible: true,
      availableViews: [],
      currentView: view,
      groupBy: params.groupBy || null,
      groupByCandidates: [],
      // Search avancé (itération 12) : requête miroir (restauration de
      // favori), filtres actifs, candidats et favoris du modèle.
      searchQuery: "",
      activeFilters: [],
      filterCandidates: [],
      favorites: [],
    });
    self.onNewClick = () => {
      env.doAction({ tag: "form_view", module, model, actionId, isNew: true });
    };
    self.onSearchQuery = (query) => {
      searchQuery = query;
      self.ui.searchQuery = query;
      applySearchFilter();
      currentPage = 0;
      renderCurrentPage();
    };
    self.onPageClick = (delta) => {
      if (delta < 0 && currentPage > 0) { currentPage--; renderCurrentPage(); }
      if (delta > 0 && (currentPage + 1) * PAGE_SIZE < allRecords.length) { currentPage++; renderCurrentPage(); }
    };
    // Hook rempli par start() (onViewSwitch y est défini, après
    // résolution du manifest) -- voir plus bas.
    let viewSwitchHandler = null;
    self.onSwitchView = (viewType) => { if (viewSwitchHandler) viewSwitchHandler(viewType); };
    self.onGroupBySelect = (name) => {
      self.ui.groupBy = name;
      currentPage = 0;
      renderCurrentPage();
    };
    // --- Search avancé : filtres + favoris (itération 12) ---
    self.onToggleFilter = (name) => {
      const active = new Set(self.ui.activeFilters);
      if (active.has(name)) active.delete(name);
      else active.add(name);
      self.ui.activeFilters = [...active];
      currentPage = 0;
      applySearchFilter();
      renderCurrentPage();
    };
    self.onSaveFavorite = (name) => {
      self.ui.favorites = saveSearchFavorite(model, {
        name,
        query: self.ui.searchQuery || "",
        filters: [...self.ui.activeFilters],
        groupBy: self.ui.groupBy === undefined ? null : self.ui.groupBy,
      });
    };
    self.onSelectFavorite = (name) => {
      const fav = (self.ui.favorites || []).find((f) => f.name === name);
      if (!fav) return;
      searchQuery = fav.query || "";
      self.ui.searchQuery = searchQuery;
      // Noms inconnus (favori obsolète) écartés pour ne pas afficher
      // des facettes sans filtre résoluable.
      self.ui.activeFilters = (fav.filters || []).filter((n) => !!filterDefsByName[n]);
      const candidates = new Set((self.ui.groupByCandidates || []).map((c) => c.name));
      self.ui.groupBy = fav.groupBy && candidates.has(fav.groupBy) ? fav.groupBy : null;
      currentPage = 0;
      applySearchFilter();
      renderCurrentPage();
    };
    self.onDeleteFavorite = (name) => {
      self.ui.favorites = deleteSearchFavorite(model, name);
    };

    // Status bar
    const statusEl = document.createElement("div");
    statusEl.className = "text-muted small px-3 py-1";
    statusEl.textContent = "Chargement de la liste...";

    function applySearchFilter() {
      let filtered = allRecordsRaw;

      if (activeDashboardFilter) {
        const domain = buildPurchaseDashboardDomain(
          activeDashboardFilter.rowKey, activeDashboardFilter.stateKey, getUserId()
        );
        filtered = filtered.filter((r) => matchesSimpleDomain(r, domain));
      }

      // Menu Filtres (search avancé) : ET entre filtres actifs, comme
      // le domaine de recherche natif.
      filtered = applyFilters(filtered, filterDefsByName, self.ui.activeFilters);

      allRecords = searchQuery
        ? filtered.filter((r) => recordMatchesQuery(r, currentViewFieldsInfo || {}, searchQuery))
        : filtered;
    }

    function syncPager() {
      self.ui.pager.page = currentPage;
      self.ui.pager.total = allRecords.length;
    }

    function destroyCurrentView() {
      if (currentViewHandle && currentViewHandle._cleanup) {
        currentViewHandle._cleanup();
      }
      currentViewHandle = null;
    }

    async function renderCurrentPage() {
      const token = ++renderToken;
      const listHost = self.listHostRef.el;
      if (!listHost) return;

      destroyCurrentView();
      listHost.innerHTML = "";

      const start = currentPage * PAGE_SIZE;
      const pageRecords = allRecords.slice(start, start + PAGE_SIZE);

      const onRecordOpen = (recordId) => {
        env.doAction({
          tag: "form_view", module, model, id: recordId, actionId,
          listLabel: label || model,
        });
      };

      if (currentView === "kanban") {
        // La kanban est rendue par OWL (voir kanban_renderer.js) : le
        // renderer est un composant OWL dont le template est compilé
        // depuis l'arch par kanban_arch_parser.js -- même flux que le
        // webclient d'Odoo (arch -> template -> composant OWL).
        const kanbanTarget = document.createElement("div");
        listHost.appendChild(kanbanTarget);
        try {
          const { destroy } = await mountKanbanView(
            kanbanTarget,
            currentModelViews.kanban.arch,
            currentViewFieldsInfo,
            pageRecords,
            onRecordOpen,
            self.ui.groupBy
          );
          if (token !== renderToken) {
            destroy(); // la page a de nouveau changé pendant le mount -> on jette le rendu
            return;
          }
          currentViewHandle = { _cleanup: destroy };
        } catch (err) {
          console.warn("[list_controller] Échec du rendu kanban :", err);
          kanbanTarget.textContent = "Impossible d'afficher la vue kanban.";
        }
      } else {
        // La liste est rendue par OWL (voir list_renderer.js) : le
        // ListRenderer est un composant OWL à template statique alimenté
        // par les colonnes parsées (list_arch_parser.js) -- même flux
        // asynchrone + jeton anti-course que la branche kanban.
        const listTarget = document.createElement("div");
        listHost.appendChild(listTarget);
        try {
          const { destroy } = await mountListView(
            listTarget,
            currentModelViews.list.arch,
            currentViewFieldsInfo,
            pageRecords,
            onRecordOpen,
            model,
            self.ui.groupBy
          );
          if (token !== renderToken) {
            destroy(); // la page a de nouveau changé pendant le mount -> on jette le rendu
            return;
          }
          currentViewHandle = { _cleanup: destroy };
        } catch (err) {
          console.warn("[list_controller] Échec du rendu liste :", err);
          listTarget.textContent = "Impossible d'afficher la vue liste.";
        }
      }

      syncPager();
    }

    async function start() {
      if (!module || !model) {
        console.warn("[list_controller] descripteur incomplet, retour à l'accueil :", params);
        env.doAction("home_menu", { replace: true, clearStack: true });
        return;
      }

      try {
        const manifest = await getModuleManifest(module, apiKey, CONFIG.ODOO_BASE_URL);
        currentModelViews = resolveModelViews(manifest, model, actionId);
        currentViewFieldsInfo = manifest.fields[model];

        if (!currentModelViews) {
          statusEl.textContent = `Aucune vue disponible pour "${model}".`;
          return;
        }

        const availableViews = ["list", "kanban", "pivot", "graph"].filter((v) => currentModelViews[v]);
        function onViewSwitch(viewType) {
          currentView = viewType;
          self.ui.availableViews = availableViews;
          self.ui.currentView = currentView;
          renderCurrentPage();
        }
        viewSwitchHandler = onViewSwitch;
        self.ui.availableViews = availableViews;

        // Candidats du menu Grouper par : colonnes de l'arch liste dont le
        // type est regroupable (char/selection/many2one/boolean).
        let groupByCandidates = [];
        if (currentModelViews.list) {
          const listParsed = parseListArch(currentModelViews.list.arch, currentViewFieldsInfo);
          if (!listParsed.error) {
            groupByCandidates = listParsed.columns
              .filter((c) => ["char", "selection", "many2one", "boolean"].includes((currentViewFieldsInfo[c.field] || {}).type))
              .map((c) => ({ name: c.field, label: c.label }));
          }
        }

        // --- Search avancé (itération 12) : l'arch <search> du manifest
        // fournit filtres et filtres de groupe, comme chez Odoo ; sans
        // arch, repli sur des filtres dérivés des champs selection.
        let searchFilters = [];
        if (currentModelViews.search && currentModelViews.search.arch) {
          const searchParsed = parseSearchArch(currentModelViews.search.arch);
          if (!searchParsed.error) {
            searchFilters = searchParsed.filters;
            const known = new Set(groupByCandidates.map((c) => c.name));
            for (const gb of searchParsed.groupBys) {
              if (!known.has(gb.name)) {
                groupByCandidates.push({ name: gb.name, label: gb.label });
              }
            }
          }
        }
        if (searchFilters.length === 0) {
          searchFilters = buildSelectionFilters(currentViewFieldsInfo);
        }
        filterDefsByName = Object.fromEntries(searchFilters.map((f) => [f.name, f]));
        self.ui.filterCandidates = searchFilters.map(({ name, label }) => ({ name, label }));
        self.ui.groupByCandidates = groupByCandidates;
        self.ui.favorites = getSearchFavorites(model);
        self.ui.currentView = currentView;

        if (currentView === "pivot" || currentView === "graph") {
          self.ui.pagerVisible = false;
          const placeholder = document.createElement("div");
          placeholder.className = "text-center text-muted p-5";
          placeholder.textContent = `Vue ${currentView === "pivot" ? "Pivot" : "Graphique"} : à venir.`;
          self.listHostRef.el.appendChild(placeholder);
          statusEl.textContent = "";
          return;
        }

        if (model === "purchase.order") {
          const dashboardData = await getPurchaseDashboardSmart(apiKey, CONFIG.ODOO_BASE_URL, actionId);

          // The banner is only relevant for certain actions (e.g., "Requests for
          // Quotation"), not for all `purchase.order` views (e.g., "Purchase
          // Orders"). In such cases, the server does not return the expected
          // format—we degrade gracefully (no banner) rather than crashing.
          if (dashboardData && dashboardData.toutes && dashboardData.mes) {
            const dashboardEl = renderPurchaseDashboard(dashboardData, activeDashboardFilter, (rowKey, stateKey) => {
              activeDashboardFilter =
                activeDashboardFilter && activeDashboardFilter.rowKey === rowKey && activeDashboardFilter.stateKey === stateKey
                  ? null : { rowKey, stateKey };
              applySearchFilter();
              currentPage = 0;
              renderCurrentPage();
            });
            self.dashboardHostRef.el.appendChild(dashboardEl);
          } else if (dashboardData) {
            console.warn("Bandeau purchase_dashboard ignoré : données inattendues pour cette action.", dashboardData);
          }
        }

        const listData = await getListRecordsSmart(model, apiKey, CONFIG.ODOO_BASE_URL, actionId);
        // Applique les record rules (ir.rule) mises en cache par user_service.js
        // -- jusqu'ici récupérées mais jamais utilisées (voir audit rules_engine).
        const securityInfo = await getSecurityInfo(model);
        allRecordsRaw = filterByRecordRule(model, listData.records || [], securityInfo);
        applySearchFilter();
        renderCurrentPage();

        statusEl.textContent = navigator.onLine ? "" : "Mode hors-ligne — liste mise en cache.";
      } catch (err) {
        console.error(err);
        statusEl.textContent = "Erreur : " + err.message;
      }
    }

    // Zones du template OWL + démarrage du flux de chargement.
    owl.onMounted(() => {
      self.statusHostRef.el.appendChild(statusEl);
      start();
    });

    // Destruction : debounce de recherche + vue actuellement montée
    // (renderer OWL kanban ou renderer liste vanilla).
    owl.onWillDestroy(() => {
      destroyCurrentView();
    });
  }
}

/**
 * Montage du contrôleur (contrat historique conservé : async, retourne
 * la fonction destroy) -- appelé par views/view.js via le descripteur
 * { Controller } de list_view.js / kanban_view.js, comme le webclient
 * d'Odoo monte le composant Controller d'une vue.
 */
export async function mountListController(container, params, env) {
  const { destroy } = await mountOwlApp(ListController, container, { params, env });
  return destroy;
}
