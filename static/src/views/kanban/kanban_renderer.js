/**
 * views/kanban/kanban_renderer.js
 * ===============================
 * Rendu de la vue Kanban par OWL -- même architecture qu'Odoo : le
 * renderer est un composant OWL dont le TEMPLATE est issu de l'arch
 * (compilée par kanban_arch_parser.js, comme le vrai webclient compile
 * l'arch en templates QWeb/OWL pour KanbanRecord).
 *
 * Chaque carte est rendue dans le scope du template avec :
 *   - `record` : proxy { <champ>: { raw_value, value } } (même forme que
 *     l'ancien moteur et que les templates kanban Odoo) ;
 *   - les variables posées par t-set dans l'arch ;
 *   - `selection_mode` (false), variable historique du scope kanban.
 *
 * Le mount est asynchrone (montage OWL) et retourne un handle
 * { destroy } -- même contrat que les contrôleurs de vues du moteur
 * hors ligne (voir list_controller.js, consommateur de ce renderer).
 */

import { mountOwlApp } from "../../owl/app.js";
import { formatCellValue, groupLabel } from "../list/list_renderer_utils.js";
import { parseKanbanArch } from "./kanban_arch_parser.js";

/**
 * Construit le proxy record consommé par les expressions du template
 * (record.x.value / record.x.raw_value), comme buildKanbanRecordProxy
 * de l'ancien moteur et comme les templates kanban natifs d'Odoo.
 */
function buildKanbanRecordProxy(record, fieldsInfo, declaredFields) {
  const proxy = {};
  const known = new Set(Object.keys(fieldsInfo || {}));
  // Les archs réelles déclarent des champs absents de fields_info (ex.
  // binaires image_128/avatar_128 exclus du manifest) : ils existent
  // quand même dans le scope des templates, sinon record.x.value
  // explose au rendu.
  for (const fname of declaredFields || []) known.add(fname);
  for (const fname of known) {
    const rawValue = record[fname];
    proxy[fname] = {
      raw_value: rawValue === undefined ? false : rawValue,
      value: formatCellValue(rawValue, fieldsInfo ? fieldsInfo[fname] : null),
    };
  }
  if (proxy.id === undefined) {
    proxy.id = { raw_value: record.id, value: record.id };
  }
  return proxy;
}

export class KanbanRenderer extends owl.Component {
  static props = {
    records: { type: Array },
    // group by : nom du champ ou null -> grille à plat
    groupBy: { optional: true },
    // [{ key, label, records }] en mode groupé (records = proxies)
    columns: { type: Array, optional: true },
    fieldsInfo: { type: Object },
    onCardClick: { type: Function },
    // Drag & drop + quick create (itération 13) : le renderer gère le
    // geste, le contrôleur possède le modèle (comme chez Odoo, où le
    // renderer délègue au model via le contrôleur).
    canDrag: { type: Boolean, optional: true },
    onRecordMove: { type: Function, optional: true },
    onQuickCreate: { type: Function, optional: true },
  };

  setup() {
    // Variables de scope historiques du moteur kanban (ex: les archs
    // contenant t-if="!selection_mode" continuent de fonctionner).
    this.selection_mode = false;
    this.rootRef = owl.useRef("root");
    // État interactif : colonne en création rapide, carte glissée,
    // colonne cible surlignée.
    this.state = owl.useState({
      quickCreateColumn: null,
      draggingRecordId: null,
      dragOverColumn: null,
    });
  }

  // ── Helpers d'arch Odoo 17 évalués dans les expressions de cartes ──
  // Les archs réelles appellent kanban_image(...) dans t-value /
  // t-attf-src et kanban_color(...) dans t-attf-class ; hors ligne les
  // binaires ne sont pas servis -> placeholder local et palette fixe
  // (classes o_kanban_color_0..10 du CSS Odoo).
  kanban_image() {
    return "assets/default-app.png";
  }

  kanban_color(color) {
    const n = ((parseInt(color, 10) || 0) % 11 + 11) % 11;
    return `o_kanban_color_${n}`;
  }

  // ── Quick create (le create vit dans le contrôleur : onQuickCreate) ──

  openQuickCreate(columnKey) {
    this.state.quickCreateColumn = columnKey;
    // L'input sera rendu par le re-render OWL (programmé sur rAF) :
    // on attend son apparition, avec quelques relances.
    this.focusQuickCreateInput(10);
  }

  focusQuickCreateInput(tries) {
    const schedule = window.requestAnimationFrame || ((cb) => setTimeout(cb, 16));
    schedule(() => {
      const input = this.rootRef.el && this.rootRef.el.querySelector(".o_quick_create_input");
      if (input) {
        input.focus();
        return;
      }
      if (tries > 0) this.focusQuickCreateInput(tries - 1);
    });
  }

  closeQuickCreate() {
    this.state.quickCreateColumn = null;
  }

  onQuickCreateKeydown(ev, columnKey) {
    if (ev.key === "Enter") {
      ev.preventDefault();
      const name = ev.target.value.trim();
      this.state.quickCreateColumn = null;
      if (name && this.props.onQuickCreate) this.props.onQuickCreate(columnKey, name);
    } else if (ev.key === "Escape") {
      this.state.quickCreateColumn = null;
    }
  }

  // ── Drag & drop (le write vit dans le contrôleur : onRecordMove) ──

  onRecordDragStart(ev, recordId) {
    this.state.draggingRecordId = recordId;
    if (ev.dataTransfer) {
      ev.dataTransfer.effectAllowed = "move";
      try {
        ev.dataTransfer.setData("text/plain", String(recordId));
      } catch (e) {
        // harnais de test sans dataTransfer complet
      }
    }
  }

  onRecordDragEnd() {
    this.state.draggingRecordId = null;
    this.state.dragOverColumn = null;
  }

  onColumnDragOver(ev, columnKey) {
    if (this.state.draggingRecordId === null) return;
    this.state.dragOverColumn = columnKey;
  }

  onColumnDrop(ev, columnKey) {
    const recordId = this.state.draggingRecordId;
    this.state.draggingRecordId = null;
    this.state.dragOverColumn = null;
    if (recordId === null || !this.props.onRecordMove) return;
    this.props.onRecordMove(recordId, columnKey);
  }
}

/**
 * Construit les colonnes de group by (itération 11) : regroupement
 * client des records par champ, libellés partagés avec la liste
 * (groupLabel), tri par libellé.
 */
function buildKanbanColumns(records, groupBy, fieldsInfo) {
  const info = (fieldsInfo || {})[groupBy];
  const map = new Map();
  for (const record of records) {
    const raw = record ? record[groupBy] : undefined;
    const key =
      info && info.type === "boolean"
        ? raw ? "1" : "0"
        : raw === false || raw === undefined || raw === null || raw === ""
          ? "__none__"
          : Array.isArray(raw)
            ? String(raw[0])
            : String(raw);
    if (!map.has(key)) map.set(key, { rawValue: raw, records: [] });
    map.get(key).records.push(record);
  }
  const columns = [...map.entries()].map(([key, { rawValue, records: groupRecords }]) => ({
    key: `${groupBy}:${key}`,
    label: groupLabel(rawValue, info),
    records: groupRecords.map((r) => buildKanbanRecordProxy(r, fieldsInfo)),
  }));
  columns.sort((a, b) => a.label.localeCompare(b.label, "fr"));
  return columns;
}

/**
 * Mounts the OWL kanban renderer into `target` for the given arch.
 * @param {HTMLElement} target - conteneur déjà inséré dans le DOM
 * @param {string} archXml - arch XML brute de la vue kanban
 * @param {Object} fieldsInfo - métadonnées des champs du modèle
 * @param {Array} records - enregistrements bruts de la page courante
 * @param {Function} onCardClick - callback(recordId)
 * @param {string|null} [groupBy] - champ de regroupement (colonnes)
 * @param {Object} [extras] - { canDrag, onRecordMove, onQuickCreate }
 *   (branches groupées interactives ; le contrôleur kanban dédié les
 *   fournit, l'ancienne branche kanban du ListController non)
 * @returns {Promise<{ destroy: Function }>}
 */
export async function mountKanbanView(target, archXml, fieldsInfo, records, onCardClick, groupBy = null, extras = {}) {
  const parsed = parseKanbanArch(archXml);

  if (parsed.error) {
    console.warn("[kanban_renderer]", parsed.error);
    const errDiv = document.createElement("div");
    errDiv.className = "o_kanban_view text-muted p-3";
    errDiv.textContent = `Vue Kanban non disponible pour ce modèle. (${parsed.error})`;
    target.appendChild(errDiv);
    return { destroy() {} };
  }

  const recordProxies = (records || []).map((rawRecord) =>
    buildKanbanRecordProxy(rawRecord, fieldsInfo, parsed.fields)
  );
  const columns = groupBy ? buildKanbanColumns(records || [], groupBy, fieldsInfo) : [];

  // Le template du renderer dépend de l'arch : il est injecté dans
  // l'App OWL au mount -- même principe que le chargement des templates
  // qweb par le webclient d'Odoo avant le rendu d'une vue.
  KanbanRenderer.template = parsed.templateName;

  const { destroy } = await mountOwlApp(
    KanbanRenderer,
    target,
    {
      records: recordProxies,
      groupBy,
      columns,
      fieldsInfo,
      onCardClick,
      canDrag: !!extras.canDrag,
      onRecordMove: extras.onRecordMove || null,
      onQuickCreate: extras.onQuickCreate || null,
    },
    { [parsed.templateName]: parsed.templateXml, ...(parsed.subTemplates || {}) }
  );

  return { destroy };
}
