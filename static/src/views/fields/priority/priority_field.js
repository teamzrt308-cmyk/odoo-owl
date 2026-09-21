/**
 * views/fields/priority/priority_field.js
 * ========================================
 * Widget "priority" : drapeaux/étoiles cliquables (Odoo 17 : fa-stars
 * sur un champ selection) -- édition au clic, valeur synchronisée dans
 * l'input caché #field-<name> pour le sérialiseur.
 */
import { selectionEntries, selectionLabel, selectionRank, hiddenValueInput } from "../selection_utils.js";
import { computeReadonly } from "../../../owl/field_bridge.js";

export function renderPriorityField(name, info, node, initialValue) {
  const entries = selectionEntries(info);
  const rank = selectionRank(info, initialValue);
  const readonly = computeReadonly(node, null) || entries.length === 0;

  const wrap = document.createElement("div");
  wrap.className = "o_priority d-inline-flex align-items-center gap-1";
  const hidden = hiddenValueInput(name, initialValue);
  wrap.appendChild(hidden);

  const paint = (currentRank) => {
    [...wrap.querySelectorAll(".o_priority_star")].forEach((el, i) => {
      el.className = `o_priority_star fa ${currentRank >= 0 && i <= currentRank ? "fa-star text-warning" : "fa-star-o text-muted"}`;
    });
  };
  for (let i = 0; i < entries.length; i++) {
    const s = document.createElement("span");
    s.className = "o_priority_star fa";
    s.setAttribute("aria-label", selectionLabel(info, entries[i][0]));
    if (!readonly) {
      s.style.cursor = "pointer";
      s.title = selectionLabel(info, entries[i][0]);
      s.addEventListener("click", () => {
        const value = entries[i][0];
        hidden.value = String(value);
        paint(i);
        hidden.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }
    wrap.appendChild(s);
  }
  paint(rank);
  return wrap;
}
