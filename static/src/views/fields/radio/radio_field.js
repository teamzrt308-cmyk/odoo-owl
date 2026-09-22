/**
 * views/fields/radio/radio_field.js
 * =================================
 * Widget "radio" -- COMPOSANT OWL (itération 25) : champ selection rendu
 * en boutons radio (Odoo 17), valeur synchronisée dans l'input caché
 * #field-<name>. (Form uniquement -- en liste les selection s'affichent
 * en badge via le ListRenderer.)
 */
export class RadioFieldOwl extends owl.Component {
  static template = owl.xml`
    <div class="o_field_radio d-inline-flex flex-column gap-1">
      <input type="hidden"
             t-att-id="'field-' + props.name"
             t-att-data-field="props.name"
             t-att-value="hiddenValue"/>
      <label t-foreach="props.entries" t-as="entry" t-key="entry[0]"
             class="d-flex align-items-center gap-2 m-0">
        <input type="radio"
               t-att-name="'radio-' + props.name"
               t-att-value="entry[0]"
               t-att-checked="isChecked(entry[0])"
               t-att-disabled="props.readonly"
               t-on-change="() => this.select(entry)"/>
        <span t-esc="entry[1]"/>
      </label>
    </div>
  `;

  static props = {
    name: String,
    value: { optional: true },
    entries: { type: Array, optional: true },
    readonly: { type: Boolean, optional: true },
    onChange: { type: Function, optional: true },
  };

  get hiddenValue() {
    const v = this.props.value;
    return v === false || v === undefined || v === null ? "" : String(v);
  }

  /** String() n'est pas disponible dans les expressions de template. */
  isChecked(key) {
    return String(this.props.value) === String(key);
  }

  select(entry) {
    if (!this.props.readonly && this.props.onChange) this.props.onChange(entry[0]);
  }
}
