/**
 * views/form/dynamic_field_attrs.js
 * =================================
 * Attributs dynamiques des champs de formulaire (readonly/required) et
 * ré-évaluation "live" de ces attributs pendant la saisie.
 *
 * Chez Odoo, les attrs dynamiques de l'arch (invisible/readonly/required)
 * sont résolus par le parsing de l'arch (form_arch_parser) puis appliqués
 * par le renderer à chaque modification du record. Ici, le moteur hors
 * ligne génère du DOM directement : ce fichier joue ce rôle côté form,
 * d'où son positionnement dans views/form/ (il ne décrit RIEN du modèle --
 * la couche "modèle" hors ligne est model/rules_engine/).
 *
 * Contient :
 *  - applyDynamicAttrs() / resetDynamicAttrs() : application et rollback
 *    des attributs dynamiques sur l'élément DOM d'un champ ;
 *  - markReadonly() / markRequired() : mutations DOM de bas niveau ;
 *  - attachLiveBusinessRules() : branche les écouteurs input/change sur le
 *    formulaire rendu pour re-appliquer les attrs dynamiques en continu
 *    (équivalent local de la ré-évaluation par le renderer Odoo).
 */

import { evaluateSimpleCondition } from "../../core/py_js/py_utils.js";
import { collectFormData } from "./form_serializer.js";

/**
 * Applies the dynamic readonly/required attributes of a <field> node
 * to the generated HTML element. inputEl can be a direct <input>/<select>,
 * or a wrapper <div> (many2one, one2many, boolean).
 */
export function applyDynamicAttrs(node, inputEl, currentValues) {
  if (!inputEl) return;

  const readonlyExpr = node.getAttribute("readonly");
  if (readonlyExpr === "1" || readonlyExpr === "True") {
    markReadonly(inputEl);
  } else if (readonlyExpr) {
    const result = evaluateSimpleCondition(readonlyExpr, currentValues);
    if (result === true) markReadonly(inputEl);
  }

  const requiredExpr = node.getAttribute("required");
  if (requiredExpr && requiredExpr !== "1" && requiredExpr !== "True") {
    const result = evaluateSimpleCondition(requiredExpr, currentValues);
    if (result === true) markRequired(inputEl);
  }
}

export function markReadonly(el) {
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT") {
    if (el.type === "checkbox") {
      el.disabled = true;
    } else {
      el.readOnly = true;
      el.style.backgroundColor = "#f5f5f5";
    }
    return;
  }
  el.querySelectorAll("input, select, textarea, button, a").forEach((child) => {
    child.disabled = true;
    child.style.pointerEvents = "none";
  });
  el.style.opacity = "0.7";
}

export function markRequired(el) {
  if ("required" in el) {
    el.required = true;
  } else {
    el.querySelectorAll("input, select, textarea").forEach((child) => {
      if ("required" in child) child.required = true;
    });
  }
}

/**
 * Resets previously applied dynamic attributes before
 * re-evaluation (otherwise, a field that has become editable again would remain locked).
 */
export function resetDynamicAttrs(el, baseRequired) {
  if (!el) return;

  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT") {
    if (el.type === "checkbox") {
      el.disabled = false;
    } else {
      el.readOnly = false;
      el.style.backgroundColor = "";
    }
    el.required = !!baseRequired;
    return;
  }

  el.querySelectorAll("input, select, textarea, button, a").forEach((child) => {
    child.disabled = false;
    child.style.pointerEvents = "";
    if ("required" in child) child.required = !!baseRequired;
  });
  el.style.opacity = "";
}

/**
 * Hooks up the live re-evaluation of dynamic attributes (readonly/
 * required) for the entire form: on every input event, the current
 * values ​​are read and the rules for each relevant <field>
 * are re-applied.
 *
 * @returns {Function} Cleanup function to be called when the form is
 * unmounted (removes the "input"/"change" listeners attached here).
 */
export function attachLiveBusinessRules(archXmlString, containerEl, fieldsInfo) {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(archXmlString, "application/xml");
  const root = xmlDoc.documentElement;

  const dynamicFieldNodes = Array.from(root.querySelectorAll("field")).filter((node) => {
    return ["readonly", "required"].some((key) => {
      const raw = node.getAttribute(key);
      return raw && raw !== "1" && raw !== "True";
    });
  });

  if (dynamicFieldNodes.length === 0) return () => {};

  const revaluateAll = () => {
    const currentValues = collectFormData(containerEl, fieldsInfo);

    dynamicFieldNodes.forEach((node) => {
      const fieldName = node.getAttribute("name");
      if (!fieldName) return;

      const wrapperEl = containerEl.querySelector(`[data-field-row="${fieldName}"] .o_field_widget`);
      if (!wrapperEl) return;

      const info = fieldsInfo[fieldName];
      const baseRequired = info ? !!info.required : false;

      resetDynamicAttrs(wrapperEl, baseRequired);
      applyDynamicAttrs(node, wrapperEl, currentValues);
    });
  };

  containerEl.addEventListener("input", revaluateAll);
  containerEl.addEventListener("change", revaluateAll);

  return () => {
    containerEl.removeEventListener("input", revaluateAll);
    containerEl.removeEventListener("change", revaluateAll);
  };
}
