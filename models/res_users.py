from odoo import models, fields # type: ignore
import hashlib
import hmac
import secrets
import logging

_logger = logging.getLogger(__name__)

# Longueur du préfixe conservé en clair (recherche par index) -- le
# secret lui-même n'est JAMAIS persisté (mesure 3 du lot sécurité).
KEY_PREFIX_LENGTH = 8


class ResUsers(models.Model):
    _inherit = "res.users"

    # Ne stocke plus que le PRÉFIXE de la clé. Auparavant ce champ
    # contenait la clé EN CLAIR (faiblesse audit : lecture SQL/backup =
    # jeton directement utilisable).
    offline_sync_api_key = fields.Char(
        string="API key prefix",
        copy=False,
        groups="base.group_user",
    )
    # HMAC-SHA256(clé, database.secret). Inutile de faire un bcrypt :
    # la clé est aléatoire haute entropie (pas de dictionnaire possible).
    offline_sync_key_hash = fields.Char(
        string="API key hash (HMAC-SHA256)",
        copy=False,
        groups="base.group_user",
    )
    offline_sync_key_created_at = fields.Datetime(
        string="API key created at",
        copy=False,
        groups="base.group_user",
    )

    # ------------------------------------------------------------------
    # OUTILS
    # ------------------------------------------------------------------

    def _offline_sync_hmac_secret(self):
        return self.env["ir.config_parameter"].sudo().get_param(
            "database.secret", ""
        )

    def _offline_sync_hash_key(self, api_key):
        return hmac.new(
            self._offline_sync_hmac_secret().encode("utf-8"),
            api_key.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()

    def _offline_sync_key_ttl_days(self):
        """Durée de vie de la clé en jours (0 = illimitée). Defaut 30."""
        try:
            return int(self.env["ir.config_parameter"].sudo().get_param(
                "offline_sync.api_key_ttl_days", "30"
            ))
        except (TypeError, ValueError):
            return 30

    # ------------------------------------------------------------------
    # GÉNÉRATION / RÉVOCATION
    # ------------------------------------------------------------------

    def action_generate_offline_sync_key(self):
        """(Re)génère la clé API et retourne le secret EN CLAIR une seule
        fois (réponse du login). Côté serveur, seul le HMAC est conservé.
        Toute clé précédente est de fait révoquée : une connexion
        invalide les sessions PWA antérieures du même utilisateur."""
        api_key = False
        for user in self:
            api_key = secrets.token_urlsafe(32)
            user.write({
                "offline_sync_api_key": api_key[:KEY_PREFIX_LENGTH],
                "offline_sync_key_hash": user._offline_sync_hash_key(api_key),
                "offline_sync_key_created_at": fields.Datetime.now(),
            })
        return api_key

    def _revoke_offline_sync_key(self):
        """Révocation immédiate (route logout) : la clé présentée par la
        PWA ne sera plus jamais validée."""
        for user in self:
            user.write({
                "offline_sync_api_key": False,
                "offline_sync_key_hash": False,
                "offline_sync_key_created_at": False,
            })
            _logger.info(
                "offline_sync: clé API révoquée uid=%s", user.id
            )

    # ------------------------------------------------------------------
    # AUTHENTIFICATION (appelé en sudo depuis controllers/common.py)
    # ------------------------------------------------------------------

    def _authenticate_offline_sync_key(self, api_key):
        """Retourne l'utilisateur (recordset sudo) si la clé Bearer est
        valide et non expirée, sinon None.

        Migration paresseuse des clés en clair d'avant durcissement : à
        la première validation, le secret est haché puis effacé.
        """
        if not api_key:
            return None
        # 1) Clé « nouvelle génération » : correspondance par préfixe
        #    puis comparaison HMAC en temps constant.
        user = self.search([
            ("offline_sync_api_key", "=", api_key[:KEY_PREFIX_LENGTH]),
            ("offline_sync_key_hash", "!=", False),
        ], limit=1)
        if user:
            candidate = user._offline_sync_hash_key(api_key)
            if hmac.compare_digest(user.offline_sync_key_hash, candidate):
                ttl = user._offline_sync_key_ttl_days()
                if ttl > 0 and user.offline_sync_key_created_at:
                    age = fields.Datetime.now() - user.offline_sync_key_created_at
                    if age.days >= ttl:
                        _logger.warning(
                            "offline_sync: clé EXPIRÉE (TTL %s j) uid=%s "
                            "-- 401 attendu par la PWA", ttl, user.id
                        )
                        return None
                return user
            _logger.warning(
                "offline_sync: clé rejetée (HMAC invalide) uid=%s", user.id
            )
            return None
        # 2) Clé en clair d'avant le durcissement : validation puis
        #    migration immédiate (hachage + effacement du secret).
        legacy = self.search([
            ("offline_sync_api_key", "=", api_key),
            ("offline_sync_key_hash", "=", False),
        ], limit=1)
        if legacy:
            legacy.write({
                "offline_sync_api_key": api_key[:KEY_PREFIX_LENGTH],
                "offline_sync_key_hash": legacy._offline_sync_hash_key(api_key),
                "offline_sync_key_created_at": fields.Datetime.now(),
            })
            _logger.info(
                "offline_sync: clé en clair migrée vers HMAC uid=%s",
                legacy.id,
            )
            return legacy
        _logger.warning(
            "offline_sync: clé API inconnue (prefix=%s…)",
            api_key[:KEY_PREFIX_LENGTH],
        )
        return None
