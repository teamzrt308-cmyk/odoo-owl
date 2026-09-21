/**
 * views/fields/url/url_field.js
 * =============================
 * Widgets "email" / "phone" / "url" : saisie normale + bouton-lien
 * (mailto:, tel:, http) qui ouvre le gestionnaire de l'appareil -- le
 * href est construit localement, aucun serveur.
 */
import { computeReadonly } from "../../../owl/field_bridge.js";

const MODES = {
  email: { type: "email", icon: "fa-envelope", title: "Envoyer un e-mail", build: (v) => `mailto:${v}` },
  phone: { type: "tel", icon: "fa-phone", title: "Appeler", build: (v) => `tel:${v}` },
  url: { type: "url", icon: "fa-external-link", title: "Ouvrir le lien", build: (v) => (v.startsWith("http") ? v : `https://${v}`) },
};

export function renderLinkField(name, info, node, initialValue, initialValues) {
  const mode = MODES[node.getAttribute("widget")] || MODES.url;
  const readonly = computeReadonly(node, initialValues);
  const wrap = document.createElement("div");
  wrap.className = "input-group input-group-sm o_field_link";

  const input = document.createElement("input");
  input.type = mode.type;
  input.className = "form-control";
  input.id = `field-${name}`;
  input.setAttribute("data-field", name);
  input.value = initialValue === false || initialValue === undefined || initialValue === null ? "" : String(initialValue);
  wrap.appendChild(input);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn btn-outline-secondary";
  btn.title = mode.title;
  btn.innerHTML = `<i class="fa ${mode.icon}"></i>`;
  btn.addEventListener("click", () => {
    const value = (input.value || "").trim();
    if (value) window.open(mode.build(value), "_blank");
  });
  wrap.appendChild(btn);
  return wrap;
}
