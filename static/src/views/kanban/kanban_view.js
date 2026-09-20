/**
 * views/kanban/kanban_view.js
 * ===========================
 * Descripteur de la vue Kanban, enregistré dans le registre "views" --
 * même mécanisme qu'Odoo 17 (web/static/src/views/kanban/kanban_view.js).
 *
 * Spécificité hors ligne : le Kanban partage aujourd'hui son contrôleur
 * avec la vue Liste (pager + recherche + view-switcher gérés par
 * ListController) ; seul le RENDERER est propre au Kanban et est rendu
 * par OWL (voir kanban_renderer.js). Le descripteur ci-dessous enveloppe
 * ListController en forçant view="kanban" -- le dispatcher views/view.js
 * monte ce composant comme n'importe quel Controller. Si le besoin d'un
 * contrôleur dédié apparaît (group by, chargement dynamique par
 * colonne...), il suffira de remplacer la classe ci-dessous sans toucher
 * au registre.
 */

import { registry } from "../../core/registry.js";
import { ListController } from "../list/list_controller.js";

class KanbanController extends owl.Component {
  static components = { ListController };
  static template = owl.xml`<ListController params="kanbanParams" env="props.env"/>`;

  get kanbanParams() {
    const params = this.props.params || {};
    return { ...params, view: params.view || "kanban" };
  }
}

registry.category("views").add("kanban", {
  Controller: KanbanController,
});
