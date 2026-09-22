/**
 * views/fields/image/image_field.js
 * =================================
 * Widget "image" -- COMPOSANT OWL (itération 25) : aperçu depuis la
 * valeur base64 du cache local (placeholder hors ligne si vide) +
 * upload local (FileReader, aucun réseau) -- valeur base64 synchronisée
 * dans l'input caché #field-<name>.
 *
 * Variante listDisplay : vignette de liste (même markup que l'ancien
 * rendu inline : img.o_list_image).
 */
export class ImageFieldOwl extends owl.Component {
  static template = owl.xml`
    <img t-if="props.listDisplay" class="o_list_image rounded" t-att-src="imgSrc" alt=""/>
    <div t-else="" class="o_field_image d-inline-block">
      <input type="hidden"
             t-att-id="'field-' + props.name"
             t-att-data-field="props.name"
             t-att-value="hiddenValue"/>
      <img class="o_image_preview img-fluid rounded border"
           t-att-alt="props.label || props.name"
           t-att-src="imgSrc"
           t-att-style="!props.readonly ? 'cursor:pointer' : ''"
           t-att-title="!props.readonly ? 'Cliquer pour choisir une image (stockée localement)' : ''"
           t-on-click="pickFile"/>
      <input t-if="!props.readonly" type="file" accept="image/*"
             style="display:none" t-ref="file" t-on-change="onFileChange"/>
    </div>
  `;

  static props = {
    name: String,
    value: { optional: true },
    label: { type: String, optional: true },
    readonly: { type: Boolean, optional: true },
    listDisplay: { type: Boolean, optional: true },
    onChange: { type: Function, optional: true },
  };

  setup() {
    this.fileRef = owl.useRef("file");
  }

  get hiddenValue() {
    const v = this.props.value;
    return v === false || v === undefined || v === null ? "" : String(v);
  }

  get imgSrc() {
    const str = typeof this.props.value === "string" ? this.props.value : "";
    if (!str) return "assets/default-app.png";
    return str.startsWith("data:") ? str : `data:image/png;base64,${str}`;
  }

  pickFile() {
    if (!this.props.readonly && this.fileRef.el) this.fileRef.el.click();
  }

  onFileChange(ev) {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      if (this.props.onChange) this.props.onChange(result.split(",")[1] || "");
    };
    reader.readAsDataURL(file);
  }
}
