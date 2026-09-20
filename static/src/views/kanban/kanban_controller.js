/**
 * views/kanban/kanban_controller.js
 * =================================
 * Contrôleur DÉDIÉ de la vue Kanban -- composant OWL, même architecture
 * qu'Odoo 17 (la vue kanban a son propre contrôleur, plus un simple
 * partage avec la liste) : le descripteur kanban_view.js expose
 * { Controller: KanbanController } et views/view.js monte le composant.
 *
 * Spécificité vs ListController : pas de pager (le kanban affiche les
 * cartes filtrées), et surtout le GROUP BY en COLONNES -- via l'attribut
 * default_group_by de l'arch ou le menu « Grouper par » du control
 * panel. La bascule vers la liste remonte au dispatcher
 * (doAction list_view), comme le view switcher du vrai webclient qui
 * change la vue de l'action courante.
 */

import { CONFIG, getApiKey } from "../../core/browser/session.js";
import { getSecurityInfo } from "../../core/user_service.js";
import { getModuleManifest, resolveModelViews } from "../view_service.js";
import { getListRecordsSmart } from "../../core/list_cache.js";
import { mountKanbanView } from "./kanban_renderer.js";
import { parseKanbanArch } from "./kanban_arch_parser.js";
import { recordMatchesQuery } from "../list/list_renderer_utils.js";
import { parseSearchArch } from "../../search/search_arch_parser.js";
import { applyFilters, buildSelectionFilters } from "../../search/search_utils.js";
import { getSearchFavorites, saveSearchFavorite, deleteSearchFavorite, matchFavorite } from "../../search/search_favorites.js";
import { ControlPanel } from "../../search/control_panel/control_panel.js";
import { filterByRecordRule } from "../../model/rules_engine/rules_engine.js";
import { mountOwlApp } from "../../owl/app.js";

const GROUPABLE_TYPES = ["char", "selection", "many2one", "boolean"];

export class KanbanController extends owl.Component {
  static components = { ControlPanel };

  static props = {
    params: { type: Object, optional: true },
    env: { optional: true },
  };

  static template = owl.xml`
    <div class="o_kanban_controller d-flex flex-column h-100">
      <ControlPanel display="cpDisplay" breadcrumb="cpBreadcrumb" views="cpViews" groups="cpGroups"
                    filters="cpFilters" favorites="cpFavorites" query="cpQuery"
                    onNew="onNewClick" onSearch="onSearchQuery" onSwitch="onSwitchView" onGroupBy="onGroupBySelect"
                    onToggleFilter="onToggleFilter" onSaveFavorite="onSaveFavorite" onSelectFavorite="onSelectFavorite" onDeleteFavorite="onDeleteFavorite"/>
      <div t-ref="statusHost"/>
      <div t-ref="rendererHost"/>
    </div>`;

  get cpBreadcrumb() {
    return {
      listLabel: null,
      recordLabel: (this.ui && this.ui.recordLabel) || "",
    };
  }

  get cpViews() {
    return {
      available: (this.ui && this.ui.availableViews) || [],
      current: (this.ui && this.ui.currentView) || "kanban",
    };
  }

  get cpGroups() {
    const ui = this.ui || {};
    return { available: ui.groupByCandidates || [], current: ui.groupBy };
  }

  get cpFilters() {
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
    this.rendererHostRef = owl.useRef("rendererHost");

    const self = this;
    const params = this.props.params || {};
    const env = this.props.env;
    const { module, model, actionId, label } = params;

    const apiKey = getApiKey();

    let allRecords = [];
    let searchQuery = "";
    // Défs des filtres (name -> {name,label,domain}) résolues par start().
    let filterDefsByName = {};
    let currentModelViews = null;
    let currentFieldsInfo = null;
    let currentArch = null;
    let currentViewHandle = null;
    // Jeton anti-course : les changements rapides (recherche/group by)
    // pendant un mount OWL ne doivent pas laisser deux rendus vivres.
    let renderToken = 0;

    // Control panel OWL : état réactif + callbacks.
    self.cpDisplay = {
      withNewButton: true,
      withSearch: true,
      withViewSwitcher: true,
      withGroupBy: true,
    };
    self.ui = owl.useState({
      recordLabel: label || model || "",
      availableViews: [],
      currentView: "kanban",
      groupBy: params.groupBy || null,
      groupByCandidates: [],
      // Search avancé (itération 12).
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
      renderCurrent();
    };
    self.onGroupBySelect = (name) => {
      self.ui.groupBy = name;
      renderCurrent();
    };
    // --- Search avancé : filtres + favoris (itération 12) ---
    self.onToggleFilter = (name) => {
      const active = new Set(self.ui.activeFilters);
      if (active.has(name)) active.delete(name);
      else active.add(name);
      self.ui.activeFilters = [...active];
      renderCurrent();
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
      self.ui.activeFilters = (fav.filters || []).filter((n) => !!filterDefsByName[n]);
      const candidates = new Set((self.ui.groupByCandidates || []).map((c) => c.name));
      self.ui.groupBy = fav.groupBy && candidates.has(fav.groupBy) ? fav.groupBy : null;
      renderCurrent();
    };
    self.onDeleteFavorite = (name) => {
      self.ui.favorites = deleteSearchFavorite(model, name);
    };
    // Bascule vers la liste : remonte au dispatcher (nouvelle vue de
    // l'action courante), comme le view switcher natif.
    self.onSwitchView = (viewType) => {
      if (viewType === "kanban") return;
      env.doAction({ tag: "list_view", module, model, actionId, label: label || model });
    };

    const statusEl = document.createElement("div");
    statusEl.className = "text-muted small px-3 py-1";
    statusEl.textContent = "Chargement du kanban...";

    function destroyCurrentView() {
      if (currentViewHandle && currentViewHandle.destroy) {
        currentViewHandle.destroy();
      }
      currentViewHandle = null;
    }

    async function renderCurrent() {
      const token = ++renderToken;
      const host = self.rendererHostRef.el;
      if (!host) return;

      destroyCurrentView();
      host.innerHTML = "";

      // Filtres actifs (menu Filtres) puis requête texte, comme le
      // pipeline de recherche natif (domain + fuzzy search).
      const filtered = applyFilters(allRecords, filterDefsByName, self.ui.activeFilters).filter((r) =>
        searchQuery ? recordMatchesQuery(r, currentFieldsInfo || {}, searchQuery) : true
      );

      const onCardOpen = (recordId) => {
        env.doAction({
          tag: "form_view", module, model, id: recordId, actionId,
          listLabel: label || model,
        });
      };

      const kanbanTarget = document.createElement("div");
      host.appendChild(kanbanTarget);
      try {
        const { destroy } = await mountKanbanView(
          kanbanTarget,
          currentArch,
          currentFieldsInfo,
          filtered,
          onCardOpen,
          self.ui.groupBy
        );
        if (token !== renderToken) {
          destroy(); // un autre rendu a été demandé entre-temps -> on jette celui-ci
          return;
        }
        currentViewHandle = { destroy };
      } catch (err) {
        console.warn("[kanban_controller] Échec du rendu kanban :", err);
        kanbanTarget.textContent = "Impossible d'afficher la vue kanban.";
      }
    }

    async function start() {
      if (!module || !model) {
        console.warn("[kanban_controller] descripteur incomplet, retour à l'accueil :", params);
        env.doAction("home_menu", { replace: true, clearStack: true });
        return;
      }

      try {
        const manifest = await getModuleManifest(module, apiKey, CONFIG.ODOO_BASE_URL);
        currentModelViews = resolveModelViews(manifest, model, actionId);
        currentFieldsInfo = manifest.fields[model];

        if (!currentModelViews || !currentModelViews.kanban || !currentFieldsInfo) {
          statusEl.textContent = `Aucune vue kanban disponible pour "${model}".`;
          return;
        }
        currentArch = currentModelViews.kanban.arch;

        // View switcher : la liste est ouverte via le dispatcher.
        self.ui.availableViews = ["list", "kanban"].filter((v) => currentModelViews[v]);

        // Candidats du Grouper par : champs du template kanban dont le
        // type est regroupable.
        let groupByCandidates = [];
        const archInfo = parseKanbanArch(currentArch);
        if (!archInfo.error) {
          groupByCandidates = archInfo.fields
            .filter((f) => GROUPABLE_TYPES.includes((currentFieldsInfo[f] || {}).type))
            .map((f) => ({ name: f, label: currentFieldsInfo[f].label || f }));
          // default_group_by de l'arch (comme le natif), sinon le param.
          self.ui.groupBy = self.ui.groupBy || archInfo.defaultGroupBy || null;
        }

        // --- Search avancé (itération 12) : arch <search> du manifest
        // (filtres + filtres de groupe), sinon champs selection.
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
          searchFilters = buildSelectionFilters(currentFieldsInfo);
        }
        filterDefsByName = Object.fromEntries(searchFilters.map((f) => [f.name, f]));
        self.ui.filterCandidates = searchFilters.map(({ name, label }) => ({ name, label }));
        self.ui.groupByCandidates = groupByCandidates;
        self.ui.favorites = getSearchFavorites(model);

        const listData = await getListRecordsSmart(model, apiKey, CONFIG.ODOO_BASE_URL, actionId);
        const securityInfo = await getSecurityInfo(model);
        allRecords = filterByRecordRule(model, listData.records || [], securityInfo);

        statusEl.textContent = navigator.onLine ? "" : "Mode hors-ligne — données mises en cache.";
        await renderCurrent();
      } catch (err) {
        console.error(err);
        statusEl.textContent = "Erreur : " + err.message;
      }
    }

    owl.onMounted(() => {
      self.statusHostRef.el.appendChild(statusEl);
      start();
    });

    owl.onWillDestroy(() => {
      destroyCurrentView();
    });
  }
}

/**
 * Montage du contrôleur (contrat historique : async -> destroy) --
 * appelé par views/view.js via le descripteur { Controller } de
 * kanban_view.js.
 */
export async function mountKanbanController(container, params, env) {
  const { destroy } = await mountOwlApp(KanbanController, container, { params, env });
  return destroy;
}
