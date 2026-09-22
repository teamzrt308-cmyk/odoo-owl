/**
 * views/fields/radio/radio_field.js
 * =================================
 * Widget "radio" : champ selection rendu en boutons radio (Odoo 17),
 * valeur synchronisée dans l'input caché #field-<name>.
 */
import { selectionEntries, hiddenValueInput } from "../selection_utils.js";
import { computeReadonly } from "../../form/field_attrs.js";
import { emitFieldChange } from "../../../owl/field_events.js";

export function renderRadioField(name, info, node, initialValue, initialValues) {
  const readonly = computeReadonly(node, initialValues);
  const wrap = document.createElement("div");
  wrap.className = "o_field_radio d-inline-flex flex-column gap-1";
  const hidden = hiddenValueInput(name, initialValue);
  wrap.appendChild(hidden);
  for (const [key, label] of selectionEntries(info)) {
    const item = document.createElement("label");
    item.className = "d-flex align-items-center gap-2 m-0";
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = `radio-${name}`;
    radio.value = String(key);
    radio.checked = String(initialValue) === String(key);
    if (readonly) radio.disabled = true;
    radio.addEventListener("change", () => {
      if (radio.checked) {
        hidden.value = String(key);
        emitFieldChange(hidden);
      }
    });
    const text = document.createElement("span");
    text.textContent = label;
    item.appendChild(radio);
    item.appendChild(text);
    wrap.appendChild(item);
  }
  return wrap;
}
