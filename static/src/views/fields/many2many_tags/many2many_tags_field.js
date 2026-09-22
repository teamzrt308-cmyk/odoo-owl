/**
 * views/fields/many2many_tags/many2many_tags_field.js
 * Widget de champ Many2many (tags) rendu par OWL (recherche + dropdown +
 * badges supprimables), via owl/field_bridge.js.
 *
 * Contrat DOM conservé pour le sérialiseur (form_serializer.js) : un
 * input caché name="<name>" portant la liste des ids en JSON
 * (collectFormData et getElementValue lisent ce champ).
 *
 * Classe exportée pour embarquement en sous-composant OWL du renderer
 * one2many -- callback onChange(ids).
 */

import { emitFieldChange } from "../../../owl/field_events.js";
import { getReferenceRecords } from "../../../core/reference_cache.js";

export class Many2manyTagsFieldOwl extends owl.Component {
  static template = owl.xml`
    <div class="o_field_many2many_tags position-relative" t-ref="root"
         style="display:flex; gap:4px; flex-wrap:wrap; align-items:center; padding:4px 0;">
      <div style="display:flex; gap:4px; flex-wrap:wrap;">
        <span t-foreach="state.selected" t-as="tag" t-key="tag[0]"
              class="badge rounded-pill text-bg-secondary d-flex align-items-center gap-1">
          <span t-esc="tag[1]"/>
          <a href="#" class="text-white" t-on-click="(ev) => this.removeTag(ev, tag[0])">&amp;times;</a>
        </span>
      </div>
      <div style="position:relative; min-width:80px; flex-grow:1;">
        <input type="text"
               class="o_input border-0"
               style="min-width:80px; width:100%;"
               t-att-id="props.id"
               placeholder="Rechercher..."
               autocomplete="off"
               t-on-input="onSearch"
        />
        <ul t-if="state.open and state.matches.length > 0" class="dropdown-menu show"
            style="display:block; position:absolute; top:100%; left:0; min-width:180px; z-index:1000;">
          <li t-foreach="state.matches" t-as="rec" t-key="rec.id">
            <a href="#" class="dropdown-item" t-on-click="(ev) => this.addTag(ev, rec)" t-esc="rec.display_name"/>
          </li>
        </ul>
      </div>
      <input type="hidden" t-ref="hidden" t-att-name="props.name" t-att-value="state.hiddenValue"/>
    </div>
  `;

  static props = {
    id: { type: String, optional: true },
    name: String,
    relation: String,
    readonly: { type: Boolean, optional: true },
    initialValue: { type: Array, optional: true },
    onChange: { type: Function, optional: true },
  };

  setup() {
    this.hiddenRef = owl.useRef("hidden");
    this.rootRef = owl.useRef("root");
    this.records = [];

    owl.useExternalListener(document.body, "click", (ev) => {
      if (this.rootRef?.el && !this.rootRef.el.contains(ev.target)) this.closeDropdown();
    });

    const initial = Array.isArray(this.props.initialValue)
      ? this.props.initialValue.map((v) => (Array.isArray(v) ? v : [v, String(v)]))
      : [];

    this.state = owl.useState({
      selected: initial,
      hiddenValue: JSON.stringify(initial.map(([id]) => id)),
      query: "",
      open: false,
      matches: [],
    });

    owl.onWillStart(async () => {
      try {
        this.records = await getReferenceRecords(this.props.relation);
      } catch (err) {
        console.warn(`Relation ${this.props.relation} :`, err);
      }
      // Résolution des libellés des ids nus (les données sauvegardées
      // contiennent [id] sans tuple) : le tag affiche le display_name du
      // cache de référence au lieu de l'id brut.
      this.state.selected = this.state.selected.map(([id, label]) => {
        if (String(label) === String(id) && this.records.length > 0) {
          const found = this.records.find((r) => String(r.id) === String(id));
          return [id, found ? found.display_name : label];
        }
        return [id, label];
      });
    });
  }

  syncHiddenValue() {
    this.state.hiddenValue = JSON.stringify(this.state.selected.map(([id]) => id));
    // Contrat field_bridge : diffusion `change` (règles racine + attrs).
    emitFieldChange(this.hiddenRef.el);
    if (this.props.onChange) this.props.onChange(this.state.selected.map(([id]) => id));
  }

  closeDropdown() {
    this.state.open = false;
    this.state.matches = [];
  }

  onSearch(ev) {
    if (this.props.readonly) return;
    const query = ev.target.value.toLowerCase();
    this.state.query = query;

    if (!query) {
      this.closeDropdown();
      return;
    }

    const selectedIds = new Set(this.state.selected.map(([id]) => id));
    this.state.matches = this.records
      .filter((r) => !selectedIds.has(r.id) && r.display_name.toLowerCase().includes(query))
      .slice(0, 20);
    this.state.open = true;
  }

  addTag(ev, record) {
    ev.preventDefault();
    this.state.selected.push([record.id, record.display_name]);
    this.syncHiddenValue();
    this.closeDropdown();
  }

  removeTag(ev, id) {
    ev.preventDefault();
    this.state.selected = this.state.selected.filter(([sid]) => sid !== id);
    this.syncHiddenValue();
  }
}
