/**
 * views/fields/many2one/many2one_field.js
 * Widget de champ Many2one rendu par OWL (recherche + dropdown), via
 * owl/field_bridge.js -- même flux que chez Odoo où Many2one est un
 * composant OWL (AutoComplete) alimenté par les enregistrements de
 * référence. Hors ligne, la source est le cache local
 * core/reference_cache.js (id -> display_name), jamais le réseau.
 *
 * Contrat DOM conservé pour le sérialiseur (form_serializer.js) :
 *   - input texte avec id="field-<name>" ;
 *   - input caché name="<name>_id" portant l'ID sélectionné
 *     (collectFormData lit ce nom ; getElementValue lit le type=hidden).
 * La création locale ("Créer ...") passe par la file de sync
 * (queueAction) et produit une référence tmp:<uuid>, comme avant.
 *
 * Classe exportée pour embarquement en sous-composant OWL du renderer
 * one2many (cellules produit des lignes) -- callback onChange(id|tmpRef).
 */

import { renderOwlField, computeReadonly, computeRequired } from "../../../owl/field_bridge.js";
import { queueAction } from "../../../core/network/rpc_service.js";
import { notifications } from "../../../core/notifications/notification_service.js";
import { getReferenceRecords } from "../../../core/reference_cache.js";

export class Many2oneFieldOwl extends owl.Component {
  static template = owl.xml`
    <div class="o_field_many2one position-relative" t-ref="root">
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
             t-att-value="state.display"
             autocomplete="off"
             t-on-input="onSearch"
      />
      <input type="hidden" t-ref="hidden" t-att-name="props.name + '_id'" t-att-value="state.valueId"/>
      <ul t-if="state.open and (state.matches.length > 0 or showCreate)" class="dropdown-menu show"
          style="display:block; position:absolute; width:100%; z-index:1000; max-height:280px; overflow-y:auto;">
        <li t-foreach="state.matches" t-as="rec" t-key="rec.id">
          <a href="#" class="dropdown-item" t-on-click="(ev) => this.selectRecord(ev, rec)" t-esc="rec.display_name"/>
        </li>
        <li t-if="showCreate">
          <a href="#" class="dropdown-item fst-italic text-primary" t-on-click="(ev) => this.createRecord(ev)"
             t-esc="'Créer &quot;' + state.query + '&quot;'"/>
        </li>
      </ul>
    </div>
  `;

  static props = {
    id: String,
    name: String,
    relation: String,
    placeholder: { type: String, optional: true },
    required: { type: Boolean, optional: true },
    readonly: { type: Boolean, optional: true },
    canCreate: { type: Boolean, optional: true },
    initialValue: { optional: true }, // id | [id, "Libellé"] | false
    onChange: { type: Function, optional: true },
  };

  setup() {
    this.inputRef = owl.useRef("input");
    this.hiddenRef = owl.useRef("hidden");
    this.state = owl.useState({
      display: "",
      valueId: "",
      query: "",
      open: false,
      matches: [],
    });

    // Fermeture du dropdown au clic extérieur (listener externe OWL,
    // retiré automatiquement à la destruction du composant). Les hooks
    // doivent être appelés dans setup(), pas dans onWillStart async.
    owl.useExternalListener(document.body, "click", (ev) => {
      if (this.rootRef?.el && !this.rootRef.el.contains(ev.target)) this.closeDropdown();
    });

    this.rootRef = owl.useRef("root");

    // Tuple Odoo [id, "Libellé"] : affichage SYNCHRONE dès setup(). Une
    // mutation faite dans le onWillStart d'un SOUS-composant (one2many)
    // peut ne pas déclencher de re-render (fiber déjà en cours) — le
    // libellé doit donc être connu AVANT le premier render.
    const initialSync = this.props.initialValue;
    if (Array.isArray(initialSync)) {
      this.state.valueId = initialSync[0];
      this.state.display = initialSync[1] ?? "";
    }

    owl.onWillStart(async () => {
      // Enregistrements de référence du modèle lié (cache local uniquement :
      // getReferenceRecords ne fait jamais de réseau).
      try {
        this.records = await getReferenceRecords(this.props.relation);
      } catch (err) {
        console.warn(`Relation ${this.props.relation} :`, err);
        this.records = [];
      }

      // Id nu (montage racine) : résolution du libellé par le cache.
      const initial = this.props.initialValue;
      if (!Array.isArray(initial) && initial !== undefined && initial !== false && initial !== null && initial !== "") {
        this.state.valueId = initial;
        const found = this.records.find((r) => String(r.id) === String(initial));
        this.state.display = found ? found.display_name : "";
      }

    });
  }

  /**
   * Option "Créer ..." : seulement si les permissions (can_create calculé
   * côté serveur) et la configuration de vue (options.no_create) le
   * permettent, comme dans le vrai Odoo.
   */
  get showCreate() {
    return !!this.props.canCreate && !!this.state.query;
  }

  closeDropdown() {
    this.state.open = false;
    this.state.matches = [];
  }

  onSearch(ev) {
    if (this.props.readonly) return;
    const query = ev.target.value;
    const queryLower = query.toLowerCase();
    this.state.query = query;
    this.state.display = query;
    this.state.valueId = ""; // toute saisie invalide la sélection courante

    this.state.matches = query
      ? this.records
          .filter((r) => r.display_name.toLowerCase().includes(queryLower))
          .slice(0, 20)
      : [];
    this.state.open = true;
  }

  selectRecord(ev, record) {
    ev.preventDefault();
    this.state.display = record.display_name;
    this.state.valueId = record.id;
    this.state.open = false;
    this.state.matches = [];
    if (this.props.onChange) this.props.onChange(record.id);
  }

  async createRecord(ev) {
    ev.preventDefault();
    try {
      // Référence "tmp:<uuid>" : marque les enregistrements créés hors-ligne
      // non encore synchronisés (le sérialiseur, le catalogue produits et
      // les règles de stock s'appuient sur ce préfixe).
      const localUuid = await queueAction(this.props.relation, "create", { name: this.state.query }, "generic");
      const tmpRef = `tmp:${localUuid}`;
      this.records.push({ id: tmpRef, display_name: this.state.query });
      this.state.display = this.state.query;
      this.state.valueId = tmpRef;
      if (this.props.onChange) this.props.onChange(tmpRef);
    } catch (err) {
      console.error("Création locale impossible:", err);
      notifications.add("Impossible de créer cet enregistrement localement.", { title: "Création locale", type: "danger" });
    }
    this.closeDropdown();
  }
}

/**
 * Minimal parser for the "options" attribute of Odoo views — syntax similar
 * to a Python dict (single quotes, capitalized True/False). Handles
 * common cases found in actual view architectures (no_create, no_open,
 * currency_field, etc.) — not a full Python parser.
 */
function parseOdooOptions(str) {
  if (!str) return {};
  try {
    const jsonLike = str
      .replace(/'/g, '"')
      .replace(/\bTrue\b/g, "true")
      .replace(/\bFalse\b/g, "false");
    return JSON.parse(jsonLike);
  } catch (err) {
    console.warn("Attribut options non parsé:", str, err);
    return {};
  }
}

export function renderMany2oneField(name, info, node, initialValue, initialValues) {
  // can_create est calculé par get_view() côté serveur d'après les vraies
  // permissions ORM du modèle lié ; no_create (dans "options") est un choix
  // de configuration de vue, indépendant des permissions.
  const options = node ? parseOdooOptions(node.getAttribute("options")) : {};
  const canCreateAttr = node ? node.getAttribute("can_create") : null;
  const allowCreate = !options.no_create && canCreateAttr !== "False";

  return renderOwlField(Many2oneFieldOwl, {
    name,
    fieldTypeClass: "many2one",
    props: {
      id: `field-${name}`,
      name,
      relation: info.relation,
      placeholder: node ? (node.getAttribute("placeholder") || "") : "",
      required: computeRequired(node, info, initialValues),
      readonly: computeReadonly(node, initialValues),
      canCreate: allowCreate,
      initialValue: initialValue || false,
    },
  });
}
