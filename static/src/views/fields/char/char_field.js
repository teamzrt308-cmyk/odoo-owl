/**
 * views/fields/char/char_field.js
 * Widget de champ Char rendu par OWL, via owl/field_bridge.js.
 *
 * La classe est exportée : le renderer one2many l'embarque comme
 * sous-composant OWL pour les cellules de ses lignes. Dans ce contexte,
 * le parent passe un callback onChange(valeur) : il reçoit la valeur
 * canonique (string) à chaque saisie. Les mises à jour venant du parent
 * (recalcul par les règles métier) rafraîchissent l'affichage via
 * onWillUpdateProps -- sauf si l'input a le focus (saisie en cours).
 */

import { renderOwlField, computeReadonly, computeRequired } from "../../../owl/field_bridge.js";

export class CharFieldOwl extends owl.Component {
  static template = owl.xml`
    <input type="text"
           class="o_input"
           t-ref="input"
           t-att-id="props.id"
           t-att-name="props.name"
           t-att-placeholder="props.placeholder"
           t-att-required="props.required"
           t-att-readonly="props.readonly"
           t-att-disabled="props.readonly"
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
    initialValue: { type: [String, Number], optional: true }, // one2many : peut recevoir un nombre
    onChange: { type: Function, optional: true },
  };

  setup() {
    this.inputRef = owl.useRef("input");
    this.state = owl.useState({ value: this.props.initialValue || "" });
    owl.onWillUpdateProps((nextProps) => this.syncFromProps(nextProps));
  }

  syncFromProps(nextProps) {
    const input = this.inputRef.el;
    if (input && input === document.activeElement) return; // saisie en cours
    const next = nextProps.initialValue || "";
    if (String(next) !== String(this.state.value)) {
      this.state.value = next;
    }
  }

  onInput(ev) {
    this.state.value = ev.target.value;
    if (this.props.onChange) this.props.onChange(ev.target.value);
  }
}

export function renderCharField(name, info, node, initialValue, initialValues) {
  return renderOwlField(CharFieldOwl, {
    name,
    fieldTypeClass: "char",
    props: {
      id: `field-${name}`,
      name,
      placeholder: node ? (node.getAttribute("placeholder") || "") : "",
      required: computeRequired(node, info, initialValues),
      readonly: computeReadonly(node, initialValues),
      initialValue: initialValue || "",
    },
  });
}
