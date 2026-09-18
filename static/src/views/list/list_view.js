/**
 * views/list/list_view.js
 * =======================
 * Descripteur de la vue Liste, enregistré dans le registre "views" --
 * même mécanisme qu'Odoo (web/static/src/views/list/list_view.js).
 */

import { registry } from "../../core/registry.js";
import { mountListController } from "./list_controller.js";

registry.category("views").add("list", {
  mount: mountListController,
});
