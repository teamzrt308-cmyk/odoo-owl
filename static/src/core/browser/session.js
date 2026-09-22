/**
 * core/browser/session.js
 * ========================
 * Groups Odoo server connection configuration and session management
 * (API key + logged-in user identity), persisted in
 * localStorage to survive offline reloads/restarts.
 */

export const CONFIG = {
  ODOO_BASE_URL: "http://localhost:8069",
};

const SESSION_STORAGE_KEY = "offline_sync_session";

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

/** Clears the local session (log out, or invalid API key on the server side). */
export function clearSession() {
  localStorage.removeItem(SESSION_STORAGE_KEY);
}

/** Shortcut: API key for the current session, or null if not logged in. */
export function getApiKey() {
  const session = getSession();
  return session ? session.api_key : null;
}

/** Shortcut: Odoo user ID of the current session, or null. */
export function getUserId() {
  const session = getSession();
  return session ? session.uid : null;
}
