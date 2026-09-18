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
  `monetary` -- 9 des 12 types du registre de `views/fields/field.js`.
- ✅ `many2one` et `many2many_tags` : composants OWL (recherche +
  dropdown sur le cache de référence local, création locale via la file
  de sync) ; contrat DOM du sérialiseur conservé (input caché).
- ✅ `one2many` : composant OWL avec état réactif des lignes, cellules
  rendues par SOUS-COMPOSANTS OWL (les widgets ci-dessus embarqués via
  `static components`), total réactif (remplace compute_engine.js,
  supprimé), catalogue produits en overlay, API impératives publiées
  sur l'hôte (`getLines()`/`applyLineUpdates()`/`adjustLineFields()`)
  consommées par form_serializer/form_controller -- plus aucun scraping
  DOM des lignes (tr._cellRefs/_getTbody supprimés).
- ✅ `views/kanban/kanban_renderer.js` : vue kanban rendue par un
  composant OWL dont le template est COMPILÉ depuis l'arch à chaque
  mount (`kanban_arch_parser.js`) -- même flux que le webclient natif.
- ⏳ Reste : le renderer form (arch -> template OWL) puis les
  contrôleurs.


