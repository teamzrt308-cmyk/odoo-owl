/**
 * views/fields/badge/badge_field.js
 * =================================
 * Widget "badge" -- COMPOSANT OWL (itération 25) : pastille arrondie
 * (comme les tags Odoo), libellé selection, valeur conservée via input
 * caché #field-<name> (form).
 *
 * Variante listDisplay : cellule de liste (même markup que l'ancien
 * rendu inline : span badge rounded-pill + classe decoration-*).
 */
export class BadgeFieldOwl extends owl.Component {
  static template = owl.xml`
    <span t-if="props.listDisplay"
          t-att-class="'badge rounded-pill ' + (props.decorationClass || '')"
          t-esc="props.label"/>
    <div t-else="" class="o_field_badge">
      <input type="hidden"
             t-att-id="'field-' + props.name"
             t-att-data-field="props.name"
             t-att-value="hiddenValue"/>
      <span class="badge rounded-pill o_tag_badge" t-esc="props.label"/>
    </div>
  `;

  static props = {
    name: String,
    value: { optional: true },
    label: { type: String, optional: true },
    decorationClass: { type: String, optional: true },
    listDisplay: { type: Boolean, optional: true },
  };

  get hiddenValue() {
    const v = this.props.value;
    return v === false || v === undefined || v === null ? "" : String(v);
  }
}
