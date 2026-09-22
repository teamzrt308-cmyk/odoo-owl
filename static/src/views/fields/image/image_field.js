/**
 * views/fields/image/image_field.js
 * =================================
 * Widget "image" : aperçu depuis la valeur base64 du cache local
 * (placeholder hors ligne si vide) + upload local (FileReader, aucun
 * réseau) -- valeur base64 synchronisée dans l'input caché.
 */
import { hiddenValueInput } from "../selection_utils.js";
import { computeReadonly, emitFieldChange } from "../../../owl/field_bridge.js";

const PLACEHOLDER = "assets/default-app.png";

function dataUri(value) {
  const str = typeof value === "string" ? value : "";
  if (!str) return PLACEHOLDER;
  return str.startsWith("data:") ? str : `data:image/png;base64,${str}`;
}

export function renderImageField(name, info, node, initialValue, initialValues) {
  const readonly = computeReadonly(node, initialValues);
  const wrap = document.createElement("div");
  wrap.className = "o_field_image d-inline-block";
  const hidden = hiddenValueInput(name, initialValue);
  wrap.appendChild(hidden);

  const img = document.createElement("img");
  img.className = "o_image_preview img-fluid rounded border";
  img.alt = info.label || name;
  img.src = dataUri(initialValue);
  wrap.appendChild(img);

  if (!readonly) {
    img.style.cursor = "pointer";
    img.title = "Cliquer pour choisir une image (stockée localement)";
    const file = document.createElement("input");
    file.type = "file";
    file.accept = "image/*";
    file.style.display = "none";
    file.addEventListener("change", () => {
      const f = file.files && file.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || "");
        hidden.value = result.split(",")[1] || "";
        img.src = result;
        emitFieldChange(hidden);
      };
      reader.readAsDataURL(f);
    });
    img.addEventListener("click", () => file.click());
    wrap.appendChild(file);
  }
  return wrap;
}
