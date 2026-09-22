/**
 * views/form/form_renderer.js
 * ===========================
 * Rendu de la vue formulaire par OWL -- même architecture qu'Odoo 17 :
 * le renderer est un composant OWL dont le TEMPLATE est COMPILÉ depuis
 * l'arch (form_arch_parser.js::buildFormTemplate, comme le webclient
 * natif compile l'arch en template QWeb/OWL). Le scaffolding (sheet_bg,
 * header/statusbar, sheet, chatter) et la structure (groups, notebook,
 * labels, h1, button box) vivent dans le template.
 *
 * PIPELINE NATIF (it. 23) : le template compilé contient directement les
 * COMPOSANTS <FormField> (views/form/field_component.js) -- **Arch XML →
 * <Field> OWL → rendu OWL**, plus aucun remplissage impératif
 * post-render. Le record (useState) est la source de vérité réactive :
 * les <FormField> le lisent et y publient leurs changements ; les
 * attributs dynamiques (invisible/readonly/required) sont ré-évalués à
 * chaque rendu, comme les attrs dynamiques du webclient.
 *
 * Spécificité hors ligne conservée : contrat DOM du sérialiseur
 * (#field-<name>, hidden inputs m2o/m2m, data-one2many + APIs
 * impératives du composant one2many) et widgets "vanilla" du registre
 * (couche de transition widget_registry, partagée avec list/kanban).
 */

import { mountOwlApp } from "../../owl/app.js";
import { notifications } from "../../core/notifications/notification_service.js";
import { parseFormViewArch, buildFormTemplate } from "./form_arch_parser.js";
import { FormField } from "./field_component.js";
import { collectFormData } from "./form_serializer.js";

export class FormRenderer extends owl.Component {
  static props = {
    fieldNodes: { type: Array, optional: true },
    headerButtons: { type: Array, optional: true },
    fieldsInfo: { type: Object, optional: true },
    initialValues: { type: Object, optional: true },
    securityContext: { optional: true },
    hasRecordId: { type: Boolean, optional: true },
    onObjectButtonClick: { type: Function, optional: true },
  };

  static components = { FormField };

  setup() {
    // Onglet actif du notebook (réactif : le template bascule les
    // classes active des nav-link/tab-pane via t-att-class).
    this.state = owl.useState({ activePage: 0 });
    // Record RÉACTIF : source de vérité des <FormField> (comme le
    // record du renderer Odoo). Copie shallow des valeurs initiales ;
    // les one2many restent pilotés par les APIs impératives du widget.
    this.record = owl.useState({ ...(this.props.initialValues || {}) });
    // OWL 2 n'expose pas this.el : la racine du template porte t-ref="root".
    this.rootRef = owl.useRef("root");
    // Contexte des <FormField> (comme la propagation du record aux
    // composants <Field> du webclient) : sous-env OWL -- visible de tout
    // le sous-arbre du renderer, propre à cette instance (chaque App OWL
    // a de toute façon son propre env). L'env racine est gelé :
    // useSubEnv est la voie prévue par OWL.
    owl.useSubEnv({
      __formCtx: {
        record: this.record,
        fieldsInfo: this.props.fieldsInfo || {},
        fieldNodes: this.props.fieldNodes || [],
        hasRecordId: !!this.props.hasRecordId,
        securityContext: this.props.securityContext,
      },
    });
    // Les champs sont des composants du template : dès la fin du mount
    // OWL, toutes les saisies existent (plus de remplissage différé).
    // La promesse `ready` est conservée pour le contrat du contrôleur.
    this.ready = Promise.resolve();
  }

  /**
   * API état (publiée sur le host par mountFormRenderer::_formState) :
   * - getValues() : mêmes formes que collectFormData (contrat sérialiseur) ;
   * - applyGraph() : réinjection RÉACTIVE du résultat des règles métier
   *   (remplace applyDocumentGraphToDom). Champs scalaires racine
   *   uniquement : m2o/m2m/o2m passent par leurs canaux dédiés (hidden
   *   inputs / APIs du widget), comme avant. Un champ en cours de saisie
   *   (input focalisé) n'est jamais écrasé -- même garde-fou que
   *   applyDocumentGraphToDom.
   */
  getValues() {
    return collectFormData(this.rootRef.el, this.props.fieldsInfo);
  }

  applyGraph(graph) {
    const root = graph && graph.root ? graph.root : {};
    for (const [name, value] of Object.entries(root)) {
      const info = this.props.fieldsInfo[name];
      if (!info) continue;
      if (info.type === "one2many" || info.type === "many2one" || info.type === "many2many") continue;
      const active = document.activeElement;
      if (active && active.id === `field-${name}`) continue; // saisie en cours
      if (this.record[name] !== value) this.record[name] = value;
    }
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
      notifications.add("Cette action nécessite une connexion à Odoo — non disponible hors-ligne pour le moment.", { title: "Action indisponible", type: "warning" });
    }
  }

  onChatterClick() {
    notifications.add("Cette action nécessite une connexion à Odoo — non disponible hors-ligne pour le moment.", { title: "Action indisponible", type: "warning" });
  }
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
 *   ready : promesse résolue quand le formulaire est rendu (contrat
 *   conservé : le contrôleur l'attend avant la 1re passe de règles).
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
      // fieldSlots (parseur) == fieldNodes consommés par <FormField>.
      fieldNodes: compiled.fieldSlots,
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

  // API état (chemin réactif) : le contrôleur l'utilise pour réinjecter
  // le résultat des règles dans le record réactif. Publiée sur le target
  // (contrat currentContainer) ET la racine rendue.
  const formState = {
    record: component.record,
    getValues: () => component.getValues(),
    applyGraph: (graph) => component.applyGraph(graph),
  };
  target._formState = formState;
  if (el) el._formState = formState;

  return { el, ready: component.ready, destroy };
}
