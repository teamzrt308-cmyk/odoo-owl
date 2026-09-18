/**
 * webclient/breadcrumb/breadcrumb.js
 * ===================================
 * Construction du fil d'Ariane -- positionné dans webclient/breadcrumb/
 * comme chez Odoo. Chez le vrai webclient le breadcrumb est un composant
 * OWL alimenté par les contrôleurs via env.config ; dans le moteur hors
 * ligne, le control panel (search/control_panel/) assemble lui-même son
 * DOM et consomme ces éléments bruts.
 */

/**
 * Builds the breadcrumb block: the previous-entry item (link back to the
 * list, hidden by default) and the current-entry item.
 *
 * @returns {{ breadcrumb: HTMLElement, breadcrumbListItem: HTMLElement,
 *             breadcrumbListLink: HTMLAnchorElement, breadcrumbCurrent: HTMLElement }}
 */
export function buildBreadcrumb() {
  const breadcrumb = document.createElement("div");
  breadcrumb.className = "o_breadcrumb d-flex gap-1 text-truncate align-items-center";

  const breadcrumbListItem = document.createElement("div");
  breadcrumbListItem.className = "o_breadcrumb_item d-none";
  breadcrumbListItem.innerHTML = `
    <a href="#" class="o_breadcrumb_item_link text-truncate"></a>
    <i class="oi oi-chevron-right mx-1 text-muted small"></i>
  `;
  breadcrumb.appendChild(breadcrumbListItem);
  const breadcrumbListLink = breadcrumbListItem.querySelector("a");

  const lastBreadcrumbItem = document.createElement("div");
  lastBreadcrumbItem.className = "o_last_breadcrumb_item active d-flex fs-4 min-w-0 align-items-center";
  const breadcrumbCurrent = document.createElement("span");
  breadcrumbCurrent.className = "min-w-0 text-truncate";
  lastBreadcrumbItem.appendChild(breadcrumbCurrent);
  breadcrumb.appendChild(lastBreadcrumbItem);

  return { breadcrumb, breadcrumbListItem, breadcrumbListLink, breadcrumbCurrent };
}
