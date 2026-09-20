# Architecture OWL — mise en place (pas encore de vue migrée)

## Périmètre de cette étape

Uniquement la **plomberie** : vendoring d'OWL, bundling des templates,
bootstrap de mount/destroy, et un composant de test bout-en-bout
(`DebugPing`). **Aucune vue existante (form/list/kanban/fields) n'est
touchée** — le moteur vanilla actuel (`views/`, `core/`) continue de
tourner exactement comme avant.

## Décisions et pourquoi

### 1. OWL vendorisé en global, pas en dépendance npm

`static/lib/owl.iife.js` est chargé via `<script>` dans `index.html`,
avant `app.bundle.js`, exactement comme `dexie.min.js` et `popper.js`.
Le code applicatif référence le global `owl` directement (`owl.mount`,
`owl.Component`, `owl.useState`...), sans `import ... from "owl"` —
cohérent avec l'existant (`new Dexie(...)`, `window.Popper.createPopper(...)`),
et nécessaire de toute façon : le bundler ici est `esbuild --bundle`
sans `node_modules` embarqué en prod, pas un résolveur de paquets npm
complet.

Build vendorisé : hash `52abf8d`, daté 2026-01-30 (`owl.__info__` dans
le fichier). Build **complet et standard** : 37 exports vérifiés
(`Component`, `App`, `mount`, tous les hooks `use*`/`on*`, `xml`,
`reactive`, `EventBus`, etc. — voir la liste exhaustive en bas de ce
fichier). `owl/app.js` instancie directement `new owl.App(...)` pour
un accès explicite à `.destroy()` au cleanup.

Seul absent notable : `css` (l'helper de template littéral pour du
CSS scopé par composant, présent dans certaines versions d'OWL) —
la fonction n'existe pas du tout dans ce build, pas juste
non-exportée. Non bloquant : le scoping CSS peut se faire par classes
préfixées par composant, comme le fait déjà le moteur vanilla actuel.

### 2. Templates : fichiers `.xml` colocalisés, importés comme texte

Chaque composant a son `.xml` à côté de son `.js`
(`debug_ping.js` / `debug_ping.xml`), importé via
`import templateXml from "./x.xml"`, résolu par le loader esbuild
`--loader:.xml=text` (ajouté dans `scripts/build-bundle.sh`).

Alternative écartée : `fetch()` runtime des templates au démarrage
(approche d'Odoo en ligne). Rejetée parce que l'app doit fonctionner
100% hors-ligne dès le premier chargement, sans dépendre du cache HTTP
pour des fichiers annexes — un seul bundle, cohérent avec le choix
déjà fait pour tout le reste du moteur.

### 3. Coexistence avec le moteur vanilla

Les briques légères sont rendues par OWL : les widgets de champ simples
(char, text, integer, float, boolean, selection, date, datetime,
monetary) via `owl/field_bridge.js`, et la vue kanban via
`views/kanban/kanban_renderer.js` (arch compilée en template OWL). Le
reste du moteur (form/list/one2many/many2one...) continue de générer du
DOM direct — la migration se fait brique par brique sans changer le
contrat `mount(container, params, env) -> destroy()` des contrôleurs.

L'ancien smoke test console (`DebugPing`, `owl/debug.js`,
`owl/templates.js`) a été SUPPRIMÉ : il servait à valider la chaîne
OWL avant toute brique réelle ; la kanban et les champs exercent
désormais cette chaîne en conditions réelles.

## Fichiers

```
static/lib/owl.iife.js              # vendorisé (build réel fourni par l'utilisateur)
static/src/owl/
  app.js                            # mountOwlApp() : owl.mount() + accès destroy
  field_bridge.js                   # renderOwlField(), computeReadonly/Required
```

## Exports vérifiés (37 au total)

App, Component, EventBus, OwlError, __info__, batched, blockDom,
htmlEscape, loadFile, markRaw, markup, mount, onError, onMounted,
onPatched, onRendered, onWillDestroy, onWillPatch, onWillRender,
onWillStart, onWillUnmount, onWillUpdateProps, reactive, status,
toRaw, useChildSubEnv, useComponent, useEffect, useEnv,
useExternalListener, useRef, useState, useSubEnv, validate,
validateType, whenReady, xml.

## Vérifié dans ce sandbox / à vérifier en navigateur

- ✅ Syntaxe ESM de tous les fichiers (`node --check`)
- ✅ `owl.iife.js` est bien un build réel et complet d'OWL (37 exports
  confirmés par inspection directe du fichier)
- ✅ Chaîne OWL validée de bout en bout en jsdom (montage réel de
  `owl.iife.js`) : vue kanban, widgets de champ, attrs dynamiques.

## Prochaine étape (hors périmètre ici)

Une fois les trois widgets relationnels migrés : compiler l'arch form
en templates OWL (attrs dynamiques résolus au parsing, comme le
form_arch_parser natif) avant d'attaquer les contrôleurs.

## État des migrations OWL

- ✅ Widgets de champ simples, tous via `owl/field_bridge.js`
  (`renderOwlField`, template inline `owl.xml`) : `char`, `text`,
  `integer`, `float`, `boolean`, `selection`, `date`, `datetime`,
  `monetary` -- 9 des 12 types du registre de `views/fields/field.js`.- ✅ `many2one` et `many2many_tags` : composants OWL (recherche +
  dropdown sur le cache de référence local, création locale via la file
  de sync) ; contrat DOM du sérialiseur conservé (input caché).
- ✅ `one2many` : composant OWL avec état réactif des lignes, cellules
  rendues par SOUS-COMPOSANTS OWL (les widgets ci-dessus embarqués via
  `static components`), total réactif (remplace compute_engine.js,
  supprimé), catalogue produits en overlay, API impératives publiées
  sur l'hôte (`getLines()`/`applyLineUpdates()`/`adjustLineFields()`)
  consommées par form_serializer/form_controller -- plus aucun scraping
  DOM des lignes (tr._cellRefs/_getTbody supprimés).
- ✅ `statusbar` : composant OWL (`views/fields/statusbar/`) -- dernier
  widget de champ migré : TOUS les widgets de champ du moteur sont
  désormais rendus par OWL. Ordre NATUREL des étapes (alignement Odoo
  17 ; l'ancien rendu DOM les inversait), filtre `statusbar_visible`
  avec valeur courante toujours affichée, o_first/o_last sur la liste
  visible, étapes désactivées (lecture seule).
- ✅ `views/form/form_renderer.js` : la vue FORMULAIRE est rendue par un
  composant OWL dont le template est COMPILÉ depuis l'arch à chaque
  mount (`form_arch_parser.js::buildFormTemplate` -- même flux que le
  webclient natif : arch -> template OWL -> composant). Scaffolding
  (sheet_bg, header/statusbar, sheet, chatter), groups (o_inner_group,
  colspan/newline), notebook réactif (state.activePage), h1, button_box
  et labels vivent dans le template ; les widgets de champ restent
  montés par `owl/field_bridge.js` dans les emplacements `data-form-slot`
  (contrat DOM du sérialiseur préservé : `#field-<name>`, inputs cachés,
  `data-one2many` + API impératives). `FormRenderer.ready` garantit que
  toutes les saisies existent avant la première passe de règles document.
  Absorbés/supprimés : `form_compiler.js`, `form_group/`,
  `form_header.js`, `button_box/`, `core/notebook/` (vanilla).
- ✅ `views/kanban/kanban_renderer.js` : vue kanban rendue par un
  composant OWL dont le template est COMPILÉ depuis l'arch à chaque
  mount (`kanban_arch_parser.js`) -- même flux que le webclient natif.
- ✅ `views/form/form_controller.js` : le CONTRÔLEUR form est un
  composant OWL (`FormController`) -- le descripteur de la vue expose
  `{ Controller }` (form_view.js, comme chez Odoo) et views/view.js
  monte le composant avec les params de l'action + l'env. Le template
  OWL porte les trois zones (control panel / statut / hôte renderer) ;
  la logique hors ligne (sync, règles, ledger) vit dans setup() et le
  cleanup est garanti par onWillDestroy.
- ✅ `views/list/list_controller.js` : le CONTRÔLEUR list est un
  composant OWL (`ListController`) -- `list_view.js` expose
  `{ Controller }`. Quatre zones OWL (control panel / statut / 
  dashboard / liste) ; la logique hors ligne (pagination, recherche,
  view-switcher, dashboard achats, record rules) vit dans setup(),
  cleanup garanti par onWillDestroy.
- ✅ `views/list/list_renderer.js` + `list_arch_parser.js` (itération 9)
  : la vue LISTE est rendue par un composant OWL à TEMPLATE STATIQUE
  (comme le natif), alimenté par les colonnes parsées de l'arch : tri
  par colonne, colonnes optionnelles persistées, sélection, badges
  decoration-*. `renderListView`/`renderListCell` vanilla supprimés.
- ✅ Group by liste (itération 10) : menu « Grouper par » du
  ControlPanel ; ListRenderer : en-têtes `o_group_header` dépliables
  (caret, compteur, sommes monetary/float), libellés par type
  (`groupLabel` partagé), groupes triés par libellé -- regroupement sur
  la page courante (écart assumé, pas de read_group serveur).
- ✅ `views/kanban/kanban_controller.js` + colonnes (itération 11) :
  `KanbanController` DÉDIÉ (`kanban_view.js` expose `{ Controller }`,
  plus d'enveloppe ListController) ; `default_group_by` de l'arch,
  menu « Grouper par » (champs regroupables de l'arch kanban),
  recherche, bascule liste via le dispatcher (doAction list_view) ;
  `mountKanbanView(..., groupBy)` construit les colonnes (en-tête
  libellé + badge compteur, « Aucun » pour les valeurs vides), template
  compilé à trois branches (groupé / vide / à plat).
- ✅ Panneaux systray + login (itération 15) : `ConnectivityIndicator`,
  `SyncStatusPanel` et `ConflictPanel` composants OWL embeddés dans la
  Navbar (plus de mounts vanilla par sélecteurs ni createDropdown/
  Popper), `Login` OWL (descripteur { mount } inchangé, phases du
  bouton, flux login -> session -> cache ownership -> droits ->
  redirectTo conservé) ; fichiers supprimés : core/dropdown/dropdown.js,
  user_menu/user_menu.js (vanilla) -- TOUT le shell est OWL.
- ✅ Shell webclient (itération 14) : `Navbar` composant OWL
  (navbar_component.js -- gabarit vanilla et écouteurs bus de
  webclient.js absorbés, ids/classes conservés pour les panneaux
  systray vanilla restants), `UserMenu` OWL embeddé (menu + « Mon
  compte » + déconnexion), `HomeMenu` OWL (grille des apps réactive,
  recherche, descripteur { mount } inchangé) ; webclient.js réduit à
  l'assemblage (ActionService + restoreState + panneaux vanilla).
- ✅ Quick create + drag & drop kanban (itération 13) : le renderer
  gère le geste (« + Créer » par colonne, cartes draggable, colonnes
  surlignées o_kanban_drag_over) et délègue le modèle au contrôleur :
  `onQuickCreate` (queueAction create + _rec_name hors ligne + valeur
  de colonne, maj optimiste, cache liste, sync en ligne) et
  `onRecordMove` (queueAction write, AMENDE du create en attente pour
  les cartes tmp:<uuid>, patchCachedRecord).
- ✅ Search avancé (itération 12) : `search/search_arch_parser.js` (arch
  `<search>` → filtres + filtres de groupe, tuples Python convertis en
  JSON), `search/search_utils.js` (`matchesSimpleDomain` partagé,
  `applyFilters` ET entre filtres, repli selection),
  `search/search_favorites.js` (équivalent hors ligne d'ir.filters,
  localStorage par modèle) ; ControlPanel : menus Filtres/Favoris +
  FACETTES retirables dans la barre de recherche, restauration complète
  d'un favori (requête + filtres + group by) sur un mount frais ;
  pipeline ListController/KanbanController : dashboard → filtres
  actifs → requête texte.
- ✅ `search/control_panel/control_panel.js` : le ControlPanel est un
  composant OWL embeddé dans les templates des contrôleurs (static
  components), alimenté par props -- `display` (blocs affichés, comme
  le prop display natif), `breadcrumb` (composant Breadcrumb,
  webclient/breadcrumb/, slots pour indicateur d'enregistrement et
  engrenage), `pager` ({page, pageSize, total} -- compteur et disabled
  calculés par le composant) et `views` (view switcher). Le debounce
  de recherche (300ms) vit dans le composant ; les interactions
  remontent par callbacks (onNew/onSearch/onPage/onSwitch/onSave/
  onUndo). buildControlPanel() vanilla supprimé.
- ✅ Fin de la migration : toutes les couches (champs, renderers,
  contrôleurs, control panel) sont rendues par OWL.


