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
import { formatCellValue } from "./list_renderer_utils.js";
import { renderListView } from "./list_renderer.js";
import { mountKanbanView } from "../kanban/kanban_renderer.js";
import { renderPurchaseDashboard, buildPurchaseDashboardDomain } from "../purchase_dashboard.js";
import { buildControlPanel, renderViewSwitcherButtons } from "../../search/control_panel/control_panel.js";
import { filterByRecordRule } from "../../model/rules_engine/rules_engine.js";
import { mountOwlApp } from "../../owl/app.js";

const PAGE_SIZE = 20;

export class ListController extends owl.Component {
  static props = {
    params: { type: Object, optional: true },
    env: { optional: true },
  };

  static template = owl.xml`
    <div class="o_list_controller d-flex flex-column h-100">
      <div t-ref="controlPanelHost"/>
      <div t-ref="statusHost"/>
      <div t-ref="dashboardHost"/>
      <div t-ref="listHost"/>
    </div>`;

  setup() {
    this.controlPanelHostRef = owl.useRef("controlPanelHost");
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
    let searchDebounceTimer = null;
    // Vue actuellement montée dans la zone de liste (handle { destroy }
    // pour le renderer OWL kanban, élément DOM pour le renderer liste).
    let currentViewHandle = null;
    // Jeton anti-course : les changements de page/vue rapides pendant un
    // mount OWL asynchrone (kanban) ne doivent pas laisser deux vues vivres.
    let renderToken = 0;

    // --- Construction of the control panel specific to this view ---
    const cp = buildControlPanel({
      withNewButton: true,
      withSearch: true,
      withPager: true,
      withViewSwitcher: true,
      withOptionsGear: true,
    });

    cp.breadcrumbCurrent.textContent = label || model;

    cp.newBtn.addEventListener("click", () => {
      env.doAction({ tag: "form_view", module, model, actionId, isNew: true });
    });

    cp.searchInput.addEventListener("input", () => {
      clearTimeout(searchDebounceTimer);
      const query = cp.searchInput.value;
      searchDebounceTimer = setTimeout(() => {
        searchQuery = query;
        applySearchFilter();
        currentPage = 0;
        renderCurrentPage();
      }, 300);
    });

    cp.pagerPrevBtn.addEventListener("click", () => {
      if (currentPage > 0) { currentPage--; renderCurrentPage(); }
    });
    cp.pagerNextBtn.addEventListener("click", () => {
      if ((currentPage + 1) * PAGE_SIZE < allRecords.length) { currentPage++; renderCurrentPage(); }
    });

    // Status bar
    const statusEl = document.createElement("div");
    statusEl.className = "text-muted small px-3 py-1";
    statusEl.textContent = "Chargement de la liste...";

    function matchesSimpleDomain(record, domain) {
      return domain.every(([field, op, value]) => {
        const raw = record[field];
        switch (op) {
          case "=": return raw === value;
          case "in": return Array.isArray(value) && value.includes(raw);
          case "<": return raw !== undefined && raw !== false && raw < value;
          default: return true;
        }
      });
    }

    function applySearchFilter() {
      let filtered = allRecordsRaw;

      if (activeDashboardFilter) {
        const domain = buildPurchaseDashboardDomain(
          activeDashboardFilter.rowKey, activeDashboardFilter.stateKey, getUserId()
        );
        filtered = filtered.filter((r) => matchesSimpleDomain(r, domain));
      }

      allRecords = searchQuery
        ? filtered.filter((r) => recordMatchesQuery(r, currentViewFieldsInfo || {}, searchQuery))
        : filtered;
    }

    function recordMatchesQuery(record, fieldsInfo, query) {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      for (const [fname, info] of Object.entries(fieldsInfo)) {
        const raw = record[fname];
        if (raw === undefined || raw === false || raw === null) continue;
        const text = formatCellValue(raw, info);
        if (text && text.toLowerCase().includes(q)) return true;
      }
      return false;
    }

    function updatePagerDisplay() {
      const total = allRecords.length;
      const start = currentPage * PAGE_SIZE;
      if (total === 0) {
        cp.pagerEl.style.setProperty("display", "none", "important");
        return;
      }
      cp.pagerEl.style.setProperty("display", "flex", "important");
      cp.pagerInfoEl.textContent = `${start + 1}-${Math.min(start + PAGE_SIZE, total)} / ${total}`;
      cp.pagerPrevBtn.disabled = currentPage === 0;
      cp.pagerNextBtn.disabled = start + PAGE_SIZE >= total;
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
            onRecordOpen
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
        const viewEl = renderListView(
          currentModelViews.list.arch, currentViewFieldsInfo, pageRecords, onRecordOpen, model
        );
        currentViewHandle = viewEl;
        listHost.appendChild(viewEl);
      }

      updatePagerDisplay();
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
          renderViewSwitcherButtons(cp.viewSwitcherEl, availableViews, currentView, onViewSwitch);
          renderCurrentPage();
        }
        renderViewSwitcherButtons(cp.viewSwitcherEl, availableViews, currentView, onViewSwitch);

        if (currentView === "pivot" || currentView === "graph") {
          cp.pagerEl.style.setProperty("display", "none", "important");
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
      self.controlPanelHostRef.el.appendChild(cp.el);
      self.statusHostRef.el.appendChild(statusEl);
      start();
    });

    // Destruction : debounce de recherche + vue actuellement montée
    // (renderer OWL kanban ou renderer liste vanilla).
    owl.onWillDestroy(() => {
      clearTimeout(searchDebounceTimer);
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
