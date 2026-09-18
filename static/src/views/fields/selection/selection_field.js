/**
 * views/fields/selection/selection_field.js
 * Widget de champ Selection rendu par OWL, via owl/field_bridge.js --
 * même pattern que char_field.js. La sélection courante est comparée en
 * String (comportement historique : les valeurs Odoo peuvent être des
 * nombres selon le modèle). La normalisation String est faite dans
 * setup() : les globals JS (String...) ne sont pas disponibles dans le
 * scope des expressions de template QWeb/OWL.
 */

import { renderOwlField, computeReadonly, computeRequired } from "../../../owl/field_bridge.js";

class SelectionFieldOwl extends owl.Component {
  static template = owl.xml`
    <select class="o_input"
            t-att-id="props.id"
            t-att-name="props.name"
            t-att-required="props.required"
            t-att-readonly="props.readonly"
            t-att-disabled="props.readonly"
            t-on-change="onChange"
    >
      <option value=""></option>
      <option t-foreach="this.normalizedOptions" t-as="opt" t-key="opt.value"
              t-att-value="opt.value"
              t-att-selected="state.value === opt.value"
              t-esc="opt.label"/>
    </select>
  `;

  static props = {
    id: String,
    name: String,
    required: { type: Boolean, optional: true },
    readonly: { type: Boolean, optional: true },
    options: { type: Array, optional: true },
    initialValue: { type: String, optional: true },
  };

  setup() {
    this.state = owl.useState({ value: this.props.initialValue || "" });
    this.normalizedOptions = (this.props.options || []).map(([value, label]) => ({
      value: String(value),
      label,
    }));
  }

  onChange(ev) {
    this.state.value = ev.target.value;
  }
}

export function renderSelectionField(name, info, node, initialValue, initialValues) {
  return renderOwlField(SelectionFieldOwl, {
    name,
    fieldTypeClass: "selection",
    props: {
      id: `field-${name}`,
      name,
      required: computeRequired(node, info, initialValues),
      readonly: computeReadonly(node, initialValues),
      options: info.selection || [],
      initialValue:
        initialValue === undefined || initialValue === false ? "" : String(initialValue),
    },
  });
}
