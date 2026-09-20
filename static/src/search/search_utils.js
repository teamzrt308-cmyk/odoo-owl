/**
 * search/search_utils.js
 * ======================
 * Utilitaires de recherche partagés par les contrôleurs de vues
 * (list, kanban) -- l'équivalent hors ligne du domaine de recherche
 * d'Odoo (web/core/domain.js + with_search) :
 *  - matchesSimpleDomain : évaluateur de domaines « triples »
 *    [['champ', 'op', valeur], ...] (ET implicite), déjà utilisé par le
 *    bandeau dashboard achats -- désormais partagé ;
 *  - applyFilters : applique les filtres ACTIFS du menu Filtres ;
 *  - buildSelectionFilters : filtres dérivés des champs selection quand
 *    le manifest ne fournit pas d'arch <search> (hors ligne il n'y a
 *    pas d'ir.filters -- écart assumé).
 */

/**
 * Évalue un domaine simple (uniquement des triples, ET implicite) sur
 * un enregistrement brut du cache. Ops supportés : =, !=, in, not in,
 * <, <=, >, >=. Un champ non défini est traité comme false (valeur
 * Odoo « vide »).
 */
export function matchesSimpleDomain(record, domain) {
  return domain.every(([field, op, value]) => {
    let raw = record[field];
    if (raw === undefined) raw = false;
    switch (op) {
      case "=": return raw === value;
      case "!=": return raw !== value;
      case "in": return Array.isArray(value) && value.includes(raw);
      case "not in": return Array.isArray(value) && !value.includes(raw);
      case "<": return raw !== false && raw < value;
      case "<=": return raw !== false && raw <= value;
      case ">": return raw !== false && raw > value;
      case ">=": return raw !== false && raw >= value;
      default: return true;
    }
  });
}

/**
 * Applique les filtres actifs (noms) sur les enregistrements -- ET
 * entre les filtres, comme chez Odoo. Les noms inconnus (favori
 * obsolète, filtre retiré du manifest) sont ignorés.
 * @param {Array} records
 * @param {Object} filterDefsByName - { name -> {name, label, domain} }
 * @param {Array} activeNames
 */
export function applyFilters(records, filterDefsByName, activeNames) {
  if (!activeNames || activeNames.length === 0) return records;
  const active = activeNames
    .map((name) => filterDefsByName[name])
    .filter((def) => def && Array.isArray(def.domain));
  if (active.length === 0) return records;
  return records.filter((record) => active.every((def) => matchesSimpleDomain(record, def.domain)));
}

/**
 * Filtres de repli dérivés des champs selection du modèle : un filtre
 * « Champ : valeur » par paire (key, label) -- permet le menu Filtres
 * sur les modèles sans arch <search> dans le manifest.
 */
export function buildSelectionFilters(fieldsInfo) {
  const filters = [];
  for (const [fname, info] of Object.entries(fieldsInfo || {})) {
    if (!info || info.type !== "selection") continue;
    for (const [key, label] of info.selection || []) {
      filters.push({
        name: `${fname}:${key}`,
        label: `${info.label || fname} : ${label}`,
        domain: [[fname, "=", key]],
      });
    }
  }
  return filters;
}
