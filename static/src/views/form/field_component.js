/**
 * views/form/field_component.js
 * =============================
 * <FormField> : composant OWL de champ, émis DIRECTEMENT dans le template
 * compilé depuis l'arch (form_arch_parser::buildFormTemplate émet
 * `<FormField index="i" mode="..."/>`) -- même pipeline que le webclient
 * natif Odoo 17 : **Arch XML → <Field> OWL → rendu OWL**.
 *
 * Responsabilités (l'équivalent du rendu de champ + attrs dynamiques
 * chez Odoo, mais RÉACTIF par construction -- les anciens renderField
 * et dynamic_field_attrs ont été supprimés en itération 24) :
 *  - lit la valeur dans le `record` réactif du renderer (useState) ;
 *  - ré-évalue à chaque rendu invisible/readonly/required (expressions
 *    de l'arch évaluées sur le record -- plus aucune mutation DOM) ;
 *  - choisit le composant interne (registre FIELD_COMPONENTS pour les
 *    types natifs OWL ; les widgets explicites (widget="...") sont
 *    résolus dans le registre WIDGET_COMPONENTS -- composants OWL
 *    depuis l'itération 25, plus aucune injection vanilla) ;
 *  - publie le changement : record[name] = v + événement `change` qui
 *    bulle vers le conteneur (scheduleDocumentRulesSync du contrôleur).
 *
 * Contrats DOM conservés (sérialiseur + suites) : #field-<name>,
 * [data-field-row], .o_field_widget.o_field_<type>, data-one2many,
 * [data-o2m-root] + APIs impératives du composant one2many.
 */
import { CharFieldOwl } from "../fields/char/char_field.js";
import { TextFieldOwl } from "../fields/text/text_field.js";
import { IntegerFieldOwl } from "../fields/integer/integer_field.js";
import { FloatFieldOwl } from "../fields/float/float_field.js";
import { BooleanFieldOwl } from "../fields/boolean/boolean_field.js";
import { SelectionFieldOwl } from "../fields/selection/selection_field.js";
import { DateFieldOwl } from "../fields/date/date_field.js";
import { DatetimeFieldOwl } from "../fields/datetime/datetime_field.js";
import { MonetaryFieldOwl } from "../fields/monetary/monetary_field.js";
import { Many2oneFieldOwl } from "../fields/many2one/many2one_field.js";
import { Many2manyTagsFieldOwl } from "../fields/many2many_tags/many2many_tags_field.js";
import { One2manyFieldOwl } from "../fields/one2many/one2many_field.js";
import { StatusbarFieldOwl } from "../fields/statusbar/statusbar.js";
import { PriorityFieldOwl } from "../fields/priority/priority_field.js";
import { BadgeFieldOwl } from "../fields/badge/badge_field.js";
import { BooleanToggleFieldOwl } from "../fields/boolean_toggle/boolean_toggle_field.js";
import { RadioFieldOwl } from "../fields/radio/radio_field.js";
import { ImageFieldOwl } from "../fields/image/image_field.js";
import { LinkFieldOwl } from "../fields/url/url_field.js";
import { StatinfoFieldOwl } from "../fields/statinfo/statinfo_field.js";
import { parseOdooOptions } from "../fields/many2one/many2one_field.js";
import { selectionEntries } from "../fields/selection_utils.js";
import { computeRequired, computeReadonly } from "./field_attrs.js";
import { emitFieldChange } from "../../owl/field_events.js";
import { evaluateSimpleCondition } from "../../core/py_js/py_utils.js";

const attr = (node, name) => (node ? node.getAttribute(name) || "" : "");
const hasStaticAttr = (node, name) => {
  const raw = node ? node.getAttribute(name) : null;
  return raw === "1" || raw === "True";
};

/** Évalue une expression d'arch (invisible/readonly/required) sur le record. */
function evalExpr(expr, values) {
  if (!expr) return false;
  if (expr === "1" || expr === "True") return true;
  return evaluateSimpleCondition(expr, values) === true;
}

/** Colonnes + props du one2many (miroir de renderOne2manyField). */
function buildOne2manyProps(name, info, node, value, parentValues) {
  const lineModel = info.relation || null;
  const subFields = info.sub_fields || {};
  const columns = [];
  const controlLabels = { default: "Ajouter une ligne", section: null, note: null, catalog: null };
  if (node) {
    const treeNode = Array.from(node.children).find((c) => c.tagName === "tree" || c.tagName === "list");
    if (treeNode) {
      for (const fieldNode of Array.from(treeNode.children).filter((c) => c.tagName === "field")) {
        const fname = fieldNode.getAttribute("name");
        if (!fname || !subFields[fname]) continue;
        if (fieldNode.getAttribute("widget") === "handle") continue;
        const columnInvisible = fieldNode.getAttribute("column_invisible");
        const invisible = fieldNode.getAttribute("invisible");
        const optional = fieldNode.getAttribute("optional");
        if (columnInvisible === "1" || columnInvisible === "True") continue;
        if (columnInvisible && evaluateSimpleCondition(columnInvisible, {}, parentValues) === true) continue;
        if (invisible === "1" || invisible === "True") continue;
        if (invisible && evaluateSimpleCondition(invisible, {}, parentValues) === true) continue;
        columns.push({
          field: fname,
          label: fieldNode.getAttribute("string") || subFields[fname].label,
          type: subFields[fname].type,
          relation: subFields[fname].relation || null,
          selection: subFields[fname].selection || [],
          optional: optional || null,
          visible: optional !== "hide",
        });
      }
    }
  }
  if (columns.length === 0) {
    Object.keys(subFields).slice(0, 4).forEach((f) => columns.push({
      field: f, label: subFields[f].label, type: subFields[f].type,
      relation: subFields[f].relation || null, selection: subFields[f].selection || [],
      optional: null, visible: true,
    }));
  }
  return {
    name, columns, labels: controlLabels, subFields, lineModel,
    initialValue: Array.isArray(value) ? value : [],
    parentValues: parentValues || {},
  };
}

/**
 * Registre des composants internes par TYPE -- props assemblées depuis
 * le record réactif (readonly/required ré-évalués à chaque rendu, comme
 * les attrs dynamiques d'Odoo). EXPORTÉ : les suites l'utilisent pour
 * monter les composants exactement comme le fait <FormField> (une seule
 * source de vérité pour la dérivation type -> composant + props).
 */
export function buildPropsFor(type, name, info, node, value, values) {
  const readonly = hasStaticAttr(node, "readonly") || evalExpr(attr(node, "readonly"), values);
  const required = !!info.required || (!hasStaticAttr(node, "required") && evalExpr(attr(node, "required"), values));
  const placeholder = attr(node, "placeholder");
  switch (type) {
    case "char":
      return { component: CharFieldOwl, props: { id: `field-${name}`, name, placeholder, required, readonly, initialValue: value || "" } };
    case "text":
      return { component: TextFieldOwl, props: { id: `field-${name}`, name, placeholder, required, readonly, initialValue: value ? String(value) : "" } };
    case "integer":
      return { component: IntegerFieldOwl, props: { id: `field-${name}`, name, placeholder, required, readonly, initialValue: value !== undefined && value !== false ? String(value) : "" } };
    case "float":
      return { component: FloatFieldOwl, props: { id: `field-${name}`, name, placeholder, required, readonly, initialValue: value !== undefined && value !== false ? String(value) : "" } };
    case "boolean":
      return { component: BooleanFieldOwl, props: { id: `field-${name}`, name, readonly, initialValue: !!value } };
    case "selection":
      return { component: SelectionFieldOwl, props: { id: `field-${name}`, name, required, readonly, options: info.selection || [], initialValue: value === undefined || value === false ? "" : String(value) } };
    case "date":
      return { component: DateFieldOwl, props: { id: `field-${name}`, name, placeholder, required, readonly, initialValue: value ? String(value) : "" } };
    case "datetime":
      return { component: DatetimeFieldOwl, props: { id: `field-${name}`, name, placeholder, required, readonly, initialValue: value ? String(value) : "" } };
    case "monetary":
      return { component: MonetaryFieldOwl, props: { id: `field-${name}`, name, initialValue: value ? Number(value).toFixed(2) : "0.00" } };
    case "many2one": {
      // can_create : options.no_create (parseur Python-ish du widget m2o)
      // ou can_create="False" -- comme le rendu d'origine.
      let allowCreate = true;
      const rawOptions = attr(node, "options");
      if (rawOptions && parseOdooOptions(rawOptions).no_create) allowCreate = false;
      if (attr(node, "can_create") === "False") allowCreate = false;
      return { component: Many2oneFieldOwl, props: { id: `field-${name}`, name, relation: info.relation, placeholder, required, readonly, canCreate: allowCreate, initialValue: value || false } };
    }
    case "many2many":
      return { component: Many2manyTagsFieldOwl, props: { id: `field-${name}`, name, relation: info.relation, readonly, initialValue: Array.isArray(value) ? value : [] } };
    case "one2many":
      return { component: One2manyFieldOwl, props: buildOne2manyProps(name, info, node, value, values) };
    default:
      return null;
  }
}

export class FormField extends owl.Component {
  static template = owl.xml`
    <t t-if="isBare">
      <t t-if="isOne2many">
        <span t-ref="o2mHost" data-o2m-root="true"><t t-if="innerName" t-component="innerName" t-props="innerProps"/></span>
      </t>
      <t t-elif="innerName" t-component="innerName" t-props="innerProps"/>
    </t>
    <div t-else="" t-ref="cell"
         t-att-class="cellClass"
         t-att-data-field-row="name"
         t-att-data-one2many="isOne2many ? name : false"
         t-att-style="hidden ? 'display: none;' : ''">
      <label t-if="showLabel" class="o_form_label" t-att-for="'field-' + name" t-esc="labelText"/>
      <div t-if="isNewSimulation" class="o_form_readonly" t-att-data-field="name">Nouveau</div>
      <div t-else="" class="o_field_widget" t-att-class="'o_field_' + fieldType">
        <t t-if="isOne2many">
          <span t-ref="o2mHost" data-o2m-root="true"><t t-if="innerName" t-component="innerName" t-props="innerProps"/></span>
        </t>
        <t t-elif="innerName" t-component="innerName" t-props="innerProps"/>
      </div>
    </div>
  `;

  static props = {
    // Émis tel quel dans le template compilé : seuls index/mode sont des
    // attributs. Les données (fieldNodes, fieldsInfo, record) transitent
    // par l'ENV OWL du renderer (env.__formCtx), comme le record du
    // webclient est propagé par contexte aux composants <Field>.
    index: { type: Number },
    mode: { type: String, optional: true },
  };

  setup() {
    this.cellRef = owl.useRef("cell");
    this.o2mHostRef = owl.useRef("o2mHost");
    // PROXY RÉACTIF PROPRE : en OWL 2, le proxy d'un useState porte le
    // callback de render de son PROPRIÉTAIRE. Lire ici le proxy du
    // renderer ne re-rendrait que le renderer (et ses enfants aux props
    // inchangés seraient sautés). useState() sur la cible brute crée un
    // NOUVEAU proxy lié au render de CE composant -- toute écriture sur
    // la cible (peu importe par quel proxy) notifie tous les abonnés.
    this.reactiveRecord = owl.useState(this.ctx.record || {});
  }

  /** Contexte du formulaire (posé par FormRenderer dans son env). */
  get ctx() { return this.env.__formCtx || {}; }
  get fieldNodes() { return this.ctx.fieldNodes || []; }
  get record() { return this.reactiveRecord; }
  get fieldsInfo() { return this.ctx.fieldsInfo || {}; }
  get hasRecordId() { return !!this.ctx.hasRecordId; }

  // ── descripteur du champ (nœud d'arch figé par le parseur) ──
  get slot() { return this.fieldNodes[this.props.index] || {}; }
  get node() { return this.slot.node || null; }
  get name() { return this.slot.name || ""; }
  get mode() { return this.slot.mode || this.props.mode || "cell"; }
  get info() { return this.fieldsInfo[this.name] || {}; }

  // ── modes de rendu (mêmes conventions que les anciens slots) ──
  get isBare() { return this.mode === "widget" || this.mode === "statusbar"; }
  get showLabel() { return this.mode === "cell" && this.node && !this.node.getAttribute("nolabel"); }

  // ── attributs dynamiques, ré-évalués sur le record réactif ──
  get hidden() {
    const expr = this.node ? this.node.getAttribute("invisible") : null;
    if (!expr || expr === "1" || expr === "True") return false;
    return evaluateSimpleCondition(expr, this.record) === true;
  }
  get required() {
    return computeRequired(this.node, this.info, this.record);
  }

  get fieldType() { return (this.info && this.info.type) || "char"; }
  get widgetName() { return this.node ? this.node.getAttribute("widget") : null; }
  get isOne2many() { return this.fieldType === "one2many" && !this.widgetName; }
  get isStaticReadonly() {
    const raw = this.node ? this.node.getAttribute("readonly") : null;
    return raw === "1" || raw === "true";
  }
  get isEmptyValue() {
    const v = this.record[this.name];
    return v === undefined || v === null || v === false || v === "";
  }
  get isNewSimulation() {
    // Simulation "Nouveau" hors ligne : readonly statique + vide + pas
    // d'id (comme renderField -- un champ de séquence ne montre jamais
    // un input vide en création).
    return this.isStaticReadonly && !this.hasRecordId && this.isEmptyValue;
  }

  get labelText() {
    return attr(this.node, "string") || this.info.label || this.name;
  }
  get cellClass() {
    return "o_row d-flex" + (this.required ? " o_field_required" : "");
  }

  // ── composant interne (CLASSE résolue : t-component dynamique exige
  // la classe elle-même, la résolution par nom n'est que statique) ──
  get innerName() {
    if (this.isNewSimulation) return null;
    if (this.widgetName === "statusbar") return FIELD_COMPONENTS.statusbar.Component;
    if (this.widgetName) {
      // handle : invisible en formulaire (comme chez Odoo) -- PAS de
      // repli par type (l'ancien rendu vanilla ne sérialisait pas ce
      // champ, cf. suite widgets).
      if (this.widgetName === "handle") return null;
      const widget = WIDGET_COMPONENTS[this.widgetName];
      if (widget) return widget;
      // widget inconnu : repli par type (comportement historique).
    }
    const entry = FIELD_COMPONENTS[this.fieldType];
    return entry ? entry.Component : null;
  }

  get innerProps() {
    const name = this.name;
    const value = this.record[name];
    if (this.isOne2many) {
      return buildPropsFor("one2many", name, this.info, this.node, value, this.record).props;
    }
    if (this.widgetName === "statusbar") {
      const visibleAttr = attr(this.node, "statusbar_visible");
      return {
        name,
        selection: this.info.selection || [],
        visibleStates: visibleAttr ? visibleAttr.split(",").map((s) => s.trim()) : null,
        initialValue: value,
      };
    }
    if (this.widgetName && WIDGET_COMPONENTS[this.widgetName] && this.widgetName !== "handle") {
      return buildWidgetProps(this.widgetName, name, this.info, this.node, value, this.record, (v) => this.onFieldChange(v));
    }
    const built = buildPropsFor(this.fieldType, name, this.info, this.node, value, this.record);
    if (!built) return { name };
    built.props.onChange = (v) => this.onFieldChange(v);
    return built.props;
  }

  /** Champ typé modifié : record réactif + bulle `change` au conteneur. */
  onFieldChange(value) {
    this.record[this.name] = value;
    const host = this.cellRef.el || this.o2mHostRef.el;
    emitFieldChange(host);
  }

}


// Registre nominal : t-component résout les noms dans static components.
export const FIELD_COMPONENTS = {
  char: { name: "CharField", Component: CharFieldOwl },
  text: { name: "TextField", Component: TextFieldOwl },
  integer: { name: "IntegerField", Component: IntegerFieldOwl },
  float: { name: "FloatField", Component: FloatFieldOwl },
  boolean: { name: "BooleanField", Component: BooleanFieldOwl },
  selection: { name: "SelectionField", Component: SelectionFieldOwl },
  date: { name: "DateField", Component: DateFieldOwl },
  datetime: { name: "DatetimeField", Component: DatetimeFieldOwl },
  monetary: { name: "MonetaryField", Component: MonetaryFieldOwl },
  many2one: { name: "Many2oneField", Component: Many2oneFieldOwl },
  many2many: { name: "Many2manyTagsField", Component: Many2manyTagsFieldOwl },
  one2many: { name: "One2manyField", Component: One2manyFieldOwl },
  statusbar: { name: "StatusbarField", Component: StatusbarFieldOwl },
};

FormField.components = {};
for (const entry of Object.values(FIELD_COMPONENTS)) {
  FormField.components[entry.name] = entry.Component;
}

/**
 * Registre des WIDGETS explicites de l'arch (attribut widget="..."),
 * comme la clé "widget" des fields_get/webclient Odoo 17 -- COMPOSANTS
 * OWL depuis l'itération 25 (l'ancien registre vanilla
 * views/fields/widget_registry.js est supprimé). <FormField> consulte
 * ce registre AVANT le dispatch par type ; le ListRenderer utilise les
 * MÊMES composants pour ses cellules (variante listDisplay).
 */
export const WIDGET_COMPONENTS = {
  priority: PriorityFieldOwl,
  badge: BadgeFieldOwl,
  boolean_toggle: BooleanToggleFieldOwl,
  radio: RadioFieldOwl,
  image: ImageFieldOwl,
  email: LinkFieldOwl,
  phone: LinkFieldOwl,
  url: LinkFieldOwl,
  statinfo: StatinfoFieldOwl,
};

/**
 * Dérivation widget -> props (EXPORTÉE : partagée entre <FormField> et
 * le ListRenderer pour ses cellules). `onChange` est fourni par
 * <FormField> (écrit le record réactif + diffuse `change`) ; en liste
 * il est absent (cellules en lecture seule).
 */
export function buildWidgetProps(widget, name, info, node, value, values, onChange) {
  const readonly = computeReadonly(node, values);
  const base = { name, value, readonly };
  switch (widget) {
    case "priority":
      return { ...base, entries: selectionEntries(info), onChange };
    case "radio":
      return { ...base, entries: selectionEntries(info), onChange };
    case "badge": {
      const entries = selectionEntries(info);
      const found = entries.find(([key]) => String(key) === String(value));
      return { ...base, label: found ? found[1] : (value === false || value === undefined || value === null ? "—" : String(value)) };
    }
    case "boolean_toggle":
      return { ...base, onChange };
    case "image":
      return { ...base, label: info.label || name, onChange };
    case "email":
    case "phone":
    case "url":
      return { ...base, mode: widget, onChange };
    case "statinfo":
      return { ...base, text: attr(node, "string") || info.label || name };
    default:
      return base;
  }
}
