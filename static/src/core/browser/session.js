/**
 * core/browser/session.js
 * ========================
 * Groups Odoo server connection configuration and session management
 * (API key + logged-in user identity), persisted in
 * localStorage to survive offline reloads/restarts.
 */

import { clearVault } from "./vault.js";

export const CONFIG = {
  ODOO_BASE_URL: "http://localhost:8069",
};

const SESSION_STORAGE_KEY = "offline_sync_session";
// M9 (coffre) : clé API déverrouillée pour la durée de l'ONGLET
// (sessionStorage) -- localStorage ne contient plus que le coffre
// chiffré (cf. vault.js).
const UNLOCKED_KEY_STORAGE = "offline_sync_unlocked_key";

function unlockedKeyRaw() {
  try {
    return typeof sessionStorage !== "undefined"
      ? sessionStorage.getItem(UNLOCKED_KEY_STORAGE)
      : null;
  } catch {
    return null;
  }
}

/** Reads the complete local session ({ uid, name, api_key }), or null if absent. */
export function getSession() {
  const raw = localStorage.getItem(SESSION_STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}

/** Saves the local session (called immediately after a successful login). */
export function saveSession(session) {
  // Tampon de base (durcissement multi-bases) : on grave dans la session
  // l'URL serveur utilisée au login (+ la base résolue par le serveur,
  // fournie par l'appelant). Au boot, verifyLocalStamp() compare ce
  // tampon à la réalité pour purger si l'appareil a changé de cible.
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({
    ...session,
    serverUrl: CONFIG.ODOO_BASE_URL,
  }));
  // Cohérence M9 : une session (re)créée sans api_key ne doit pas
  // hériter d'une clé déverrouillée d'une session précédente.
  if (session && !session.api_key) {
    try {
      if (typeof sessionStorage !== "undefined") {
        sessionStorage.removeItem(UNLOCKED_KEY_STORAGE);
      }
    } catch {
      // ignoré
    }
  }
}

/** Base Odoo de la session (tampon multi-bases), ou null si absente. */
export function getSessionDb() {
  const session = getSession();
  return session && session.db ? session.db : null;
}

/**
 * Étiquette une URL offline_sync avec la base de la session
 * (?db=<nom>). Indispensable en déploiement multi-bases sur un MÊME
 * domaine (la base n'est plus devinable par le host) ; sans effet en
 * mono-base. `explicitDb` (optionnel) sert au login, avant toute
 * session.
 */
export function withDb(url, explicitDb = null) {
  const db = explicitDb || getSessionDb();
  if (!db) return url;
  return url + (url.includes("?") ? "&" : "?") + "db=" + encodeURIComponent(db);
}

/** Clears the local session (log out, or invalid API key on the server side).
 * M9 : efface aussi la clé déverrouillée (onglet) et le coffre chiffré. */
export function clearSession() {
  localStorage.removeItem(SESSION_STORAGE_KEY);
  try {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.removeItem(UNLOCKED_KEY_STORAGE);
    }
  } catch {
    // sessionStorage indisponible : rien à purger.
  }
  clearVault();
}

/** Shortcut: API key for the current session, or null if not logged in.
 * M9 : la clé vient de la session ONGLET (déverrouillée par le mot de
 * passe Odoo) ; repli : sessions legacy d'avant le coffre (clé en clair
 * dans localStorage -- migrée au prochain login). */
export function getApiKey() {
  const unlocked = unlockedKeyRaw();
  if (unlocked) return unlocked;
  const session = getSession();
  return session && session.api_key ? session.api_key : null;
}

/** M9 : mémorise la clé déverrouillée pour la durée de l'onglet. */
export function setUnlockedKey(apiKey) {
  try {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(UNLOCKED_KEY_STORAGE, apiKey);
    }
  } catch {
    // sessionStorage indisponible : la clé reste en mémoire vive de
    // l'appelant uniquement (l'app exige un re-déverrouillage au
    // prochain boot de toute façon).
  }
}

/** Shortcut: Odoo user ID of the current session, or null. */
export function getUserId() {
  const session = getSession();
  return session ? session.uid : null;
}
