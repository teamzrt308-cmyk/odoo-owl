/**
 * core/notifications/notification_container.js
 * ============================================
 * NotificationContainer -- composant OWL, même architecture qu'Odoo 17 :
 * le conteneur des toasts est monté UNE FOIS par le webclient (il vit
 * au-dessus de toutes les actions) et s'abonne au service de
 * notifications via le bus "notification:changed". Chaque toast est
 * rendu par le template OWL (type -> couleur/icône, titre, message,
 * boutons d'action, croix de fermeture).
 */

import { bus } from "../bus/bus_service.js";
import { notifications } from "./notification_service.js";
import { mountOwlApp } from "../../owl/app.js";

const TYPE_STYLES = {
  warning: "text-bg-warning",
  danger: "text-bg-danger",
  success: "text-bg-success",
  info: "text-bg-info",
};

const TYPE_ICONS = {
  warning: "fa-exclamation-triangle",
  danger: "fa-times-circle",
  success: "fa-check-circle",
  info: "fa-info-circle",
};

export class NotificationContainer extends owl.Component {
  static template = owl.xml`
    <div class="o_notification_container position-fixed top-0 end-0 p-3" style="z-index: 2000; max-width: 340px;">
      <div t-foreach="state.items" t-as="item" t-key="item.id" role="alert"
           t-att-class="'o_notification toast show d-flex mb-2 border-0 shadow ' + (styles[item.type] || 'text-bg-secondary') + (item.className ? ' ' + item.className : '')">
        <div class="toast-body d-flex gap-2 align-items-start w-100">
          <i t-att-class="'fa ' + (icons[item.type] || 'fa-info-circle') + ' mt-1'"/>
          <div class="flex-grow-1">
            <strong t-if="item.title" class="d-block small mb-1" t-esc="item.title"/>
            <span class="small o_notification_message" t-esc="item.message"/>
            <div t-if="item.buttons.length > 0" class="mt-2 pt-2 border-top d-flex gap-2">
              <button t-foreach="item.buttons" t-as="btn" t-key="btn.name" type="button"
                      class="btn btn-sm btn-light o_notification_button"
                      t-on-click.stop="() => this.onButtonClick(item, btn)" t-esc="btn.name"/>
            </div>
          </div>
          <button type="button" class="btn-close btn-close-white ms-1" aria-label="Fermer"
                  t-on-click.stop="() => this.close(item.id)"/>
        </div>
      </div>
    </div>`;

  setup() {
    // Maps exposées au scope du template (type -> classes/icônes).
    this.styles = TYPE_STYLES;
    this.icons = TYPE_ICONS;
    this.state = owl.useState({ items: [] });
    // Remplacement de PREMIER niveau : le pattern réactif fiable.
    this.onChange = (ev) => {
      this.state.items = ev.detail || [];
    };
    bus.addEventListener("notification:changed", this.onChange);
    owl.onWillDestroy(() => bus.removeEventListener("notification:changed", this.onChange));
  }

  close(id) {
    notifications.close(id);
  }

  onButtonClick(item, btn) {
    if (btn.onClick) btn.onClick();
    // Sauf demande explicite, un bouton ferme le toast (comme Odoo).
    if (btn.close !== false) this.close(item.id);
  }
}

/**
 * Montage du conteneur (contrat : async -> destroy) -- appelé une seule
 * fois par webclient.js.
 */
export async function mountNotificationContainer(target) {
  const { destroy } = await mountOwlApp(NotificationContainer, target, {});
  return destroy;
}
