/**
 * views/fields/widget_registry.js
 * ================================
 * Registre des WIDGETS explicites de l'arch (attribut widget="..."),
 * comme la clé "widget" des fields_get/webclient Odoo 17. <FormField>
 * consulte ce registre AVANT le dispatch par type : un champ
 * <field name="priority" widget="priority"/> est rendu par le widget
 * priority même si son type est selection.
 */
import { renderPriorityField } from "./priority/priority_field.js";
import { renderBadgeField } from "./badge/badge_field.js";
import { renderBooleanToggleField } from "./boolean_toggle/boolean_toggle_field.js";
import { renderRadioField } from "./radio/radio_field.js";
import { renderImageField } from "./image/image_field.js";
import { renderLinkField } from "./url/url_field.js";
import { renderHandleField } from "./handle/handle_field.js";
import { renderStatinfoField } from "./statinfo/statinfo_field.js";

export const WIDGET_RENDERERS = {
  priority: renderPriorityField,
  badge: renderBadgeField,
  boolean_toggle: renderBooleanToggleField,
  radio: renderRadioField,
  image: renderImageField,
  email: renderLinkField,
  phone: renderLinkField,
  url: renderLinkField,
  handle: renderHandleField,
  statinfo: renderStatinfoField,
};
