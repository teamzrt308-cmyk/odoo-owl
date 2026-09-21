/**
 * views/fields/handle/handle_field.js
 * ===================================
 * Widget "handle" : poignée de réordonnancement. En FORMULAIRE elle est
 * invisible (comme chez Odoo) ; en LISTE le renderer affiche la poignée
 * (voir list_renderer.js). Le glisser-déposer de réordonnancement des
 * lignes one2many reste à faire (itération suivante) -- écart documenté.
 */
export function renderHandleField() {
  const span = document.createElement("span");
  span.className = "text-muted";
  return span;
}
