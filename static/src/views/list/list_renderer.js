/**
 * views/list/list_renderer.js
 * ===========================
 * Rendu de la vue LISTE par OWL -- même architecture qu'Odoo 17 : le
 * ListRenderer est un composant OWL à template STATIQUE (owl.xml),
 * alimenté par les colonnes parsées de l'arch (list_arch_parser.js).
 * Contrairement au kanban, l'arch liste n'est pas compilée en template :
 * elle décrit les colonnes d'un tableau générique.
 *
 * Fonctionnalités conservées à l'identique de l'ancien rendu DOM :
 *  - tri par colonne (icône de direction, tuple many2one trié par
 *    libellé, valeurs vides en dernier) ;
 *  - colonnes optionnelles (engrenage + préférences persistées par
 *    modèle, list_column_prefs.js) ;
 *  - sélection (case par ligne + tout sélectionner) ;
 *  - badges de sélection colorés via decoration-* ;
 *  - clic de ligne -> onRowClick(record.id).
 *
 * Montage asynchrone : mountListView() retourne { destroy } -- même
 * contrat que mountKanbanView() (consommateur : list_controller.js).
 */

import { mountOwlApp } from "../../owl/app.js";
import { parseListArch } from "./list_arch_parser.js";
import { formatCellValue, getDecorationClass } from "./list_renderer_utils.js";
import { loadOptionalColumnsState, saveOptionalColumnsState } from "./list_column_prefs.js";

export class ListRenderer extends owl.Component {
  static props = {
    columns: { type: Array }, // sortie de parseListArch (TOUTES les colonnes)
    records: { type: Array },
    fieldsInfo: { type: Object, optional: true },
    modelName: { type: String, optional: true },
    // nom du champ de regroupement (string) ou null -> table à plat
    groupBy: { optional: true },
    onRowClick: { type: Function, optional: true },
  };

  static template = owl.xml`
    <div class="o_list_view o_view_controller">
      <div class="o_list_renderer table-responsive">
        <table class="o_list_table table table-sm table-hover position-relative mb-0 o_list_table_ungrouped table-striped" style="table-layout: fixed;">
          <thead>
            <tr>
              <th class="o_list_record_selector align-middle pe-1" style="width: 41px;">
                <div class="o-checkbox form-check d-flex m-0">
                  <input type="checkbox" class="form-check-input" t-att-checked="isAllSelected" t-on-change="onToggleSelectAll"/>
                </div>
              </th>
              <th t-foreach="visibleColumns" t-as="col" t-key="col.field"
                  t-att-data-name="col.field"
                  class="align-middle o_column_sortable position-relative cursor-pointer"
                  t-on-click="() => this.onSort(col)">
                <div class="d-flex">
                  <span class="d-block min-w-0 text-truncate flex-grow-1" t-esc="col.label"/>
                  <i t-att-class="sortIcon(col.field)"/>
                </div>
              </th>
              <th class="o_list_actions_header position-relative" style="width: 32px;">
                <div t-if="optionalColumns.length > 0" class="position-relative">
                  <button type="button" class="btn btn-sm p-0 o_optional_columns_dropdown_toggle" title="Options d'affichage"
                          t-on-click.stop="() => this.toggleOptionalMenu()">
                    <i class="fa fa-sliders"/>
                  </button>
                  <div t-if="state.optionalMenuOpen" class="dropdown-menu show o_optional_columns_dropdown p-2"
                       style="position: absolute; top: 100%; right: 0; z-index: 1000; min-width: 220px;">
                    <div t-foreach="optionalColumns" t-as="col" t-key="col.field" class="dropdown-item py-1">
                      <label class="d-flex align-items-center gap-2 mb-0 w-100" style="cursor: pointer;">
                        <input type="checkbox" class="form-check-input m-0"
                               t-att-checked="state.optionalState[col.field]"
                               t-on-click.stop=""
                               t-on-change="(ev) => this.onToggleOptional(col, ev)"/>
                        <span t-esc="col.label"/>
                      </label>
                    </div>
                  </div>
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr t-if="isEmpty">
              <td t-att-colspan="visibleColumns.length + 2" class="text-center text-muted p-4">Aucun enregistrement.</td>
            </tr>
            <t t-else="" t-foreach="displayGroups" t-as="group" t-key="group.key">
              <tr t-if="group.header" class="o_group_header cursor-pointer" t-on-click="() => this.toggleGroup(group.key)">
                <td t-att-colspan="visibleColumns.length + 2" class="o_group_name">
                  <div class="d-flex align-items-center gap-2">
                    <i t-att-class="'fa fa-caret-' + (group.folded ? 'right' : 'down')"/>
                    <span t-esc="group.label"/>
                    <span class="o_group_count text-muted">(<t t-esc="group.records.length"/>)</span>
                    <span t-if="group.sums.length > 0" class="ms-auto d-flex gap-3 pe-3">
                      <span t-foreach="group.sums" t-as="sumEntry" t-key="sumEntry.field" class="fw-bold" t-esc="sumEntry.text"/>
                    </span>
                  </div>
                </td>
              </tr>
              <tr t-if="!group.folded" t-foreach="group.records" t-as="record" t-key="group.key + '-' + record.id"
                  class="o_data_row cursor-pointer"
                  t-on-click="() => this.onRowClick(record)">
                <td class="o_list_record_selector user-select-none">
                  <div class="o-checkbox form-check">
                    <input type="checkbox" class="form-check-input"
                           t-att-checked="isSelected(record)"
                           t-on-click.stop=""
                           t-on-change="(ev) => this.onToggleSelect(record, ev)"/>
                  </div>
                </td>
                <td t-foreach="visibleColumns" t-as="col" t-key="col.field" class="o_data_cell o_field_cell">
                  <span t-if="isBadge(col)"
                        t-att-class="'badge rounded-pill ' + badgeClass(record, col)"
                        t-esc="cellText(record, col)"/>
                  <span t-elif="isBoldNumber(col)" class="fw-bold" t-esc="cellText(record, col)"/>
                  <span t-else="" t-esc="cellText(record, col)"/>
                </td>
                <td/>
              </tr>
            </t>
          </tbody>
        </table>
      </div>
    </div>`;

  setup() {
    const optionalFieldsList = this.props.columns.filter(
      (c) => c.optional === "show" || c.optional === "hide"
    );
    // Préférences de colonnes optionnelles (persistées par modèle).
    const optionalState = loadOptionalColumnsState(
      this.props.modelName,
      optionalFieldsList.map((c) => ({ field: c.field, defaultVisible: c.optional === "show" }))
    );

    this.state = owl.useState({
      optionalState,
      optionalMenuOpen: false,
      sortColumn: null,
      sortAsc: true,
      selected: [], // ids sélectionnés (tableau réactif)
      groupBy: this.props.groupBy || null,
      foldedGroups: {}, // clé de groupe -> booléen (pliable de façon réactive)
    });

    // Fermeture du menu optionnel au clic extérieur (hook OWL, retiré
    // automatiquement à la destruction -- l'ancien rendu posait un
    // listener document global à nettoyer à la main).
    owl.useExternalListener(document.body, "click", () => {
      if (this.state.optionalMenuOpen) this.state.optionalMenuOpen = false;
    });
  }

  // -------------------------------------------------------------------------
  // Colonnes
  // -------------------------------------------------------------------------

  get optionalColumns() {
    return this.props.columns.filter((c) => c.optional === "show" || c.optional === "hide");
  }

  get visibleColumns() {
    return this.props.columns.filter((c) => {
      if (c.optional === "show" || c.optional === "hide") {
        return !!this.state.optionalState[c.field];
      }
      return true;
    });
  }

  toggleOptionalMenu() {
    this.state.optionalMenuOpen = !this.state.optionalMenuOpen;
  }

  // -------------------------------------------------------------------------
  // Group by (Odoo : GroupByMenu + lignes d'en-tête de groupe) -- les
  // groupes portent sur les enregistrements de la PAGE courante (le
  // regroupement serveur, lui, est hors périmètre du cache local).
  // -------------------------------------------------------------------------

  toggleGroup(groupKey) {
    this.state.foldedGroups[groupKey] = !this.state.foldedGroups[groupKey];
  }

  get isEmpty() {
    return this.displayGroups.every((g) => g.records.length === 0);
  }

  get displayGroups() {
    const groupBy = this.state.groupBy;
    if (!groupBy) {
      // Table à plat : un seul "groupe" sans en-tête.
      return [{ key: "__all__", header: false, folded: false, records: this.sortedRecords, sums: [] }];
    }
    const info = (this.props.fieldsInfo || {})[groupBy];
    const map = new Map();
    for (const record of this.sortedRecords) {
      const raw = record[groupBy];
      const key =
        raw === false || raw === undefined || raw === null || raw === ""
          ? "__none__"
          : Array.isArray(raw)
            ? String(raw[0])
            : String(raw);
      if (!map.has(key)) map.set(key, { rawValue: raw, records: [] });
      map.get(key).records.push(record);
    }
    const groups = [...map.entries()].map(([key, { rawValue, records }]) => ({
      key: `${groupBy}:${key}`,
      header: true,
      folded: !!this.state.foldedGroups[`${groupBy}:${key}`],
      records,
      label: groupLabel(rawValue, info),
      sums: computeGroupSums(records, this.visibleColumns, this.props.fieldsInfo || {}),
    }));
    // Ordre des groupes par libellé (le groupe "Aucun" remonte tôt).
    groups.sort((a, b) => a.label.localeCompare(b.label, "fr"));
    return groups;
  }

  onToggleOptional(col, ev) {
    this.state.optionalState[col.field] = ev.target.checked;
    saveOptionalColumnsState(this.props.modelName, { ...this.state.optionalState });
  }

  // -------------------------------------------------------------------------
  // Tri (client, comme l'ancien rendu : tuple many2one par libellé,
  // valeurs vides en dernier, inversion au second clic)
  // -------------------------------------------------------------------------

  onSort(col) {
    if (this.state.sortColumn === col.field) {
      this.state.sortAsc = !this.state.sortAsc;
    } else {
      this.state.sortColumn = col.field;
      this.state.sortAsc = true;
    }
  }

  sortIcon(field) {
    if (this.state.sortColumn !== field) return "fa fa-lg fa-angle-down opacity-0";
    return `fa fa-lg fa-angle-${this.state.sortAsc ? "down" : "up"}`;
  }

  get sortedRecords() {
    const { sortColumn, sortAsc } = this.state;
    const records = [...(this.props.records || [])];
    if (!sortColumn) return records;

    records.sort((a, b) => {
      const va = a[sortColumn], vb = b[sortColumn];
      const sa = Array.isArray(va) ? va[1] : va;
      const sb = Array.isArray(vb) ? vb[1] : vb;
      if (sa === sb) return 0;
      if (sa === false || sa === undefined) return 1;
      if (sb === false || sb === undefined) return -1;
      return (sa > sb ? 1 : -1) * (sortAsc ? 1 : -1);
    });
    return records;
  }

  // -------------------------------------------------------------------------
  // Sélection
  // -------------------------------------------------------------------------

  isSelected(record) {
    return this.state.selected.includes(record.id);
  }

  get isAllSelected() {
    const records = this.props.records || [];
    return records.length > 0 && records.every((r) => this.state.selected.includes(r.id));
  }

  onToggleSelectAll(ev) {
    this.state.selected = ev.target.checked
      ? (this.props.records || []).map((r) => r.id)
      : [];
  }

  onToggleSelect(record, ev) {
    const selected = this.state.selected.filter((id) => id !== record.id);
    if (ev.target.checked) selected.push(record.id);
    this.state.selected = selected;
  }

  onRowClick(record) {
    if (this.props.onRowClick) this.props.onRowClick(record.id);
  }

  // -------------------------------------------------------------------------
  // Cellules (même rendu que l'ancien renderListCell, côté template)
  // -------------------------------------------------------------------------

  cellText(record, col) {
    const info = (this.props.fieldsInfo || {})[col.field];
    const value = record[col.field];
    if (info && info.type === "monetary") {
      // comme renderListCell : montant à 2 décimales (0.00 si vide)
      return value ? Number(value).toFixed(2) : "0.00";
    }
    if (info && info.type === "float") {
      return value ? Number(value).toFixed(2) : "0.00";
    }
    if (info && info.type === "many2one") {
      return Array.isArray(value) ? value[1] : (value || "");
    }
    if (info && info.type === "boolean") {
      return value ? "✓" : "";
    }
    return formatCellValue(value, info);
  }

  isBadge(col) {
    const info = (this.props.fieldsInfo || {})[col.field];
    return !!info && info.type === "selection";
  }

  isBoldNumber(col) {
    const info = (this.props.fieldsInfo || {})[col.field];
    return !!info && (info.type === "monetary" || info.type === "float");
  }

  badgeClass(record, col) {
    return getDecorationClass(col.decoration, record);
  }
}

/**
 * Libellé d'un groupe selon le type du champ de regroupement (tuple
 * many2one -> libellé, selection -> libellé, boolean -> Oui/Non,
 * vide -> "Aucun"), comme le GroupByMenu natif.
 */
function groupLabel(rawValue, info) {
  // Un boolean false est une valeur légitime ("Non"), pas un vide.
  if (info && info.type === "boolean") return rawValue ? "Oui" : "Non";
  if (rawValue === false || rawValue === undefined || rawValue === null || rawValue === "") {
    return "Aucun";
  }
  if (Array.isArray(rawValue)) return rawValue[1] || "Aucun";
  if (info && info.type === "selection") {
    const found = (info.selection || []).find(([v]) => String(v) === String(rawValue));
    return found ? found[1] : String(rawValue);
  }
  return String(rawValue);
}

/**
 * Sommes des colonnes numériques visibles (monetary/float), affichées
 * dans l'en-tête de groupe.
 */
function computeGroupSums(records, columns, fieldsInfo) {
  const sums = [];
  for (const col of columns) {
    const info = fieldsInfo[col.field];
    if (!info || (info.type !== "monetary" && info.type !== "float")) continue;
    const total = records.reduce((acc, r) => acc + (Number(r[col.field]) || 0), 0);
    sums.push({ field: col.field, text: total.toFixed(2) });
  }
  return sums;
}

/**
 * Monte le renderer OWL de la liste dans `target`.
 * @returns {Promise<{ destroy: Function }>} même contrat que
 *   mountKanbanView (consommateur : list_controller.js).
 */
export async function mountListView(target, archXml, fieldsInfo, records, onRowClick, modelName = null, groupBy = null) {
  const parsed = parseListArch(archXml, fieldsInfo || {});

  if (parsed.error) {
    console.warn("[list_renderer]", parsed.error);
    const errDiv = document.createElement("div");
    errDiv.className = "o_list_view text-muted p-3";
    errDiv.textContent = `Vue liste non disponible. (${parsed.error})`;
    target.appendChild(errDiv);
    return { destroy() {} };
  }

  const { destroy } = await mountOwlApp(
    ListRenderer,
    target,
    {
      columns: parsed.columns,
      records: records || [],
      fieldsInfo: fieldsInfo || {},
      modelName,
      groupBy,
      onRowClick,
    }
  );

  return { destroy };
}
