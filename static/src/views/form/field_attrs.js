/**
 * views/form/field_attrs.js
 * =========================
 * Évaluation des attributs dynamiques de l'arch (readonly/required),
 * héritée du field_bridge (itération 24). PURE : retourne des booléens,
 * ne mute JAMAIS le DOM -- les résultats sont consommés au rendu par
 * <FormField> (field_component.js) et par les widgets explicites
 * (registre WIDGET_COMPONENTS, itération 25). Côté pipeline natif, ces valeurs sont
 * ré-évaluées à CHAQUE rendu sur le record réactif (l'équivalent des
 * attrs dynamiques du webclient, sans couche impérative).
 *
 * (La mutation DOM live de l'ancienne couche dynamic_field_attrs.js --
 * applyDynamicAttrs / attachLiveBusinessRules -- est supprimée : le
 * re-render réactif la remplace.)
 */

import { evaluateSimpleCondition } from "../../core/py_js/py_utils.js";

/**
 * Readonly du nœud <field> : attribut statique ("1"/"True") ou
 * expression Python évaluée sur les valeurs courantes.
 */
export function computeReadonly(node, initialValues) {
  if (!node) return false;
  const readonlyExpr = node.getAttribute("readonly");
  if (!readonlyExpr) return false;
  if (readonlyExpr === "1" || readonlyExpr === "True") return true;
  return evaluateSimpleCondition(readonlyExpr, initialValues) === true;
}

/**
 * Idem côté required. `info.required` reflète le required statique
 * défini par le modèle (fields_get) ; l'attribut `required="expr"` sur
 * le nœud <field> ne porte, comme dans l'original, que les expressions
 * dynamiques (jamais "1"/"True", déjà couvert par info.required).
 */
export function computeRequired(node, info, initialValues) {
  if (info.required) return true;
  if (!node) return false;
  const requiredExpr = node.getAttribute("required");
  if (!requiredExpr || requiredExpr === "1" || requiredExpr === "True") return false;
  return evaluateSimpleCondition(requiredExpr, initialValues) === true;
}
