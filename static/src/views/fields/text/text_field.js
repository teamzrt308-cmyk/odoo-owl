/**
 * views/fields/text/text_field.js
 * Widget de champ Text (textarea) rendu par OWL, via owl/field_bridge.js.
 * Le contenu initial est posé au premier rendu (t-esc) ; la saisie
 * ultérieure reste dans le DOM (le textarea n'est jamais re-rendu après
 * le mount) -- le moteur hors ligne sérialise directement le DOM, cf.
 * form_serializer.
 *
 * La classe est exportée pour embarquement en sous-composant OWL du
 * renderer one2many (callback onChange).
 */

import { renderOwlField, computeReadonly, computeRequired } from "../../../owl/field_bridge.js";

export class TextFieldOwl extends owl.Component {
  static template = owl.xml`
    <textarea
           class="o_input"
           t-att-id="props.id"
           t-att-name="props.name"
           t-att-placeholder="props.placeholder"
           t-att-required="props.required"
           t-att-readonly="props.readonly"
           t-att-disabled="props.readonly"
           t-att-style="props.readonly ? 'background-color:#f5f5f5' : ''"
    ><t t-esc="state.value"/></textarea>
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
    // State non réactif à la saisie : le textarea n'est jamais re-rendu
    // après le mount (voir en-tête de fichier).
    this.state = { value: this.props.initialValue || "" };
  }

  onInput(ev) {
    if (this.props.onChange) this.props.onChange(ev.target.value);
  }
}

export function renderTextField(name, info, node, initialValue, initialValues) {
  return renderOwlField(TextFieldOwl, {
    name,
    fieldTypeClass: "text",
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
