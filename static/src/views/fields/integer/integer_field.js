/**
 * views/fields/integer/integer_field.js
 * Widget de champ Integer rendu par OWL, via owl/field_bridge.js.
 * Classe exportée pour embarquement en sous-composant OWL du renderer
 * one2many (callback onChange avec valeur canonique number|false).
 */


export class IntegerFieldOwl extends owl.Component {
  static template = owl.xml`
    <input type="number"
           step="1"
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
    initialValue: { type: [String, Number], optional: true }, // one2many : valeurs canoniques numériques
    onChange: { type: Function, optional: true },
  };

  setup() {
    this.inputRef = owl.useRef("input");
    this.state = owl.useState({ value: this.props.initialValue || "" });
    owl.onWillUpdateProps((nextProps) => this.syncFromProps(nextProps));
  }

  syncFromProps(nextProps) {
    const input = this.inputRef.el;
    if (input && input === document.activeElement) return;
    const next = nextProps.initialValue || "";
    if (String(next) !== String(this.state.value)) {
      this.state.value = next;
    }
  }

  toCanonical(raw) {
    return raw === "" ? false : parseInt(raw, 10);
  }

  onInput(ev) {
    this.state.value = ev.target.value;
    if (this.props.onChange) this.props.onChange(this.toCanonical(ev.target.value));
  }
}
