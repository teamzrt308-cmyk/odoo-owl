/**
 * webclient/navbar/conflict_panel.js
 * ==================================
 * ConflictPanel -- composant OWL, même architecture qu'Odoo 17 : la
 * liste compacte des conflits en attente est un composant de la systray
 * de la Navbar (plus de mount vanilla branché par sélecteurs +
 * createDropdown/Popper).
 *
 * Ce panel ne fait que LISTER et NAVIGUER : cliquer une entrée ouvre la
 * page de détail (conflict_detail.js, doAction { tag: "conflict_detail",
 * localUuid }) pour la comparaison complète et la résolution.
 */

import { bus } from "../../core/bus/bus_service.js";
import { getCachedConflicts } from "../../core/network/rpc_service.js";

function formatFieldLabel(fieldName) {
  const match = fieldName.match(/^(.+)\[(\d+)\]$/);
  if (match) return `${match[1]} (ligne #${match[2]})`;
  return fieldName;
}

export class ConflictPanel extends owl.Component {
  static props = {
    doAction: { type: Function, optional: true },
  };

  static template = owl.xml`
    <div class="o-dropdown dropdown o_sync_conflicts_menu o-dropdown--no-caret position-relative" t-on-click.stop="">
      <button id="conflict-status-btn" type="button" class="dropdown-toggle position-relative" tabindex="0"
              aria-expanded="false" title="Conflits de synchronisation" t-on-click="toggle">
        <i class="fa fa-lg fa-exclamation-triangle" role="img" aria-label="Conflits"/>
        <span t-if="state.conflicts.length > 0" class="o-mail-MessagingMenu-counter badge rounded-pill bg-warning"
              t-esc="state.conflicts.length"/>
      </button>
      <div t-if="state.open" class="dropdown-menu dropdown-menu-end show o_sync_conflicts_dropdown"
           style="min-width: 340px; max-height: 420px; overflow-y: auto; position: absolute; top: 100%; right: 0; z-index: 1000;">
        <div class="px-3 py-2 border-bottom">
          <strong class="small" t-esc="panelTitle"/>
        </div>
        <div t-if="state.conflicts.length === 0" class="text-muted text-center p-4 small">Aucun conflit en attente.</div>
        <a t-foreach="state.conflicts" t-as="entry" t-key="entry.local_uuid" href="#"
           class="dropdown-item small py-2 border-bottom o_conflict_item"
           t-on-click.prevent="() => this.openConflict(entry)">
          <div class="fw-bold" t-esc="entry.model_name"/>
          <div class="text-muted text-truncate" style="font-size:11px;" t-esc="entry.fieldLabels"/>
          <div class="text-muted" style="font-size:11px;" t-esc="entry.created_at || ''"/>
        </a>
      </div>
    </div>`;

  setup() {
    this.state = owl.useState({ open: false, conflicts: [] });
    this.onSyncUpdated = () => this.refresh();
    bus.addEventListener("sync:updated", this.onSyncUpdated);
    owl.onMounted(() => this.refresh());
    owl.onWillDestroy(() => bus.removeEventListener("sync:updated", this.onSyncUpdated));
  }

  get panelTitle() {
    return this.state.conflicts.length > 0
      ? `${this.state.conflicts.length} conflit(s) à résoudre`
      : "Conflits de synchronisation";
  }

  toggle() {
    this.state.open = !this.state.open;
    if (this.state.open) this.refresh();
  }

  close() {
    this.state.open = false;
  }

  async refresh() {
    // Le badge doit être à jour même menu fermé ; le view-model est bon
    // marché (cache local), il est donc toujours calculé.
    const conflicts = await getCachedConflicts();
    this.state.conflicts = conflicts.map((row) => ({
      ...row,
      fieldLabels: (row.conflicts || []).map((c) => formatFieldLabel(c.field)).join(", "),
    }));
  }

  openConflict(entry) {
    this.close();
    if (this.props.doAction) {
      this.props.doAction({ tag: "conflict_detail", localUuid: entry.local_uuid });
    }
  }
}
