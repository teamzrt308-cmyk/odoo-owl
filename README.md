# Offline Sync — PWA Standalone
Application web progressive (PWA) indépendante nommé odoo-offline, synchronisée avec un module Odoo offline_sync
via une API JSON authentifiée par clé API.

# Mécanisme SPA

1. ## main.js 
   démarre les services (`registry.category("services")`)
   appelle `loadOdooAssets()` (CSS natif Odoo) et
   `registerServiceWorker()`, puis monte `webclient.js`.

2. ## webclient.js
   construit le squelette (navbar Odoo, masquée sauf
   pour `list_view`/`form_view`), crée l'`ActionService`, et restaure l'état depuis l'URL (`router.current`) — deep link ou `home_menu` par défaut.

3. ## action_service.js
   c' est LE routeur : `doAction(descripteur)`
   démonte le contrôleur courant, en monte un nouveau dans
   `#action-container`, gère la pile de breadcrumb et synchronise l'URL via `router.pushState`/`replaceState`. Garde d'authentification intégrée (redirige vers `"login"` si pas de clé API).

4. ## views/view.js 
   dispatcher de vues, calqué sur le flux d'Odoo : résolution du TYPE de
   vue (`params.view`, sinon `form` si `id`/`isNew`, sinon `list`) puis
   montage du descripteur correspondant de `registry.category("views")`
   (enregistrés par `views/form/form_view.js`, `views/list/list_view.js`,
   `views/kanban/kanban_view.js` — même mécanisme que le webclient
   natif). Les tags `list_view`/`form_view`/`ir.actions.act_window` du
   registre "actions" ne sont que des entrées de compatibilité avec
   l'ActionService hors ligne.

5. ## Rendu OWL
   La vue kanban est rendue par un composant OWL
   (`views/kanban/kanban_renderer.js`) dont le template est COMPILÉ
   depuis l'arch par `views/kanban/kanban_arch_parser.js` — le même
   mécanisme que le vrai webclient (arch -> template QWeb/OWL ->
   composant). Les champs migrent progressivement via
   `owl/field_bridge.js` (`char_field.js` déjà migré).

6. ## Communication interne : 
   `core/bus/bus_service.js` (EventBus)

# Correspondance avec la structure d'Odoo (web/static/src/)

| Odoo 17 | Ce projet | Note |
|---|---|---|
| `core/` (registry, py_js, orm_service, user_service, browser/, bus/, dropdown/, notebook/, network/) | identique | ✔ aligné |
| `views/view.js` + registre "views" | identique | descripteurs form/list/kanban |
| `views/form/form_arch_parser.js` | identique | arch -> structure, sans DOM |
| `views/form/{form_controller,form_renderer}.js`, `button_box/` | identique | |
| `views/fields/<type>/` (char, many2one, one2many, statusbar...) | identique | x2many -> `one2many/` |
| `views/kanban/{kanban_arch_parser,kanban_renderer}.js` | identique | renderer OWL (pilote) |
| `webclient/{actions,navbar,user_menu,breadcrumb}/` | identique | breadcrumb extrait du control panel |
| `search/control_panel/`, `views/view_service.js` | identique | |
| `model/` | `model/rules_engine/` | couche modèle hors ligne (règles métier) |
| — (spécifique) | `core/*_cache.js`, `core/local_ledger.js`, `core/catalog_cache.js`, `core/reference_cache.js` | caches IndexedDB hors ligne |
| — (spécifique) | `core/network/rpc_service.js` | file de sync + push (`/offline_sync/*`) |
| — (spécifique) | `webclient/offline_prefetch_service.js`, `login/`, `conflict_detail/` | téléchargement hors ligne, auth par clé API, arbitrage de conflits |

# Odoo

## Installer
docker compose exec odoo odoo -d demo_db --db_host=db --db_port=5432 --db_user=odoo --db_password='978@308.com' -i odooc17 --stop-after-init

## Mise à jour
docker compose exec odoo odoo -d demo_db --db_host=db --db_port=5432 --db_user=odoo --db_password='978@308.com' -u odooc17 --stop-after-init

## Désinstaller un module
docker compose exec odoo sh -c "echo \"self.env['ir.module.module'].search([('name', '=', 'odoo_offline')]).button_immediate_uninstall()\" | odoo shell -d demo_db --db_host=db --db_port=5432 --db_user=odoo --db_password='978@308.com' --stop-after-init"

echo "env['ir.module.module'].search([('name', '=', 'offline_orm')]).button_immediate_uninstall(); env.cr.commit()" | docker compose exec -T odoo odoo shell -d demo_db --db_host=db --db_port=5432 --db_user=odoo --db_password='978@308.com' --no-http

## SHELL ODOO :
docker compose exec odoo odoo shell -d demo_db --db_host=db --db_port=5432 --db_user=odoo --db_password='978@308.com'

## régénérer le bundle 
bash scripts/build-bundle.sh

## GITHUB
git add .
git commit -m "Explication de vos modifications"
git push


#### 1 - Récupérer l'état du serveur distant 
git fetch origin

#### 2 - Réinitialiser les fichiers suivis
git reset --hard origin/main

#### 3 - Effacer les nouveaux fichiers créés
git clean -fd