/**
 * views/fields/selection_utils.js
 * ================================
 * Petits utilitaires partagés par les widgets basés sur un champ
 * selection (priority, radio, badge -- composants OWL depuis l'it. 25) :
 * lookup de libellé et rang. (hiddenValueInput supprimé : les inputs
 * cachés sont désormais déclarés dans les templates des composants.)
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
