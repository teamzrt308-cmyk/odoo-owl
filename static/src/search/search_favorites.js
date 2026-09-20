/**
 * search/search_favorites.js
 * ==========================
 * Favoris de recherche -- l'équivalent hors ligne d'ir.filters d'Odoo
 * (search/favorite_menu) : une recherche complète (requête texte +
 * filtres actifs + group by) est enregistrée PAR MODÈLE dans le
 * localStorage et réapplicable en un clic depuis le menu Favoris du
 * control panel.
 */

const storageKey = (model) => `pwa_search_favorites:${model}`;

export function getSearchFavorites(model) {
  try {
    return JSON.parse(localStorage.getItem(storageKey(model)) || "[]");
  } catch (e) {
    return [];
  }
}

/** Enregistre (ou écrase) un favori { name, query, filters, groupBy }. */
export function saveSearchFavorite(model, favorite) {
  const favorites = getSearchFavorites(model).filter((f) => f.name !== favorite.name);
  favorites.push({
    name: favorite.name,
    query: favorite.query || "",
    filters: [...(favorite.filters || [])],
    groupBy: favorite.groupBy || null,
  });
  localStorage.setItem(storageKey(model), JSON.stringify(favorites));
  return favorites;
}

export function deleteSearchFavorite(model, name) {
  const favorites = getSearchFavorites(model).filter((f) => f.name !== name);
  localStorage.setItem(storageKey(model), JSON.stringify(favorites));
  return favorites;
}

/**
 * Retourne le favori correspondant à l'état de recherche courant
 * (requête + filtres actifs + group by), ou undefined -- utilisé pour
 * cocher le favori actif dans le menu.
 */
export function matchFavorite(favorites, { query, activeFilters, groupBy }) {
  const activeKey = [...(activeFilters || [])].sort().join(",");
  return (favorites || []).find(
    (f) =>
      (f.query || "") === (query || "") &&
      [...(f.filters || [])].sort().join(",") === activeKey &&
      (f.groupBy || null) === (groupBy || null)
  );
}
