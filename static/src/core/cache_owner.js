/**
 * core/cache_owner.js
 * Prevents an Odoo user from silently inheriting the cache
 * IndexedDB left behind by a previous user on the same device
 */

import { db } from "./orm_service.js";
import { clearSession, getSession, withDb, CONFIG } from "./browser/session.js";

const OWNER_KEY = "owner";
const DB_STAMP_KEY = "db_stamp";

/**
 * Verifies that the local cache belongs to newUserId. If the cache
 * belonged to another user, purges all tables (without
 * destroying the Dexie schema) before saving the new owner.
 *
 * @param {number} newUserId - Odoo UID of the user who just logged in
 */
export async function ensureCacheOwnership(newUserId, dbStamp = null) {
  if (newUserId === undefined || newUserId === null) {
    throw new Error("ensureCacheOwnership: newUserId manquant");
  }

  const meta = await db.cache_meta.get(OWNER_KEY);
  const previousOwner = meta?.value;
  const stampMeta = await db.cache_meta.get(DB_STAMP_KEY);
  const previousStamp = stampMeta ? stampMeta.value : null;

  const isDifferentOwner = previousOwner !== undefined && previousOwner !== newUserId;
  // Durcissement multi-bases : purge aussi si le cache appartenait à
  // une AUTRE base/serveur (même uid -- un même utilisateur peut avoir
  // des comptes dans deux bases, dont les ids n'ont rien en commun).
  const isDifferentStamp = !!dbStamp && !!previousStamp &&
    (previousStamp.db !== dbStamp.db || previousStamp.serverUrl !== dbStamp.serverUrl);

  if (isDifferentOwner || isDifferentStamp) {
    // Cache belonging to another user/base: complete purge.
    // sync_queue and sync_conflicts are intentionally included\u2014pending
    // actions created by the previous owner must never be replayed or
    // displayed under another identity.
    await purgeAllTables();
  }

  await db.cache_meta.put({ key: OWNER_KEY, value: newUserId });
  if (dbStamp) await db.cache_meta.put({ key: DB_STAMP_KEY, value: dbStamp });

  return { purged: isDifferentOwner || isDifferentStamp };
}

/** Export de secours (JSON téléchargé) des actions non synchronisées. */
function exportPendingActions(rows) {
  try {
    const blob = new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `sync_queue_export_${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (err) {
    console.warn("[db-guard] export des actions en attente impossible :", err);
  }
}

/** Purge TOUTES les tables (le schéma Dexie est conservé). */
export async function purgeAllTables() {
  await db.transaction("rw", db.tables, async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
  });
}

/**
 * GARDE DE BASE (boot, durcissement multi-bases) : vérifie que le tampon
 * de la session ({db, serverUrl}) correspond toujours à la réalité.
 * Divergence -> purge locale (confirmation + export JSON s'il y a des
 * actions non synchronisées) puis déconnexion : la garde
 * d'authentification du doAction redirige vers l'écran de login.
 * Mémoïsé : une seule vérification par boot.
 */
let stampVerdict = null;

export async function verifyLocalStamp() {
  if (stampVerdict) return stampVerdict;

  const session = getSession();
  if (!session) {
    stampVerdict = { ok: true };
    return stampVerdict;
  }
  // Session antérieure au durcissement (pas de tampon) : tolérée --
  // migration douce, le tampon sera posé au prochain login.
  if (!session.db) {
    console.warn("[db-guard] session sans tampon de base (ancienne session) -- purge non applicable");
    stampVerdict = { ok: true, legacy: true };
    return stampVerdict;
  }

  // 1) URL serveur changée : détectable HORS LIGNE (comparaison locale).
  if (CONFIG.ODOO_BASE_URL !== session.serverUrl) {
    stampVerdict = await purgeOnDivergence(
      `l'URL du serveur a changé (${session.serverUrl} -> ${CONFIG.ODOO_BASE_URL})`
    );
    return stampVerdict;
  }

  // 2) Base différente derrière le même domaine : le ping renvoie la
  //    base réellement résolue par le dispatch. On lui passe ?db= de la
  //    session : si cette base n'existe plus, db_filter la rejette et la
  //    résolution retombe sur une autre -> divergence détectée.
  if (navigator.onLine) {
    try {
      const response = await fetch(withDb(`${CONFIG.ODOO_BASE_URL}/offline_sync/ping`));
      if (response.ok) {
        const data = await response.json();
        if (data.db && data.db !== session.db) {
          stampVerdict = await purgeOnDivergence(
            `le serveur pointe désormais vers la base « ${data.db} » (session : « ${session.db} »)`
          );
          return stampVerdict;
        }
      }
    } catch (err) {
      // Hors ligne / serveur injoignable : seule la vérification locale
      // (1) est applicable ce boot.
      console.warn("[db-guard] vérification serveur du tampon impossible (hors ligne ?) :", err);
    }
  }

  stampVerdict = { ok: true };
  return stampVerdict;
}

/**
 * Purge sur divergence : s'il y a des actions non synchronisées, une
 * confirmation est demandée ; OK -> export JSON automatique puis purge,
 * Annuler -> les données locales sont CONSERVÉES (récupérables par
 * l'utilisateur) mais la session est de toute façon effacée (obligation
 * de se reconnecter à la bonne base).
 */
async function purgeOnDivergence(reason) {
  const pendingRows = await db.sync_queue
    .where("status").anyOf(["pending", "in_progress", "conflict"]).toArray();

  let proceed = true;
  if (pendingRows.length > 0) {
    proceed = window.confirm(
      `Divergence détectée : ${reason}.\n\n` +
      `${pendingRows.length} action(s) locale(s) non synchronisée(s) concernent l'ancienne base.\n` +
      "OK : exporter ces actions en JSON puis purger les données locales.\n" +
      "Annuler : conserver les données locales et se déconnecter."
    );
  }

  if (proceed) {
    if (pendingRows.length > 0) exportPendingActions(pendingRows);
    await purgeAllTables();
  }
  clearSession();
  return { sessionCleared: true, purged: proceed, reason };
}

/**
 * Read-only utility, useful for debugging or diagnostic display
 * (e.g., "cache currently associated with user X").
 */
export async function getCacheOwner() {
  const meta = await db.cache_meta.get(OWNER_KEY);
  return meta?.value ?? null;
}