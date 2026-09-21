/**
 * views/fields/statinfo/statinfo_field.js
 * =======================================
 * Widget "statinfo" : tuile du button_box (compteur + libellé). Dans le
 * button_box la tuile est compilée par form_arch_parser.js (emitButtonBox)
 * avec la valeur injectée ; ce renderer n'est utilisé que si le champ se
 * retrouve hors button_box.
 */
import { hiddenValueInput } from "../selection_utils.js";

export function renderStatinfoField(name, info, node, initialValue) {
  const wrap = document.createElement("div");
  wrap.className = "o_stat_info d-inline-flex flex-column align-items-center";
  wrap.appendChild(hiddenValueInput(name, initialValue));
  const value = document.createElement("span");
  value.className = "o_stat_value fw-bold fs-5";
  value.textContent = String(initialValue === undefined || initialValue === false ? 0 : initialValue);
  const text = document.createElement("span");
  text.className = "o_stat_text text-muted small";
  text.textContent = node.getAttribute("string") || info.label || name;
  wrap.appendChild(value);
  wrap.appendChild(text);
  return wrap;
}
