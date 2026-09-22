/**
 * views/fields/statinfo/statinfo_field.js
 * =======================================
 * Widget "statinfo" -- COMPOSANT OWL (itération 25) : tuile compteur +
 * libellé. Dans le button_box la tuile reste compilée par
 * form_arch_parser.js (emitButtonBox, valeur injectée au compile-time) ;
 * ce composant n'est utilisé que si le champ se retrouve hors
 * button_box. Valeur conservée via input caché #field-<name>.
 */
export class StatinfoFieldOwl extends owl.Component {
  static template = owl.xml`
    <div class="o_stat_info d-inline-flex flex-column align-items-center">
      <input type="hidden"
             t-att-id="'field-' + props.name"
             t-att-data-field="props.name"
             t-att-value="hiddenValue"/>
      <span class="o_stat_value fw-bold fs-5" t-esc="displayValue"/>
      <span class="o_stat_text text-muted small" t-esc="props.text"/>
    </div>
  `;

  static props = {
    name: String,
    value: { optional: true },
    text: { type: String, optional: true },
  };

  get hiddenValue() {
    const v = this.props.value;
    return v === false || v === undefined || v === null ? "" : String(v);
  }

  get displayValue() {
    const v = this.props.value;
    return v === undefined || v === false ? "0" : String(v);
  }
}
