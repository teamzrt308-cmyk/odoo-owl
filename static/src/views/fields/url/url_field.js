/**
 * views/fields/url/url_field.js
 * =============================
 * Widgets "email" / "phone" / "url" -- COMPOSANT OWL (itération 25) :
 * saisie normale + bouton-lien (mailto:, tel:, http) qui ouvre le
 * gestionnaire de l'appareil -- le href est construit localement, aucun
 * serveur. L'input porte id="field-<name>" (contrat sérialiseur).
 * (Form uniquement -- en liste la valeur reste du texte brut.)
 */
const MODES = {
  email: { type: "email", icon: "fa-envelope", title: "Envoyer un e-mail", build: (v) => `mailto:${v}` },
  phone: { type: "tel", icon: "fa-phone", title: "Appeler", build: (v) => `tel:${v}` },
  url: { type: "url", icon: "fa-external-link", title: "Ouvrir le lien", build: (v) => (v.startsWith("http") ? v : `https://${v}`) },
};

export class LinkFieldOwl extends owl.Component {
  static template = owl.xml`
    <div class="input-group input-group-sm o_field_link">
      <input t-ref="input"
             t-att-type="mode.type"
             class="form-control"
             t-att-id="'field-' + props.name"
             t-att-data-field="props.name"
             t-att-value="state.value"
             t-on-input="onInput"/>
      <button type="button" class="btn btn-outline-secondary"
              t-att-title="mode.title" t-on-click="openLink">
        <i t-att-class="'fa ' + mode.icon"/>
      </button>
    </div>
  `;

  static props = {
    name: String,
    value: { optional: true },
    mode: { type: String, optional: true }, // "email" | "phone" | "url"
    onChange: { type: Function, optional: true },
  };

  setup() {
    this.inputRef = owl.useRef("input");
    this.state = owl.useState({ value: this.initialText });
    owl.onWillUpdateProps((nextProps) => this.syncFromProps(nextProps));
  }

  get mode() {
    return MODES[this.props.mode] || MODES.url;
  }

  get initialText() {
    const v = this.props.value;
    return v === false || v === undefined || v === null ? "" : String(v);
  }

  /** Réagit au record réactif (comme CharFieldOwl) sans casser la saisie. */
  syncFromProps(nextProps) {
    const input = this.inputRef.el;
    if (input && input === document.activeElement) return; // saisie en cours
    const v = nextProps.value;
    const next = v === false || v === undefined || v === null ? "" : String(v);
    if (next !== this.state.value) this.state.value = next;
  }

  onInput(ev) {
    this.state.value = ev.target.value;
    if (this.props.onChange) this.props.onChange(ev.target.value);
  }

  openLink() {
    const value = (this.state.value || "").trim();
    if (value) window.open(this.mode.build(value), "_blank");
  }
}
