/**
 * views/kanban/kanban_view.js
 * ===========================
 * Descripteur de la vue Kanban, enregistré dans le registre "views" --
 * même mécanisme qu'Odoo (web/static/src/views/kanban/kanban_view.js).
 *
 * Spécificité hors ligne : le Kanban partage aujourd'hui son contrôleur
 * avec la vue Liste (pager + recherche + view-switcher gérés par
 * list_controller.js) ; seul le RENDERER est propre au Kanban et est
 * rendu par OWL (voir kanban_renderer.js). Si le besoin d'un contrôleur
 * dédié apparaît (group by, chargement dynamique par colonne...), il
 * suffira de remplacer le mount ci-dessous sans toucher au registre.
 */

import { registry } from "../../core/registry.js";
import { mountListController } from "../list/list_controller.js";

registry.category("views").add("kanban", {
  mount(container, params, env) {
    return mountListController(container, { ...params, view: params.view || "kanban" }, env);
  },
});
