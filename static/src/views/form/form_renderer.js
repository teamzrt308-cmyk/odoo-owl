/**
 * views/form/form_renderer.js
 * ===========================
 * Rendu de la vue formulaire par OWL -- même architecture qu'Odoo 17 :
 * le renderer est un composant OWL dont le TEMPLATE est COMPILÉ depuis
 * l'arch (form_arch_parser.js::buildFormTemplate, comme le webclient
 * natif compile l'arch en template QWeb/OWL). Le scaffolding (sheet_bg,
 * header/statusbar, sheet, chatter) et la structure (groups, notebook,
 * labels, h1, button box) vivent dans le template ; les onglets du
 * notebook sont réactifs (state.activePage).
 *
 * Spécificité hors ligne : les widgets de champ restent montés par
 * owl/field_bridge.js (contrat DOM du sérialiseur : #field-<name>,
 * inputs cachés, data-one2many + API impératives). Après le render,
 * FormRenderer remplit les emplacements data-form-slot du template avec
 * les cellules produites par views/fields/field.js::renderField, puis
 * expose `ready` (promesse) résolue quand toutes les saisies existent.
 */

import { mountOwlApp } from "../../owl/app.js";
import { parseFormViewArch, buildFormTemplate } from "./form_arch_parser.js";
import { renderField } from "../fields/field.js";
import { renderStatusbarField } from "../fields/statusbar/statusbar.js";

export class FormRenderer extends owl.Component {
  static props = {
    fieldSlots: { type: Array, optional: true },
    headerButtons: { type: Array, optional: true },
    fieldsInfo: { type: Object, optional: true },
    initialValues: { type: Object, optional: true },
    securityContext: { optional: true },
    hasRecordId: { type: Boolean, optional: true },
    onObjectButtonClick: { type: Function, optional: true },
  };

  setup() {
    // Onglet actif du notebook (réactif : le template bascule les
    // classes active des nav-link/tab-pane via t-att-class).
    this.state = owl.useState({ activePage: 0 });
    // OWL 2 n'expose pas this.el : la racine du template porte t-ref="root".
    this.rootRef = owl.useRef("root");
    // Promesse exposée à mountFormRenderer (voir plus bas).
    this.ready = Promise.resolve();
    owl.onMounted(() => {
      this.ready = this.mountFieldSlots();
    });
  }

  /**
   * Remplit les emplacements data-form-slot avec les cellules de champs
   * produites par renderField() -- le pont entre le template OWL compilé
   * et les widgets de champ du moteur (contrat sérialiseur préservé).
   * Retourne une promesse résolue lorsque TOUS les widgets OWL montés
   * dans ces emplacements existent (field_bridge._owlReady).
   */
  async mountFieldSlots() {
    const root = this.rootRef.el;
    const pending = [];

    for (const slot of this.props.fieldSlots || []) {
      const host = root.querySelector(`[data-form-slot="${slot.index}"]`);
      if (!host) continue;

      if (slot.kind === "statusbar") {
        // Widget statusbar (views/fields/statusbar/) -- composant OWL
        // monté par le field bridge : sa promesse _owlReady rejoint les
        // autres, FormRenderer.ready garantit aussi son affichage.
        const info = this.props.fieldsInfo[slot.name];
        const wrapper = renderStatusbarField(
          slot.name,
          info,
          slot.node,
          (this.props.initialValues || {})[slot.name]
        );
        if (wrapper) {
          if (wrapper._owlReady) pending.push(wrapper._owlReady);
          host.replaceWith(wrapper);
        }
        continue;
      }

      const cell = renderField(
        slot.node,
        this.props.fieldsInfo,
        this.props.initialValues,
        this.props.securityContext,
        this.props.hasRecordId
      );
      if (!cell) {
        host.remove();
        continue;
      }

      if (slot.mode === "widget") {
        // Paire <label for="x"/> : seuls les enfants du .o_field_widget
        // entrent dans la cellule de saisie du template.
        const widget = cell.querySelector(".o_field_widget") || cell;
        pending.push(...collectOwlReady([widget]));
        host.replaceWith(...Array.from(widget.childNodes));
      } else {
        if (slot.mode === "cell-nolabel") {
          const label = cell.querySelector(":scope > label");
          if (label) label.remove();
        }
        pending.push(...collectOwlReady([cell]));
        host.replaceWith(cell);
      }
    }

    await Promise.all(pending);
  }

  onTabClick(ev, index) {
    ev.preventDefault();
    this.state.activePage = index;
  }

  /**
   * Boutons du <header> : le markup est statique dans le template, la
   * décision (type="object" branché, sinon message hors-ligne) est ici.
   */
  onHeaderButton(index) {
    const btn = (this.props.headerButtons || [])[index];
    if (btn && btn.type === "object" && btn.name && typeof this.props.onObjectButtonClick === "function") {
      this.props.onObjectButtonClick(btn.name);
    } else {
      alert("Cette action nécessite une connexion à Odoo — non disponible hors-ligne pour le moment.");
    }
  }

  onChatterClick() {
    alert("Cette action nécessite une connexion à Odoo — non disponible hors-ligne pour le moment.");
  }
}

/**
 * Collecte les promesses _owlReady des widgets de champ (spans du field
 * bridge) contenus dans les nœuds insérés.
 */
function collectOwlReady(nodes) {
  const promises = [];
  for (const node of nodes) {
    if (!node.querySelectorAll) continue;
    if (node.matches && node.matches("[data-owl-field]") && node._owlReady) {
      promises.push(node._owlReady);
    }
    node.querySelectorAll("[data-owl-field]").forEach((span) => {
      if (span._owlReady) promises.push(span._owlReady);
    });
  }
  return promises;
}

/**
 * Monte le renderer OWL dans `target` pour l'arch donnée.
 * @param {HTMLElement} target - conteneur (déjà inséré dans le DOM)
 * @param {string} archXml - arch XML brute de la vue form
 * @param {Object} fieldsInfo - métadonnées des champs du modèle
 * @param {Object} initialValues - valeurs du record (ou {} en création)
 * @param {Object|null} securityContext - contexte de sécurité (is_admin…)
 * @param {Function|null} onObjectButtonClick - callback boutons type="object"
 * @returns {Promise<{ el: HTMLElement, ready: Promise, destroy: Function }>}
 *   el : la racine .o_form_view rendue (contrat form_controller),
 *   ready : promesse résolue quand tous les widgets de champ sont montés.
 */
export async function mountFormRenderer(target, archXml, fieldsInfo, initialValues = {}, securityContext = null, onObjectButtonClick = null) {
  const parsed = parseFormViewArch(archXml);

  if (parsed.error) {
    console.error("[form_renderer]", parsed.error);
    const errDiv = document.createElement("div");
    errDiv.textContent = "Impossible d'afficher ce formulaire (erreur de structure).";
    target.appendChild(errDiv);
    return { el: errDiv, ready: Promise.resolve(), destroy() {} };
  }

  const hasRecordId = !!(initialValues && initialValues.id);
  const compiled = buildFormTemplate(parsed.formRoot, {
    fieldsInfo,
    initialValues,
    securityContext,
    hasRecordId,
  });

  // Le template du renderer dépend de l'arch : injecté dans l'App OWL au
  // mount -- même principe que le chargement des templates qweb par le
  // webclient d'Odoo avant le rendu d'une vue.
  FormRenderer.template = compiled.templateName;

  const { component, destroy } = await mountOwlApp(
    FormRenderer,
    target,
    {
      fieldSlots: compiled.fieldSlots,
      headerButtons: compiled.headerButtons,
      fieldsInfo,
      initialValues: initialValues || {},
      securityContext,
      hasRecordId,
      onObjectButtonClick,
    },
    { [compiled.templateName]: compiled.templateXml }
  );

  const el = (component.rootRef && component.rootRef.el) || target.firstElementChild;
  return { el, ready: component.ready, destroy };
}
