/**
 * views/form/form_view.js
 * =======================
 * Descripteur de la vue Formulaire, enregistré dans le registre "views"
 * -- même mécanisme qu'Odoo 17 (web/static/src/views/form/form_view.js) :
 * l'entrée expose le COMPOSANT Controller et c'est le dispatcher
 * views/view.js qui le monte avec les params de l'action + l'env du
 * webclient (voir FormController dans form_controller.js).
 */

import { registry } from "../../core/registry.js";
import { FormController } from "./form_controller.js";

registry.category("views").add("form", {
  Controller: FormController,
});
