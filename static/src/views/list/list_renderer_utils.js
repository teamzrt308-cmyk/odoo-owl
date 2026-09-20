/**
 * views/list/list_renderer_utils.js
 * Rendering and formatting of list view cells, used as-is by the
 * Kanban engine (views/kanban/kanban_renderer.js). 
*/

import { evaluateSimpleCondition } from "../../core/py_js/py_utils.js";

/**
 * Reads the decoration-info/success/danger/warning/muted attributes of the
 * <field> in the arch and evaluates their conditions to select the badge
 * color, exactly as the actual Odoo web client does.
 */
export function getDecorationClass(decorations, record) {
  // decorations : map extraite de l'arch par list_arch_parser.js
  // ({ success: "state == 'done'", ... }) -- plus aucun accès DOM.
  if (!decorations) return "text-bg-secondary";
  for (const [color, expr] of Object.entries(decorations)) {
    const result = evaluateSimpleCondition(expr, record);
    if (result === true) return `text-bg-${color}`;
  }
  return "text-bg-secondary";
}

/** 
 * Format a raw value into readable text based on the field type.
 * Used by both the list view and the Kanban engine. 
*/
export function formatCellValue(value, info) {
  if (value === false || value === undefined || value === null) return "";
  if (!info) return String(value);

  switch (info.type) {
    case "many2one":
      return Array.isArray(value) ? value[1] : String(value);
    case "boolean":
      return value ? "✓" : "";
    case "selection": {
      const found = (info.selection || []).find(([v]) => String(v) === String(value));
      return found ? found[1] : String(value);
    }
    default:
      return String(value);
  }
}

/**
 * Libellé d'un groupe selon le type du champ de regroupement (tuple
 * many2one -> libellé, selection -> libellé, boolean -> Oui/Non,
 * vide -> "Aucun"), comme le GroupByMenu natif -- partagé par les
 * renderers list (en-têtes de groupes) et kanban (titres de colonnes).
 * Un boolean false est une valeur légitime ("Non"), pas un vide.
 */
export function groupLabel(rawValue, info) {
  if (info && info.type === "boolean") return rawValue ? "Oui" : "Non";
  if (rawValue === false || rawValue === undefined || rawValue === null || rawValue === "") {
    return "Aucun";
  }
  if (Array.isArray(rawValue)) return rawValue[1] || "Aucun";
  if (info && info.type === "selection") {
    const found = (info.selection || []).find(([v]) => String(v) === String(rawValue));
    return found ? found[1] : String(rawValue);
  }
  return String(rawValue);
}

/**
 * Filtre textuel client partagé par les contrôleurs list et kanban :
 * un record matche si UN de ses champs formatés contient la requête.
 */
export function recordMatchesQuery(record, fieldsInfo, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  for (const [fname, info] of Object.entries(fieldsInfo)) {
    const raw = record[fname];
    if (raw === undefined || raw === false || raw === null) continue;
    const text = formatCellValue(raw, info);
    if (text && text.toLowerCase().includes(q)) return true;
  }
  return false;
}
