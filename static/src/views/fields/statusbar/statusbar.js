/**
 * views/fields/statusbar/statusbar.js
 * ===================================
 * Widget "statusbar" (barre de progression des états) -- chez Odoo, le
 * statusbar est un WIDGET DE CHAMP (views/fields/statusbar/), pas une
 * pièce du header : ce fichier reproduit ce positionnement. Le rendu
 * des boutons du <header>, lui, vit dans views/form/form_header.js.
 *
 * Signature alignée sur celle des autres widgets de champ du moteur
 * hors ligne : (name, info, node, currentValue) -> HTMLElement.
 */

export function renderStatusbarField(name, info, node, currentValue) {
  const visibleAttr = node.getAttribute("statusbar_visible");
  const visibleStates = visibleAttr
    ? visibleAttr.split(",").map((s) => s.trim())
    : null;

  const visibleSelection = info.selection.filter(([value]) => {
    if (!visibleStates) return true;
    return visibleStates.includes(String(value)) || String(value) === String(currentValue);
  });

  const fieldWrapper = document.createElement("div");
  fieldWrapper.setAttribute("name", name);
  fieldWrapper.className = "o_field_widget o_readonly_modifier o_field_statusbar";

  const statusDiv = document.createElement("div");
  statusDiv.className = "o_statusbar_status";
  statusDiv.setAttribute("role", "radiogroup");
  statusDiv.setAttribute("aria-label", "Barre de statut");

  visibleSelection.forEach(([value, label], idx) => {
    const isActive =
      (currentValue !== undefined && String(currentValue) === String(value)) ||
      (currentValue === undefined && idx === 0);
    const isFirst = idx === 0;
    const isLast = idx === info.selection.length - 1;

    const step = document.createElement("button");
    step.type = "button";
    step.className =
      "btn btn-secondary o_arrow_button" +
      (isFirst ? " o_first" : "") +
      (isLast ? " o_last" : "") +
      (isActive ? " o_arrow_button_current" : "");
    step.disabled = true;
    step.setAttribute("role", "radio");
    step.setAttribute("aria-checked", isActive ? "true" : "false");
    if (isActive) step.setAttribute("aria-current", "step");
    step.dataset.value = value;
    step.textContent = label;
    statusDiv.insertBefore(step, statusDiv.firstChild);
  });

  fieldWrapper.appendChild(statusDiv);
  return fieldWrapper;
}
