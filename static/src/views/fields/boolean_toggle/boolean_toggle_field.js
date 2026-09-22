/**
 * views/fields/boolean_toggle/boolean_toggle_field.js
 * ===================================================
 * Widget "boolean_toggle" : interrupteur (form-check-switch Bootstrap 5)
 * -- le CHECKBOX lui-même porte id="field-<name>" : le sérialiseur lit
 * el.checked comme pour le widget boolean natif.
 */
import { computeReadonly, emitFieldChange } from "../../../owl/field_bridge.js";

export function renderBooleanToggleField(name, info, node, initialValue, initialValues) {
  const wrap = document.createElement("div");
  wrap.className = "form-check form-switch o_boolean_toggle d-inline-block m-0";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.className = "form-check-input";
  input.id = `field-${name}`;
  input.setAttribute("data-field", name);
  input.checked = !!initialValue;
  if (computeReadonly(node, initialValues)) {
    input.setAttribute("readonly", "readonly");
    input.disabled = true;
  }
  input.addEventListener("change", () => {
    // reflet "icône" éventuel à côté (liste : non applicable)
    emitFieldChange(input);
  });
  wrap.appendChild(input);
  return wrap;
}
