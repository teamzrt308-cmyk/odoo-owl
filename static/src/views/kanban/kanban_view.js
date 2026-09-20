/**
 * views/kanban/kanban_view.js
 * ===========================
 * Descripteur de la vue Kanban, enregistré dans le registre "views" --
 * même mécanisme qu'Odoo 17 (web/static/src/views/kanban/kanban_view.js) :
 * l'entrée expose le COMPOSANT Controller et c'est le dispatcher
 * views/view.js qui le monte avec les params de l'action + l'env du
 * webclient (voir KanbanController dans kanban_controller.js).
 */

import { registry } from "../../core/registry.js";
import { KanbanController } from "./kanban_controller.js";

registry.category("views").add("kanban", {
  Controller: KanbanController,
});
