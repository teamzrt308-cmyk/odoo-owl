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
 *  - views      : { available: [], current } | null (view switcher).
 * Les interactions remontent par callbacks : onNew, onSearch (debounce
 * 300ms géré ici, comme le SearchBar natif), onPage(delta), onSwitch,
 * onSave, onUndo.
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
    onNew: { type: Function, optional: true },
    onSearch: { type: Function, optional: true },
    onPage: { type: Function, optional: true },
    onSwitch: { type: Function, optional: true },
    onGroupBy: { type: Function, optional: true },
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
          <div t-if="display.withGroupBy and groups and groups.available.length > 0" class="o_cp_groupby position-relative">
            <button type="button" class="btn btn-secondary o_groupby_button d-flex align-items-center gap-1" title="Grouper par"
                    t-on-click.stop="() => this.toggleGroupByMenu()">
              Grouper par <i class="fa fa-angle-down"/>
            </button>
            <div t-if="state.groupByMenuOpen" class="dropdown-menu show o_groupby_menu"
                 style="position: absolute; top: 100%; left: 0; z-index: 1000; min-width: 200px;">
              <a href="#" t-att-class="'dropdown-item d-flex align-items-center gap-2' + (groups.current === null ? ' active' : '')"
                 t-on-click.stop="() => this.selectGroupBy(null)">
                Aucun groupe <i t-if="groups.current === null" class="fa fa-check ms-auto"/>
              </a>
              <a t-foreach="groups.available" t-as="g" t-key="g.name" href="#"
                 t-att-class="'dropdown-item d-flex align-items-center gap-2' + (groups.current === g.name ? ' active' : '')"
                 t-on-click.stop="() => this.selectGroupBy(g.name)">
                <t t-esc="g.label"/><i t-if="groups.current === g.name" class="fa fa-check ms-auto"/>
              </a>
            </div>
          </div>
          <div t-if="display.withSearch" class="o_cp_searchview d-flex input-group flex-grow-1" role="search">
            <div class="o_searchview form-control d-flex align-items-center py-1" role="search">
              <i class="o_searchview_icon d-print-none oi oi-search me-2"/>
              <div class="o_searchview_input_container d-flex flex-grow-1 flex-wrap gap-1">
                <input type="text" class="o_searchview_input border-0 flex-grow-1" placeholder="Rechercher..." t-on-input="onSearchInput"/>
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
    this.state = owl.useState({ groupByMenuOpen: false });

    // Fermeture du menu Grouper par au clic extérieur.
    owl.useExternalListener(document.body, "click", () => {
      if (this.state.groupByMenuOpen) this.state.groupByMenuOpen = false;
    });

    owl.onWillDestroy(() => clearTimeout(this.searchDebounceTimer));
  }

  toggleGroupByMenu() {
    this.state.groupByMenuOpen = !this.state.groupByMenuOpen;
  }

  selectGroupBy(name) {
    if (this.props.onGroupBy) this.props.onGroupBy(name);
    this.state.groupByMenuOpen = false;
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
