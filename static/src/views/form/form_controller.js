/**
 * views/form/form_controller.js
 * ================================
 * Contrôleur de la vue formulaire -- composant OWL, même architecture
 * qu'Odoo 17 : le descripteur de la vue (form_view.js) expose
 * { Controller: FormController } et c'est le dispatcher views/view.js
 * qui monte le composant (props : params de l'action + env du webclient).
 *
 * Le template OWL du contrôleur porte les trois zones de la vue
 * (control panel, statut, hôte du renderer). La logique métier hors
 * ligne -- chargement du record, file de sync, règles document, ledger
 * local, actions objet -- vit dans des closures de setup(), attachée
 * aux zones par refs ; la migration de CHAQUE brique vers l'OWL (control
 * panel, barre de statut) se fera par la suite sans changer ce contrat.
 *
 * Manages the complete load/render/save cycle for a single record, with
 * an offline-first sync queue.
 */

import { bus } from "../../core/bus/bus_service.js";
import { notifications } from "../../core/notifications/notification_service.js";
import { CONFIG, getApiKey } from "../../core/browser/session.js";
import { getModuleManifest, resolveModelViews } from "../view_service.js";
import { getReferenceRecordsSmart } from "../../core/reference_cache.js";
import { getRecordSmart } from "../../core/record_cache.js";
import { getSecurityInfo } from "../../core/user_service.js";
import { mountFormRenderer } from "./form_renderer.js";
import { attachLiveBusinessRules } from "./dynamic_field_attrs.js";
import { runDocumentRules, validateDocument, checkRequiredFields, computeStockEffects, computeOptimisticStateUpdate } from "../../model/rules_engine/rules_engine.js";
import { collectFormData, buildDocumentGraph, applyDocumentGraphToDom } from "./form_serializer.js";
import { addLedgerDelta, getAggregatedDeltasByField } from "../../core/local_ledger.js";
import { patchCachedRecord } from "../../core/record_cache.js";
import { router } from "../../core/browser/router_service.js";
import {
  queueAction,
  queueMethodCall,
  syncPendingActions,
  amendPendingCreate,
  getSyncQueueEntry,
} from "../../core/network/rpc_service.js";
import { ControlPanel } from "../../search/control_panel/control_panel.js";
import { mountOwlApp } from "../../owl/app.js";

export class FormController extends owl.Component {
  static components = { ControlPanel };

  static props = {
    params: { type: Object, optional: true },
    env: { optional: true },
  };

  static template = owl.xml`
    <div class="o_form_controller d-flex flex-column h-100">
      <ControlPanel display="cpDisplay" breadcrumb="cpBreadcrumb"
                    onSave="onSaveClick" onUndo="onUndoClick" onBreadcrumbList="onBreadcrumbList"/>
      <div t-ref="statusHost"/>
      <div t-ref="formHost"/>
    </div>`;

  /**
   * Props calculées du ControlPanel, lues dans l'état réactif ui.
   */
  get cpBreadcrumb() {
    return {
      listLabel: (this.ui && this.ui.listLabel) || null,
      recordLabel: (this.ui && this.ui.recordLabel) || "",
    };
  }

  setup() {
    this.statusHostRef = owl.useRef("statusHost");
    this.formHostRef = owl.useRef("formHost");

    const self = this;
    const params = this.props.params || {};
    const env = this.props.env;
    const { module, model, id, isNew, actionId, listLabel } = params;

    const apiKey = getApiKey();

    let currentRecordId = id ? parseInt(id, 10) : null;
    let pendingCreateUuid = null;
    let currentReferenceWriteDate = null;
    let currentReferenceValues = {};
    let currentContainer = null;
    let currentFieldsInfo = null;
    let cleanupRules = () => {};
    let rendererDestroy = null;
    let rulesSyncTimer = null;

    // NEW — promoted to closure variables (previously: local to the try
    // block) so that saveRecord() can rebuild the form after a
    // successful write, without relying on a full view reload.
    let archXml = null;
    let currentSecurityContext = null;

    // Control panel OWL : état réactif (fil d'Ariane) + callbacks.
    self.cpDisplay = { withRecordStatusIcons: true };
    self.ui = owl.useState({ listLabel: listLabel || null, recordLabel: "" });
    self.onSaveClick = () => saveRecord();
    self.onUndoClick = () => {
      env.doAction({ tag: "form_view", module, model, id: currentRecordId, actionId, listLabel }, { replace: true });
    };
    self.onBreadcrumbList = () => env.goBack();

    const statusEl = document.createElement("div");
    statusEl.id = "status-msg";
    statusEl.className = "text-muted small px-3 py-1";
    statusEl.textContent = "Chargement du formulaire...";

    /**
   * Monte (ou re-monte) le renderer OWL du formulaire -- même rôle que
   * les trois anciens blocs renderFormView() + replaceWith() (mount
   * initial, refresh après write, rebuild optimiste), désormais
   * factorisés. L'app OWL précédente est détruite avant le re-mount.
   * Le renderer reçoit un template compilé depuis l'arch
   * (form_arch_parser.js) et remplit lui-même les widgets de champ ;
   * `ready` garantit que toutes les saisies existent avant la première
   * passe de règles document.
   */
  async function mountFormInto(values) {
    cleanupRules();
    if (rendererDestroy) {
      try {
        rendererDestroy();
      } catch (err) {
        console.warn("[form_controller] destroy renderer:", err);
      }
      rendererDestroy = null;
    }

    const host = document.createElement("div");
    if (currentContainer) {
      currentContainer.replaceWith(host);
    } else {
      self.formHostRef.el.appendChild(host);
    }

    const { el, ready, destroy } = await mountFormRenderer(
      host,
      archXml,
      currentFieldsInfo,
      values,
      currentSecurityContext,
      onObjectButtonClick
    );
    rendererDestroy = destroy;
    currentContainer = host;
    el.dataset.model = model;

    cleanupRules = attachLiveBusinessRules(archXml, el, currentFieldsInfo);
    el.addEventListener("input", scheduleDocumentRulesSync);
    el.addEventListener("change", scheduleDocumentRulesSync);
    await ready; // toutes les saisies existent avant la 1re passe de règles
    scheduleDocumentRulesSync(); // premier passage (ex: amount_total sur un nouveau document)
    applyLedgerAdjustmentsToForm(); // ex: qty_received déjà ajustée par une réception validée hors-ligne
    return el;
  }

    async function start() {
      if (!module || !model) {
        console.warn("[form_controller] descripteur incomplet, retour à l'accueil :", params);
        env.doAction("home_menu", { replace: true, clearStack: true });
        return;
      }

      if (navigator.onLine) {
        syncPendingActions()
          .catch((err) => console.warn("Rattrapage synchro échoué:", err))
          .finally(() => bus.trigger("sync:updated"));
      }

      try {
        const manifest = await getModuleManifest(module, apiKey, CONFIG.ODOO_BASE_URL);
        const modelViews = resolveModelViews(manifest, model, actionId);
        const fieldsInfo = manifest.fields[model];

        if (!modelViews || !modelViews.form || !fieldsInfo) {
          statusEl.textContent = `Aucune vue formulaire disponible pour "${model}".`;
          return;
        }
        archXml = modelViews.form.arch;

        // Préchargement des caches de référence (relationnels des champs
        // du formulaire ET des sous-champs one2many) -- lecture locale en
        // mode hors-ligne.
        const relationsToPreload = new Set();
        for (const finfo of Object.values(fieldsInfo)) {
          if ((finfo.type === "many2one" || finfo.type === "many2many") && finfo.relation) {
            relationsToPreload.add(finfo.relation);
          }
          if (finfo.type === "one2many" && finfo.sub_fields) {
            for (const subInfo of Object.values(finfo.sub_fields)) {
              if ((subInfo.type === "many2one" || subInfo.type === "many2many") && subInfo.relation) {
                relationsToPreload.add(subInfo.relation);
              }
            }
          }
        }
        for (const relModel of relationsToPreload) {
          await getReferenceRecordsSmart(relModel, apiKey, CONFIG.ODOO_BASE_URL);
        }

        let initialValues = {};
        if (currentRecordId) {
          initialValues = await getRecordSmart(model, currentRecordId, apiKey, CONFIG.ODOO_BASE_URL);
          currentReferenceWriteDate = initialValues.__reference_write_date__ || null;
          const { __reference_write_date__, ...cleanValues } = initialValues;
          currentReferenceValues = cleanValues;
        }

        const securityInfo = await getSecurityInfo(model);
        currentSecurityContext = securityInfo || { is_admin: false };

        currentFieldsInfo = fieldsInfo;
        await mountFormInto(initialValues);

        statusEl.textContent = navigator.onLine ? "" : "Mode hors-ligne — données mises en cache.";

        const recordLabel = currentRecordId ? initialValues.name || `#${currentRecordId}` : "Nouveau";
        self.ui.recordLabel = recordLabel;
      } catch (err) {
        console.error(err);
        statusEl.textContent = "Erreur : " + err.message;
      }
    }

    /**
   * NEW — rebuilds the form from fresh server data.
   * Necessary after a successful write: one2many lines
   * created via this write receive a real server-side ID that
   * no sync response otherwise propagates back to the client
   * (confirmed by sync_queue.py::_execute, which returns only
   * the record_id for the root record, never the IDs of linked
   * lines). Without this refresh, a synchronized one2many line
   * remains with _recordId=null indefinitely and would be
   * recreated as a duplicate upon the next write involving
   * that same line.
   */
  async function refreshFormFromServer() {
    if (!currentRecordId || !archXml || !currentFieldsInfo) return;

    const freshRecord = await getRecordSmart(model, currentRecordId, getApiKey(), CONFIG.ODOO_BASE_URL);
    currentReferenceWriteDate = freshRecord.__reference_write_date__ || null;
    const { __reference_write_date__, ...cleanValues } = freshRecord;
    currentReferenceValues = cleanValues;

    await mountFormInto(freshRecord);

    self.ui.recordLabel = freshRecord.name || `#${currentRecordId}`;
  }

    /**
   * NEW — branche runDocumentRules() (compute/onchange en cascade sur
   * racine + lignes, ex: amount_total = f(order_line.price_total)) sur le
   * formulaire réellement affiché. Jusqu'ici cette fonction du moteur
   * n'était appelée par aucun fichier -- voir audit rules_engine.
   * Débounce léger car buildDbSnapshot() interroge Dexie à chaque appel.
   */
  function scheduleDocumentRulesSync() {
    if (!currentContainer || !currentFieldsInfo) return;
    clearTimeout(rulesSyncTimer);
    rulesSyncTimer = setTimeout(async () => {
      const container = currentContainer;
      const fieldsInfo = currentFieldsInfo;
      if (!container || !fieldsInfo) return;

      try {
        const graph = buildDocumentGraph(container, fieldsInfo, currentReferenceValues);
        const updatedGraph = await runDocumentRules(model, graph);

        applyDocumentGraphToDom(container, fieldsInfo, updatedGraph);

        // Les lignes one2many sont mises à jour via l'API du composant OWL
        // du widget (voir fields/one2many/one2many_field.js) -- l'état
        // réactif ré-affiche les cellules, plus aucun mapping tr <-> row.
        for (const [fieldName, { rows }] of Object.entries(updatedGraph.lines || {})) {
          const fieldWrapper = container.querySelector(`[data-one2many="${fieldName}"] [data-o2m-root="true"]`);
          if (fieldWrapper && fieldWrapper._owlOne2many) {
            fieldWrapper.applyLineUpdates(rows);
          }
        }
      } catch (err) {
        console.warn("[form_controller] Échec de l'exécution des règles document:", err);
      }
    }, 200);
  }

  /**
   * NEW — applique les deltas en attente du ledger local (voir
   * core/local_ledger.js) sur les lignes one2many affichées, pour un
   * affichage immédiat de qty_received/qty_delivered après validation
   * d'un bon de réception/livraison, sans attendre la sync avec Odoo.
   * Générique : fonctionne pour n'importe quel champ ajusté par une
   * règle "stock_effect" (voir rules/stock_rules.js), pas seulement
   * qty_received/qty_delivered -- ne connaît pas ces noms de champs.
   */
  async function applyLedgerAdjustmentsToForm() {
    if (!currentContainer || !currentFieldsInfo) return;

    for (const [fieldName, info] of Object.entries(currentFieldsInfo)) {
      if (info.type !== "one2many" || !info.relation) continue;

      const fieldWrapper = currentContainer.querySelector(`[data-one2many="${fieldName}"] [data-o2m-root="true"]`);
      if (!fieldWrapper || !fieldWrapper._owlOne2many) continue;

      // Deltas du ledger local appliqués via l'API du composant OWL
      // (état réactif) -- ex: qty_received/qty_delivered après validation
      // d'un bon hors-ligne. Générique : fonctionne pour n'importe quel
      // champ ajusté par une règle "stock_effect" (voir rules/stock_rules.js).
      for (const lineId of fieldWrapper.getLineIds()) {
        let deltas;
        try {
          deltas = await getAggregatedDeltasByField(info.relation, String(lineId));
        } catch (err) {
          continue; // pas de ledger pour cette ligne -- rien à ajuster
        }
        if (deltas && Object.keys(deltas).length > 0) {
          fieldWrapper.adjustLineFields(lineId, deltas);
        }
      }
    }
  }

    /**
   * NEW — applique une mise à jour OPTIMISTE locale (voir
   * rules/stock_rules.js::optimisticState) suite à un clic sur un bouton
   * objet, sans attendre la synchronisation. Re-rend tout le formulaire
   * (comme refreshFormFromServer(), mais à partir de données patchées
   * localement plutôt que du serveur) car le widget statusbar affichant
   * "state" n'est pas un simple <input> -- un patch DOM ciblé ne le
   * rafraîchirait pas visuellement.
   */
  async function applyOptimisticStateUpdate(methodName, documentGraph) {
    const optimistic = computeOptimisticStateUpdate(model, methodName, documentGraph);
    const hasRootUpdate = Object.keys(optimistic.root).length > 0;
    const hasLineUpdate = Object.keys(optimistic.lineUpdates).length > 0;
    if (!hasRootUpdate && !hasLineUpdate) return; // aucune règle ne couvre ce couple modèle/méthode

    Object.assign(currentReferenceValues, optimistic.root);
    if (hasLineUpdate) {
      for (const fieldName of Object.keys(documentGraph.lines || {})) {
        if (Array.isArray(currentReferenceValues[fieldName])) {
          currentReferenceValues[fieldName] = currentReferenceValues[fieldName].map((row) => ({
            ...row,
            ...optimistic.lineUpdates,
          }));
        }
      }
    }

    await patchCachedRecord(model, currentRecordId, currentReferenceValues);

    const patchedRecord = { ...currentReferenceValues, id: currentRecordId };

    await mountFormInto(patchedRecord);
  }

    /**
   * NEW — handles a click on a type="object" header button (e.g.
   * action_confirm, action_cancel, action_lock...). Follows the exact
   * same pattern already used by saveRecord(): always queue locally
   * first, then flush immediately if online. This keeps a single,
   * consistent offline-first code path instead of a separate "direct
   * online RPC" branch.
   *
   * Generic by design: methodName is whatever the arch XML declared as
   * button name="..." — no method name is hardcoded here.
   *
   * Known limitations (intentionally deferred, not silently ignored):
   * - The button's "context" attribute (e.g. context="{'validate_analytic': True}")
   *   is not evaluated/forwarded yet — args/kwargs are sent empty.
   * - type="action" buttons are out of scope for this iteration
   *   (see form_header.js, unchanged behavior for them).
   */
  async function onObjectButtonClick(methodName) {
    if (!currentRecordId) {
      notifications.add("Impossible d'exécuter cette action avant l'enregistrement de la fiche.", { title: "Action object", type: "warning" });
      return;
    }

    try {
      const localUuid = await queueMethodCall(model, currentRecordId, methodName);

      // Effets de stock (voir rules/stock_rules.js) -- ex: valider un bon
      // de réception/livraison. Calculés à partir de l'état actuel du
      // formulaire (quantités saisies), écrits dans le ledger local pour
      // un affichage immédiat sans attendre la sync avec Odoo. N'a aucun
      // effet si aucune règle "stock_effect" ne couvre ce couple
      // modèle/méthode (retourne un tableau vide).
      try {
        const graph = buildDocumentGraph(currentContainer, currentFieldsInfo, currentReferenceValues);
        const deltas = await computeStockEffects(model, methodName, graph);
        for (const d of deltas) {
          await addLedgerDelta(d.model, d.key, d.deltaField, d.delta, localUuid);
        }
        if (deltas.length > 0) bus.trigger("ledger:updated");

        // Mise à jour OPTIMISTE de l'enregistrement lui-même (ex: state
        // "assigned" -> "done") -- données locales changées TOUT DE SUITE,
        // avant même de savoir si la connexion est disponible. La vraie
        // valeur serveur prendra le relais via refreshFormFromServer() une
        // fois la synchronisation confirmée (voir plus bas).
        await applyOptimisticStateUpdate(methodName, graph);
      } catch (err) {
        console.warn("[form_controller] Échec du calcul des effets de stock:", err);
      }

      statusEl.textContent = "Action enregistrée localement — sera synchronisée dès que possible.";
      bus.trigger("sync:updated");

      if (navigator.onLine) {
        const result = await syncPendingActions();

        if (result.synced > 0) {
          statusEl.textContent = "Action synchronisée avec Odoo.";
          try {
            await refreshFormFromServer();
          } catch (err) {
            console.warn("Rafraîchissement post-action échoué:", err);
          }
        }

        // The server executed the method but returned an action (e.g. a
        // wizard) it could not replay offline — see
        // sync_queue.py::_execute_call_method. This is NOT an error:
        // the underlying method did run, but a manual follow-up step
        // remains, so the user must be told explicitly rather than
        // believing the action fully completed.
        const pendingInfo = result.manualActions && result.manualActions[localUuid];
        if (pendingInfo) {
          notifications.add(
            "L'action a été exécutée, mais nécessite une étape supplémentaire dans Odoo" +
            (pendingInfo.name ? ` (${pendingInfo.name})` : "") +
            " — à compléter une fois connecté.",
            { title: "Étape supplémentaire", type: "info", sticky: true }
          );
        }

        bus.trigger("sync:updated");
      }
    } catch (err) {
      console.error(err);
      statusEl.textContent = "Erreur lors de l'exécution de l'action : " + err.message;
    }
  }

    async function saveRecord() {
    if (!currentContainer || !currentFieldsInfo) return;
    const formData = collectFormData(currentContainer, currentFieldsInfo);

    // Champs requis (équivalent du checkRequired natif, côté client) :
    // bloqué AVANT les contraintes, même ordre que la validation Odoo.
    const missingRequired = checkRequiredFields(model, formData, currentFieldsInfo);
    if (missingRequired.length > 0) {
      const message = "Champs requis manquants : " + missingRequired.join(", ");
      statusEl.textContent = "Enregistrement bloqué : " + message;
      notifications.add(message, { title: "Champs requis", type: "danger" });
      return;
    }

    // Règle constraint -- les @api.constrains portées dans rules/
    // (quantités strictement positives, dates cohérentes...) bloquent
    // la sauvegarde avec leur message, comme un raise ValidationError.
    const graphForValidation = buildDocumentGraph(currentContainer, currentFieldsInfo, currentReferenceValues);
    const validation = await validateDocument(model, graphForValidation);
    if (!validation.valid) {
      statusEl.textContent = "Enregistrement bloqué : " + validation.errors.map((e) => e.message).join(" / ");
      return;
    }

    try {
      let localUuid;

      if (currentRecordId) {
        formData.id = currentRecordId;
        localUuid = await queueAction(model, "write", formData, "generic", currentReferenceWriteDate, currentReferenceValues);
      } else if (pendingCreateUuid) {
        const amended = await amendPendingCreate(pendingCreateUuid, formData);
        if (amended) {
          localUuid = pendingCreateUuid;
        } else {
          const entry = await getSyncQueueEntry(pendingCreateUuid);
          if (entry && entry.odoo_record_id) {
            currentRecordId = entry.odoo_record_id;
            formData.id = currentRecordId;
            localUuid = await queueAction(model, "write", formData, "generic", currentReferenceWriteDate, currentReferenceValues);
            pendingCreateUuid = null;
          } else {
            localUuid = await queueAction(model, "create", formData, "generic", currentReferenceWriteDate, currentReferenceValues);
            pendingCreateUuid = localUuid;
          }
        }
      } else {
        localUuid = await queueAction(model, "create", formData, "generic", currentReferenceWriteDate, currentReferenceValues);
        pendingCreateUuid = localUuid;
      }

      statusEl.textContent = "Enregistré localement — sera synchronisé dès que possible.";
      bus.trigger("sync:updated");

      if (navigator.onLine) {
        const result = await syncPendingActions();
        const wasCreate = !!(result.createdIds && result.createdIds[localUuid]);

        if (wasCreate) {
          currentRecordId = result.createdIds[localUuid];
          pendingCreateUuid = null;
          router.replaceState({ tag: "form_view", module, model, id: currentRecordId, actionId, listLabel });
        }

        if (result.synced > 0) {
          statusEl.textContent = "Enregistré et synchronisé avec Odoo";
          // NEW: in both cases (create OR write), we reload
          // the complete record from the server — for a create,
          // this also retrieves the IDs of one2many lines created at the
          // same time as the root record; for a write, it is the
          // only way to obtain these IDs (see refreshFormFromServer).
          try {
            await refreshFormFromServer();
          } catch (err) {
            console.warn("Rafraîchissement post-synchronisation échoué:", err);
          }
        } else if (result.hasConflict) {
          // NEW: distinct from a technical error — the write was
          // intentionally refused because the record changed elsewhere
          // in the meantime. Resolution happens in the sync panel, not
          // here (see conflict_panel.js).
          statusEl.textContent =
            "Conflit détecté : ce document a été modifié par quelqu'un d'autre. " +
            "Ouvrez le panneau de synchronisation pour choisir quelle version garder.";
        } else if (result.hasError) {
          statusEl.textContent = "Erreur lors de la synchronisation — voir le panneau de synchronisation.";
        }
        bus.trigger("sync:updated");
      }
    } catch (err) {
      console.error(err);
      statusEl.textContent = "Erreur lors de l'enregistrement : " + err.message;
    }
  }

    // Zones du template OWL + démarrage du flux de chargement.
    owl.onMounted(() => {
      self.statusHostRef.el.appendChild(statusEl);
      start();
    });

    // Destruction : timers, écouteurs live et app OWL du renderer.
    owl.onWillDestroy(() => {
      clearTimeout(rulesSyncTimer);
      cleanupRules();
      if (rendererDestroy) rendererDestroy();
    });
  }
}

/**
 * Montage du contrôleur (contrat historique conservé : async, retourne
 * la fonction destroy) -- appelé par views/view.js via le descripteur
 * { Controller } de form_view.js, comme le webclient d'Odoo monte le
 * composant Controller d'une vue.
 */
export async function mountFormController(container, params, env) {
  const { destroy } = await mountOwlApp(FormController, container, { params, env });
  return destroy;
}
