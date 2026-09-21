/**
 * views/fields/selection_utils.js
 * ================================
 * Petits utilitaires partagés par les widgets basés sur un champ
 * selection (priority, radio, badge) : lookup de libellé et rang.
 */
export function selectionEntries(info) {
  return Array.isArray(info && info.selection) ? info.selection : [];
}

export function selectionLabel(info, value) {
  const entry = selectionEntries(info).find(([key]) => String(key) === String(value));
  return entry ? entry[1] : (value === false || value === undefined || value === null ? "" : String(value));
}

export function selectionRank(info, value) {
  return selectionEntries(info).findIndex(([key]) => String(key) === String(value));
}

/**
 * Crée l'input caché qui porte la valeur pour le sérialiseur
 * (collectFormData lit `#field-<name>`, voir form_serializer.js).
 */
export function hiddenValueInput(name, value) {
  const input = document.createElement("input");
  input.type = "hidden";
  input.id = `field-${name}`;
  input.setAttribute("data-field", name);
  input.value = value === false || value === undefined || value === null ? "" : String(value);
  return input;
}
