/**
 * views/fields/priority/priority_field.js
 * ========================================
 * Widget "priority" -- COMPOSANT OWL (itération 25, anciennement vanilla
 * via widget_registry) : drapeaux/étoiles cliquables (Odoo 17 : fa-stars
 * sur un champ selection). Le clic publie onChange (le record réactif du
 * renderer est mis à jour par <FormField>) et l'input caché
 * #field-<name> porte la valeur pour le sérialiseur.
 *
 * Variante listDisplay : cellule de liste en lecture seule (même markup
 * que l'ancien rendu inline du ListRenderer : span o_priority_display).
 */
export class PriorityFieldOwl extends owl.Component {
  static template = owl.xml`
    <span t-if="props.listDisplay" class="o_priority_display" t-esc="displayStars" t-att-title="props.title || ''"/>
    <div t-else="" class="o_priority d-inline-flex align-items-center gap-1">
      <input type="hidden"
             t-att-id="'field-' + props.name"
             t-att-data-field="props.name"
             t-att-value="hiddenValue"/>
      <t t-foreach="props.entries" t-as="entry" t-key="entry[0]">
        <span class="o_priority_star fa"
              t-att-class="starClass(entry_index)"
              t-att-aria-label="entry[1]"
              t-att-title="entry[1]"
              t-att-style="!props.readonly ? 'cursor:pointer' : ''"
              t-on-click="() => this.select(entry)"/>
      </t>
    </div>
  `;

  static props = {
    name: String,
    value: { optional: true },
    entries: { type: Array, optional: true },
    readonly: { type: Boolean, optional: true },
    listDisplay: { type: Boolean, optional: true },
    title: { type: String, optional: true },
    onChange: { type: Function, optional: true },
  };

  get rank() {
    const entries = this.props.entries || [];
    return entries.findIndex(([key]) => String(key) === String(this.props.value));
  }

  get hiddenValue() {
    const v = this.props.value;
    return v === false || v === undefined || v === null ? "" : String(v);
  }

  get displayStars() {
    return this.rank < 0 ? "☆" : "★".repeat(this.rank + 1);
  }

  starClass(index) {
    return this.rank >= 0 && index <= this.rank
      ? "fa-star text-warning"
      : "fa-star-o text-muted";
  }

  select(entry) {
    if (!this.props.readonly && this.props.onChange) this.props.onChange(entry[0]);
  }
}
