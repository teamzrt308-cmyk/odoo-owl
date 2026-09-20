/**
 * search/search_arch_parser.js
 * ============================
 * Parseur de l'arch de vue <search> -- même responsabilité que
 * search_arch_parser.js chez Odoo 17 : extraire du XML les éléments que
 * le control panel transforme en menus :
 *  - les <filter> portant un attribut domain  -> filtres activables
 *    (menu Filtres, évalués côté client par search_utils.js) ;
 *  - les <filter> portant un context "{ 'group_by': 'x' }" (imbriqués
 *    dans un <group> chez Odoo) -> candidats du menu « Grouper par ».
 *
 * Les domaines Odoo sont écrits en syntaxe Python à guillemets simples
 * (domain="[('state','=','draft')]") -- conversion prudente en JSON
 * (échange des quotes), comme le fait le webclient qui les reçoit déjà
 * évalués côté serveur.
 */

/** Convertit un attribut domain d'arch en tableau JS (ou null). */
export function parseSearchDomain(attr) {
  if (!attr) return null;
  const raw = attr.trim();
  try {
    // Domaine déjà « JSON » (listes à doubles crochets).
    return JSON.parse(raw);
  } catch (e) {
    // Syntaxe Python usuelle d'Odoo : quotes simples + TUPLES
    // (a, b, c) -- JSON n'a pas de tuples, les parenthèses deviennent
    // des crochets (les listes/queries JSON restent inchangées).
    try {
      return JSON.parse(raw.replace(/'/g, '"').replace(/\(/g, "[").replace(/\)/g, "]"));
    } catch (e2) {
      return null;
    }
  }
}

/** Extrait le champ d'un context "{ 'group_by': 'x' }" (ou null). */
export function parseGroupByContext(context) {
  if (!context) return null;
  const match = context.match(/['"]?group_by['"]?\s*:\s*['"]([\w.]+)['"]/);
  return match ? match[1] : null;
}

/**
 * @param {string} archXml - l'arch XML brute de la vue <search>
 * @returns {{ filters: Array<{name,label,domain}>, groupBys: Array<{name,label,fieldName}> } | { error: string }}
 */
export function parseSearchArch(archXml) {
  try {
    const doc = new DOMParser().parseFromString(archXml, "text/xml");
    const root = doc.querySelector("search");
    if (!root) return { error: "arch <search> introuvable" };

    const filters = [];
    const groupBys = [];
    const seen = new Set();
    let autoIndex = 0;

    for (const node of root.querySelectorAll("filter")) {
      const context = node.getAttribute("context") || "";
      const fieldName = parseGroupByContext(context);
      const nameAttr = node.getAttribute("name") || `filter_${autoIndex++}`;
      if (seen.has(nameAttr)) continue;
      seen.add(nameAttr);

      const label = node.getAttribute("string") || node.getAttribute("name") || nameAttr;

      if (fieldName) {
        // Filtre de groupe (menu « Grouper par ») : le candidat est
        // identifié par le CHAMP, comme chez Odoo où l'action reçoit
        // le group_by du context.
        groupBys.push({ name: fieldName, label, fieldName });
        continue;
      }
      const domain = parseSearchDomain(node.getAttribute("domain"));
      if (!domain) continue; // filtre sans domaine évaluable : ignoré
      filters.push({ name: nameAttr, label, domain });
    }

    return { filters, groupBys };
  } catch (err) {
    return { error: `arch <search> illisible : ${err.message}` };
  }
}
