# Alignement du moteur hors ligne sur Odoo 17 — état au 20/09/2026

Comparaison couche par couche avec le webclient d'Odoo 17 (`web/static/src`).
Référence : branche `arena/01a0b34a-odoo-owl`, itérations 1→12 poussées.

---

## ✅ Terminé

### Socle technique
- **OWL embarqué localement** (`static/lib/owl.iife.js` 2.8.2), bundle esbuild, PWA (manifest + service-worker v45).
- **Persistance hors ligne** : IndexedDB/Dexie — caches record/list/reference/catalog/manifest, file de sync (`rpc_service`), ledger local.
- **Règles métier** : `model/rules_engine/` (onchange/compute génériques + spécifiques purchase/sale/stock, access, domain, default) portées de la logique serveur ; `core/py_js/` (evaluateSimpleCondition, isNodeVisible).
- **Tests** : 14 suites jsdom versionnées (`scripts/tests/`, ~395 assertions), exécutables offline.

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

### Règles métier « comme Odoo » (itération 17)
Le moteur local (`model/rules_engine/`) reproduit déjà les concepts de
l'ORM d'Odoo -- cette itération comble les trois trous restants :

| Odoo (serveur) | Moteur hors ligne |
|---|---|
| `@api.depends` | règles `computes` + `trigger` (cascade) |
| `@api.onchange` | règles `trigger` + `compute` (runLineRules/runDocumentRules) |
| dict `{'warning': ...}` d'un onchange | clé `warning` du résultat -> bus `rules:warning` -> toast (notification service) |
| `@api.constrains` + `ValidationError` | règles `type: "constraint"` + `validate()` -> `validateDocument` bloque le save |
| `checkRequired` / NOT NULL | `checkRequiredFields(model, record, fieldsInfo)` (0 est une valeur, false/"" vides) |
| `@api.ondelete` | `checkOndeleteGuard` |
| `ir.model.access` | règles `access` (CRUD + groupes) |
| `ir.rule` | règles `domain` (record_rule) -> `filterByRecordRule` |
| defaults | règles `default` -> `getDefaultValue` |
| workflow boutons (stock) | règles `stock_effect` (deltas ledger + état optimiste) |

- contraintes portées : `sale.order.line._check_quantity`
  (product_uom_qty > 0), `purchase.order.line._check_quantity`
  (product_qty > 0), `sale.order._check_dates` (commitment_date >=
  date_order) -- messages français, champs absents tolérés (ligne en
  cours de saisie) ;
- avertissement porté : `purchase.order.line._onchange_product_id`
  prévient quand le produit n'a pas de prix d'achat (comme le dict
  warning Python) ;
- `checkRequiredFields` branché AVANT `validateDocument` dans
  saveRecord (même ordre qu'Odoo) : blocage + statut + toast danger ;
- CORRIGÉ au passage : `buildDbSnapshot` ne chargeait que les modèles
  du DOCUMENT (racine + lignes) -- les `db.get("product.product", ...)`
  des règles renvoyaient toujours null ; le snapshot charge désormais
  TOUT le cache de référence.

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

### Renderer form (itération 4, migré en 23)
- `form_arch_parser.js::buildFormTemplate()` : **arch → template OWL** (scaffolding, groups `o_inner_group` avec colspan/newline, notebook réactif, h1, button_box, header buttons, statusbar) ;
- `FormRenderer` composant OWL (voir itération 23 : plus d'emplacements
  impératifs -- le template contient directement les composants) ;
- compilateurs DOM vanilla supprimés (form_compiler, form_group, form_header, button_box, core/notebook).

### Pipeline natif `<Field>` OWL (itération 23)
- **Arch XML -> `<Field>` OWL -> rendu OWL**, comme le webclient 17 :
  `emitFieldSlot` émet désormais `<FormField index="i" mode="…"/>`
  directement dans le template compilé (plus d'emplacements
  `data-form-slot` remplis après render, plus de `mountFieldSlots`) ;
- **`views/form/field_component.js::FormField`** : composant champ
  unique qui résout le composant interne par TYPE (registre
  `FIELD_COMPONENTS` : les 13 classes OWL des champs) ou injecte le
  widget vanilla (widget_registry it. 21, couche de transition) ;
  simulation « Nouveau » (readonly statique + vide + sans id) conservée ;
- **Record réactif** : `FormRenderer.record = useState(initialValues)`
  publié aux champs par sous-env OWL (`useSubEnv({ __formCtx })` --
  l'env racine est gelé). Particularité OWL 2 : le proxy useState porte
  le callback de render de son PROPRIÉTAIRE -- chaque `<FormField>`
  recrée son propre proxy (`useState(ctx.record)`) pour que ses lectures
  (valeur, invisible, readonly, required) l'abonnent LUI ; une écriture
  sur la cible notifie tous les proxys ;
- **attrs dynamiques réactifs par construction** : invisible/readonly/
  required ré-évalués à CHAQUE rendu sur le record (plus de mutation
  DOM : `dynamic_field_attrs.attachLiveBusinessRules` n'est plus
  appelé quand `_formState` existe -- couche de transition conservée) ;
- **API état du renderer** (`_formState` sur le host + la racine) :
  `getValues()` (contrat sérialiseur inchangé), `applyGraph()` --
  réinjection RÉACTIVE du graphe racine des règles métier (remplace
  `applyDocumentGraphToDom` ; même garde-fou champ focalisé) ; les
  one2many restent pilotés par leurs APIs impératives ;
- **Contrats conservés** : `#field-<name>`, hidden inputs m2o/m2m,
  `data-one2many` + `[data-o2m-root]` (le composant o2m vit DANS le
  span hôte et s'y publie via `closest()` au onMounted :
  `getLines/getLineIds/applyLineUpdates/adjustLineFields`),
  `emitFieldChange` (bulle `change` -> passe de règles debounce 200 ms) ;
- suites : 18/18 vertes ; audit manifest réel : MONTAGE 168/168,
  PARSE list/kanban/form 56×3.

### Purge de la couche de transition (itération 24)
- **`owl/field_bridge.js` SUPPRIMÉ** : `renderOwlField` (mount impératif
  dans un span) n'a plus de consommateur depuis le pipeline `<FormField>` ;
  `emitFieldChange` vit dans `owl/field_events.js`, `computeReadonly`/
  `computeRequired` dans `views/form/field_attrs.js` (fonctions pures,
  sans DOM) ;
- **`views/form/dynamic_field_attrs.js` SUPPRIMÉ** : `applyDynamicAttrs`
  (mutation DOM) et `attachLiveBusinessRules` (ré-évaluation live par
  écouteurs) remplacés par la réactivité de `<FormField>` -- le
  contrôleur n'a plus aucun fallback impératif (`_formState.applyGraph`
  est le seul chemin de réinjection) ;
- **`views/fields/field.js` SUPPRIMÉ** (dispatch `renderField` +
  13 `renderXField`) : `canRenderField` devient une constante locale de
  `form_arch_parser` (`RENDERABLE_FIELD_TYPES`) ; les 13 modules de
  champ ne gardent que leurs classes OWL (`parseOdooOptions` exporté par
  m2o, partagé avec `buildPropsFor`) ;
- **`form_serializer`** : `applyDocumentGraphToDom`/`setElementValue`
  supprimés (réinjection réactive uniquement) ;
- **`buildPropsFor` EXPORTÉ** (field_component) : dérivation unique
  type -> composant + props, partagée entre `<FormField>` et les suites
  (test-fields-owl / test-relational-owl / test-structure migrés : ils
  montent les MÊMES composants que la vue réelle, plus de doublon de
  dérivation dans les tests) ;
- bundle : 9218 -> 8809 lignes (~400 lignes mortes purgées) ; 18/18
  vertes ; audit manifest réel : MONTAGE 168/168, PARSE 56×3 ;
- **transition RESTANTE** : réduite (it. 25) aux seules APIs
  impératives du one2many (contrat sérialiseur assumé sur
  `[data-o2m-root]`).

### Widgets explicites en composants OWL (itération 25)
- **`views/fields/widget_registry.js` SUPPRIMÉ** : les 8 widgets
  vanilla deviennent des COMPOSANTS OWL (`PriorityFieldOwl`,
  `BadgeFieldOwl`, `BooleanToggleFieldOwl`, `RadioFieldOwl`,
  `ImageFieldOwl`, `LinkFieldOwl` pour email/phone/url,
  `StatinfoFieldOwl`) ; `renderHandleField` supprimé -- la poignée
  reste structurelle dans le template de liste et est invisible en
  formulaire (pas de repli par type, pas de champ sérialisé) ;
- **registre `WIDGET_COMPONENTS`** (field_component.js, exporté) :
  résolution widget -> COMPOSANT, consultée par `<FormField>` AVANT le
  dispatch par type ; `buildWidgetProps` (exportée) est la dérivation
  unique widget -> props (valeur du record réactif, readonly évalué,
  onChange = écriture record + `emitFieldChange`) ;
- **cellules de liste via les MÊMES composants** : le ListRenderer
  remplace ses spans inline priority/boolean_toggle/image/badge par
  un `t-component` dynamique avec la variante `listDisplay` (markup
  identique : `o_priority_display`, icônes fa, `o_list_image`, badge
  + decoration-*) -- cellules en lecture seule, même architecture que
  le webclient où la liste rend les composants de champ ; la sélection
  SANS widget s'affiche toujours en badge inline (règle de formatage
  de liste, inchangée) ;
- **cartes kanban** : déjà OWL (transform compile-time du template de
  l'arch, image base64 réactive avec placeholder local) -- aucun
  changement ;
- contrat sérialiseur INTACT : inputs cachés `#field-<name>` déclarés
  DANS les templates des composants (priority/badge/radio/image/
  statinfo), checkbox native (boolean_toggle), input (liens) ;
  `hiddenValueInput` (selection_utils) supprimé ;
- écart OWL : `String()` n'est pas disponible dans les expressions de
  template -- passer par des getters ;
- test-list-controller : attente fixe de la recherche remplacée par un
  poll (fluage de timing sous charge) ;
- suites : 18/18 vertes (test-widgets-owl VERBATIM : mêmes sélecteurs,
  mêmes comportements étoiles/toggle/radio/liens/upload) ; audit
  MONTAGE 168/168, PARSE 56x3 ; bundle 8903 lignes.

### Contrôleurs (itérations 5-6, 11)
- `FormController`, `ListController`, `KanbanController` (**dédié** depuis l'itération 11, descripteur `{ Controller }`) : **composants OWL**, zones en template, logique offline intacte (sync, règles document, ledger, actions objet, sauvegarde, pagination, recherche, dashboard), `onMounted`/`onWillDestroy`.
- `view.js` monte `descriptor.Controller` (props params + env), comme le webclient natif.

### Paquet de widgets de champ (itération 21)
- **Registre `views/fields/widget_registry.js`** : l'attribut `widget="…"`
  de l'arch a priorité sur le rendu par type, comme la clé widget du
  webclient Odoo 17 ;
- **10 widgets rendus** (form + cellules de liste + carte kanban) :
  `priority` (étoiles cliquables en édition, ★ en liste),
  `badge` (pastille), `boolean_toggle` (interrupteur Bootstrap, checkbox
  native = contrat sérialiseur), `radio` (selection en boutons radio),
  `image` (aperçu base64 du cache + upload local FileReader + placeholder
  hors ligne), `email`/`phone`/`url` (saisie + bouton-lien mailto:/tel:/
  https local), `handle` (poignée de réordonnancement rendue en liste,
  invisible en form), `statinfo` (tuile button_box : icône + compteur +
  libellé, valeur injectée au compile-time) ;
- **Contrat sérialiseur respecté** : chaque widget éditable expose
  `#field-<name>` (hidden input ou checkbox native) — collectFormData /
  setElementValue ne changent pas ;
- **Kanban** : `<field widget="image"/>` de l'arch devient une vraie
  `<img>` base64 (placeholder si vide) ; la passe placeholder des images
  statiques tourne AVANT la transform des champs (sinon elle écrase les
  images dynamiques) ;
- **Listes** : `parseListArch` conserve l'attribut widget dans les
  colonnes ; la colonne handle n'est plus supprimée (poignée rendue) ;
- écart restant : le glisser-déposer de réordonnancement des lignes
  (handle) n'est pas encore câblé ; le clic sur une tuile statinfo
  (action serveur) reste à traiter avec le button_box fonctionnel ;
- `css/odoo_widgets.css` (styles spécifiques) chargé par index.html et
  pré-caché par le service-worker ;
- **itération 25** : les rendus vanilla de ce registre ont été
  convertis en composants OWL (voir section it. 25), le registre
  vanilla est supprimé.

### Workflow hors ligne : boutons objet + calculs enrichis (itération 20)
- **Nouveau bucket `object_action`** dans le moteur (`rules/workflow_rules.js`)
  : portage des méthodes de boutons du header qui ne font que
  transitionner l'état, avec la sémantique des méthodes Python Odoo 17 —
  `fromStates` (revalidation du verrou d'état via `canRunObjectAction`,
  comme la méthode Python), `optimisticState` (état appliqué IMMÉDIATEMENT
  à l'écran hors ligne, fusionné avec `stock_effect` par
  `computeOptimisticStateUpdate`), `guard` optionnel ;
  - sale.order : action_confirm (draft|sent→sale), action_draft
    (sale|cancel→draft), action_cancel, action_unlock (locked=false),
    action_quotation_send (mail serveur, sans verrou) ;
  - purchase.order : button_confirm (draft|sent|to approve→purchase,
    double validation non embarquée = écart documenté), button_approve,
    button_draft, button_cancel, button_done (verrouillage),
    action_rfq_send ;
  - stock.picking : action_confirm (→confirmed), action_assign
    (confirmed|waiting→assigned), action_cancel — button_validate reste
    dans stock_rules.js (effets ledger + lignes picked) ;
  - méthodes NON portées (effets serveur : paiements, facturation,
    mails, impressions, wizards) → comportement historique
    (queueMethodCall, covered:false) ;
- `form_controller.onObjectButtonClick` : verrou workflow AVANT la mise
  en file — clic non applicable dans l'état courant → toast warning,
  RIEN en file ;
- **Calculs métier enrichis** (miroir `_compute_amount`/`_compute_amounts`) :
  - lignes : `discount` (borne 0..100) entre dans le sous-total
    (qty×prix×(1−remise/100)) ;
  - commandes : `amount_untaxed` = Σ sous-totaux, `amount_tax` = 0 hors
    ligne (pas de account.tax embarqué — écart documenté),
    `amount_total` = HT + TVA ; déclencheur `order_line.price_subtotal`
    (cascade complète) ;
- **Fix moteur** : la boucle des lignes de `runDocumentRules` lit
  désormais `getRulesForModel()` — le repli générique `*`
  (__qty×__price→__subtotal) s'applique aussi aux one2many d'un modèle
  sans règles propres (avant : ignoré).

**Chaîne complète vente -> stock (comme Odoo 17, validée par test)** :
1. CONFIRMER le devis (Ventes) : bouton autorisé depuis draft/sent ->
   état « Commande client » immédiat, action en file, et AUCUN effet de
   stock (le picking est créé par le serveur à la synchronisation, comme
   chez Odoo — il faut donc qu'il ait été synchronisé au moins une fois
   pour exister hors ligne) ;
2. VALIDER le bon (Inventaire) : autorisé depuis draft/waiting/confirmed/
   assigned (verrou object_action, refus « déjà terminé » sur done/cancel
   comme la UserError Python) ; picking -> « Fait » + lignes « picked »
   immédiatement ; deltas façon double entrée (−quant à l'emplacement
   source, +quant à la destination) + qty_delivered/qty_received sur les
   lignes d'origine, écrits dans le ledger local lié à l'action ;
3. AFFICHAGE : la LISTE/KANBAN des quants applique le ledger en lecture
   (`getListRecordsSmart` -> `applyLedgerAdjustmentsToList`, sans
   persister — le serveur rattrape à la sync puis le ledger est purgé) ;
   les lignes o2m des fiches vente/achat sont ajustées
   (`applyLedgerAdjustmentsToForm`) ; clé composite `produit:emplacement`
   pour stock.quant (`ledgerKeyForRecord`) ;
4. écart documenté : la fiche quant racine n'applique PAS le ledger
   (éviterait d'enregistrer la quantité ajustée à la sauvegarde) — la
   liste reste l'écran de référence.

### Audit du manifest RÉEL (itération 19)
Constat sur l'export réel de la table `module_manifests`
(`offline_sync_db_module_manifests.json` — purchase, sale_management,
stock ; 24 modèles, 56 archs par type de vue) :
- **forme conforme au moteur** : clés `module/models/fields/views/menus`,
  `views[model].default` + `by_action` (clés = ids d'action **numériques**,
  menus `action_id` numériques aussi) ;
- **lignes one2many** : le manifest n'embarque PAS les modèles de lignes
  (sale.order.line…) — leurs champs voyagent dans `sub_fields` du champ
  parent, que `one2many_field.js` consomme déjà ;
- **pas d'arch `<search>`** (0/168) : repli prévu — filtres dérivés des
  champs `selection` + group by candidats depuis les colonnes de liste ;
- **binaires exclues** (`image_128`…) : déclarées dans les archs mais
  absentes de `fields` ;
- **menus orphelins** (16) : rapports/paramètres/attributs référencent
  des modèles sans vues -> atterrissage gracieux à l'accueil ;
- **graph/pivot** présents dans `by_action` -> placeholder « à venir ».

Correctifs révélés par l'audit (`scripts/tests/audit-manifest.mjs
--mount` : parse + montage runtime de chaque arch, 168/168 OK) :
- `KanbanRenderer` : helpers d'arch `kanban_image` (placeholder local)
  et `kanban_color` (palette o_kanban_color_0..10) exposés aux templates ;
- `buildKanbanRecordProxy` : couvre les champs DÉCLARÉS dans l'arch même
  absents de `fields_info` (sinon `record.x.value` explose) ;
- `parseKanbanArch` : enregistre les sous-templates `t-name`
  (`kanban-menu`, `SalesTeamDashboardGraph`…) référencés par `t-call` ;
- `evaluateSimpleCondition` (py_js) : `context.get('clé', défaut)`
  évalué au défaut ; évaluateur par scope `with` — un champ nommé comme
  un mot réservé JS (`res.partner.function`) cassait TOUTES les
  évaluations de visibilité (SyntaxError « Unexpected token 'function' »).

### Test global de bout en bout (itération 18)
- `test-global-boot-owl.mjs` : boot du `main.js` réel dans jsdom (PWA complète, stubs Dexie/réseau) — login → home → liste → group by → kanban → form → save en file, 0 erreur console inattendue ;
- correctifs révélés par le test global :
  - **race de re-render** : `renderCurrentPage` (list) et `renderCurrent` (kanban) attendent un frame (`requestAnimationFrame`) avant de lire le host `t-ref` — un setter d'état réactif programme un patch OWL qui recrée les zones ; lire le host avant donnait une cible détachée ;
  - **ancres des menus du control panel** : `t-on-click.stop.prevent` (au lieu de `.stop`) — `href="#"` sans `preventDefault` vidait le hash et renvoyait à l'accueil ;
  - **quick create depuis la liste** : la branche kanban du `ListController` passe `onQuickCreate` (même file hors ligne `queueAction` → sync → promotion d'id, parité itération 13) + `flashStatus`.

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
8. Validation required/constraints au save : FAITE (itération 17 -- checkRequiredFields + contraintes portées) ; reste les contraintes SQL et les contraintes Python non portées (au cas par cas, selon les modèles utilisés).

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
- **PRINCIPE ARCHITECTURAL (inversé en itération 23 -- décision
  explicite de l'utilisateur)** : le rendu migre vers le pipeline natif
  du webclient 17, **Arch XML -> `<Field>` OWL -> rendu OWL** :
  `form_arch_parser.buildFormTemplate` émet désormais des COMPOSANTS
  `<FormField>` (views/form/field_component.js) directement dans le
  template compilé, et le record réactif du renderer (useState) est la
  source de vérité -- plus de remplissage impératif data-form-slot.
  Migration PROGRESSIVE : field_bridge supprimé (it. 24, héritiers
  purs : `owl/field_events.js`, `views/form/field_attrs.js`),
  widget_registry supprimé (it. 25, registre OWL `WIDGET_COMPONENTS`
  partagé form + cellules de liste) ; la transition restante se
  limite aux APIs impératives du one2many (contrat sérialiseur
  assumé sur `[data-o2m-root]`). CONTRATS INTANGIBLES
  à chaque étape : valeur (`#field-<name>` / `getLines()`), relations
  (m2o hidden `_id`, m2m JSON, o2m composant + sub_fields), invisible/
  readonly/required désormais RÉACTIFS par construction (ré-évalués à
  chaque rendu sur le record), événements (`emitFieldChange` -- règle
  d'or : seules les actions UTILISATEUR notifient, jamais les
  re-renders programmatiques type applyLineUpdates, sinon boucle de
  sync). Particularité OWL 2 : chaque composant lit le record via son
  PROPRE proxy useState (le proxy porte le callback de render de son
  propriétaire -- lire celui du parent ne re-rend pas l'enfant).
  Suites : `test-field-bridge-contract.mjs` (contrat sérialiseur) +
  17 autres, vertes à chaque étape ;
- règles métier locales (`rules_engine`) au lieu des onchange serveur -- mapping Odoo→moteur documenté (itération 17) ;
- templates compilés depuis l'arch au lieu de templates qweb servis par le serveur.

## Durcissement multi-bases (garde de base)

Objectif : empêcher qu'un appareil retargeté vers une AUTRE base Odoo
(même serveur déplacé, `--db-filter` absent, sélecteur de base) rejoue
des écritures locales (sync_queue) ou affiche des caches d'une base B
sous la base A -- les ids n'y signifient rien de commun.

Mécanismes (PWA) :

- **Tampon de session** : `saveSession` grave désormais
  `{db, serverUrl}` dans `offline_sync_session` ; `serverUrl` est
  l'URL serveur utilisée au login, `db` la base résolue par le serveur
  (nouveau champ `db` des réponses login/ping de l'addon).
- **Étiquetage des fetch** : `withDb(url)` (session.js) ajoute
  `?db=<base>` à TOUTES les URLs offline_sync (push, list, read,
  reference, security, manifests, catalog, dashboard, ping) -- la base
  est explicite même quand le host ne la détermine pas.
- **Garde de boot** (`cache_owner.verifyLocalStamp`, branché dans le
  doAction, mémoïsé) :
  1. `session.serverUrl != CONFIG.ODOO_BASE_URL` -> divergence,
     détectable HORS LIGNE ;
  2. sinon, en ligne, ping `?db=session.db` -> la base renvoyée diffère
     (ou la base n'existe plus, db_filter la rejette) -> divergence.
  Divergence -> `window.confirm` si la file contient des actions
  non synchronisées (OK = export JSON automatique puis purge,
  Annuler = données conservées) -> purge des 10 stores Dexie
  (`purgeAllTables`) + `clearSession` ; la garde d'authentification
  redirige alors vers le login.
- **Ownership étendu** : `ensureCacheOwnership(uid, stamp)` purge aussi
  si le tampon `db_stamp` de `cache_meta` (base ou serveur) diffère,
  même pour le MÊME uid.
- **Sélecteur de base** (login) : champ optionnel « Base de données » ;
  sa valeur passe en `?db=` au POST login, la base RÉSOLUE par le
  serveur fait foi dans la session.

Sessions antérieures au durcissement (sans tampon) : tolérées au boot
(migration douce, warn en console) -- le tampon est posé au prochain
login. En mono-base, tout ceci est transparent (ping renvoie la même
base, withDb ajoute un paramètre inoffensif).

Addon : `login` et `ping` renvoient `db: request.env.cr.dbname`
(tampon) ; ping garde `auth="none"` et dégrade à `db: null` si aucune
base n'est résolue. Suite : `scripts/tests/test-db-guard-owl.mjs` (22
assertions : withDb, tampon, garde URL/base, confirm OK/Annulé,
ownership uid+base, login OWL).
