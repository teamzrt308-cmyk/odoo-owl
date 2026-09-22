/**
 * views/fields/boolean_toggle/boolean_toggle_field.js
 * ==================================================
 * Widget "boolean_toggle" -- COMPOSANT OWL (itération 25) : interrupteur
 * (form-check-switch Bootstrap 5). Le CHECKBOX lui-même porte
 * id="field-<name>" : le sérialiseur lit el.checked comme pour le
 * widget boolean natif.
 *
 * Variante listDisplay : cellule de liste en lecture seule (même markup
 * que l'ancien rendu inline : icône fa-check-circle / fa-times-circle).
 */
export class BooleanToggleFieldOwl extends owl.Component {
  static template = owl.xml`
    <span t-if="props.listDisplay"
          t-att-class="'fa ' + (props.value ? 'fa-check-circle text-success' : 'fa-times-circle text-muted')"
          t-att-title="props.title || ''"/>
    <div t-else="" class="form-check form-switch o_boolean_toggle d-inline-block m-0">
      <input type="checkbox"
             class="form-check-input"
             t-att-id="'field-' + props.name"
             t-att-data-field="props.name"
             t-att-checked="!!props.value"
             t-att-readonly="props.readonly"
             t-att-disabled="props.readonly"
             t-on-change="onToggle"/>
    </div>
  `;

  static props = {
    name: String,
    value: { optional: true },
    readonly: { type: Boolean, optional: true },
    listDisplay: { type: Boolean, optional: true },
    title: { type: String, optional: true },
    onChange: { type: Function, optional: true },
  };

  onToggle(ev) {
    if (this.props.onChange) this.props.onChange(ev.target.checked);
  }
}
