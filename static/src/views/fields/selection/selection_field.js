/**
 * views/fields/selection/selection_field.js
 * Widget de champ Selection rendu par OWL, via owl/field_bridge.js.
 * La sélection courante est comparée en String (comportement historique :
 * les valeurs Odoo peuvent être des nombres selon le modèle) ; la
 * normalisation est faite dans setup() : les globals JS (String...) ne
 * sont pas disponibles dans le scope des expressions de template
 * QWeb/OWL. Classe exportée pour embarquement en sous-composant OWL du
 * renderer one2many (callback onChange).
 */

import { renderOwlField, computeReadonly, computeRequired } from "../../../owl/field_bridge.js";

export class SelectionFieldOwl extends owl.Component {
  static template = owl.xml`
    <select class="o_input"
            t-ref="input"
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
    initialValue: { type: [String, Number], optional: true }, // one2many : valeur technique possible
    onChange: { type: Function, optional: true },
  };

  setup() {
    this.inputRef = owl.useRef("input");
    this.state = owl.useState({ value: this.props.initialValue || "" });
    this.normalizedOptions = (this.props.options || []).map(([value, label]) => ({
      value: String(value),
      label,
    }));
    owl.onWillUpdateProps((nextProps) => {
      const input = this.inputRef.el;
      if (input && input === document.activeElement) return;
      const next = nextProps.initialValue || "";
      if (String(next) !== String(this.state.value)) {
        this.state.value = next;
      }
    });
  }

  onChange(ev) {
    this.state.value = ev.target.value;
    if (this.props.onChange) this.props.onChange(ev.target.value);
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
