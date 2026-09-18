/**
 * views/fields/one2many/one2many_field.js
 * =======================================
 * Widget de champ One2many rendu par OWL -- même architecture qu'Odoo :
 * le renderer embarque des SOUS-COMPOSANTS OWL par cellule (les widgets
 * de champ de views/fields/), l'état des lignes est un tableau
 * réactif, et les recalculs métier passent par rules_engine
 * (runLineRules / checkOndeleteGuard) comme les compute Odoo.
 *
 * Contrat impératif exposé sur l'hôte DOM (via field_bridge ->
 * _attachToHost), consommé par form_serializer.js / form_controller.js :
 *   - host._owlOne2many            : marqueur de l'implémentation OWL ;
 *   - host.getLines()              : valeurs canoniques des lignes,
 *     suppressions de lignes initiales matérialisées {id, _deleted:true} ;
 *   - host.getLineIds()            : ids des lignes présentes ;
 *   - host.applyLineUpdates(rows)  : fusionne les valeurs recalculées par
 *     runDocumentRules (champ en cours de saisie épargné) ;
 *   - host.adjustLineFields(id, deltas) : applique les deltas du ledger
 *     local (qty_received/qty_delivered...) sur une ligne.
 *
 * Le total du pied de table est réactif (recalculé à chaque mutation) --
 * il remplace l'ancien compute_engine.js (supprimé), qui relisait le DOM.
 * Le catalogue produits reste un overlay DOM autonome
 * (product_catalog.js), inséré dans un host dédié du template OWL.
 */

import { renderOwlField } from "../../../owl/field_bridge.js";
import { evaluateSimpleCondition } from "../../../core/py_js/py_utils.js";
import { runLineRules, checkOndeleteGuard } from "../../../model/rules_engine/rules_engine.js";
import { getApiKey, CONFIG } from "../../../core/browser/session.js";
import { getCatalogProductsSmart } from "../../../core/catalog_cache.js";
import { getReferenceRecords } from "../../../core/reference_cache.js";
import { db } from "../../../core/orm_service.js";
import { detectCatalogFieldNames, renderProductCatalog } from "../product_catalog/product_catalog.js";

import { CharFieldOwl } from "../char/char_field.js";
import { TextFieldOwl } from "../text/text_field.js";
import { IntegerFieldOwl } from "../integer/integer_field.js";
import { FloatFieldOwl } from "../float/float_field.js";
import { BooleanFieldOwl } from "../boolean/boolean_field.js";
import { SelectionFieldOwl } from "../selection/selection_field.js";
import { DateFieldOwl } from "../date/date_field.js";
import { DatetimeFieldOwl } from "../datetime/datetime_field.js";
import { MonetaryFieldOwl } from "../monetary/monetary_field.js";
import { Many2oneFieldOwl } from "../many2one/many2one_field.js";
import { Many2manyTagsFieldOwl } from "../many2many_tags/many2many_tags_field.js";

// "quantity" = Odoo 17, "qty_done" = versions antérieures.
const QTY_FIELD_CANDIDATES = ["product_uom_qty", "product_qty", "quantity", "qty"];

let one2manyItemCounter = 0;

/**
 * Désenveloppe les tuples many2one [id, "Libellé"] des données serveur en
 * id brut -- les valeurs des lignes sont toujours canoniques (ids), comme
 * ce que produisait getElementValue() sur l'ancien rendu DOM.
 */
function normalizeRowValues(rowData, columns) {
  const values = { ...(rowData || {}) };
  for (const col of columns) {
    if (col.type === "many2one" && Array.isArray(values[col.field])) {
      values[col.field] = values[col.field][0];
    }
  }
  return values;
}

/**
 * Extrait les libellés des tuples many2one [id, "Libellé"] des données
 * serveur (comme le webclient natif, qui affiche le display_name du
 * record lu par le serveur sans le résoudre localement). Le sous-composant
 * many2one reçoit ainsi le tuple complet : affichage SYNCHRONE, aucune
 * résolution asynchrone (par le cache de référence) dans la table.
 */
function extractRowLabels(rowData, columns) {
  const labels = {};
  if (!rowData) return labels;
  for (const col of columns) {
    const value = rowData[col.field];
    if (col.type === "many2one" && Array.isArray(value) && value.length >= 2) {
      labels[col.field] = value[1];
    }
  }
  return labels;
}

export class One2manyFieldOwl extends owl.Component {
  static template = owl.xml`
    <div class="o_field_one2many" t-ref="root">
      <div t-att-class="'o_list_renderer table-responsive' + (state.catalogOpen ? ' d-none' : '')">
        <table class="o_list_table table table-sm">
          <thead>
            <tr>
              <th t-foreach="state.columns" t-as="col" t-key="col.field" t-att-class="cellClass(col)" t-esc="col.label"/>
              <th class="o_list_controller o_list_actions_header position-sticky end-0" style="position:relative;">
                <div t-if="optionalColumns.length > 0" class="o-dropdown dropdown o_optional_columns_dropdown text-center o-dropdown--no-caret" style="position:relative;">
                  <button type="button" class="dropdown-toggle btn p-0" tabindex="-1" aria-expanded="false"
                          t-on-click="(ev) => this.toggleColMenu(ev)">
                    <i class="o_optional_columns_dropdown_toggle oi oi-fw oi-settings-adjust"/>
                  </button>
                  <div t-if="state.colMenuOpen" role="menu"
                       class="o_optional_columns_dropdown o-dropdown--menu dropdown-menu"
                       style="position:absolute; top:100%; right:0; display:block; z-index:1000;">
                    <span t-foreach="optionalColumns" t-as="col" t-key="col.field" class="dropdown-item" role="menuitem" tabindex="0">
                      <div class="o-checkbox form-check">
                        <input type="checkbox" class="form-check-input"
                               t-att-id="'pwa-optcol-' + props.name + '-' + col.field"
                               t-att-checked="col.visible"
                               t-on-change="(ev) => this.toggleColumn(col, ev)"/>
                        <label class="form-check-label" t-att-for="'pwa-optcol-' + props.name + '-' + col.field" t-esc="col.label"/>
                      </div>
                    </span>
                  </div>
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            <t t-foreach="state.items" t-as="item" t-key="item.uid">
              <tr t-if="item.kind !== 'line'" class="o_data_row">
                <td t-att-colspan="state.columns.length + 1">
                  <input type="text" class="o_input border-0 w-100 fw-bold"
                         t-att-value="item.text"
                         t-att-placeholder="item.kind === 'section' ? state.labels.section : state.labels.note"
                         t-on-input="(ev) => this.onSectionInput(item, ev)"/>
                </td>
              </tr>
              <tr t-else="" class="o_data_row">
                <td t-foreach="state.columns" t-as="col" t-key="col.field"
                    t-att-class="cellClass(col)"
                    t-att-data-line-uid="item.uid"
                    t-att-data-line-field="col.field">
                  <FieldChar t-if="col.type === 'char'"
                             t-key="'cell-' + item.uid + '-' + col.field"
                             id="'field-' + props.name + '__' + col.field + '__' + item.uid"
                             name="props.name + '__' + col.field + '__' + item.uid"
                             initialValue="item.values[col.field]"
                             onChange="(v) => this.onCellChange(item, col, v)"/>
                  <FieldText t-elif="col.type === 'text'"
                             t-key="'cell-' + item.uid + '-' + col.field"
                             id="'field-' + props.name + '__' + col.field + '__' + item.uid"
                             name="props.name + '__' + col.field + '__' + item.uid"
                             initialValue="item.values[col.field]"
                             onChange="(v) => this.onCellChange(item, col, v)"/>
                  <FieldInteger t-elif="col.type === 'integer'"
                                t-key="'cell-' + item.uid + '-' + col.field"
                                id="'field-' + props.name + '__' + col.field + '__' + item.uid"
                                name="props.name + '__' + col.field + '__' + item.uid"
                                initialValue="item.values[col.field]"
                                onChange="(v) => this.onCellChange(item, col, v)"/>
                  <FieldFloat t-elif="col.type === 'float'"
                              t-key="'cell-' + item.uid + '-' + col.field"
                              id="'field-' + props.name + '__' + col.field + '__' + item.uid"
                              name="props.name + '__' + col.field + '__' + item.uid"
                              initialValue="item.values[col.field]"
                              onChange="(v) => this.onCellChange(item, col, v)"/>
                  <FieldBoolean t-elif="col.type === 'boolean'"
                                t-key="'cell-' + item.uid + '-' + col.field"
                                id="'field-' + props.name + '__' + col.field + '__' + item.uid"
                                name="props.name + '__' + col.field + '__' + item.uid"
                                initialValue="item.values[col.field] ? true : false"
                                onChange="(v) => this.onCellChange(item, col, v)"/>
                  <FieldSelection t-elif="col.type === 'selection'"
                                  t-key="'cell-' + item.uid + '-' + col.field"
                                  id="'field-' + props.name + '__' + col.field + '__' + item.uid"
                                  name="props.name + '__' + col.field + '__' + item.uid"
                                  options="col.selection or []"
                                  initialValue="item.values[col.field]"
                                  onChange="(v) => this.onCellChange(item, col, v)"/>
                  <FieldDate t-elif="col.type === 'date'"
                             t-key="'cell-' + item.uid + '-' + col.field"
                             id="'field-' + props.name + '__' + col.field + '__' + item.uid"
                             name="props.name + '__' + col.field + '__' + item.uid"
                             initialValue="item.values[col.field]"
                             onChange="(v) => this.onCellChange(item, col, v)"/>
                  <FieldDatetime t-elif="col.type === 'datetime'"
                                 t-key="'cell-' + item.uid + '-' + col.field"
                                 id="'field-' + props.name + '__' + col.field + '__' + item.uid"
                                 name="props.name + '__' + col.field + '__' + item.uid"
                                 initialValue="item.values[col.field]"
                                 onChange="(v) => this.onCellChange(item, col, v)"/>
                  <FieldMonetary t-elif="col.type === 'monetary'"
                                 t-key="'cell-' + item.uid + '-' + col.field"
                                 id="'field-' + props.name + '__' + col.field + '__' + item.uid"
                                 name="props.name + '__' + col.field + '__' + item.uid"
                                 initialValue="item.values[col.field]"/>
                  <FieldMany2One t-elif="col.type === 'many2one'"
                                 t-key="'cell-' + item.uid + '-' + col.field"
                                 id="'field-' + props.name + '__' + col.field + '__' + item.uid"
                                 name="props.name + '__' + col.field + '__' + item.uid"
                                 relation="col.relation or ''"
                                 initialValue="item.labels[col.field] !== undefined ? [item.values[col.field], item.labels[col.field]] : item.values[col.field]"
                                 onChange="(v) => this.onCellChange(item, col, v)"/>
                  <FieldMany2ManyTags t-elif="col.type === 'many2many'"
                                      t-key="'cell-' + item.uid + '-' + col.field"
                                      id="'field-' + props.name + '__' + col.field + '__' + item.uid"
                                      name="props.name + '__' + col.field + '__' + item.uid"
                                      relation="col.relation or ''"
                                      initialValue="item.values[col.field]"
                                      onChange="(v) => this.onCellChange(item, col, v)"/>
                  <span t-else=""/>
                </td>
                <td class="o_list_record_remove text-center">
                  <button type="button" class="fa fa-trash-o" aria-label="Supprimer la ligne"
                          t-on-click="() => this.removeLine(item)"/>
                </td>
              </tr>
            </t>
            <tr>
              <td class="o_field_x2many_list_row_add" t-att-colspan="state.columns.length + 1">
                <a href="#" t-on-click="(ev) => this.onAddClick(ev)" t-esc="state.labels.default"/>
                <a t-if="state.labels.section" href="#" class="ml16" t-on-click="(ev) => this.onAddSectionClick(ev)" t-esc="state.labels.section"/>
                <a t-if="state.labels.note" href="#" class="ml16" t-on-click="(ev) => this.onAddNoteClick(ev)" t-esc="state.labels.note"/>
                <button t-if="state.labels.catalog" type="button" class="btn px-4 btn-link ml16"
                        t-on-click="() => this.openCatalog()" t-esc="state.labels.catalog.string || 'Catalogue'"/>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div t-if="state.catalogOpen" t-ref="overlayHost"/>
      <div class="text-end fw-bold mt-2 pe-3" style="font-size:1.1em;" t-esc="totalLabel"/>
    </div>
  `;

  static components = {
    FieldChar: CharFieldOwl,
    FieldText: TextFieldOwl,
    FieldInteger: IntegerFieldOwl,
    FieldFloat: FloatFieldOwl,
    FieldBoolean: BooleanFieldOwl,
    FieldSelection: SelectionFieldOwl,
    FieldDate: DateFieldOwl,
    FieldDatetime: DatetimeFieldOwl,
    FieldMonetary: MonetaryFieldOwl,
    FieldMany2One: Many2oneFieldOwl,
    FieldMany2ManyTags: Many2manyTagsFieldOwl,
  };

  static props = {
    name: String,
    columns: { type: Array, optional: true },
    labels: { type: Object, optional: true },
    subFields: { type: Object, optional: true },
    lineModel: { type: String, optional: true },
    initialValue: { type: Array, optional: true },
    parentValues: { type: Object, optional: true },
  };

  setup() {
    this.rootRef = owl.useRef("root");
    this.overlayHostRef = owl.useRef("overlayHost");

    const columns = (this.props.columns || []).map((col) => ({ ...col }));
    const initialRows = Array.isArray(this.props.initialValue) ? this.props.initialValue : [];

    const items = initialRows.map((rowData) => this.makeLineItem(rowData));
    this.initialLineIds = new Set(items.filter((it) => it.id).map((it) => it.id));

    this.state = owl.useState({
      columns,
      items,
      labels: this.props.labels || { default: "Ajouter une ligne", section: null, note: null, catalog: null },
      colMenuOpen: false,
      catalogOpen: false,
      total: 0,
      currency: { symbol: "", position: "after" },
    });

    this.catalogProducts = null;

    this.computeTotal();

    owl.onWillStart(async () => {
      const rawCurrency = this.props.parentValues && this.props.parentValues.currency_id;
      // initialValues peut fournir un tuple [id, "Libellé"] (lecture serveur)
      const currencyId = Array.isArray(rawCurrency) ? rawCurrency[0] : rawCurrency;
      if (!currencyId) return;
      try {
        const currencies = await getReferenceRecords("res.currency");
        const found = currencies.find((c) => c.id === currencyId);
        if (found) {
          this.state.currency = {
            symbol: found.symbol || found.display_name || "",
            position: found.position === "before" ? "before" : "after",
          };
          this.computeTotal();
        }
      } catch (err) {
        console.warn("Impossible de résoudre la devise:", err);
      }
    });
  }

  /**
   * Publie les API impératives sur l'hôte DOM (conteneur créé par
   * field_bridge) -- consommées par form_serializer/form_controller,
   * qui n'ont plus à scraper le DOM des lignes.
   */
  _attachToHost(host) {
    host._owlOne2many = true;
    host.getLines = () => this.getLines();
    host.getLineIds = () => this.getLineIds();
    host.applyLineUpdates = (rows) => this.applyLineUpdates(rows);
    host.adjustLineFields = (lineId, deltasByField) => this.adjustLineFields(lineId, deltasByField);
  }

  // -------------------------------------------------------------------------
  // State dérivé
  // -------------------------------------------------------------------------

  get lineItems() {
    return this.state.items.filter((it) => it.kind === "line");
  }

  get optionalColumns() {
    return this.state.columns.filter((c) => c.optional === "show" || c.optional === "hide");
  }

  get totalLabel() {
    const total = Number(this.state.total).toLocaleString("fr-FR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    const { symbol, position } = this.state.currency;
    if (!symbol) return `Total: ${total}`;
    return position === "before" ? `Total: ${symbol} ${total}` : `Total: ${total} ${symbol}`;
  }

  cellClass(col) {
    return `o2m-col-${this.props.name}-${col.field}${col.visible ? "" : " d-none"}`;
  }

  // -------------------------------------------------------------------------
  // Lignes : création, suppression, saisie
  // -------------------------------------------------------------------------

  makeLineItem(rowData = {}) {
    const columns = this.state ? this.state.columns : this.props.columns || [];
    return {
      uid: ++one2manyItemCounter,
      kind: "line",
      id: rowData.id || null,
      values: normalizeRowValues(rowData, columns),
      labels: extractRowLabels(rowData, columns),
    };
  }

  makeTextItem(kind) {
    return { uid: ++one2manyItemCounter, kind, text: "" };
  }

  onAddClick(ev) {
    ev.preventDefault();
    this.state.items.push(this.makeLineItem({}));
  }

  onAddSectionClick(ev) {
    ev.preventDefault();
    this.state.items.push(this.makeTextItem("section"));
  }

  onAddNoteClick(ev) {
    ev.preventDefault();
    this.state.items.push(this.makeTextItem("note"));
  }

  onSectionInput(item, ev) {
    item.text = ev.target.value;
  }

  /**
   * Valeur canonique saisie dans une cellule (émise par le sous-composant
   * OWL du champ) : met à jour la ligne puis enchaîne les règles métier
   * compute/onchange du modèle de ligne (ex: _compute_amount).
   */
  onCellChange(item, col, value) {
    item.values[col.field] = value;
    let modelUpdates = {};
    if (this.props.lineModel) {
      modelUpdates = runLineRules(this.props.lineModel, { ...item.values }, {
        changedFields: [col.field],
      });
      for (const [field, v] of Object.entries(modelUpdates)) {
        item.values[field] = v;
      }
    }
    // Repli générique (remplace compute_engine.computeLineSubtotal, supprimé) :
    // si aucune règle spécifique au modèle n'a recalculé les montants,
    // qty * price -> price_subtotal/price_total.
    if (!("price_subtotal" in modelUpdates)) {
      this.applyGenericLineAmount(item, col.field);
    }
    this.computeTotal();
  }

  /**
   * qty * price générique pour UNE ligne, via la règle "*" de
   * rules/generic_rules.js (clés canoniques __qty/__price). Ne touche que
   * les modèles qui exposent les champs standard price_subtotal/price_total.
   */
  applyGenericLineAmount(item, changedField) {
    const v = item.values;
    const qtyField = QTY_FIELD_CANDIDATES.find((f) => f in v) || null;
    const priceField = "price_unit" in v ? "price_unit" : null;
    const touchesAmounts = changedField === qtyField || changedField === priceField;
    if (!qtyField || !priceField || !touchesAmounts) return;
    const updates = runLineRules("*", { __qty: Number(v[qtyField]) || 0, __price: Number(v[priceField]) || 0 }, {
      changedFields: ["__qty", "__price"],
    });
    const subtotal = updates.__subtotal;
    if (subtotal === undefined) return;
    if ("price_subtotal" in v) v.price_subtotal = subtotal;
    if ("price_total" in v) v.price_total = subtotal;
  }

  removeLine(item) {
    // Règle ondelete_guard -- aucune n'existe encore dans rules/ pour
    // purchase.order.line/sale.order.line, mais le point de branchement
    // est actif : dès qu'une règle sera ajoutée (ex: interdire la
    // suppression d'une ligne déjà facturée), elle sera respectée ici.
    if (this.props.lineModel) {
      const rowValues = { ...item.values };
      if (item.id) rowValues.id = item.id;
      const guard = checkOndeleteGuard(this.props.lineModel, rowValues);
      if (!guard.valid) {
        alert(guard.message || "Suppression bloquée par une règle métier.");
        return;
      }
    }
    this.removeItem(item);
    this.computeTotal();
  }

  removeItem(item) {
    const idx = this.state.items.indexOf(item);
    if (idx !== -1) this.state.items.splice(idx, 1);
  }

  // -------------------------------------------------------------------------
  // API impératives (host)
  // -------------------------------------------------------------------------

  getLines() {
    const lines = this.lineItems.map((it) => {
      const values = { ...it.values };
      if (it.id) values.id = it.id;
      return values;
    });
    const currentIds = new Set(this.lineItems.filter((it) => it.id).map((it) => it.id));
    for (const initialId of this.initialLineIds) {
      if (!currentIds.has(initialId)) {
        lines.push({ id: initialId, _deleted: true });
      }
    }
    return lines;
  }

  getLineIds() {
    return this.lineItems.filter((it) => it.id).map((it) => it.id);
  }

  /**
   * Fusionne les valeurs recalculées par runDocumentRules() sur les lignes
   * (même ordre que le graphe du moteur). Le champ en cours de saisie est
   * épargné, comme applyLineRowToDom() le faisait sur l'ancien rendu.
   */
  applyLineUpdates(rows) {
    const lineItems = this.lineItems;
    (rows || []).forEach((row, idx) => {
      const item = lineItems[idx];
      if (!item) return;
      for (const [field, value] of Object.entries(row)) {
        if (field === "id") continue;
        const cellEl = this.rootRef.el
          ? this.rootRef.el.querySelector(`[data-line-uid="${item.uid}"][data-line-field="${field}"]`)
          : null;
        const input = cellEl ? cellEl.querySelector("input, select, textarea") : null;
        if (input && input === document.activeElement) continue;
        // Tuple serveur [id, "Libellé"] : valeur canonique + libellé.
        if (Array.isArray(value) && value.length >= 2) {
          item.values[field] = value[0];
          item.labels[field] = value[1];
        } else {
          if (item.values[field] !== value && item.labels[field] !== undefined) {
            delete item.labels[field]; // id changé sans libellé : ne pas garder l'ancien
          }
          item.values[field] = value;
        }
      }
    });
    this.computeTotal();
  }

  /**
   * Applique les deltas du ledger local (voir rules/stock_rules.js) sur
   * une ligne identifiée par son id serveur (ex: qty_received après la
   * validation hors-ligne d'une réception).
   */
  adjustLineFields(lineId, deltasByField) {
    const item = this.lineItems.find(
      (it) => it.id === lineId || String(it.id) === String(lineId)
    );
    if (!item) return;
    for (const [field, delta] of Object.entries(deltasByField || {})) {
      const base = Number(item.values[field]) || 0;
      item.values[field] = base + delta;
    }
    this.computeTotal();
  }

  // -------------------------------------------------------------------------
  // Total réactif (remplace compute_engine.js)
  // -------------------------------------------------------------------------

  computeTotal() {
    let total = 0;
    for (const item of this.lineItems) {
      const v = item.values;

      // price_total (ou à défaut price_subtotal) est calculé par la règle
      // _compute_amount de rules_engine -- on le réutilise au lieu de
      // refaire qty*price ici, ce qui dupliquait la règle métier.
      if (v.price_total !== undefined && v.price_total !== false && v.price_total !== null && v.price_total !== "") {
        total += Number(v.price_total) || 0;
        continue;
      }
      if (v.price_subtotal !== undefined && v.price_subtotal !== false && v.price_subtotal !== null && v.price_subtotal !== "") {
        total += Number(v.price_subtotal) || 0;
        continue;
      }

      // Fallback générique (modèle sans règle spécifique) : qty * price
      // via la règle "*" de rules/generic_rules.js.
      const qtyField = QTY_FIELD_CANDIDATES.find((f) => f in v);
      const priceField = "price_unit" in v ? "price_unit" : null;
      const qty = qtyField ? Number(v[qtyField]) || 0 : 0;
      const price = priceField ? Number(v[priceField]) || 0 : 0;
      const updates = runLineRules("*", { __qty: qty, __price: price }, {
        changedFields: ["__qty", "__price"],
      });
      total += updates.__subtotal || 0;
    }
    this.state.total = total;
  }

  // -------------------------------------------------------------------------
  // Catalogue produits (overlay DOM dans un host OWL)
  // -------------------------------------------------------------------------

  toggleColMenu(ev) {
    ev.stopPropagation();
    this.state.colMenuOpen = !this.state.colMenuOpen;
  }

  toggleColumn(col, ev) {
    col.visible = ev.target.checked;
  }

  /**
   * Lit la valeur courante du champ partner_id du formulaire parent
   * directement depuis le DOM (pas le snapshot parentValues, figé au
   * premier rendu) -- comportement historique du moteur.
   */
  getPartnerIdFromForm() {
    const formRoot = this.rootRef.el ? this.rootRef.el.closest(".o_form_view") : null;
    const hiddenInput = formRoot
      ? formRoot.querySelector('input[name="partner_id_id"]')
      : null;
    if (!hiddenInput) return null;
    const raw = hiddenInput.value || "";
    if (!raw || raw.startsWith("tmp:")) return null; // création locale non synchronisée
    const id = parseInt(raw, 10);
    return isNaN(id) ? null : id;
  }

  getExistingQuantities(qtyField) {
    const map = {};
    for (const item of this.lineItems) {
      const pid = item.values.product_id;
      if (!pid || String(pid).startsWith("tmp:")) continue;
      const qty = Number(item.values[qtyField]) || 0;
      map[pid] = (map[pid] || 0) + qty;
    }
    return map;
  }

  async openCatalog() {
    const renderedFieldSet = new Set(this.state.columns.map((c) => c.field));
    const { productFields, qtyField } = detectCatalogFieldNames(this.props.subFields, renderedFieldSet);
    if (productFields.length === 0 || !qtyField || !productFields.includes("product_id")) {
      alert("Catalogue indisponible : champs produit/quantité non détectés pour ce modèle.");
      return;
    }

    const partnerId = this.getPartnerIdFromForm();
    if (!partnerId) {
      alert("Veuillez sélectionner un client (ou fournisseur) avant d'ouvrir le catalogue.");
      return;
    }

    const catalogModel = this.rootRef.el
      ? this.rootRef.el.closest("[data-model]")?.dataset.model
      : null;
    if (!catalogModel) {
      alert("Impossible de déterminer le modèle du document courant.");
      return;
    }

    const apiKey = getApiKey();
    const products = await getCatalogProductsSmart(catalogModel, partnerId, apiKey, CONFIG.ODOO_BASE_URL);
    if (!products || products.length === 0) {
      alert("Aucun produit disponible dans le catalogue (hors-ligne sans cache, ou catalogue vide).");
      return;
    }

    this.catalogProducts = products;
    const existingQuantities = this.getExistingQuantities(qtyField);

    const overlay = renderProductCatalog(
      products,
      existingQuantities,
      async (finalQuantities) => {
        await this.applyCatalogSelection(finalQuantities, existingQuantities, productFields, qtyField);
        this.state.catalogOpen = false;
      },
      "Retour"
    );

    this.state.catalogOpen = true;
    // Laisser OWL rendre le host (t-if) avant d'y insérer l'overlay DOM.
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (this.overlayHostRef.el) {
      this.overlayHostRef.el.appendChild(overlay);
    }
  }

  /**
   * Répercute les quantités choisies dans le catalogue sur l'état
   * réactif des lignes : mise à jour/suppression des lignes existantes,
   * création des nouvelles (avec règles onchange produit + compute
   * montants, le catalogue servant de snapshot "db").
   */
  async applyCatalogSelection(finalQuantities, previousQuantities, productFields, qtyField) {
    const subFields = this.props.subFields || {};
    const productsById = {};
    (this.catalogProducts || []).forEach((p) => (productsById[p.id] = p));

    const referencesToCache = [];
    const pendingNewRows = [];

    Object.entries(finalQuantities).forEach(([productIdStr, qty]) => {
      const productId = parseInt(productIdStr, 10);
      const previousQty = previousQuantities[productId] || 0;
      if (qty === previousQty) return;

      const existingItem = this.lineItems.find(
        (it) => Number(it.values.product_id) === productId
      );

      if (qty === 0 && existingItem) {
        this.removeItem(existingItem);
        return;
      }

      const product = productsById[productId];

      if (existingItem) {
        existingItem.values[qtyField] = qty;
        if (this.props.lineModel) {
          const updates = runLineRules(this.props.lineModel, { ...existingItem.values }, {
            changedFields: [qtyField],
          });
          Object.assign(existingItem.values, updates);
        }
        return;
      }

      if (product) {
        if (productFields.includes("product_id")) {
          referencesToCache.push({
            model: subFields.product_id?.relation || "product.product",
            id: productId,
            display_name: product.name,
          });
        }
        if (productFields.includes("product_template_id") && product.product_tmpl_id) {
          referencesToCache.push({
            model: subFields.product_template_id?.relation || "product.template",
            id: product.product_tmpl_id,
            display_name: product.name,
          });
        }
      }

      pendingNewRows.push({ productId, qty, product });
    });

    if (referencesToCache.length > 0) {
      await db.reference_records.bulkPut(referencesToCache);
    }

    pendingNewRows.forEach(({ productId, qty, product }) => {
      const rowData = { [qtyField]: qty };

      if (productFields.includes("product_id")) {
        rowData.product_id = productId;
      }
      if (productFields.includes("product_template_id") && product && product.product_tmpl_id) {
        rowData.product_template_id = product.product_tmpl_id;
      }

      this.addLineWithRules(rowData, {
        get: (m, id) => (m === "product.product" ? productsById[id] || null : null),
      });
    });

    this.computeTotal();
  }

  /**
   * Ajoute une ligne en appliquant les règles du modèle de ligne :
   * _onchange_product_id (name/price_unit) puis _compute_amount
   * (price_subtotal/price_total). dbSnapshot optionnel : catalogue
   * déjà en mémoire pour éviter un aller-retour IndexedDB.
   */
  addLineWithRules(rowData, dbSnapshot = null) {
    const item = this.makeLineItem(rowData);
    this.state.items.push(item);

    if (this.props.lineModel && item.values.product_id) {
      const options = dbSnapshot ? { dbSnapshot } : {};
      const onchangeUpdates = runLineRules(this.props.lineModel, { ...item.values }, {
        changedFields: ["product_id"],
        ...options,
      });
      Object.assign(item.values, onchangeUpdates);

      const qtyField = QTY_FIELD_CANDIDATES.find((f) => f in item.values) || null;
      const computeUpdates = runLineRules(this.props.lineModel, { ...item.values }, {
        changedFields: qtyField ? [qtyField, "price_unit"] : ["price_unit"],
        ...options,
      });
      Object.assign(item.values, computeUpdates);
    }

    return item;
  }
}

/**
 * Extraction des libellés <control><create string="..."/></control> et du
 * bouton catalogue de l'arch -- jamais de texte codé en dur par modèle.
 */
function getControlLabels(treeNode) {
  const labels = { default: "Ajouter une ligne", section: null, note: null, catalog: null };
  if (!treeNode) return labels;

  const controlNode = Array.from(treeNode.children).find((c) => c.tagName === "control");
  if (!controlNode) return labels;

  Array.from(controlNode.children).forEach((child) => {
    if (child.tagName === "create") {
      const str = child.getAttribute("string");
      const context = child.getAttribute("context") || "";
      if (!str) return;
      if (context.includes("line_section")) {
        labels.section = str;
      } else if (context.includes("line_note")) {
        labels.note = str;
      } else {
        labels.default = str;
      }
    } else if (child.tagName === "button") {
      labels.catalog = {
        string: child.getAttribute("string") || "",
        name: child.getAttribute("name") || "",
      };
    }
  });

  return labels;
}

export function renderOne2manyField(name, info, node, initialValue, parentValues) {
  // Modèle des lignes (ex: "purchase.order.line") -- fourni par fields_get().
  const lineModel = info.relation || null;
  const subFields = info.sub_fields || {};

  // Colonnes depuis l'arch (<tree>/<list> enfant), avec visibilité
  // évaluée une fois au rendu (column_invisible/invisible + parentValues),
  // comme l'ancien moteur.
  let columns = [];
  let controlLabels = { default: "Ajouter une ligne", section: null, note: null, catalog: null };

  if (node) {
    const treeNode = Array.from(node.children).find((c) => c.tagName === "tree" || c.tagName === "list");
    if (treeNode) {
      controlLabels = getControlLabels(treeNode);
      for (const fieldNode of Array.from(treeNode.children).filter((c) => c.tagName === "field")) {
        const fname = fieldNode.getAttribute("name");
        if (!fname || !subFields[fname]) continue;

        const widget = fieldNode.getAttribute("widget");
        if (widget === "handle") continue;

        const columnInvisible = fieldNode.getAttribute("column_invisible");
        const invisible = fieldNode.getAttribute("invisible");
        const optional = fieldNode.getAttribute("optional"); // "show" | "hide" | null

        if (columnInvisible === "1" || columnInvisible === "True") continue;
        if (columnInvisible && evaluateSimpleCondition(columnInvisible, {}, parentValues) === true) continue;

        if (invisible === "1" || invisible === "True") continue;
        if (invisible && evaluateSimpleCondition(invisible, {}, parentValues) === true) continue;

        // optional="hide" ne supprime PAS la colonne : masquée par défaut,
        // ré-activable via l'engrenage (état réactif du composant OWL).
        columns.push({
          field: fname,
          label: fieldNode.getAttribute("string") || subFields[fname].label,
          type: subFields[fname].type,
          relation: subFields[fname].relation || null,
          selection: subFields[fname].selection || [],
          optional: optional || null,
          visible: optional !== "hide",
        });
      }
    }
  }

  if (columns.length === 0) {
    const priorityFields = ["product_template_id", "product_id", "name", "product_uom_qty", "price_unit", "product_uom"];
    columns = priorityFields
      .filter((f) => subFields[f])
      .map((f) => ({
        field: f,
        label: subFields[f].label,
        type: subFields[f].type,
        relation: subFields[f].relation || null,
        selection: subFields[f].selection || [],
        optional: null,
        visible: true,
      }));

    if (columns.length === 0) {
      columns = Object.keys(subFields).slice(0, 4).map((f) => ({
        field: f,
        label: subFields[f].label,
        type: subFields[f].type,
        relation: subFields[f].relation || null,
        selection: subFields[f].selection || [],
        optional: null,
        visible: true,
      }));
    }
  }

  return renderOwlField(One2manyFieldOwl, {
    name,
    fieldTypeClass: "one2many",
    attributes: { "data-o2m-root": "true" },
    props: {
      name,
      columns,
      labels: controlLabels,
      subFields,
      lineModel,
      initialValue: Array.isArray(initialValue) ? initialValue : [],
      parentValues: parentValues || {},
    },
  });
}

