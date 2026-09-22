# Sécurité — addon offline_sync (lot « 11 mesures »)

État après le lot implémenté dans ce module (v17.0.1.1.0) :

| # | Mesure | État |
|---|--------|------|
| 1 | HTTPS + HSTS | 🔧 **config déploiement** — voir ci-dessous |
| 2 | CSP (PWA) | ✅ implémenté côté PWA (meta `index.html`) |
| 3 | Clé API hachée HMAC-SHA256 | ✅ implémenté |
| 4 | TTL clé + logout serveur + 401 PWA | ✅ implémenté (+ intercepteur 401 PWA) |
| 5 | Rate-limit login | ✅ implémenté (5 échecs / 15 min → 429) |
| 6 | CORS précis | ✅ fail-safe `*` refusé + normalisation — **config requise** |
| 7 | Push robuste (try/action + plafonds) | ✅ implémenté |
| 8 | 4 bugs mineurs audit | ✅ corrigés (a/b/c/d) |
| 9 | PIN WebCrypto session PWA | ⏳ décision en attente (option) |
| 10 | Logs & alertes | ✅ implémenté (`odoo.log`) |
| 11 | Hygiène infra | 🔧 **config déploiement** — voir ci-dessous |

## 1. HTTPS + HSTS (bloquant en production)

Toutes les routes de ce module transportent le mot de passe (login) ou la
clé API (Bearer) : **HTTP clair = mot de passe interceptable**. Mettre
Odoo derrière un reverse proxy TLS.

Exemple nginx :

```nginx
server {
    listen 80;
    server_name odoo.mondomaine.mg;
    return 301 https://$host$request_uri;
}
server {
    listen 443 ssl http2;
    server_name odoo.mondomaine.mg;

    ssl_certificate     /etc/letsencrypt/live/odoo.mondomaine.mg/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/odoo.mondomaine.mg/privkey.pem;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    location / {
        proxy_pass http://127.0.0.1:8069;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 600s;
    }
}
```

Puis côté PWA : `CONFIG.ODOO_BASE_URL = "https://odoo.mondomaine.mg"`.

Certificat : `certbot --nginx -d odoo.mondomaine.mg` (Let's Encrypt, renouvellement auto).

## 6. CORS (offline_sync.allowed_origins)

Paramètre système **obligatoire** (sinon TOUT est refusé et une erreur
est loggée à chaque appel) :

```
Paramètres > Technique > Paramètres système
clé    : offline_sync.allowed_origins
valeur : https://pwa.mondomaine.mg
```

- **Origine par origine** (schéma + hôte + port exacts, sans `/` final) ;
- **`*` est refusé par le code** (fail-safe) : l'API porteuse de clé ne
  doit jamais être appelable depuis n'importe quelle page web ;
- plusieurs origines : séparées par des virgules.

## 11. Hygiène infra (odoo.conf)

```ini
[options]
list_db = False
db_filter = ^(vente1|stock2)$      ; bases joignables (le ?db= PWA choisit dedans)
admin_passwd = <mot de passe maître SOLIDE>   ; JAMAIS dans un README/git
proxy_mode = True                  ; derrière nginx (mesure 1)
```

- `list_db = False` : interdit l'énumération des bases (le `?db=`
  explicite de la PWA continue de fonctionner) ;
- retirer le mot de passe Postgres/master de tout document versionné ;
- désactiver l'inscription libre (`auth_signup`) et la récupération si
  non utilisées — et supprimer les liens codés en dur du template de
  login PWA ;
- maintenir Odoo + dépendances à jour.

## 3+4. Cycle de vie de la clé API (implémenté)

- La clé n'est **jamais stockée en clair** : seul
  `HMAC-SHA256(clé, database.secret)` l'est (champ
  `offline_sync_key_hash`) + un préfixe de 8 caractères (recherche) ;
- **le login régénère systématiquement la clé** : le secret n'existe en
  clair que dans la réponse de ce login. Conséquence assumée : la
  connexion d'un appareil **révoque les sessions antérieures** du même
  utilisateur (elles reçoivent un 401 à leur prochain appel et doivent
  se reconnecter) ;
- **TTL** : paramètre `offline_sync.api_key_ttl_days` (défaut **30**,
  `0` = illimité). Clé expirée → 401 → la PWA déconnecte ;
- **révocation immédiate** : `POST /offline_sync/logout` (Bearer) —
  appelée par le bouton de déconnexion PWA quand il est en ligne ;
- **migration paresseuse** : une clé en clair d'avant le durcissement
  est validée une dernière fois puis hachée+effacée automatiquement.

## 5. Rate-limit login (implémenté)

5 échecs par couple (IP, login) sur 15 minutes → **429 + Retry-After**.
Compteurs en mémoire par worker (les blocs sont loggés, cf. mesure 10 ;
une protection coordonnée multi-IP relève du reverse proxy / fail2ban).

Paramètres non exposés volontairement (valeurs du code) :
`_LOGIN_MAX_FAILURES = 5`, `_LOGIN_WINDOW_SECONDS = 900`.

## 7. Plafonds de push (implémentés)

Paramètres système (défauts entre parenthèses) :

- `offline_sync.push_max_actions` (100) — au-delà : erreur transitoire,
  la PWA conserve les actions en file et les repousse plus tard ;
- `offline_sync.push_max_payload_bytes` (1000000) — payload trop gros :
  rejeté en erreur (visible dans le panneau de sync PWA).

Une action qui lève une exception serveur est marquée `error`
(`error_message`) **sans faire échouer les autres** ni la requête.

## 10. Logs (implémentés)

Dans `odoo.log` (recherche : `offline_sync`) :

- `login OK / échec / RATE-LIMIT` (avec IP et login) ;
- `clé API inconnue / rejetée / EXPIRÉE / révoquée / migrée` (uid) ;
- `logout` (uid, IP) ;
- `push : N action(s)` + exceptions par action (`uuid`, modèle).

Suggestion fail2ban : bannir les IP générant des `RATE-LIMIT` répétés.
Contrôle hebdomadaire recommandé : grep des warnings ci-dessus.
