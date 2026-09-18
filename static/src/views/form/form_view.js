/**
 * views/form/form_view.js
 * =======================
 * Descripteur de la vue Formulaire, enregistré dans le registre "views"
 * -- même mécanisme qu'Odoo (web/static/src/views/form/form_view.js),
 * où chaque type de vue s'enregistre dans registry.category("views")
 * et expose son Controller au webclient via le dispatcher views/view.js.
 *
 * Spécificité hors ligne : le "Controller" est une fonction mount()
 * impérative (montage DOM + retour d'une fonction destroy) plutôt qu'un
 * composant OWL -- la migration progressive vers des Controllers OWL se
 * fait descripteur par descripteur sans changer ce registre.
 */

import { registry } from "../../core/registry.js";
import { mountFormController } from "./form_controller.js";

registry.category("views").add("form", {
  mount: mountFormController,
});
