/**
 * views/fields/monetary/monetary_field.js
 * Widget de champ Monetary rendu par OWL, via owl/field_bridge.js.
 * Champ en lecture seule (le montant est calculé côté règles métier /
 * serveur, jamais saisi) : pas d'état, la valeur est portée par les
 * props -- les recalculs des règles métier rafraîchissent donc
 * l'affichage à chaque re-render (attribut value, input non "dirty").
 */


export class MonetaryFieldOwl extends owl.Component {
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
    initialValue: { type: [String, Number], optional: true }, // one2many : valeurs canoniques numériques
  };
}
