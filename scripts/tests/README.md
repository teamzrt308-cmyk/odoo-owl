# Tests de fumée jsdom

Suites exécutées hors bundle (Node + jsdom installé dans /tmp/owl-smoke) :

```bash
mkdir -p /tmp/owl-smoke && cd /tmp/owl-smoke && npm init -y >/dev/null && npm i jsdom >/dev/null
for t in test-fields-owl test-kanban-owl test-structure test-relational-owl; do
  node /home/user/odoo-owl/scripts/tests/$t.mjs
done
```

- `test-fields-owl.mjs` : widgets de champ simples OWL (char, text, integer,
  float, boolean, selection, date, datetime, monetary) — contrat DOM
  (id/hidden/onChange) et sync onWillUpdateProps.
- `test-relational-owl.mjs` : many2one (recherche, création locale tmp:<uuid>,
  no_create), many2many_tags (badges + JSON), one2many (règles métier,
  total réactif, getLines/applyLineUpdates/adjustLineFields, colonnes
  optionnelles, intégration collectFormData).
- `test-kanban-owl.mjs` : pilote OWL de la vue kanban (arch → template).
- `test-structure.mjs` : invariants d'architecture (registres, chemins,
  conventions façon Odoo 17).

Ces tests utilisent un stub Dexie minimal et ne touchent jamais le réseau.
