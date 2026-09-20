/**
 * views/fields/statusbar/statusbar.js
 * ===================================
 * Widget "statusbar" (barre de progression des états) -- COMPOSANT OWL,
 * comme chez Odoo 17 où le statusbar est un widget de champ
 * (views/fields/statusbar/), pas une pièce du header : le rendu des
 * boutons du <header>, lui, vit dans le template compilé
 * (form_arch_parser.js). C'est le dernier widget de champ migré : tous
 * les widgets de champ du moteur sont désormais rendus par OWL.
 *
 * Contractualisme conservé :
 *  - renderStatusbarField(name, info, node, currentValue) -> HTMLElement
 *    (span du field_bridge, mount OWL asynchrone dedans) ;
 *  - DOM produit : .o_field_widget.o_readonly_modifier.o_field_statusbar
 *    > .o_statusbar_status > .o_arrow_button (sélecteurs de test et
 *    contrat visuel inchangés).
 *
 * Amélioration d'alignement Odoo 17 : les étapes sont rendues dans
 * l'ORDRE NATUREL de info.selection (premier état à gauche) -- l'ancien
 * rendu DOM les inversait (artefact du insertBefore(firstChild)).
 * o_first/o_last sont calculés sur la liste VISIBLE (filtrée par
 * statusbar_visible), plus sur la liste complète.
 */

import { renderOwlField } from "../../../owl/field_bridge.js";

export class StatusbarFieldOwl extends owl.Component {
  static props = {
    id: { type: String, optional: true },
    name: { type: String, optional: true },
    // [[value, label], ...] issue de fields_get (info.selection)
    selection: { type: Array, optional: true },
    // valeurs de l'attribut statusbar_visible (["draft", "sent"]) ou null
    visibleStates: { type: Array, optional: true },
    // valeur courante du champ (peut être undefined/false)
    initialValue: { optional: true },
    onChange: { type: Function, optional: true }, // réservé : steps désactivés
  };

  static template = owl.xml`
    <div class="o_field_widget o_readonly_modifier o_field_statusbar" t-att-name="props.name">
      <div class="o_statusbar_status" role="radiogroup" aria-label="Barre de statut">
        <t t-foreach="steps" t-as="step" t-key="step.value">
          <button type="button"
                  t-att-class="stepClass(step)"
                  disabled="disabled"
                  role="radio"
                  t-att-aria-checked="step.isActive ? 'true' : 'false'"
                  t-att-aria-current="step.isActive ? 'step' : false"
                  t-att-data-value="step.value"
                  t-esc="step.label"/>
        </t>
      </div>
    </div>`;

  setup() {
    // Valeur réactive : le getter steps s'en déduit (le statut est mis à
    // jour par re-render réactif, comme le renderer natif qui lit le
    // record ; le formulaire hors ligne re-monte tout le renderer à
    // chaque refresh -- voir form_controller.mountFormInto).
    this.state = owl.useState({ value: this.props.initialValue });

    owl.onWillUpdateProps((nextProps) => {
      this.state.value = nextProps.initialValue;
    });
  }

  /**
   * Étapes VISIBLES dans l'ordre naturel (Odoo 17) : statusbar_visible
   * filtre la liste, la valeur courante reste toujours affichée ;
   * o_first/o_last portent sur la liste filtrée ; sans valeur courante,
   * la première étape est considérée active (comportement historique).
   */
  get steps() {
    const selection = this.props.selection || [];
    const visibleStates = this.props.visibleStates;
    const current = this.state.value;

    const visibleSelection = visibleStates
      ? selection.filter(([value]) => visibleStates.includes(String(value)) || String(value) === String(current))
      : selection;

    return visibleSelection.map(([value, label], idx) => ({
      value,
      label,
      isFirst: idx === 0,
      isLast: idx === visibleSelection.length - 1,
      isActive:
        (current !== undefined && String(current) === String(value)) ||
        (current === undefined && idx === 0),
    }));
  }

  stepClass(step) {
    return (
      "btn btn-secondary o_arrow_button" +
      (step.isFirst ? " o_first" : "") +
      (step.isLast ? " o_last" : "") +
      (step.isActive ? " o_arrow_button_current" : "")
    );
  }
}

/**
 * Signature alignée sur celle des autres widgets de champ du moteur hors
 * ligne : (name, info, node, currentValue) -> HTMLElement (span du field
 * bridge). info.selection est requis (vérifié en amont par
 * form_arch_parser avant de créer l'emplacement).
 */
export function renderStatusbarField(name, info, node, currentValue) {
  if (!info || !info.selection) return null;

  const visibleAttr = node ? node.getAttribute("statusbar_visible") : null;
  const visibleStates = visibleAttr
    ? visibleAttr.split(",").map((s) => s.trim())
    : null;

  return renderOwlField(StatusbarFieldOwl, {
    name,
    fieldTypeClass: "statusbar",
    props: {
      name,
      selection: info.selection,
      visibleStates,
      initialValue: currentValue,
    },
  });
}
