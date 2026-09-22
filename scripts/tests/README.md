# Tests de fumée jsdom

Suites de non-régression du moteur (Node + jsdom). Exécution :

```bash
cd scripts/tests && npm install   # une seule fois (jsdom)
for t in test-fields-owl test-kanban-owl test-structure test-relational-owl test-form-owl test-controller-owl test-list-controller-owl test-list-owl test-kanban-controller-owl test-search-advanced-owl test-shell-owl test-systray-login-owl test-notifications-action-service-owl test-business-rules-owl; do
  node $t.mjs
done
```

- `test-fields-owl.mjs` : widgets de champ simples OWL (char, text, integer,
  float, boolean, selection, date, datetime, monetary) — contrat DOM
  (id/hidden/onChange) et sync onWillUpdateProps.
- `test-relational-owl.mjs` : many2one (recherche, création locale tmp:<uuid>,
  no_create), many2many_tags (badges + JSON), one2many (règles métier,
  total réactif, getLines/applyLineUpdates/adjustLineFields, colonnes
  optionnelles, intégration collectFormData).
- `test-form-owl.mjs` : renderer form OWL (itération 4) — template compilé
  depuis l'arch (scaffolding, groups, notebook réactif, h1, button_box),
  header type="object", statusbar, emplacements de champs (contrat
  sérialiseur), re-mount + destroy.
- `test-controller-owl.mjs` : contrôleur form OWL (itération 5) —
  descripteur { Controller }, dispatch view.js, parcours hors ligne
  complet (caches → rendu → sauvegarde en file → action objet → destroy).
- `test-list-controller-owl.mjs` : contrôleur list OWL (itération 6) —
  descripteurs { Controller } list/kanban, parcours hors ligne (caches →
  lignes → pager → recherche → clic/Nouveau → bascule kanban OWL →
  pivot → destroy).
- `test-list-owl.mjs` : renderer list OWL (itérations 9-10) —
  parseListArch, tri, colonnes optionnelles persistées, sélection,
  badges decoration-*, formats, état vide, destroy, GROUP BY
  (en-têtes dépliables, comptes, sommes, libellés par type).
- `test-business-rules-owl.mjs` : règles métier (it. 17) — contraintes
  @api.constrains portées (validateDocument), avertissements d'onchange
  (bus rules:warning, clé strippée), checkRequiredFields, e2e save
  bloquée par un champ requis.
- `test-notifications-action-service-owl.mjs` : notifications (it. 16)
  — service add/close/sticky/boutons, conteneur de toasts, RainbowMan,
  ActionService étendu (act_url, client, server -> file, effect).
- `test-systray-login-owl.mjs` : systray OWL (itération 15) —
  connectivité (ping réel, dot), panneau sync (badges, réessai,
  suppression, bus), conflits (badge, doAction conflict_detail), login
  OWL (session, ownership, droits, redirectTo, échec).
- `test-shell-owl.mjs` : shell webclient OWL (itération 14) — Navbar
  (visibilité, sections/dropdowns, atterrissage naturel, bus
  user:info), UserMenu (Mon compte, déconnexion), HomeMenu (grille,
  recherche, ouverture d'app), ancrages systray vanilla.
- `test-search-advanced-owl.mjs` : search avancé (itération 12) —
  parseur `<search>`, menus Filtres/Favoris, facettes, filtrage ET,
  restauration d'un favori sur mount frais, repli selection.
- `test-kanban-controller-owl.mjs` : contrôleur kanban dédié +
  colonnes de group by (itération 11) + quick create et drag & drop
  (itération 13) — default_group_by, menu Grouper par, recherche, clic
  carte, switch list, « + Créer » (create en file + carte tmp), DnD
  (write + patch caches, amende du create tmp), guard, destroy.
- `test-kanban-owl.mjs` : pilote OWL de la vue kanban (arch → template).
- `test-structure.mjs` : invariants d'architecture (registres, chemins,
  conventions façon Odoo 17, compilation du notebook dans le template
  form, composants ControlPanel/Breadcrumb).

- `test-global-boot-owl.mjs` : **test global** — boot du `main.js`
  RÉEL dans jsdom de bout en bout : login → home menu → carte Ventes →
  liste (cache hors ligne) → group by État → kanban (quick create
  présent) → form fiche 42 → save (file hors ligne, 0 erreur console
  inattendue). Vérifie le câblage croisé de TOUTES les itérations.

- `test-field-bridge-contract.mjs` : contrat field_bridge — invisible
  LIVE (cellule masquée/rendue sans re-render), marqueur required visuel,
  événements o2m → règles RACINE (qty ligne → amount_total), sérialiseur.
- `test-widgets-owl.mjs` : widgets de champ (itération 21) — priority
  (étoiles + clic), badge, boolean_toggle, radio, image (base64 +
  placeholder), email/phone/url (liens locaux), handle (liste), statinfo
  (tuile button_box), contrat sérialiseur (#field-<name>), cellules de
  liste et carte kanban image.
- `test-workflow-rules-owl.mjs` : workflow hors ligne (itération 20) —
  verrous `fromStates` (canRunObjectAction), états optimistes
  (computeOptimisticStateUpdate, fusion stock_effect + object_action),
  cascade remise → sous-totaux → amount_untaxed/tax/total, e2e form :
  clic « Confirmer » → boutons header permutés (invisible), statusbar à
  jour, method call en file, état persisté. **Chaîne complète
  vente -> stock** : confirmer le devis (0 effet stock, comme Odoo),
  valider le bon (double entrée −2/+2, qty_delivered, picking done),
  liste des quants affichant 98 en lecture ledger, re-validation refusée.
- `audit-manifest.mjs` : **audit d'un manifest RÉEL** (export Dexie de
  la table `module_manifests`) — parse puis (avec `--mount`) montage
  runtime de chaque arch list/kanban/form avec enregistrements factices ;
  signale archs cassées, widgets utilisés, menus orphelins. Usage :
  `node audit-manifest.mjs [--mount] export.json` (0/168 puis 168/168
  après itération 19).

Ces tests utilisent un stub Dexie minimal et ne touchent jamais le réseau.
