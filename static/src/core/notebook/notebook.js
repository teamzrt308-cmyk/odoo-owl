/**
 * core/notebook/notebook.js
 * Rendu du notebook (onglets <page>) d'une vue formulaire.
 * Positionné dans core/ comme chez Odoo (composant Notebook réutilisable
 * en dehors des seules vues formulaire) -- et, comme chez Odoo, SANS
 * dépendance vers le moteur de vues : la compilation des enfants de
 * chaque page est injectée par l'appelant (form_compiler.js passe sa
 * fonction renderChildrenInto), ce qui évite tout import croisé
 * core/ -> views/.
 * Depends on:
 * - core/py_js/py_utils.js (isNodeVisible)
 */

import { isNodeVisible } from "../py_js/py_utils.js";

/**
 * @param {Element} node - nœud <notebook> de l'arch
 * @param {Object} fieldsInfo
 * @param {Object} initialValues
 * @param {Object} securityContext
 * @param {boolean} hasRecordId
 * @param {Function} renderChildren - callback (xmlNode, htmlParent, ...)
 *   injecté par l'appelant pour compiler le contenu des pages.
 */
export function renderNotebook(node, fieldsInfo, initialValues, securityContext, hasRecordId, renderChildren) {
  if (typeof renderChildren !== "function") {
    throw new Error("renderNotebook: un callback renderChildren doit être fourni par l'appelant.");
  }

  const wrapper = document.createElement("div");
  wrapper.className = "o_notebook";

  const nav = document.createElement("div");
  nav.className = "o_notebook_headers";

  const navUl = document.createElement("ul");
  navUl.className = "nav nav-tabs";
  nav.appendChild(navUl);

  const content = document.createElement("div");
  content.className = "tab-content";

  const pages = Array.from(node.children).filter(
    (c) => c.tagName === "page" && isNodeVisible(c, securityContext, initialValues)
  );

  pages.forEach((page, index) => {
    const label = page.getAttribute("string") || `Page ${index + 1}`;

    const li = document.createElement("li");
    li.className = "nav-item";
    const link = document.createElement("a");
    link.className = "nav-link" + (index === 0 ? " active" : "");
    link.href = "#";
    link.textContent = label;
    li.appendChild(link);
    navUl.appendChild(li);

    const pane = document.createElement("div");
    pane.className = "tab-pane" + (index === 0 ? " active" : "");
    renderChildren(page, pane, fieldsInfo, initialValues, securityContext, hasRecordId);
    content.appendChild(pane);

    link.addEventListener("click", (e) => {
      e.preventDefault();
      navUl.querySelectorAll(".nav-link").forEach((l) => l.classList.remove("active"));
      content.querySelectorAll(".tab-pane").forEach((p) => p.classList.remove("active"));
      link.classList.add("active");
      pane.classList.add("active");
    });
  });

  wrapper.appendChild(nav);
  wrapper.appendChild(content);
  return pages.length > 0 ? wrapper : null;
}
