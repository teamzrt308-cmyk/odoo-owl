/**
 * core/browser/vault.js
 * Coffre-fort de session (lot sécurité, M9 -- « mot de passe », PAS de
 * PIN) : la clé API n'est plus jamais stockée en clair dans
 * localStorage. Elle est chiffrée AES-GCM 256 avec une clé dérivée
 * PBKDF2-SHA256 (210 000 itérations) du MOT DE PASSE ODOO de
 * l'utilisateur : aucun nouveau secret à créer ni à retenir.
 *
 * Modèle de menace couvert : appareil volé/consulté, onglet fermé ->
 * sessionStorage vide -> l'app démarre « verrouillée » (écran unlock) :
 * caches visibles mais session inutilisable sans le mot de passe.
 * Un mot de passe erroné échoue à l'authentification GCM (aucun
 * vérificateur stocké : le chiffrement EST la vérification).
 *
 * Dégradations assumées :
 *  - onglet laissé ouvert : la clé déverrouillée vit en sessionStorage
 *    (le temps de l'onglet) ;
 *  - contexte non sécurisé (pas de https/localhost) : WebCrypto
 *    indisponible -> repli legacy (clé en clair, warn console), le
 *    temps de passer à https (mesure 1).
 */

const VAULT_STORAGE_KEY = "offline_sync_vault";
export const PBKDF2_ITERATIONS = 210000;

function subtle() {
  const c = globalThis.crypto;
  if (c && c.subtle && typeof c.subtle.encrypt === "function") {
    return c.subtle;
  }
  throw new Error("WebCrypto indisponible (contexte non sécurisé ?)");
}

function randomBytes(n) {
  const bytes = new Uint8Array(n);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

function toB64(buffer) {
  let str = "";
  new Uint8Array(buffer).forEach((b) => { str += String.fromCharCode(b); });
  return btoa(str);
}

function fromB64(b64) {
  const str = atob(b64);
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i);
  return out;
}

/** WebCrypto utilisable ? (sinon repli legacy côté appelant) */
export function cryptoAvailable() {
  try {
    return !!(globalThis.crypto && globalThis.crypto.subtle &&
      typeof globalThis.crypto.subtle.encrypt === "function");
  } catch {
    return false;
  }
}

async function deriveKey(password, salt) {
  const baseKey = await subtle().importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return subtle().deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/** Un coffre existe-t-il (session chiffrée en attente de déverrouillage) ? */
export function vaultExists() {
  try {
    return !!localStorage.getItem(VAULT_STORAGE_KEY);
  } catch {
    return false;
  }
}

/** Supprime le coffre (logout, « se reconnecter »). */
export function clearVault() {
  try {
    localStorage.removeItem(VAULT_STORAGE_KEY);
  } catch {
    // localStorage indisponible : rien à purger.
  }
}

/** Chiffre la clé API avec le mot de passe et persiste le coffre. */
export async function createVault(password, apiKey) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveKey(password, salt);
  const cipher = await subtle().encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(apiKey)
  );
  localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify({
    v: 1,
    kdf: "PBKDF2-SHA256",
    iterations: PBKDF2_ITERATIONS,
    salt: toB64(salt),
    iv: toB64(iv),
    ct: toB64(cipher),
    created_at: new Date().toISOString(),
  }));
  return true;
}

/**
 * Tente le déverrouillage avec le mot de passe fourni : retourne la clé
 * API en clair (uniquement en mémoire par l'appelant) ou null si le
 * mot de passe est incorrect / le coffre corrompu.
 */
export async function unlockVault(password) {
  let vault = null;
  try {
    vault = JSON.parse(localStorage.getItem(VAULT_STORAGE_KEY) || "null");
  } catch {
    return null;
  }
  if (!vault || !vault.salt || !vault.iv || !vault.ct) return null;
  try {
    const key = await deriveKey(password, fromB64(vault.salt));
    const plain = await subtle().decrypt(
      { name: "AES-GCM", iv: fromB64(vault.iv) },
      key,
      fromB64(vault.ct)
    );
    return new TextDecoder().decode(plain);
  } catch {
    // Authentification GCM échouée : mauvais mot de passe (ou coffre
    // altéré) -- on ne distingue PAS les deux volontairement.
    return null;
  }
}
