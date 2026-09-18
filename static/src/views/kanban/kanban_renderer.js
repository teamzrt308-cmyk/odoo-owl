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
import { formatCellValue } from "../list/list_renderer_utils.js";
import { parseKanbanArch } from "./kanban_arch_parser.js";

/**
 * Construit le proxy record consommé par les expressions du template
 * (record.x.value / record.x.raw_value), comme buildKanbanRecordProxy
 * de l'ancien moteur et comme les templates kanban natifs d'Odoo.
 */
function buildKanbanRecordProxy(record, fieldsInfo) {
  const proxy = {};
  for (const [fname, info] of Object.entries(fieldsInfo)) {
    const rawValue = record[fname];
    proxy[fname] = {
      raw_value: rawValue === undefined ? false : rawValue,
      value: formatCellValue(rawValue, info),
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
    fieldsInfo: { type: Object },
    onCardClick: { type: Function },
  };

  setup() {
    // Variables de scope historiques du moteur kanban (ex: les archs
    // contenant t-if="!selection_mode" continuent de fonctionner).
    this.selection_mode = false;
  }
}

/**
 * Mounts the OWL kanban renderer into `target` for the given arch.
 * @param {HTMLElement} target - conteneur déjà inséré dans le DOM
 * @param {string} archXml - arch XML brute de la vue kanban
 * @param {Object} fieldsInfo - métadonnées des champs du modèle
 * @param {Array} records - enregistrements bruts de la page courante
 * @param {Function} onCardClick - callback(recordId)
 * @returns {Promise<{ destroy: Function }>}
 */
export async function mountKanbanView(target, archXml, fieldsInfo, records, onCardClick) {
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
    buildKanbanRecordProxy(rawRecord, fieldsInfo)
  );

  // Le template du renderer dépend de l'arch : il est injecté dans
  // l'App OWL au mount -- même principe que le chargement des templates
  // qweb par le webclient d'Odoo avant le rendu d'une vue.
  KanbanRenderer.template = parsed.templateName;

  const { destroy } = await mountOwlApp(
    KanbanRenderer,
    target,
    {
      records: recordProxies,
      fieldsInfo,
      onCardClick,
    },
    { [parsed.templateName]: parsed.templateXml }
  );

  return { destroy };
}
