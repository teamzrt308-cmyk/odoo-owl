/**
 * owl/field_bridge.js
 * ====================
*/

import { mountOwlApp } from "./app.js";
import { evaluateSimpleCondition } from "../core/py_js/py_utils.js";

/**
 * Même logique que dynamic_field_attrs.js::applyDynamicAttrs, côté
 * readonly, mais ne produit qu'un booléen (pas de mutation DOM) —
 * partagée par tous les widgets OWL migrés.
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

/**
 * CONTRAT ÉVÉNEMENTIEL field_bridge : les widgets OWL (many2one,
 * many2many_tags, one2many, widgets du registre...) ne sont pas des
 * <input> natifs -- quand leur valeur change ils diffusent un événement
 * `change` qui BULLE jusqu'au conteneur du formulaire, exactement comme
 * un input natif. C'est ce qui déclenche, sans aucun câblage spécifique :
 *  - la ré-évaluation LIVE des attributs dynamiques
 *    (dynamic_field_attrs.attachLiveBusinessRules) ;
 *  - la cascade de règles métier RACINE (form_controller
 *    ::scheduleDocumentRulesSync -> runDocumentRules, ex: amount_total
 *    recalculé quand une LIGNE one2many change).
 */
export function emitFieldChange(el) {
  if (!el) return;
  // Event pris dans le REALM du document (le bundle et les widgets
  // peuvent tourner dans un contexte vm différent du document jsdom/natif).
  const View = el.ownerDocument && el.ownerDocument.defaultView;
  const EV = (View && View.Event) || Event;
  el.dispatchEvent(new EV("change", { bubbles: true }));
}

/**
 * Crée le conteneur synchrone + lance le mount OWL dedans + retourne le
 * conteneur immédiatement. C'est le cœur de l'adaptateur : chaque
 * renderXField() n'a plus qu'à l'appeler avec son Component et ses props.
 *
 * Une fois le mount terminé, le composant est exposé sur son hôte via
 * mountPoint._owlComponent, et si le composant définit _attachToHost(host),
 * cette méthode est appelée pour publier ses API impératives sur le conteneur
 * (ex: le widget one2many expose getLines()/applyLineUpdates() -- consommés
 * par form_serializer/form_controller).
 *
 * @param {typeof owl.Component} Component
 * @param {Object} options
 * @param {string} options.name - nom du champ (pour data-owl-field et les logs)
 * @param {string} options.fieldTypeClass - ex: "char", "text", "boolean"
 *   -> classe CSS `o_field_<fieldTypeClass>_mount` sur le conteneur
 * @param {Object} options.props - props passées telles quelles au Component
 * @param {Object} [options.attributes] - attributs supplémentaires posés sur
 *   le conteneur (ex: "data-o2m-root" pour le widget one2many)
 * @returns {HTMLElement} le conteneur, à insérer immédiatement dans le DOM
 */
export function renderOwlField(Component, { name, fieldTypeClass, props, attributes = {} }) {
  const mountPoint = document.createElement("span");
  mountPoint.className = `o_owl_mount o_field_${fieldTypeClass}_mount`;
  mountPoint.setAttribute("data-owl-field", name);
  for (const [attr, value] of Object.entries(attributes)) {
    mountPoint.setAttribute(attr, value);
  }

  const ready = mountOwlApp(Component, mountPoint, props)
    .then(({ component }) => {
      mountPoint._owlComponent = component;
      if (typeof component._attachToHost === "function") {
        component._attachToHost(mountPoint);
      }
      return component;
    })
    .catch((err) => {
      console.error(
        `[field_bridge] échec du mount OWL pour "${name}" (${fieldTypeClass}) :`,
        err
      );
    });

  // Promesse de disponibilité du widget (résolue après le mount OWL,
  // jamais rejetée) : consommée par le renderer form pour attendre que
  // toutes les saisies existent avant la première passe de règles.
  mountPoint._owlReady = ready;

  return mountPoint;
}