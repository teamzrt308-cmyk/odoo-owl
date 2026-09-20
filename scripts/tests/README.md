# Tests de fumée jsdom

Suites de non-régression du moteur (Node + jsdom). Exécution :

```bash
cd scripts/tests && npm install   # une seule fois (jsdom)
for t in test-fields-owl test-kanban-owl test-structure test-relational-owl test-form-owl test-controller-owl test-list-controller-owl; do
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
- `test-kanban-owl.mjs` : pilote OWL de la vue kanban (arch → template).
- `test-structure.mjs` : invariants d'architecture (registres, chemins,
  conventions façon Odoo 17, compilation du notebook dans le template
  form, composants ControlPanel/Breadcrumb).

Ces tests utilisent un stub Dexie minimal et ne touchent jamais le réseau.
