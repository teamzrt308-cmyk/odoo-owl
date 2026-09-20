/**
 * webclient/navbar/sync_status_panel.js
 * =====================================
 * SyncStatusPanel -- composant OWL, même architecture qu'Odoo 17 : le
 * menu de synchronisation est un composant de la systray de la Navbar
 * (plus de mount vanilla branché par sélecteurs + createDropdown/Popper).
 *
 * Le comportement historique est conservé intégralement :
 *  - badges pending/errors (titre contextuel selon la connexion) ;
 *  - dropdown : en-tête (compteur + « Tout réessayer »), section des
 *    actions en file (spinner si en ligne, horloge si hors ligne),
 *    liste des ERREURS avec Réessayer / Supprimer (confirm) ;
 *  - auto-sync au retour en ligne / au retour sur l'onglet, refresh au
 *    bus "sync:updated".
 */

import { bus } from "../../core/bus/bus_service.js";
import {
  getSyncQueueSummary,
  getSyncErrorEntries,
  getSyncPendingEntries,
  retryAllSyncErrors,
  retrySyncAction,
  deleteSyncAction,
  syncPendingActions,
} from "../../core/network/rpc_service.js";

function formatSyncEntryTitle(entry) {
  const opLabels = { create: "Création", write: "Modification", unlink: "Suppression" };
  const opLabel = opLabels[entry.operation] || entry.operation;
  return `${opLabel} — ${entry.model_name}`;
}

export class SyncStatusPanel extends owl.Component {
  static template = owl.xml`
    <div class="o-dropdown dropdown o_sync_errors_menu o-dropdown--no-caret position-relative" t-on-click.stop="">
      <button id="sync-status-btn" type="button" class="dropdown-toggle position-relative" tabindex="0"
              aria-expanded="false" title="Synchronisation" t-on-click="toggle">
        <i class="fa fa-lg fa-cloud-upload" role="img" aria-label="Synchronisation"/>
        <span t-if="state.summary.pending > 0" class="o-mail-MessagingMenu-counter badge rounded-pill bg-secondary"
              t-esc="state.summary.pending" t-att-title="pendingBadgeTitle"/>
        <span t-if="state.summary.error > 0" class="o-mail-MessagingMenu-counter badge rounded-pill bg-danger"
              t-esc="state.summary.error"/>
      </button>
      <div t-if="state.open" class="dropdown-menu dropdown-menu-end show o_sync_status_dropdown"
           style="min-width: 340px; max-height: 420px; overflow-y: auto; position: absolute; top: 100%; right: 0; z-index: 1000;">
        <div class="d-flex justify-content-between align-items-center px-3 py-2 border-bottom">
          <strong class="small" t-esc="panelTitle"/>
          <button t-if="state.errors.length > 0" type="button" class="btn btn-sm btn-link p-0 o_sync_retry_all"
                  t-att-disabled="state.busyAll" t-on-click.stop="retryAll" t-esc="state.busyAll ? '...' : 'Tout réessayer'"/>
        </div>
        <div t-if="state.pendingEntries.length > 0" class="px-3 py-2 border-bottom bg-light">
          <div class="text-muted small mb-1" t-esc="pendingLabel"/>
          <div t-foreach="state.pendingEntries" t-as="entry" t-key="entry.id" class="small d-flex align-items-center gap-2">
            <i t-att-class="navigatorOnline ? 'fa fa-spinner fa-spin text-muted' : 'fa fa-clock-o text-muted'"/>
            <span t-esc="entryTitle(entry)"/>
          </div>
        </div>
        <div t-if="state.errors.length === 0" class="text-muted text-center p-4 small">Aucune erreur de synchronisation.</div>
        <div t-foreach="state.errors" t-as="entry" t-key="entry.id" class="px-3 py-2 border-bottom o_sync_error_item">
          <div class="fw-bold small" t-esc="entryTitle(entry)"/>
          <div class="text-muted small" t-esc="entry.created_at"/>
          <div class="small text-danger mt-1" style="word-break: break-word;" t-esc="entry.error_message || 'Erreur inconnue.'"/>
          <div class="d-flex gap-2 mt-2">
            <button type="button" class="btn btn-sm btn-outline-secondary o_sync_retry"
                    t-att-disabled="state.busyEntry === entry.id" t-on-click.stop="() => this.retry(entry)"
                    t-esc="state.busyEntry === entry.id ? '...' : 'Réessayer'"/>
            <button type="button" class="btn btn-sm btn-outline-danger o_sync_delete"
                    t-att-disabled="state.busyEntry === entry.id" t-on-click.stop="() => this.remove(entry)"
                    t-esc="state.busyEntry === entry.id ? '...' : 'Supprimer'"/>
          </div>
        </div>
      </div>
    </div>`;

  setup() {
    this.state = owl.useState({
      open: false,
      summary: { pending: 0, error: 0 },
      errors: [],
      pendingEntries: [],
      // id de l'entrée en cours d'opération (bouton « ... ») ; busyAll
      // (booléen) pour « Tout réessayer ».
      busyEntry: null,
      busyAll: false,
    });
    // Verrou non réactif de l'auto-sync.
    this.syncInFlight = false;

    this.attemptAutoSync = () => this.attemptAutoSyncImpl();
    window.addEventListener("online", this.attemptAutoSync);
    this.onVisibilityChange = () => {
      if (document.visibilityState === "visible") this.attemptAutoSyncImpl();
    };
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    this.onSyncUpdated = () => this.refresh();
    bus.addEventListener("sync:updated", this.onSyncUpdated);

    owl.onMounted(() => this.refresh());
    owl.onWillDestroy(() => {
      window.removeEventListener("online", this.attemptAutoSync);
      document.removeEventListener("visibilitychange", this.onVisibilityChange);
      bus.removeEventListener("sync:updated", this.onSyncUpdated);
    });
  }

  get navigatorOnline() {
    return navigator.onLine;
  }

  get pendingBadgeTitle() {
    return navigator.onLine
      ? "En cours de synchronisation..."
      : "En attente de connexion pour synchroniser";
  }

  get panelTitle() {
    if (this.state.errors.length > 0) {
      return `${this.state.errors.length} erreur(s) de synchronisation`;
    }
    if (this.state.pendingEntries.length > 0) {
      return navigator.onLine
        ? `${this.state.pendingEntries.length} en cours de synchronisation...`
        : `${this.state.pendingEntries.length} en attente de connexion`;
    }
    return "Synchronisation";
  }

  get pendingLabel() {
    return navigator.onLine
      ? "En cours d'envoi vers Odoo..."
      : "Hors-ligne — seront envoyées à la reconnexion :";
  }

  entryTitle(entry) {
    return formatSyncEntryTitle(entry);
  }

  toggle() {
    this.state.open = !this.state.open;
    if (this.state.open) this.refresh();
  }

  close() {
    this.state.open = false;
  }

  async refresh() {
    this.state.summary = await getSyncQueueSummary();
    // Le contenu détaillé n'est chargé que si le menu est ouvert
    // (comme l'ancien refreshSyncStatus).
    if (this.state.open) {
      const [errors, pendingEntries] = await Promise.all([
        getSyncErrorEntries(),
        getSyncPendingEntries(),
      ]);
      this.state.errors = errors;
      this.state.pendingEntries = pendingEntries;
    }
  }

  async retry(entry) {
    this.state.busyEntry = entry.id;
    try {
      await retrySyncAction(entry.id);
      await this.refresh();
    } finally {
      this.state.busyEntry = null;
    }
  }

  async remove(entry) {
    if (!confirm("Supprimer définitivement cette action non synchronisée ? L'enregistrement devra être recréé.")) return;
    this.state.busyEntry = entry.id;
    try {
      await deleteSyncAction(entry.id);
      await this.refresh();
    } finally {
      this.state.busyEntry = null;
    }
  }

  async retryAll() {
    this.state.busyAll = true;
    try {
      await retryAllSyncErrors();
      await this.refresh();
    } finally {
      this.state.busyAll = false;
    }
  }

  /** Auto-sync au retour en ligne / sur l'onglet (comportement conservé). */
  async attemptAutoSyncImpl() {
    if (this.syncInFlight || !navigator.onLine) {
      await this.refresh();
      return;
    }
    const summary = await getSyncQueueSummary();
    if (summary.pending === 0) {
      await this.refresh();
      return;
    }
    this.syncInFlight = true;
    try {
      await syncPendingActions();
    } catch (err) {
      console.warn("Tentative de synchro automatique échouée, sera retentée:", err);
    } finally {
      this.syncInFlight = false;
      await this.refresh();
      bus.trigger("sync:updated");
    }
  }
}
