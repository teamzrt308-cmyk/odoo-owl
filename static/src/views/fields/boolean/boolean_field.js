/**
 * views/fields/boolean/boolean_field.js
 * Widget de champ Boolean (case à cocher) rendu par OWL, via
 * owl/field_bridge.js -- même pattern que char_field.js.
 */

import { renderOwlField, computeReadonly } from "../../../owl/field_bridge.js";

class BooleanFieldOwl extends owl.Component {
  static template = owl.xml`
    <div class="o-checkbox form-check">
      <input type="checkbox"
             class="form-check-input"
             t-att-id="props.id"
             t-att-name="props.name"
             t-att-readonly="props.readonly"
             t-att-disabled="props.readonly"
             t-att-checked="state.checked"
             t-on-change="onChange"
      />
    </div>
  `;

  static props = {
    id: String,
    name: String,
    readonly: { type: Boolean, optional: true },
    initialValue: { type: Boolean, optional: true },
  };

  setup() {
    this.state = owl.useState({ checked: !!this.props.initialValue });
  }

  onChange(ev) {
    this.state.checked = ev.target.checked;
  }
}

export function renderBooleanField(name, info, node, initialValue, initialValues) {
  return renderOwlField(BooleanFieldOwl, {
    name,
    fieldTypeClass: "boolean",
    props: {
      id: `field-${name}`,
      name,
      readonly: computeReadonly(node, initialValues),
      initialValue: !!initialValue,
    },
  });
}
