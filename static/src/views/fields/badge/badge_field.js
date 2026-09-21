/**
 * views/fields/badge/badge_field.js
 * ==================================
 * Widget "badge" : pastille arrondie (comme les tags Odoo) -- affichage
 * du libellé selection, valeur conservée via input caché.
 */
import { selectionLabel, hiddenValueInput } from "../selection_utils.js";

export function renderBadgeField(name, info, node, initialValue) {
  const wrap = document.createElement("div");
  wrap.className = "o_field_badge";
  wrap.appendChild(hiddenValueInput(name, initialValue));
  const badge = document.createElement("span");
  badge.className = "badge rounded-pill o_tag_badge";
  badge.textContent = selectionLabel(info, initialValue) || "—";
  wrap.appendChild(badge);
  return wrap;
}
