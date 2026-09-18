/**
 * views/form/form_arch_parser.js
 * ==============================
 * Parsing de l'arch XML d'une vue formulaire -- même responsabilité que
 * form_arch_parser.js chez Odoo : transformer l'arch brute en une
 * structure exploitable par le renderer, SANT générer le moindre DOM.
 * La génération DOM reste le rôle de form_renderer.js/form_compiler.js
 * (specificité hors ligne du moteur).
 */

/**
 * @param {string} archXml - l'arch XML brute de la vue form
 * @returns {{ formRoot: Element } | { error: string }}
 */
export function parseFormViewArch(archXml) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(archXml, "text/xml");

  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    return { error: "Erreur de parsing XML : " + parseError.textContent };
  }

  const formRoot = doc.querySelector("form");
  if (!formRoot) {
    return { error: "Aucun élément <form> trouvé dans cette vue." };
  }

  return { formRoot };
}
