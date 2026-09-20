# Alignement du moteur hors ligne sur Odoo 17 — état au 20/09/2026

Comparaison couche par couche avec le webclient d'Odoo 17 (`web/static/src`).
Référence : branche `arena/01a0b34a-odoo-owl`, itérations 1→12 poussées.

---

## ✅ Terminé

### Socle technique
- **OWL embarqué localement** (`static/lib/owl.iife.js` 2.8.2), bundle esbuild, PWA (manifest + service-worker v39).
- **Persistance hors ligne** : IndexedDB/Dexie — caches record/list/reference/catalog/manifest, file de sync (`rpc_service`), ledger local.
- **Règles métier** : `model/rules_engine/` (onchange/compute génériques + spécifiques purchase/sale/stock, access, domain, default) portées de la logique serveur ; `core/py_js/` (evaluateSimpleCondition, isNodeVisible).
- **Tests** : 13 suites jsdom versionnées (`scripts/tests/`, ~370 assertions), exécutables offline.

### Structure & flux (itération 1)
- Registre `registry.category("views")` + dispatcher `views/view.js` (`resolveViewType` : view demandée → form si id/isNew → list) — même flux qu'Odoo (ActionService → registry views).
- Descripteurs de vues façon Odoo : `{ Controller }` (form, list, kanban).

### Widgets de champ (itérations 2-3) — tous en OWL
- 12 types via `owl/field_bridge.js` (contrat sérialiseur préservé : `#field-<name>`, inputs cachés, `data-one2many`) :
  char, text, integer, float, boolean, selection, date, datetime, monetary,
  **many2one** (recherche + dropdown + création locale `tmp:<uuid>` + no_create),
  **many2many_tags** (badges + JSON),
  **one2many** (sous-composants OWL par cellule, état réactif des lignes, total réactif, catalogue produits en overlay, colonnes optionnelles, API impératives `getLines`/`applyLineUpdates`/`adjustLineFields`),
  **statusbar** (itération 8 : composant OWL, ordre naturel des étapes façon Odoo 17 -- l'ancien rendu les inversait, filtre statusbar_visible, o_first/o_last sur la liste visible).

### Renderer kanban (itération 1)
- `kanban_arch_parser.js` : **arch → template OWL compilé**, `KanbanRenderer` composant OWL (t-if/t-esc/t-foreach/t-set/t-attf, scope `record`).

### Renderer list (itération 9)
- `list_arch_parser.js::parseListArch` (arch -> colonnes, sans DOM) ;
- `ListRenderer` composant OWL à **template statique** (comme le natif :
  seul le kanban compile l'arch), tri, colonnes optionnelles persistées,
  sélection, badges decoration-* ; `mountListView` -> { destroy },
  branche list du contrôleur asynchrone avec jeton anti-course ;
- `renderListView`/`renderListCell` vanilla supprimés -- tous les
  renderers de vues sont OWL.

### Group by list (itération 10)
- Menu « Grouper par » du ControlPanel (candidats = colonnes
  regroupables char/selection/many2one/boolean de l'arch) ;
- ListRenderer : en-têtes `o_group_header` dépliables (caret, compteur,
  sommes monetary/float), libellés par type (m2o -> libellé, selection,
  boolean Oui/Non, vide -> « Aucun »), ordre des groupes par libellé ;
  regroupement sur la page courante (cache local, pas de read_group
  serveur -- écart documenté).

### Contrôleur kanban dédié + colonnes (itération 11)
- `KanbanController` OWL (`{ Controller }`, plus d'enveloppe
  ListController) : default_group_by de l'arch, menu « Grouper par »
  (candidats = champs regroupables de l'arch kanban), recherche,
  New, bascule liste via le dispatcher (doAction list_view) ;
- `mountKanbanView(..., groupBy)` : colonnes verticales (en-tête
  libellé + compteur, cartes du groupe, triées, « Aucun ») ; template
  compilé à trois branches (groupé / vide / à plat) ;
- helpers partagés list/kanban : `groupLabel`, `recordMatchesQuery`
  (list_renderer_utils).

### Quick create kanban + drag & drop (itération 13)
- `KanbanRenderer` : bouton « + Créer » par colonne (champ `+ Créer` ->
  input -> Entrée), cartes `draggable`, colonnes cibles surlignées
  (`o_kanban_drag_over`) -- le renderer gère le GESTE, le contrôleur le
  MODÈLE (même répartition qu'Odoo) ;
- `KanbanController.onQuickCreate` : `queueAction(create)` avec
  `_rec_name` hors ligne (« name » char de l'arch) + valeur du champ de
  groupement de la colonne (selection/m2o/boolean/char), mise à jour
  optimiste + `upsertLocalListRecord` (cache liste) + sync en ligne
  (remplacement tmp:<uuid> -> id réel) ;
- `KanbanController.onRecordMove` : `queueAction(write)` pour une carte
  réelle (payload serveur : id int pour m2o), **amende du create en
  attente** (`amendPendingCreate`) pour une carte tmp, libellé m2o
  repris d'une carte soeur, `patchCachedRecord` + cache liste ;
- désactivé pour un group by char et en grille à plat (`canDrag`).

### Shell webclient OWL (itération 14)
- `Navbar` composant OWL (`navbar_component.js`) : le gabarit vanilla
  NAVBAR_TEMPLATE et ses manipulations DOM de webclient.js supprimés ;
  le composant consomme lui-même les bus `action:changed` (visibilité
  par tag, assets Odoo, classes de body, titre d'app, menu horizontal
  depuis le manifest, atterrissage naturel) et `user:info` (avatar,
  nom, société, badges messages/activités) ; sections avec dropdowns
  (entrées groupées), section active, menu mobile, bouton Accueil ;
  classes et ids conservés à l'identique ;
- `UserMenu` composant OWL embeddé dans la Navbar : menu principal,
  vue « Mon compte » (profil + sécurité en cache, hors ligne),
  déconnexion (confirmation si file non synchronisée -> doAction
  login) ;
- `HomeMenu` composant OWL (descripteur { mount } inchangé) : grille
  réactive des apps (cache), recherche par libellé, pré-téléchargement,
  refresh, dashboard_info -> profil + bus user:info ;
- webclient.js réduit à l'assemblage : squelette, ActionService,
  mount de la Navbar OWL, panneaux systray VANILLA restants (sync,
  conflits, connectivité) montés DANS le DOM OWL, restoreState ;
- pièges OWL traités : entités HTML (&larr;) interdites en XML,
  t-foreach évalué même avec t-if (`entry.items or []`), props pas dans
  le scope nu du template (`props.initial`), flèche obligatoire pour un
  handler passé en prop (`onLogout="() => this.onUserLogout()"`),
  mutation d'objet imbriqué de useState non réactive (remplacer
  l'objet entier).

### Notifications + ActionService étendu (itération 16)
- `core/notifications/notification_service.js` : service de
  notifications façon Odoo 17 (`notifications.add(message, { title,
  type, sticky, autoCloseDelay, buttons, className })` -> id, close/
  closeAll), singleton importable ET enregistré dans le registre
  "services", état dans le service + bus `notification:changed` (le
  composant remplace son état de premier niveau) ;
- `core/notifications/notification_container.js` : NotificationContainer
  OWL monté une fois par le webclient -- toasts (couleur/icône par
  type, titre, message, croix, boutons d'action -> onClick + fermeture) ;
- `core/effects/rainbow_man.js` : effect_service + RainbowMan OWL
  (équivalent du couple effect_service/rainbow_man d'Odoo) -- plein
  écran, auto-dismiss, clic pour fermer ;
- ActionService : `ir.actions.act_url` (window.open _blank/_self),
  `ir.actions.client` (dispatch vers le tag du registre "actions"),
  `ir.actions.server` (queueMethodCall -> file + sync si en ligne +
  toast success/danger, PAS de navigation), option `effect` de
  doAction -> RainbowMan ;
- les 9 `alert()` natifs remplacés par des toasts (many2one, one2many
  ×5, form_renderer ×2, form_controller ×2, conflict_detail) ;
  div mort #conflict-toast-container retiré du squelette.

### Panneaux systray OWL + login (itération 15)
- `ConnectivityIndicator` OWL : point de statut (rouge/vert), ping réel
  (fetch + timeout 3 s) périodique et aux événements online/offline ;
- `SyncStatusPanel` OWL : badges pending/errors (titre contextuel),
  dropdown (titre, « Tout réessayer », section en attente spinner/
  horloge, items d'erreur Réessayer/Supprimer avec confirm),
  auto-sync au retour en ligne / sur l'onglet, bus sync:updated ;
- `ConflictPanel` OWL : badge, liste compacte (libellés de champs
  formatés « name (ligne #2) »), clic -> doAction conflict_detail ;
- `Login` OWL : descripteur { mount: mountLogin } INCHANGÉ, état
  réactif (phases du bouton Connexion... / Vérification du cache
  local... / Chargement des droits..., message d'erreur), flux
  conservé (login -> saveSession -> ensureCacheOwnership -> Security
  Engine -> doAction redirectTo|home_menu) ;
- SUPPRIMÉS (plus aucun consommateur) : `core/dropdown/dropdown.js`
  (createDropdown/Popper) et `user_menu/user_menu.js` vanilla ;
- webclient.js : plus aucun panneau vanilla -- TOUT le shell est OWL.

### Search avancé : filtres + favoris (itération 12)
- `search/search_arch_parser.js` : arch `<search>` → filtres (attribut
  `domain`, quotes + tuples Python convertis en JSON) et filtres de
  groupe (`context="{ 'group_by': 'x' }"`), comme le parseur natif ;
- `search/search_utils.js` : `matchesSimpleDomain` (triples, ET
  implicite, partagé avec le bandeau dashboard), `applyFilters` (ET
  entre filtres actifs), `buildSelectionFilters` (repli sans arch
  `<search>` : un filtre par valeur des champs selection) ;
- `search/search_favorites.js` : favoris PAR MODÈLE dans le localStorage
  (équivalent hors ligne d'ir.filters) + `matchFavorite` (favori
  courant coché) ;
- ControlPanel : menus **Filtres** (bascule, reste ouvert) et
  **Favoris** (appliquer / supprimer / « Enregistrer la recherche
  actuelle »), **facettes actives** retirables dans la barre de
  recherche, restauration complète d'un favori (requête + filtres +
  group by) sur un mount frais ;
- ListController et KanbanController : pipeline de recherche
  dashboard → filtres actifs → requête texte ; candidats « Grouper par »
  fusionnés avec les filtres de groupe du `<search>`.

### Renderer form (itération 4)
- `form_arch_parser.js::buildFormTemplate()` : **arch → template OWL** (scaffolding, groups `o_inner_group` avec colspan/newline, notebook réactif, h1, button_box, header buttons, statusbar) ;
- `FormRenderer` composant OWL (emplacements `data-form-slot` remplis après render, `ready` = saisies garanties) ;
- compilateurs DOM vanilla supprimés (form_compiler, form_group, form_header, button_box, core/notebook).

### Contrôleurs (itérations 5-6, 11)
- `FormController`, `ListController`, `KanbanController` (**dédié** depuis l'itération 11, descripteur `{ Controller }`) : **composants OWL**, zones en template, logique offline intacte (sync, règles document, ledger, actions objet, sauvegarde, pagination, recherche, dashboard), `onMounted`/`onWillDestroy`.
- `view.js` monte `descriptor.Controller` (props params + env), comme le webclient natif.

### Control panel + breadcrumb (itération 7)
- `ControlPanel` OWL embeddé dans les contrôleurs, props-driven (`display`, `breadcrumb`, `pager` `{page,pageSize,total}`, `views`, `groups`, `filters`, `favorites`, `query`), callbacks (onNew/onSearch/onPage/onSwitch/onGroupBy/onToggleFilter/onSelectFavorite/onSaveFavorite/onDeleteFavorite/onSave/onUndo), **debounce recherche internalisé**.
- `Breadcrumb` OWL (`webclient/breadcrumb/`), slots indicateur d'enregistrement + engrenage.
- `buildControlPanel`/`buildBreadcrumb` vanilla supprimés.

---

## ⏳ Manquant (écart vs Odoo 17)

### Vues
1. **Pivot / Graph** : placeholders « à venir » (Odoo : renderers + mesures/groupes).
2. Kanban : pas de chargement dynamique par colonne (tout est en cache) ni de réordonnancement intra-colonne ; pas de quick create sur la grille à plat.
3. Calendrier, gantt, activité… : hors périmètre actuel (à trancher explicitement).

### Widgets de champ
6. Widgets Odoo absents (à trancher selon besoins PWA) : badge, url, image, handle, email/phone, many2one_avatar, favorite, percentage, color…

### Modèle de données
7. **Pas de RelationalModel/BasicModel** (datapoints, dirty/changes) : notre état = DOM (sérialiseur) + état réactif des widgets — écart assumé du moteur hors ligne, à garder documenté.
8. Validation required/constraints au save : partielle (via `validateDocument`), pas d'équivalent complet de checkRequired.

### Couche recherche
9. SearchBar : filtres/favoris/group by FAITS (itération 12) ; reste l'auto-complétion des `<field>` du `<search>` et les domaines dynamiques (Odoo withSearch complet) ; engrenage options purement décoratif.

### Shell webclient
11. Systray messaging : boutons Messages/Activités de la navbar décoratifs (pas de menu, comme le chatter stub).
12. ActionService : ir.actions.server/act_url/client + effets FAITS (itération 16) ; reste le wizard (ir.actions.act_window target=new en pop-up) et l'auto-dismiss post-action d'Odoo.
13. **Chatter/mail** : stub non fonctionnel (thread/composer/followers/activités côté Odoo).
14. Notifications : service + toasts OWL FAITS (itération 16) ; pas encore de canal "discussions" (liée au chatter stub).
15. **i18n** : chaînes françaises en dur (Odoo : `_t` + catalogues).
16. Router : hash simple vs service router Odoo (état riche, pushState sémantique).

### Qualité
17. Tests e2e navigateur (au-delà de jsdom) — absent.
18. Accessibilité complète (aria/focus), thème/variantes — partiels.

---

## Ordre de reprise suggéré
1. chatter/mail stub, widgets additionnels ;
2. i18n, router, e2e navigateur, a11y.

## Écarts assumés (spécificité hors ligne, à ne PAS « corriger »)
- Champs montés par `field_bridge` (contrat DOM sérialiseur) plutôt que tags `<Field>` OWL ;
- règles métier locales (`rules_engine`) au lieu des onchange serveur ;
- templates compilés depuis l'arch au lieu de templates qweb servis par le serveur.
