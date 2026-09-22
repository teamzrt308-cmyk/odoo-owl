from odoo import http #type: ignore
from odoo.http import request #type: ignore
from odoo.exceptions import AccessDenied #type: ignore
import logging
import json
import time

from .common import OfflineSyncMixin

_logger = logging.getLogger(__name__)

# Mesure 5 : rate-limit du login (par IP + login) -- 5 échecs / 15 min.
# Compteurs en mémoire par worker : suffisant contre le brute-force
# (les attaques distribuées relèvent de la mesure 1 / infra).
_LOGIN_WINDOW_SECONDS = 15 * 60
_LOGIN_MAX_FAILURES = 5
_login_failures = {}


def _prune_login_failures(now):
    for key, stamps in list(_login_failures.items()):
        fresh = [t for t in stamps if now - t < _LOGIN_WINDOW_SECONDS]
        if fresh:
            _login_failures[key] = fresh
        else:
            _login_failures.pop(key, None)


class AuthController(http.Controller, OfflineSyncMixin):

    @http.route(
            "/offline_sync/ping", 
            type="http", 
            auth="none",
            methods=["GET", "OPTIONS"], 
            csrf=False
        )
    def ping(self, **kwargs):
        """Ultra-lightweight, unauthenticated route used 
        solely to verify actual reachability of the Odoo server 
        (beyond `navigator.onLine`, which only detects the local 
        network interface status, not actual server access).."""

        if request.httprequest.method == "OPTIONS":
            return self._cors_response()
        # Echo de la base resolue par le dispatch (host/db_filter/?db=) :
        # la PWA la compare au tampon de sa session au boot. Aucun acces
        # env ici -- la route reste utilisable meme sans base resolue.
        try:
            dbname = request.env.cr.dbname
        except Exception:
            dbname = None
        return self._cors_response(json.dumps({"status": "ok", "db": dbname}))

    @http.route(
            "/offline_sync/login", 
            type="http", 
            auth="none",
            methods=["POST", "OPTIONS"], 
            csrf=False
        )
    def login(self, **kwargs):
        if request.httprequest.method == "OPTIONS":
            return self._cors_response()

        try:
            body = json.loads(request.httprequest.data)
            login = body.get("login")
            password = body.get("password")
        except Exception:
            return self._cors_response(json.dumps({"error": "Invalid request"}), status=400)

        if not login or not password:
            return self._cors_response(
                json.dumps({"error": "Email and password required"}), status=400
            )

        # Mesure 5 : garde rate-limit AVANT toute vérification de mot
        # de passe.
        ip = request.httprequest.remote_addr or "?"
        now = time.monotonic()
        _prune_login_failures(now)
        failure_key = (ip, login)
        if len(_login_failures.get(failure_key, [])) >= _LOGIN_MAX_FAILURES:
            _logger.warning(
                "offline_sync: RATE-LIMIT login ip=%s login=%s", ip, login
            )
            return self._cors_response(
                json.dumps({"error": "Trop de tentatives. Réessayez dans 15 minutes."}),
                status=429,
                extra_headers=[("Retry-After", str(_LOGIN_WINDOW_SECONDS))],
            )

        db = request.env.cr.dbname
        try:
            uid = request.env["res.users"]._login(db, login, password, {"interactive": False})
        except AccessDenied:
            uid = False
        except Exception:
            _logger.exception("Authentication error")
            uid = False

        if not uid:
            _login_failures.setdefault(failure_key, []).append(now)
            _logger.warning(
                "offline_sync: échec de login ip=%s login=%s", ip, login
            )
            return self._cors_response(
                json.dumps({"error": "Incorrect email or password"}), status=401
            )

        _login_failures.pop(failure_key, None)

        user = request.env["res.users"].sudo().browse(uid)
        # Mesure 3/4 : régénération systématique -- le secret n'existe en
        # clair que le temps de CETTE réponse (haché ensuite côté
        # serveur) ; les sessions antérieures du même utilisateur sont
        # révoquées (elles recevront un 401 à leur prochain appel).
        api_key = user.action_generate_offline_sync_key()
        _logger.info(
            "offline_sync: login OK uid=%s ip=%s (clé API régénérée)", uid, ip
        )

        return self._cors_response(json.dumps({
            "uid": user.id,
            "name": user.name,
            "api_key": api_key,
            # Base resolue pour cette requete : la PWA la stocke dans sa
            # session ("tampon de base") et la verifie au boot -- garde
            # anti-divergence en deploiement multi-bases (cf. db_filter,
            # selecteur de base / parametre ?db=).
            "db": request.env.cr.dbname,
        }))

    @http.route(
            "/offline_sync/logout",
            type="http",
            auth="none",
            methods=["POST", "OPTIONS"],
            csrf=False
        )
    def logout(self, **kwargs):
        """Mesure 4 : révocation SERVEUR de la clé API (le logout PWA
        local ne suffisait pas -- la clé restait valide à vie)."""
        if request.httprequest.method == "OPTIONS":
            return self._cors_response()

        user = self._authenticate_api_key()
        if not user:
            return self._cors_response(
                json.dumps({"error": "Clé API invalide ou manquante"}), status=401
            )

        user._revoke_offline_sync_key()
        _logger.info(
            "offline_sync: logout uid=%s ip=%s",
            user.id, request.httprequest.remote_addr or "?",
        )
        return self._cors_response(json.dumps({"status": "ok"}))
