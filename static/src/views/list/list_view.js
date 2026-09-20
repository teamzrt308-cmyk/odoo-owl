/**
 * views/list/list_view.js
 * =======================
 * Descripteur de la vue Liste, enregistré dans le registre "views" --
 * même mécanisme qu'Odoo 17 (web/static/src/views/list/list_view.js) :
 * l'entrée expose le COMPOSANT Controller et c'est le dispatcher
 * views/view.js qui le monte avec les params de l'action + l'env du
 * webclient (voir ListController dans list_controller.js).
 */

import { registry } from "../../core/registry.js";
import { ListController } from "./list_controller.js";

registry.category("views").add("list", {
  Controller: ListController,
});
