/**
 * webclient/navbar/connectivity_indicator.js
 * ==========================================
 * ConnectivityIndicator -- composant OWL, même architecture qu'Odoo 17
 * (la navbar est composée de composants systray, dont connectivity
 * indicator) : le point de statut de connexion est un composant de la
 * Navbar, plus un mount vanilla branché par sélecteurs.
 *
 * La logique est conservée : navigator.onLine est insuffisant (réseau
 * présent mais serveur injoignable), un ping réel (fetch + timeout
 * 3 s) est vérifié périodiquement et aux événements online/offline.
 */

import { CONFIG } from "../../core/browser/session.js";

export class ConnectivityIndicator extends owl.Component {
  static template = owl.xml`
    <div class="d-flex align-items-center px-2" t-att-title="title">
      <span id="connectivity-dot" class="rounded-circle d-inline-block" style="width:10px; height:10px;" t-att-style="dotStyle"/>
    </div>`;

  setup() {
    // null = jamais vérifié (dot neutre au boot), true/false = dernier
    // état réel connu.
    this.state = owl.useState({ online: null });
    this.intervalId = null;

    this.updateConnectivityIndicator = () => this.update();
    window.addEventListener("online", this.updateConnectivityIndicator);
    window.addEventListener("offline", this.updateConnectivityIndicator);

    owl.onMounted(() => {
      this.update();
      this.intervalId = setInterval(this.updateConnectivityIndicator, 5000);
    });

    owl.onWillDestroy(() => {
      clearInterval(this.intervalId);
      window.removeEventListener("online", this.updateConnectivityIndicator);
      window.removeEventListener("offline", this.updateConnectivityIndicator);
    });
  }

  /**
   * Vérifie la connectivité RÉELLE : navigator.onLine est insuffisant
   * (réseau présent mais serveur injoignable) -- ping avec timeout.
   */
  async checkRealConnectivity() {
    if (!navigator.onLine) return false;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      const response = await fetch(`${CONFIG.ODOO_BASE_URL}/offline_sync/ping`, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return response.ok;
    } catch (err) {
      return false;
    }
  }

  async update() {
    const isOnline = await this.checkRealConnectivity();
    if (isOnline === this.state.online) return;
    this.state.online = isOnline;
  }

  get title() {
    if (this.state.online === null) return "Statut de connexion";
    return this.state.online ? "En ligne" : "Hors ligne";
  }

  get dotStyle() {
    if (this.state.online === true) {
      return "background-color:#28a745; box-shadow:0 0 4px rgba(40, 167, 69, 0.6);";
    }
    if (this.state.online === false) {
      return "background-color:#dc3545; box-shadow:0 0 4px rgba(220, 53, 69, 0.6);";
    }
    return "";
  }
}
