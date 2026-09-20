/**
 * views/list/list_arch_parser.js
 * ==============================
 * Parsing de l'arch XML d'une vue liste -- mêmes responsabilités que
 * list_arch_parser.js chez Odoo 17 : transformer l'arch brute en une
 * structure exploitée par le renderer (colonnes, options, décorations),
 * SANS générer le moindre DOM. Le ListRenderer (list_renderer.js) est un
 * composant OWL à template statique, comme le webclient natif -- seul le
 * KANBAN compile l'arch en template (cartes spécifiques au record).
 */

/**
 * Extrait les expressions decoration-* d'un nœud <field> de l'arch
 * (badge de sélection coloré, exactement comme le webclient natif).
 */
function extractDecorations(fieldNode) {
  const decorations = {};
  if (!fieldNode) return decorations;
  for (const color of ["success", "info", "warning", "danger", "muted", "primary"]) {
    const expr = fieldNode.getAttribute(`decoration-${color}`);
    if (expr) decorations[color] = expr;
  }
  return decorations;
}

/**
 * @param {string} archXml - l'arch XML brute de la vue list/tree
 * @param {Object} fieldsInfo - métadonnées des champs du modèle
 * @returns {{ columns: Array } | { error: string }}
 *   columns : [{ field, label, optional, decoration }]
 */
export function parseListArch(archXml, fieldsInfo) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(archXml, "text/xml");

  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    return { error: "Erreur de parsing XML : " + parseError.textContent };
  }

  const treeRoot = doc.querySelector("tree, list");
  const columns = [];

  if (treeRoot) {
    for (const fieldNode of Array.from(treeRoot.children).filter((c) => c.tagName === "field")) {
      const fname = fieldNode.getAttribute("name");
      if (!fname || !fieldsInfo[fname]) continue;

      const widget = fieldNode.getAttribute("widget");
      if (widget === "handle") continue;

      const columnInvisible = fieldNode.getAttribute("column_invisible");
      if (columnInvisible === "1" || columnInvisible === "True") continue;

      const optional = fieldNode.getAttribute("optional"); // "show" | "hide" | null
      columns.push({
        field: fname,
        label:
          fieldNode.getAttribute("string") ||
          fieldsInfo[fname].label ||
          fname,
        optional,
        decoration: extractDecorations(fieldNode),
      });
    }
  }

  // Repli historique : arch sans <field> exploitable -> 6 premières
  // métadonnées du modèle.
  if (columns.length === 0) {
    for (const fname of Object.keys(fieldsInfo || {}).slice(0, 6)) {
      columns.push({
        field: fname,
        label: fieldsInfo[fname].label || fname,
        optional: null,
        decoration: {},
      });
    }
  }

  return { columns };
}
