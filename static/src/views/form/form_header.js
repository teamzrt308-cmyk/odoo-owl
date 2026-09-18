/**
 * views/form/form_header.js
 * =========================
 * Rendu du <header> d'une vue formulaire : boutons d'action (dont les
 * type="object" branchés sur le contrôleur) + champ widget="statusbar".
 *
 * Chez Odoo, les boutons du header sont rendus par le renderer de la
 * vue form tandis que le statusbar est un widget de champ
 * (views/fields/statusbar/) -- ce fichier suit ce même découpage : les
 * boutons ici, la barre d'état déléguée au widget de champ.
 *
 * Paramètre onObjectButtonClick(methodName) : callback invoqué au clic
 * sur un bouton type="object" (ex: action_confirm). Les boutons de tout
 * autre type (type="action", ou sans type) conservent le comportement
 * "non disponible hors-ligne" -- hors périmètre volontairement.
 */

import { evaluateSimpleCondition } from "../../core/py_js/py_utils.js";
import { renderStatusbarField } from "../fields/statusbar/statusbar.js";

export function renderHeaderInto(node, headerRow, fieldsInfo, initialValues, onObjectButtonClick) {
  const buttonsWrapper = document.createElement("div");
  buttonsWrapper.className = "o_statusbar_buttons d-flex align-items-center align-content-around flex-wrap gap-1";

  const buttons = Array.from(node.children).filter((c) => c.tagName === "button");
  buttons.forEach((btnNode) => {
    const label = btnNode.getAttribute("string");
    if (!label) return;

    const invisibleExpr = btnNode.getAttribute("invisible");
    if (invisibleExpr) {
      const result = evaluateSimpleCondition(invisibleExpr, initialValues);
      if (result === true) return;
    }

    const btnType = btnNode.getAttribute("type");
    const btnName = btnNode.getAttribute("name");

    const btn = document.createElement("button");
    btn.type = "button";
    const isPrimary =
      btnNode.getAttribute("class")?.includes("oe_highlight") ||
      buttonsWrapper.children.length === 0;
    btn.className = "btn " + (isPrimary ? "btn-primary" : "btn-secondary");
    btn.textContent = label;

    // Only type="object" buttons with a valid name and a wired callback
    // are made functional. Everything else (type="action", missing name,
    // no callback provided) keeps the previous placeholder behavior —
    // this scope restriction is intentional (type="action" handled later).
    if (btnType === "object" && btnName && typeof onObjectButtonClick === "function") {
      btn.addEventListener("click", () => onObjectButtonClick(btnName));
    } else {
      btn.title = "Action non disponible hors-ligne pour le moment";
      btn.addEventListener("click", () => {
        alert("Cette action nécessite une connexion à Odoo — non disponible hors-ligne pour le moment.");
      });
    }

    buttonsWrapper.appendChild(btn);
  });

  headerRow.appendChild(buttonsWrapper);

  const statusField = Array.from(node.querySelectorAll("field")).find(
    (f) => f.getAttribute("widget") === "statusbar"
  );

  if (statusField) {
    const fieldName = statusField.getAttribute("name");
    const info = fieldsInfo[fieldName];

    if (info && info.selection) {
      const currentValue = initialValues ? initialValues[fieldName] : undefined;
      const fieldWrapper = renderStatusbarField(fieldName, info, statusField, currentValue);
      if (fieldWrapper) headerRow.appendChild(fieldWrapper);
    }
  }
}
