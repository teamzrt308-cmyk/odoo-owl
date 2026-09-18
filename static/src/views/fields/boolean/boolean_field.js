/**
 * views/fields/boolean/boolean_field.js
 * Widget de champ Boolean (case à cocher) rendu par OWL, via
 * owl/field_bridge.js. Classe exportée pour embarquement en
 * sous-composant OWL du renderer one2many (callback onChange).
 */

import { renderOwlField, computeReadonly } from "../../../owl/field_bridge.js";

export class BooleanFieldOwl extends owl.Component {
  static template = owl.xml`
    <div class="o-checkbox form-check">
      <input type="checkbox"
             class="form-check-input"
             t-ref="input"
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
    initialValue: { type: [Boolean, Number], optional: true }, // one2many : 0/1 possibles
    onChange: { type: Function, optional: true },
  };

  setup() {
    this.inputRef = owl.useRef("input");
    this.state = owl.useState({ checked: !!this.props.initialValue });
    owl.onWillUpdateProps((nextProps) => {
      const input = this.inputRef.el;
      if (input && input === document.activeElement) return;
      if (!!nextProps.initialValue !== this.state.checked) {
        this.state.checked = !!nextProps.initialValue;
      }
    });
  }

  onChange(ev) {
    this.state.checked = ev.target.checked;
    if (this.props.onChange) this.props.onChange(ev.target.checked);
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
