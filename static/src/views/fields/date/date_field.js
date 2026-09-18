/**
 * views/fields/date/date_field.js
 * Widget de champ Date rendu par OWL, via owl/field_bridge.js --
 * même pattern que char_field.js. Input natif type="date" : calendrier
 * + format yyyy-mm-dd garanti par le navigateur (valeur déjà ISO côté
 * Odoo, aucune conversion nécessaire).
 */

import { renderOwlField, computeReadonly, computeRequired } from "../../../owl/field_bridge.js";

class DateFieldOwl extends owl.Component {
  static template = owl.xml`
    <input type="date"
           class="o_input"
           t-att-id="props.id"
           t-att-name="props.name"
           t-att-placeholder="props.placeholder"
           t-att-required="props.required"
           t-att-readonly="props.readonly"
           t-att-style="props.readonly ? 'background-color:#f5f5f5' : ''"
           t-att-value="state.value"
           t-on-input="onInput"
    />
  `;

  static props = {
    id: String,
    name: String,
    placeholder: { type: String, optional: true },
    required: { type: Boolean, optional: true },
    readonly: { type: Boolean, optional: true },
    initialValue: { type: String, optional: true },
  };

  setup() {
    this.state = owl.useState({ value: this.props.initialValue || "" });
  }

  onInput(ev) {
    this.state.value = ev.target.value;
  }
}

export function renderDateField(name, info, node, initialValue, initialValues) {
  return renderOwlField(DateFieldOwl, {
    name,
    fieldTypeClass: "date",
    props: {
      id: `field-${name}`,
      name,
      placeholder: node ? (node.getAttribute("placeholder") || "") : "",
      required: computeRequired(node, info, initialValues),
      readonly: computeReadonly(node, initialValues),
      initialValue: initialValue ? String(initialValue) : "",
    },
  });
}
