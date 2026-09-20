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
