/**
 * views/fields/text/text_field.js
 * Widget de champ Text (textarea) rendu par OWL, via owl/field_bridge.js
 * -- même pattern que char_field.js. Le contenu initial est posé au
 * premier rendu (t-esc) ; la saisie ultérieure reste dans le DOM (le
 * moteur hors ligne sérialise directement le DOM, cf. form_serializer),
 * sans re-render OWL à chaque frappe.
 */

import { renderOwlField, computeReadonly, computeRequired } from "../../../owl/field_bridge.js";

class TextFieldOwl extends owl.Component {
  static template = owl.xml`
    <textarea
           class="o_input"
           t-att-id="props.id"
           t-att-name="props.name"
           t-att-placeholder="props.placeholder"
           t-att-required="props.required"
           t-att-readonly="props.readonly"
           t-att-style="props.readonly ? 'background-color:#f5f5f5' : ''"
    ><t t-esc="state.value"/></textarea>
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
    // State non réactif à la saisie : le textarea n'est jamais re-rendu
    // après le mount (voir en-tête de fichier).
    this.state = { value: this.props.initialValue || "" };
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
