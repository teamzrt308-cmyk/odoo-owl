/**
 * owl/field_events.js
 * ===================
 * CONTRAT ÉVÉNEMENTIEL (hérité du field_bridge, itération 24) : les
 * widgets non natifs (many2one, many2many_tags, one2many, widgets du
 * registre vanilla, <FormField>) ne sont pas toujours des <input>
 * natifs -- quand leur valeur change par une action UTILISATEUR, ils
 * diffusent un événement `change` qui BULLE jusqu'au conteneur du
 * formulaire, exactement comme un input natif. C'est ce qui déclenche,
 * sans aucun câblage spécifique, la cascade de règles métier RACINE
 * (form_controller::scheduleDocumentRulesSync -> runDocumentRules,
 * ex: amount_total recalculé quand une LIGNE one2many change).
 *
 * RÈGLE D'OR (itération 22) : ne PAS appeler cette fonction depuis les
 * ré-écritures programmatiques (applyLineUpdates, adjustLineFields,
 * applyGraph) -- notifier re-déclencherait la synchro en boucle.
 */

/**
 * Diffuse un événement `change` bubblant sur `el` (peut être nul :
 * no-op). L'Event est pris dans le REALM du document (le bundle et les
 * widgets peuvent tourner dans un contexte vm différent du document
 * jsdom/natif).
 */
export function emitFieldChange(el) {
  if (!el) return;
  const View = el.ownerDocument && el.ownerDocument.defaultView;
  const EV = (View && View.Event) || Event;
  el.dispatchEvent(new EV("change", { bubbles: true }));
}
