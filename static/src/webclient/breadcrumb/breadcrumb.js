/**
 * webclient/breadcrumb/breadcrumb.js
 * ===================================
 * Fil d'Ariane -- positionné dans webclient/breadcrumb/ comme chez Odoo,
 * où le breadcrumb est un COMPOSANT OWL alimenté par les contrôleurs.
 * Le ControlPanel (search/control_panel/) l'embarque via static
 * components et le complète avec deux emplacements :
 *  - slot par défaut  : ajouté APRÈS l'item courant (indicateur
 *    d'enregistrement du formulaire) ;
 *  - slot "extras"    : ajouté DANS l'item courant (engrenage d'options).
 */

export class Breadcrumb extends owl.Component {
  static props = {
    // TOUT passer par un seul objet déclaré : la validation OWL RETIRE
    // toute prop non déclarée (voir l'épisode initialValue, itération 3).
    breadcrumb: { type: Object, optional: true }, // { listLabel, recordLabel }
    onListClick: { type: Function, optional: true },
  };

  static template = owl.xml`
    <div class="o_breadcrumb d-flex gap-1 text-truncate align-items-center">
      <div t-if="breadcrumb.listLabel" class="o_breadcrumb_item">
        <a href="#" class="o_breadcrumb_item_link text-truncate" t-on-click="onListClick"><t t-esc="breadcrumb.listLabel"/></a>
        <i class="oi oi-chevron-right mx-1 text-muted small"/>
      </div>
      <div class="o_last_breadcrumb_item active d-flex fs-4 min-w-0 align-items-center">
        <span class="min-w-0 text-truncate"><t t-esc="breadcrumb.recordLabel or ''"/></span>
        <t t-slot="extras"/>
      </div>
      <t t-slot="default"/>
    </div>`;

  get breadcrumb() {
    return this.props.breadcrumb || {};
  }

  onListClick(ev) {
    ev.preventDefault();
    if (this.props.onListClick) this.props.onListClick();
  }
}
