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
import { getListRecordsSmart, upsertLocalListRecord } from "../../core/list_cache.js";
import { patchCachedRecord } from "../../core/record_cache.js";
import { queueAction, syncPendingActions, amendPendingCreate, getSyncQueueEntry } from "../../core/network/rpc_service.js";
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
// Types pour lesquels glisser une carte d'une colonne à l'autre a un
// sens (écrire la valeur du champ de groupement) -- pas pour char.
const DRAGGABLE_TYPES = ["selection", "many2one", "boolean"];

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
    // Champ utilisé par le quick create (équivalent _rec_name : le
    // champ "name" s'il est char, sinon le premier champ char de l'arch).
    let nameField = null;
    // Jeton anti-course : les changements rapides (recherche/group by)
    // pendant un mount OWL ne doivent pas laisser deux rendus vivres.
    let renderToken = 0;
    // Timer du message de statut (quick create / drag & drop).
    let statusFlashTimer = null;

    function statusFlash(message) {
      statusEl.textContent = message;
      clearTimeout(statusFlashTimer);
      statusFlashTimer = setTimeout(() => {
        statusEl.textContent = "";
      }, 3000);
    }

    // ── Quick create + drag & drop (itération 13) ────────────────────
    // Le renderer gère le GESTE (input, dragstart/drop) et délègue le
    // MODÈLE au contrôleur -- même répartition qu'Odoo (renderer ->
    // model via le contrôleur). Les écritures passent par la file de
    // synchronisation hors ligne, avec mise à jour optimiste du kanban,
    // du cache liste et du cache enregistrement.

    function groupByInfo() {
      return self.ui.groupBy ? (currentFieldsInfo || {})[self.ui.groupBy] || null : null;
    }

    /** "<champ>:<clé>" -> valeur à écrire (convention buildKanbanColumns). */
    function columnValueFromKey(info, columnKey) {
      const rawKey = columnKey.includes(":") ? columnKey.slice(columnKey.indexOf(":") + 1) : columnKey;
      if (rawKey === "__none__") return false;
      if (!info) return rawKey;
      switch (info.type) {
        case "boolean": return rawKey === "1";
        case "many2one": return /^\d+$/.test(rawKey) ? parseInt(rawKey, 10) : rawKey;
        default: return rawKey;
      }
    }

    /** Valeur brute -> clé de colonne (miroir de buildKanbanColumns). */
    function columnKeyOf(info, raw) {
      const key =
        info && info.type === "boolean"
          ? raw ? "1" : "0"
          : raw === false || raw === undefined || raw === null || raw === ""
            ? "__none__"
            : Array.isArray(raw)
              ? String(raw[0])
              : String(raw);
      return `${self.ui.groupBy}:${key}`;
    }

    self.onQuickCreate = async (columnKey, name) => {
      const info = groupByInfo();
      const values = {};
      if (nameField) values[nameField] = name;
      if (self.ui.groupBy) values[self.ui.groupBy] = columnValueFromKey(info, columnKey);
      try {
        const localUuid = await queueAction(model, "create", values, "generic");
        const tmpId = `tmp:${localUuid}`;
        const record = { id: tmpId, ...values };
        allRecords.push(record);
        await upsertLocalListRecord(model, actionId, record);
        statusFlash("Carte créée localement — sera synchronisée dès que possible.");
        renderCurrent();
        if (navigator.onLine) {
          const result = await syncPendingActions();
          const realId = result.createdIds && result.createdIds[localUuid];
          if (realId) {
            const idx = allRecords.findIndex((r) => String(r.id) === tmpId);
            if (idx >= 0) allRecords[idx] = { ...allRecords[idx], id: realId };
            await upsertLocalListRecord(model, actionId, allRecords[idx]);
            renderCurrent();
            statusFlash("Carte enregistrée et synchronisée avec Odoo.");
          }
        }
      } catch (err) {
        console.error("[kanban_controller] quick create échoué :", err);
        statusFlash("Erreur lors de la création : " + err.message);
      }
    };

    self.onRecordMove = async (recordId, columnKey) => {
      const record = allRecords.find((r) => String(r.id) === String(recordId));
      const info = groupByInfo();
      if (!record || !info || !self.ui.groupBy) return;
      const field = self.ui.groupBy;
      if (columnKeyOf(info, record[field]) === columnKey) return; // même colonne
      const newValue = columnValueFromKey(info, columnKey);
      const isTmp = String(record.id).startsWith("tmp:");
      try {
        if (isTmp) {
          // Le create est encore EN FILE : pas de write possible sur un
          // id tmp -- on amende le payload du create en attente (comme
          // amendPendingCreate depuis le formulaire).
          const entry = await getSyncQueueEntry(String(record.id).slice(4));
          if (entry) {
            const payload = JSON.parse(entry.payload || "{}");
            payload[field] = newValue;
            await amendPendingCreate(String(record.id).slice(4), payload);
          }
        } else {
          await queueAction(model, "write", { id: record.id, [field]: newValue }, "generic");
        }

        // Mise à jour optimiste : la valeur LOCALE garde la forme du
        // cache (m2o = tuple [id, libellé]) -- le libellé est repris
        // d'une carte soeur de la colonne cible s'il en existe une.
        let localValue = newValue;
        if (info.type === "many2one") {
          const sibling = allRecords.find((r) => r !== record && columnKeyOf(info, r[field]) === columnKey);
          localValue = sibling ? sibling[field] : newValue === false ? false : [newValue, ""];
        }
        record[field] = localValue;
        if (!isTmp) {
          await patchCachedRecord(model, record.id, { [field]: localValue });
        }
        await upsertLocalListRecord(model, actionId, record);
        statusFlash("Carte déplacée — sera synchronisée dès que possible.");
        renderCurrent();
        if (navigator.onLine) {
          await syncPendingActions();
          statusFlash("Déplacement synchronisé avec Odoo.");
        }
      } catch (err) {
        console.error("[kanban_controller] déplacement échoué :", err);
        statusFlash("Erreur lors du déplacement : " + err.message);
      }
    };

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
      // Laisse OWL appliquer les re-renders réactifs programmés (rAF) :
      // un patch du composant recrée les zones t-ref, et lire le host
      // avant donnerait une cible détachée (même race que la liste).
      await new Promise((resolve) => (window.requestAnimationFrame || setTimeout)(resolve));
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
      // Drag & drop activé si le champ de groupement est écrivable par
      // colonne (selection/m2o/boolean) -- pas pour char ni à plat.
      const info = groupByInfo();
      const canDrag = !!self.ui.groupBy && !!info && DRAGGABLE_TYPES.includes(info.type);
      try {
        const { destroy } = await mountKanbanView(
          kanbanTarget,
          currentArch,
          currentFieldsInfo,
          filtered,
          onCardOpen,
          self.ui.groupBy,
          {
            canDrag,
            onRecordMove: self.onRecordMove,
            onQuickCreate: self.onQuickCreate,
          }
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

        // Champ « nom » du quick create (équivalent _rec_name hors
        // ligne : "name" s'il est char, sinon premier char de l'arch).
        nameField =
          archInfo && !archInfo.error
            ? ["name", ...archInfo.fields].find((f) => ((currentFieldsInfo || {})[f] || {}).type === "char") || null
            : null;

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
      clearTimeout(statusFlashTimer);
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
