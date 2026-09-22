/**
 * core/network/fetch_guard.js
 * Sécurité (lot « 11 mesures ») :
 *  - INTERCEPTEUR 401 (mesure 4) : une réponse 401 d'une route
 *    /offline_sync/ signifie clé invalide, expirée (TTL) ou révoquée
 *    (logout sur un autre appareil) -> session locale effacée + événement
 *    bus "auth:expired" (toast + redirection login par le service d'actions) ;
 *  - logoutServeur() (mesure 4) : révocation de la clé côté serveur
 *    (POST /offline_sync/logout, Bearer) -- fire-and-forget, no-op hors
 *    ligne ; le logout local reste immédiat quoi qu'il arrive.
 */

import { bus } from "../bus/bus_service.js";
import {
    clearSession,
    getApiKey,
    withDb,
    CONFIG,
} from "../browser/session.js";

let installed = false;

/**
 * Enrobe window.fetch UNE FOIS (appelé au boot, avant les services).
 * Ne modifie jamais la réponse : seulement observe les 401.
 */
export function installFetchGuard() {
  if (installed || typeof window === "undefined" || !window.fetch) return;
  installed = true;
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const response = await originalFetch(input, init);
    try {
      const url = typeof input === "string" ? input : (input && input.url) || "";
      if (
        response &&
        response.status === 401 &&
        url.includes("/offline_sync/") &&
        getApiKey()
      ) {
        console.warn("[fetch-guard] 401 offline_sync -> déconnexion locale :", url);
        clearSession();
        bus.trigger("auth:expired", { url });
      }
    } catch (err) {
      // La garde ne doit JAMAIS faire échouer l'appel qu'elle observe.
    }
    return response;
  };
}

/**
 * Révocation serveur de la clé API. Retourne true si la requête est
 * partie avec succès. Hors ligne : false immédiat (le logout local a
 * déjà eu lieu côté appelant ; la clé sera révoquée au prochain login
 * de toute façon -- le login régénère systématiquement la clé).
 */
export async function logoutServeur() {
  const apiKey = getApiKey();
  if (!apiKey || !navigator.onLine) return false;
  try {
    const response = await fetch(
      withDb(`${CONFIG.ODOO_BASE_URL}/offline_sync/logout`),
      {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
      }
    );
    if (!response.ok) {
      console.warn("[fetch-guard] logout serveur refusé :", response.status);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[fetch-guard] logout serveur impossible (hors ligne ?)", err);
    return false;
  }
}
