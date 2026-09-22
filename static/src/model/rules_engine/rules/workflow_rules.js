/**
 * model/rules_engine/rules/workflow_rules.js
 * ============================================
 * Workflow hors ligne : portage des méthodes OBJET de boutons du header
 * (type="object") qui ne font que TRANSITIONNER L'ÉTAT du document chez
 * Odoo 17. Les transitions reprennent exactement les valeurs des
 * sélections `state` des manifests réels (sale.order, purchase.order,
 * stock.picking) et la sémantique des méthodes Python correspondantes :
 *
 *   - sale.order    : action_confirm, action_draft, action_cancel,
 *                     action_unlock, action_quotation_send ;
 *   - purchase.order: button_confirm, button_approve, button_draft,
 *                     button_cancel, button_done, action_rfq_send ;
 *   - stock.picking : action_confirm, action_assign, action_cancel
 *                     (button_validate vit dans stock_rules.js : il
 *                     porte en plus les effets de stock sur le ledger).
 *
 * Type "object_action" : chaque règle porte
 *   - fromStates       : états depuis lesquels le clic est autorisé
 *                        (Odoo masque le bouton via invisible="state !=
 *                        ..." ; le moteur REVALIDE -- canRunObjectAction) ;
 *                        null = couvrante sans verrou d'état (clic
 *                        silencieux, cf. quotation_send/rfq_send) ;
 *   - optimisticState(documentGraph) : champs à fusionner IMMÉDIATEMENT
 *                        sur la fiche (state, locked...) pour que
 *                        l'écran reflète l'action hors ligne.
 *   (Pas de propriété "guard" : jamais implémentée côté moteur -- ne
 *   pas documenter une option inexistante.)
 *
 * L'appel RÉEL reste queueMethodCall(model, id, method) dans
 * form_controller.js : à la synchronisation, le serveur rejoue la
 * méthode Python authentique (messages, sous--actions, etc.). Ces
 * règles ne reproduisent que la PARTIE LOCALE, purement déterministe.
 *
 * Cas particulier action_quotation_send / action_rfq_send : portées en
 * règles COUVRANTES sans verrou d'état (fromStates: null, aucun effet
 * local) -- l'effet serveur (e-mail) reste au rejeu, mais le clic reste
 * possible hors ligne et l'action part en file.
 *
 * Méthodes volontairement NON portées (effets serveur non reproductibles
 * hors ligne : paiements, facturation, impressions, wizards) :
 * payment_action_capture/void, action_create_invoice, action_create_project,
 * action_view_picking/print_quotation/do_print_picking,
 * action_update_quantity_on_hand, action_open_label_*... -> pas de règle,
 * le couple (modèle, méthode) reste "non couvert" (canRunObjectAction ->
 * covered:false) et le clic est refusé (toast) sans rien mettre en file.
 */

const noopOptimistic = () => ({ root: {}, lineUpdates: {} });

// ── sale.order (Odoo 17 : sale/models/sale_order.py) ─────────────────────
const saleOrderWorkflow = [
  {
    model: "sale.order",
    type: "object_action",
    method: "action_confirm",
    // Devis (draft) ou envoyé (sent) -> commande (sale).
    fromStates: ["draft", "sent"],
    optimisticState: () => ({ root: { state: "sale" }, lineUpdates: {} }),
  },
  {
    model: "sale.order",
    type: "object_action",
    method: "action_draft",
    // Repasser en devis depuis commande ou annulé.
    fromStates: ["sale", "cancel"],
    optimisticState: () => ({ root: { state: "draft" }, lineUpdates: {} }),
  },
  {
    model: "sale.order",
    type: "object_action",
    method: "action_cancel",
    fromStates: ["draft", "sent", "sale"],
    optimisticState: () => ({ root: { state: "cancel" }, lineUpdates: {} }),
  },
  {
    model: "sale.order",
    type: "object_action",
    method: "action_unlock",
    // Déverrouiller une commande verrouillée (champ boolean `locked`).
    fromStates: ["sale", "done"],
    optimisticState: () => ({ root: { locked: false }, lineUpdates: {} }),
  },
  {
    model: "sale.order",
    type: "object_action",
    method: "action_quotation_send",
    // Envoi du devis par e-mail : effet serveur (mail), pas de
    // transition locale -- règle "couvrante" sans verrou d'état pour
    // garder le clic silencieux côté moteur.
    fromStates: null,
    optimisticState: noopOptimistic,
  },
];

// ── purchase.order (Odoo 17 : purchase/models/purchase_order.py) ─────────
const purchaseOrderWorkflow = [
  {
    model: "purchase.order",
    type: "object_action",
    method: "button_confirm",
    // Demande de prix / envoyée -> bon de commande. (La double
    // validation "to approve" dépend d'une config serveur non embarquée :
    // hors ligne on applique le flux simple, comme une société sans
    // approbation -- écart documenté.)
    fromStates: ["draft", "sent", "to approve"],
    optimisticState: () => ({ root: { state: "purchase" }, lineUpdates: {} }),
  },
  {
    model: "purchase.order",
    type: "object_action",
    method: "button_approve",
    // Approbation (flux à double validation) -> bon de commande.
    fromStates: ["to approve"],
    optimisticState: () => ({ root: { state: "purchase" }, lineUpdates: {} }),
  },
  {
    model: "purchase.order",
    type: "object_action",
    method: "button_draft",
    fromStates: ["cancel", "purchase", "done"],
    optimisticState: () => ({ root: { state: "draft" }, lineUpdates: {} }),
  },
  {
    model: "purchase.order",
    type: "object_action",
    method: "button_cancel",
    fromStates: ["draft", "sent", "to approve", "purchase"],
    optimisticState: () => ({ root: { state: "cancel" }, lineUpdates: {} }),
  },
  {
    model: "purchase.order",
    type: "object_action",
    method: "button_done",
    // Verrouiller le bon de commande.
    fromStates: ["purchase"],
    optimisticState: () => ({ root: { state: "done" }, lineUpdates: {} }),
  },
  {
    model: "purchase.order",
    type: "object_action",
    method: "action_rfq_send",
    fromStates: null,
    optimisticState: noopOptimistic,
  },
];

// ── stock.picking (Odoo 17 : stock/models/stock_picking.py) ──────────────
// button_validate porte son VERROU ici (object_action) et ses EFFETS dans
// stock_rules.js (stock_effect : deltas ledger + lignes picked) --
// canRunObjectAction() et computeOptimisticStateUpdate() fusionnent les
// deux buckets, comme si la méthode Python unique faisait les deux.
const stockPickingWorkflow = [
  {
    model: "stock.picking",
    type: "object_action",
    method: "button_validate",
    // La méthode Python refuse un bon déjà fait/annulé (UserError) ;
    // les archs masquent le bouton via invisible="state in ('done','cancel')"
    // -- on revalide ici (double clic, fiche périmée).
    fromStates: ["draft", "waiting", "confirmed", "assigned"],
    blockedMessage: "Ce transfert est déjà terminé (ou annulé) : validation impossible.",
    optimisticState: noopOptimistic,
  },
  {
    model: "stock.picking",
    type: "object_action",
    method: "action_confirm",
    // Marquer comme à faire.
    fromStates: ["draft"],
    optimisticState: () => ({ root: { state: "confirmed" }, lineUpdates: {} }),
  },
  {
    model: "stock.picking",
    type: "object_action",
    method: "action_assign",
    // Vérifier la disponibilité -> "Prêt". (La réservation fine des
    // quants est serveur ; hors ligne on reproduit la transition, le
    // ledger local affiche déjà le stock calculé.)
    fromStates: ["confirmed", "waiting"],
    optimisticState: () => ({ root: { state: "assigned" }, lineUpdates: {} }),
  },
  {
    model: "stock.picking",
    type: "object_action",
    method: "action_cancel",
    fromStates: ["draft", "waiting", "confirmed", "assigned"],
    optimisticState: () => ({ root: { state: "cancel" }, lineUpdates: {} }),
  },
];

export const workflowRules = [
  ...saleOrderWorkflow,
  ...purchaseOrderWorkflow,
  ...stockPickingWorkflow,
];
