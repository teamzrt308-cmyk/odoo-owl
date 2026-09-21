/**
 * core/local_ledger.js
 * Registre local des deltas produits par les règles de calcul offline pour
 * les agrégats qui portent sur PLUSIEURS enregistrements (ex: qty_available
 * d'un stock.quant, alimenté par tous les stock.move créés hors-ligne qui le
 * concernent). Voir orm_service.js (version 11) pour le détail du schéma et
 * la justification de cette table séparée de record_cache.
 */

import { db } from "./orm_service.js";

/**
 * Enregistre un delta local (ex: -3 sur la quantité disponible d'un produit
 * suite à la confirmation hors-ligne d'une commande de vente).
 *
 * @param {string} model       - modèle Odoo concerné (ex: "stock.quant")
 * @param {string} key         - identifiant de l'agrégat, convention libre
 *                                par modèle (ex: "5:8" pour product_id=5,
 *                                location_id=8)
 * @param {string} deltaField  - champ affecté (ex: "quantity")
 * @param {number} delta       - valeur à ajouter, peut être négative
 * @param {string} syncUuid    - local_uuid de l'entrée sync_queue à
 *                                l'origine de ce delta
 */
export async function addLedgerDelta(model, key, deltaField, delta, syncUuid) {
  if (!delta) return; // un delta de 0 n'a aucun effet, inutile de le stocker
  await db.local_ledger.add({
    model,
    key,
    delta_field: deltaField,
    delta,
    sync_uuid: syncUuid,
    created_at: new Date().toISOString(),
  });
}

/**
 * Clé du ledger pour un enregistrement AFFICHÉ. La convention doit
 * rester identique à celle des règles stock_effect (stock_rules.js) :
 * les stock.quant sont agrégés par le couple produit:emplacement (pas
 * par leur id), tout autre modèle est indexé par son id.
 */
export function ledgerKeyForRecord(model, record) {
  if (!record) return null;
  if (model === "stock.quant") {
    const unwrap = (v) => (Array.isArray(v) ? v[0] : v);
    const productId = unwrap(record.product_id);
    const locationId = unwrap(record.location_id);
    if (productId !== undefined && productId !== null && locationId !== undefined && locationId !== null) {
      return `${productId}:${locationId}`;
    }
  }
  return String(record.id);
}

/**
 * Somme tous les deltas en attente pour un agrégat précis
 * (model + key + delta_field). Retourne 0 s'il n'y en a aucun.
 */
export async function getAggregatedDelta(model, key, deltaField) {
  const entries = await db.local_ledger
    .where({ model, key, delta_field: deltaField })
    .toArray();
  return entries.reduce((sum, e) => sum + (e.delta || 0), 0);
}

/**
 * Retourne TOUS les deltas en attente pour un agrégat (model + key), quel
 * que soit le champ, regroupés par delta_field. Pratique quand un même
 * enregistrement agrégé (ex: un stock.quant) a plusieurs champs dérivés à
 * ajuster en une seule lecture.
 *
 * @returns {Object} ex: { quantity: -3, reserved_quantity: 1 }
 */
export async function getAggregatedDeltasByField(model, key) {
  const entries = await db.local_ledger.where({ model, key }).toArray();
  const byField = {};
  for (const e of entries) {
    byField[e.delta_field] = (byField[e.delta_field] || 0) + (e.delta || 0);
  }
  return byField;
}

/**
 * Applique les deltas en attente par-dessus un enregistrement de base
 * (typiquement une valeur fraîchement lue depuis record_cache/reference_records)
 * et retourne une COPIE ajustée -- ne modifie jamais l'enregistrement d'origine.
 *
 * @param {string} model
 * @param {string} key
 * @param {Object} baseRecord - enregistrement tel que connu du serveur
 * @returns {Object} copie de baseRecord avec les deltas appliqués
 */
export async function applyLedgerAdjustments(model, key, baseRecord) {
  const deltas = await getAggregatedDeltasByField(model, key);
  if (Object.keys(deltas).length === 0) return baseRecord;

  const adjusted = { ...baseRecord };
  for (const [field, delta] of Object.entries(deltas)) {
    adjusted[field] = (adjusted[field] || 0) + delta;
  }
  return adjusted;
}

/**
 * Applique les deltas en attente sur une LISTE d'enregistrements
 * (listes/kanban) -- lecture AJUSTÉE sans persistance : comme une
 * lecture Odoo en temps réel, la base stockée reste celle du serveur et
 * le ledger porte le diff local en attente de synchronisation. Les
 * enregistrements sans delta sont retournés tels quels (même référence).
 *
 * @returns {Array} nouvelles lignes à afficher
 */
export async function applyLedgerAdjustmentsToList(model, records) {
  if (!Array.isArray(records) || records.length === 0) return records;
  const adjusted = [];
  let anyDelta = false;
  for (const record of records) {
    const key = ledgerKeyForRecord(model, record);
    const deltas = key ? await getAggregatedDeltasByField(model, key) : {};
    if (deltas && Object.keys(deltas).length > 0) {
      anyDelta = true;
      adjusted.push(await applyLedgerAdjustments(model, key, record));
    } else {
      adjusted.push(record);
    }
  }
  return anyDelta ? adjusted : records;
}

/**
 * Supprime toutes les entrées du ledger liées à une action sync_queue
 * précise. À appeler UNIQUEMENT une fois cette action confirmée
 * synchronisée avec succès (sinon son effet serait perdu avant que le
 * nouveau record_cache, qui l'intègre réellement, ne soit rechargé).
 *
 * Sera branché dans rpc_service.js::syncPendingActions à l'étape suivante.
 */
export async function clearLedgerForSyncUuid(syncUuid) {
  await db.local_ledger.where({ sync_uuid: syncUuid }).delete();
}

/**
 * Purge complète du ledger (ex: changement d'utilisateur sur un poste
 * partagé -- voir cache_meta / version 10 -- ou reset manuel de debug).
 */
export async function clearAllLedger() {
  await db.local_ledger.clear();
}