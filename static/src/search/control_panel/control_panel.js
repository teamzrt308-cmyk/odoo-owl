/**
 * search/control_panel/control_panel.js
 * =====================================
 * ControlPanel -- composant OWL, même architecture qu'Odoo 17 : le
 * control panel appartient au contrôleur de la vue courante (embeddé
 * dans son template via static components) et reçoit de quoi s'afficher
 * par props :
 *  - display    : blocs à afficher { withNewButton, withSearch, withPager,
 *                 withViewSwitcher, withRecordStatusIcons, withOptionsGear } ;
 *  - breadcrumb : { listLabel, recordLabel } (composant Breadcrumb,
 *                 webclient/breadcrumb/) ;
 *  - pager      : { page, pageSize, total } | null (masqué si null/vide) ;
 *  - views      : { available: [], current } | null (view switcher) ;
 *  - groups     : { available: [{name,label}], current } | null (Grouper par) ;
 *  - filters    : { available: [{name,label}], active: [] } (menu Filtres,
 *                 issu de l'arch <search> ou des champs selection) ;
 *  - favorites  : { available: [{name}], current } (menu Favoris) ;
 *  - query      : requête courante (restauration d'un favori).
 * Les interactions remontent par callbacks : onNew, onSearch (debounce
 * 300ms géré ici, comme le SearchBar natif), onPage(delta), onSwitch,
 * onGroupBy, onToggleFilter, onSaveFavorite, onSelectFavorite,
 * onDeleteFavorite, onSave, onUndo.
 *
 * Les filtres actifs sont affichés en FACETTES dans la barre de
 * recherche (retirables), comme le SearchBar natif d'Odoo.
 *
 * Les classes CSS sont identiques à l'ancien buildControlPanel() vanilla
 * (contrat visuel et sélecteurs de test préservés).
 */

import { Breadcrumb } from "../../webclient/breadcrumb/breadcrumb.js";

const VIEW_SWITCHER_ICONS = {
  list: "oi-view-list",
  kanban: "oi-view-kanban",
  pivot: "oi-view-pivot",
  graph: "oi-view-graph",
};

const SEARCH_DEBOUNCE_MS = 300;

export class ControlPanel extends owl.Component {
  static components = { Breadcrumb };

  static props = {
    display: { type: Object, optional: true },
    breadcrumb: { type: Object, optional: true },
    pager: { type: Object, optional: true },
    views: { type: Object, optional: true },
    groups: { type: Object, optional: true }, // { available: [{name,label}], current }
    filters: { type: Object, optional: true }, // { available: [{name,label}], active: [] }
    favorites: { type: Object, optional: true }, // { available: [{name}], current }
    query: { type: String, optional: true },
    onNew: { type: Function, optional: true },
    onSearch: { type: Function, optional: true },
    onPage: { type: Function, optional: true },
    onSwitch: { type: Function, optional: true },
    onGroupBy: { type: Function, optional: true },
    onToggleFilter: { type: Function, optional: true },
    onSaveFavorite: { type: Function, optional: true },
    onSelectFavorite: { type: Function, optional: true },
    onDeleteFavorite: { type: Function, optional: true },
    onSave: { type: Function, optional: true },
    onUndo: { type: Function, optional: true },
  };

  static template = owl.xml`
    <div class="o_control_panel d-flex flex-column gap-3 gap-lg-1 px-3 pt-2 pb-3">
      <div class="o_control_panel_main d-flex flex-wrap flex-lg-nowrap justify-content-between align-items-lg-start gap-3 flex-grow-1">
        <div class="o_control_panel_breadcrumbs d-flex align-items-center gap-1 order-0 h-lg-100">
          <div class="o_control_panel_main_buttons d-flex gap-1 d-empty-none d-print-none">
            <button t-if="display.withNewButton" type="button" class="btn btn-primary o_list_button_add" t-on-click="onNewClick">Nouveau</button>
          </div>
          <Breadcrumb breadcrumb="props.breadcrumb" onListClick="props.onBreadcrumbList">
            <div t-if="display.withRecordStatusIcons" class="o_form_status_indicator_buttons">
              <button type="button" class="o_form_button_save btn btn-light border-0 px-1 py-0 lh-sm" title="Enregistrer manuellement" aria-label="Enregistrer manuellement" t-on-click="onSaveClick">
                <i class="fa fa-cloud-upload fa-fw"/>
              </button>
              <button type="button" class="o_form_button_cancel btn btn-light border-0 px-1 py-0 lh-sm" title="Ignorer les changements" aria-label="Ignorer les changements" t-on-click="onUndoClick">
                <i class="fa fa-undo fa-fw"/>
              </button>
            </div>
            <t t-set-slot="extras">
              <button t-if="display.withOptionsGear" type="button" class="btn btn-link p-0 ms-1 lh-sm border-0" title="Options de vue" style="margin-left: 4px;">
                <i class="fa fa-cog"/>
              </button>
            </t>
          </Breadcrumb>
        </div>
        <div class="o_control_panel_navigation d-flex flex-wrap flex-md-nowrap justify-content-end gap-3 gap-lg-1 gap-xl-3 order-1 order-lg-2 flex-grow-1">
          <div t-if="display.withFilters and filters and filters.available.length > 0" class="o_cp_filters position-relative">
            <button type="button" class="btn btn-secondary o_filters_button d-flex align-items-center gap-1" title="Filtres"
                    t-on-click.stop="() => this.toggleMenu('filtersMenuOpen')">
              Filtres<span t-if="filters.active.length > 0" class="badge text-bg-primary" t-esc="filters.active.length"/><i class="fa fa-angle-down"/>
            </button>
            <div t-if="state.filtersMenuOpen" class="dropdown-menu show o_filters_menu"
                 style="position: absolute; top: 100%; left: 0; z-index: 1000; min-width: 220px;">
              <a t-foreach="filters.available" t-as="f" t-key="f.name" href="#"
                 t-att-class="'dropdown-item d-flex align-items-center gap-2' + (filters.active.includes(f.name) ? ' active' : '')"
                 t-on-click.stop="() => this.toggleFilter(f.name)">
                <t t-esc="f.label"/><i t-if="filters.active.includes(f.name)" class="fa fa-check ms-auto"/>
              </a>
            </div>
          </div>
          <div t-if="display.withGroupBy and groups and groups.available.length > 0" class="o_cp_groupby position-relative">
            <button type="button" class="btn btn-secondary o_groupby_button d-flex align-items-center gap-1" title="Grouper par"
                    t-on-click.stop="() => this.toggleMenu('groupByMenuOpen')">
              Grouper par <i class="fa fa-angle-down"/>
            </button>
            <div t-if="state.groupByMenuOpen" class="dropdown-menu show o_groupby_menu"
                 style="position: absolute; top: 100%; left: 0; z-index: 1000; min-width: 200px;">
              <a href="#" t-att-class="'dropdown-item d-flex align-items-center gap-2' + (groups.current === null ? ' active' : '')"
                 t-on-click.stop.prevent="() => this.selectGroupBy(null)">
                Aucun groupe <i t-if="groups.current === null" class="fa fa-check ms-auto"/>
              </a>
              <a t-foreach="groups.available" t-as="g" t-key="g.name" href="#"
                 t-att-class="'dropdown-item d-flex align-items-center gap-2' + (groups.current === g.name ? ' active' : '')"
                 t-on-click.stop.prevent="() => this.selectGroupBy(g.name)">
                <t t-esc="g.label"/><i t-if="groups.current === g.name" class="fa fa-check ms-auto"/>
              </a>
            </div>
          </div>
          <div t-if="display.withFavorites" class="o_cp_favorites position-relative">
            <button type="button" class="btn btn-secondary o_favorites_button d-flex align-items-center gap-1" title="Favoris"
                    t-on-click.stop="() => this.toggleMenu('favoritesMenuOpen')">
              Favoris <i class="fa fa-angle-down"/>
            </button>
            <div t-if="state.favoritesMenuOpen" class="dropdown-menu show o_favorites_menu"
                 style="position: absolute; top: 100%; left: 0; z-index: 1000; min-width: 240px;">
              <div t-foreach="favorites.available" t-as="fav" t-key="fav.name"
                   t-att-class="'dropdown-item d-flex align-items-center gap-2' + (fav.name === favorites.current ? ' active' : '')"
                   t-on-click.stop="() => this.selectFavorite(fav.name)" role="button">
                <t t-esc="fav.name"/><i t-if="fav.name === favorites.current" class="fa fa-check"/>
                <span class="o_delete_favorite text-danger ms-auto" role="button" title="Supprimer ce favori"
                      t-on-click.stop="() => this.deleteFavorite(fav.name)"><i class="fa fa-trash"/></span>
              </div>
              <div class="dropdown-divider"/>
              <div t-if="state.favoriteInputOpen" class="px-3 py-2 d-flex gap-1" t-on-click.stop="">
                <input type="text" class="form-control form-control-sm o_favorite_name_input" placeholder="Nom du favori"
                       t-ref="favoriteInput" t-on-keydown="onFavoriteNameKeydown"/>
                <button type="button" class="btn btn-primary btn-sm text-nowrap o_save_favorite_button"
                        t-on-click="() => this.saveFavorite()">Enregistrer</button>
              </div>
              <a t-else="" href="#" class="dropdown-item o_add_favorite" t-on-click.stop.prevent="() => this.openFavoriteInput()">
                Enregistrer la recherche actuelle
              </a>
            </div>
          </div>
          <div t-if="display.withSearch" class="o_cp_searchview d-flex input-group flex-grow-1" role="search">
            <div class="o_searchview form-control d-flex align-items-center py-1" role="search">
              <i class="o_searchview_icon d-print-none oi oi-search me-2"/>
              <div class="o_searchview_input_container d-flex flex-grow-1 flex-wrap gap-1">
                <span t-foreach="activeFacets" t-as="facet" t-key="facet.name"
                      class="o_searchview_facet d-inline-flex align-items-center gap-1 badge text-bg-light border">
                  <t t-esc="facet.label"/>
                  <button type="button" class="o_facet_remove btn btn-link p-0 border-0 lh-1" title="Retirer ce filtre"
                          aria-label="Retirer ce filtre" t-on-click.stop="() => this.removeFacet(facet.name)">×</button>
                </span>
                <input type="text" class="o_searchview_input border-0 flex-grow-1" placeholder="Rechercher..." t-ref="searchInput" t-on-input="onSearchInput"/>
              </div>
            </div>
          </div>
          <div t-if="display.withPager and pager" class="o_cp_pager text-nowrap" role="search">
            <nav t-if="pager.total > 0" class="o_pager d-flex gap-2 h-100">
              <span class="o_pager_counter align-self-center"><t t-esc="pagerCounter"/></span>
              <span class="btn-group d-print-none" aria-atomic="true">
                <button type="button" class="btn btn-secondary o_pager_previous px-2 rounded-start" title="Précédent" t-att-disabled="pager.page === 0" t-on-click="() => this.onPageClick(-1)">
                  <i class="oi oi-chevron-left"/>
                </button>
                <button type="button" class="btn btn-secondary o_pager_next px-2 rounded-end" title="Suivant" t-att-disabled="(pager.page + 1) * pager.pageSize >= pager.total" t-on-click="() => this.onPageClick(1)">
                  <i class="oi oi-chevron-right"/>
                </button>
              </span>
            </nav>
          </div>
          <div t-if="display.withViewSwitcher and views and views.available.length > 1" class="o_cp_switch_buttons d-print-none btn-group" role="group">
            <button t-foreach="views.available" t-as="viewType" t-key="viewType" type="button"
                    t-att-class="'btn btn-outline-secondary' + (viewType === views.current ? ' active' : '')"
                    t-att-title="viewType.charAt(0).toUpperCase() + viewType.slice(1)"
                    t-on-click="() => this.onSwitchClick(viewType)">
              <i t-att-class="'oi ' + (icons[viewType] or '')"/>
            </button>
          </div>
        </div>
      </div>
    </div>`;

  setup() {
    // Blocs affichés (défaut : rien) -- objet figé, l'équivalent du prop
    // `display` du ControlPanel natif d'Odoo.
    this.display = {
      withNewButton: false,
      withSearch: false,
      withPager: false,
      withViewSwitcher: false,
      withRecordStatusIcons: false,
      withOptionsGear: false,
      withGroupBy: false,
      ...(this.props.display || {}),
    };
    // Map d'icônes exposée au scope du template (view switcher).
    this.icons = VIEW_SWITCHER_ICONS;
    this.searchDebounceTimer = null;
    this.searchInputRef = owl.useRef("searchInput");
    this.favoriteInputRef = owl.useRef("favoriteInput");
    this.state = owl.useState({
      groupByMenuOpen: false,
      filtersMenuOpen: false,
      favoritesMenuOpen: false,
      favoriteInputOpen: false,
    });

    // Fermeture des menus déroulants au clic extérieur.
    owl.useExternalListener(document.body, "click", () => this.closeAllMenus());

    owl.onWillDestroy(() => clearTimeout(this.searchDebounceTimer));

    owl.onMounted(() => {
      // Requête initiale (ex: restauration d'un favori au mount).
      if (this.searchInputRef.el && (this.props.query || "")) {
        this.searchInputRef.el.value = this.props.query;
      }
    });

    // L'input de recherche est non contrôlé : la requête n'est mise à
    // jour dans le DOM que si elle change PAR DEHORS (favori appliqué),
    // et jamais pendant la saisie (hors focus).
    owl.onWillUpdateProps((nextProps) => {
      const nextQuery = nextProps.query || "";
      if (
        nextQuery !== (this.props.query || "") &&
        this.searchInputRef.el &&
        document.activeElement !== this.searchInputRef.el
      ) {
        this.searchInputRef.el.value = nextQuery;
      }
    });
  }

  closeAllMenus() {
    this.state.groupByMenuOpen = false;
    this.state.filtersMenuOpen = false;
    this.state.favoritesMenuOpen = false;
  }

  toggleMenu(menuKey) {
    const opening = !this.state[menuKey];
    this.closeAllMenus();
    this.state.favoriteInputOpen = false;
    this.state[menuKey] = opening;
  }

  selectGroupBy(name) {
    if (this.props.onGroupBy) this.props.onGroupBy(name);
    this.state.groupByMenuOpen = false;
  }

  /** Bascule un filtre du menu Filtres -- le menu RESTE ouvert. */
  toggleFilter(name) {
    if (this.props.onToggleFilter) this.props.onToggleFilter(name);
  }

  /** Retrait d'une facette dans la barre de recherche. */
  removeFacet(name) {
    if (this.props.onToggleFilter) this.props.onToggleFilter(name);
  }

  selectFavorite(name) {
    if (this.props.onSelectFavorite) this.props.onSelectFavorite(name);
    this.closeAllMenus();
    this.state.favoriteInputOpen = false;
  }

  deleteFavorite(name) {
    if (this.props.onDeleteFavorite) this.props.onDeleteFavorite(name);
  }

  openFavoriteInput() {
    this.state.favoriteInputOpen = true;
    setTimeout(() => {
      if (this.favoriteInputRef.el) this.favoriteInputRef.el.focus();
    }, 0);
  }

  saveFavorite() {
    const input = this.favoriteInputRef.el;
    const name = input ? input.value.trim() : "";
    if (!name) return;
    if (this.props.onSaveFavorite) this.props.onSaveFavorite(name);
    this.state.favoriteInputOpen = false;
  }

  onFavoriteNameKeydown(ev) {
    if (ev.key === "Enter") {
      ev.preventDefault();
      this.saveFavorite();
    }
    if (ev.key === "Escape") this.state.favoriteInputOpen = false;
  }

  get breadcrumb() {
    return this.props.breadcrumb || {};
  }

  get pager() {
    return this.props.pager || null;
  }

  get views() {
    return this.props.views || null;
  }

  get groups() {
    // Comme pager/views : le template lit la propriété du composant,
    // pas this.props directement.
    return this.props.groups || null;
  }

  get filters() {
    return this.props.filters || null;
  }

  get favorites() {
    return this.props.favorites || null;
  }

  get query() {
    return this.props.query || "";
  }

  /** Facettes actives : [{name, label}] (labels résolus depuis available). */
  get activeFacets() {
    const f = this.props.filters;
    if (!f || !f.available) return [];
    const labels = new Map(f.available.map((d) => [d.name, d.label]));
    return (f.active || []).map((name) => ({ name, label: labels.get(name) || name }));
  }

  get pagerCounter() {
    const p = this.props.pager;
    const start = p.page * p.pageSize;
    return `${start + 1}-${Math.min(start + p.pageSize, p.total)} / ${p.total}`;
  }

  onNewClick() {
    if (this.props.onNew) this.props.onNew();
  }

  onSearchInput(ev) {
    // Debounce interne, comme le SearchBar natif : la saisie n'est
    // propagée au contrôleur qu'après 300ms d'inactivité.
    const query = ev.target.value;
    clearTimeout(this.searchDebounceTimer);
    this.searchDebounceTimer = setTimeout(() => {
      if (this.props.onSearch) this.props.onSearch(query);
    }, SEARCH_DEBOUNCE_MS);
  }

  onPageClick(delta) {
    if (this.props.onPage) this.props.onPage(delta);
  }

  onSwitchClick(viewType) {
    if (this.props.onSwitch) this.props.onSwitch(viewType);
  }

  onSaveClick() {
    if (this.props.onSave) this.props.onSave();
  }

  onUndoClick() {
    if (this.props.onUndo) this.props.onUndo();
  }
}
