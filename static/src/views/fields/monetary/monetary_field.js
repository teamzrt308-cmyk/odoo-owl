/**
 * views/fields/monetary/monetary_field.js
 * Widget de champ Monetary rendu par OWL, via owl/field_bridge.js.
 * Champ en lecture seule (le montant est calculé côté règles métier /
 * serveur, jamais saisi) : pas d'état réactif, la valeur est posée au
 * mount depuis les props.
 */

import { renderOwlField } from "../../../owl/field_bridge.js";

class MonetaryFieldOwl extends owl.Component {
  static template = owl.xml`
    <input type="text"
           class="o_input"
           readonly="readonly"
           t-att-id="props.id"
           t-att-name="props.name"
           t-att-value="props.initialValue"
    />
  `;

  static props = {
    id: String,
    name: String,
    initialValue: { type: String, optional: true },
  };
}

export function renderMonetaryField(name, info, node, initialValue, initialValues) {
  return renderOwlField(MonetaryFieldOwl, {
    name,
    fieldTypeClass: "monetary",
    props: {
      id: `field-${name}`,
      name,
      initialValue: initialValue ? Number(initialValue).toFixed(2) : "0.00",
    },
  });
}
