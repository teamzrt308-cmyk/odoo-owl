# Alignement du moteur hors ligne sur Odoo 17 — état au 20/09/2026

Comparaison couche par couche avec le webclient d'Odoo 17 (`web/static/src`).
Référence : branche `arena/01a0b34a-odoo-owl`, itérations 1→7 poussées (2725d5d).

---

## ✅ Terminé

### Socle technique
- **OWL embarqué localement** (`static/lib/owl.iife.js` 2.8.2), bundle esbuild, PWA (manifest + service-worker v30).
- **Persistance hors ligne** : IndexedDB/Dexie — caches record/list/reference/catalog/manifest, file de sync (`rpc_service`), ledger local.
- **Règles métier** : `model/rules_engine/` (onchange/compute génériques + spécifiques purchase/sale/stock, access, domain, default) portées de la logique serveur ; `core/py_js/` (evaluateSimpleCondition, isNodeVisible).
- **Tests** : 7 suites jsdom versionnées (`scripts/tests/`, ~180 assertions), exécutables offline.

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

### Renderer form (itération 4)
- `form_arch_parser.js::buildFormTemplate()` : **arch → template OWL** (scaffolding, groups `o_inner_group` avec colspan/newline, notebook réactif, h1, button_box, header buttons, statusbar) ;
- `FormRenderer` composant OWL (emplacements `data-form-slot` remplis après render, `ready` = saisies garanties) ;
- compilateurs DOM vanilla supprimés (form_compiler, form_group, form_header, button_box, core/notebook).

### Contrôleurs (itérations 5-6)
- `FormController`, `ListController`, `KanbanController` (enveloppe de ListController) : **composants OWL**, zones en template, logique offline intacte (sync, règles document, ledger, actions objet, sauvegarde, pagination, recherche, dashboard), `onMounted`/`onWillDestroy`.
- `view.js` monte `descriptor.Controller` (props params + env), comme le webclient natif.

### Control panel + breadcrumb (itération 7)
- `ControlPanel` OWL embeddé dans les contrôleurs, props-driven (`display`, `breadcrumb`, `pager` `{page,pageSize,total}`, `views`), callbacks (onNew/onSearch/onPage/onSwitch/onSave/onUndo), **debounce recherche internalisé**.
- `Breadcrumb` OWL (`webclient/breadcrumb/`), slots indicateur d'enregistrement + engrenage.
- `buildControlPanel`/`buildBreadcrumb` vanilla supprimés.

---

## ⏳ Manquant (écart vs Odoo 17)

### Vues
1. **Renderer LIST encore vanilla** (`list_renderer.js`, DOM direct) — dernier renderer non OWL ; Odoo : `list_arch_parser` + ListRenderer OWL. (`list_column_prefs.js` à réintégrer au passage.)
2. **Pivot / Graph** : placeholders « à venir » (Odoo : renderers + mesures/groupes).
3. **Contrôleur kanban dédié** : aujourd'hui enveloppe de ListController — group by, colonnes dynamiques absents.
4. Calendrier, gantt, activité… : hors périmètre actuel (à trancher explicitement).

### Widgets de champ
6. Widgets Odoo absents (à trancher selon besoins PWA) : badge, url, image, handle, email/phone, many2one_avatar, favorite, percentage, color…

### Modèle de données
7. **Pas de RelationalModel/BasicModel** (datapoints, dirty/changes) : notre état = DOM (sérialiseur) + état réactif des widgets — écart assumé du moteur hors ligne, à garder documenté.
8. Validation required/constraints au save : partielle (via `validateDocument`), pas d'équivalent complet de checkRequired.

### Couche recherche
9. **SearchBar riche** : filtres/groupBy/favoris (Odoo withSearch + favorite_menu) — ici simple filtre texte ; engrenage options purement décoratif.
10. **Group by** (list/kanban) : absent.

### Shell webclient
11. **Navbar, systray, user_menu, home_menu, login** : encore impératifs (DOM vanilla) — dernière grosse migration OWL possible.
12. **ActionService** : couvre act_window/home/form ; manque ir.actions.server/act_url/client actions, effets (Odoo action_service complet).
13. **Chatter/mail** : stub non fonctionnel (thread/composer/followers/activités côté Odoo).
14. Notifications/toasts : alert() natif, pas de notification service.
15. **i18n** : chaînes françaises en dur (Odoo : `_t` + catalogues).
16. Router : hash simple vs service router Odoo (état riche, pushState sémantique).

### Qualité
17. Tests e2e navigateur (au-delà de jsdom) — absent.
18. Accessibilité complète (aria/focus), thème/variantes — partiels.

---

## Ordre de reprise suggéré
1. renderer LIST en OWL (clôt « 100 % des renderers ») ;
2. contrôleur kanban dédié + group by ;
4. shell webclient OWL (navbar/home_menu/user_menu) ;
5. search avancé (filtres/groupBy/favoris) ;
6. ActionService étendu + notifications.

## Écarts assumés (spécificité hors ligne, à ne PAS « corriger »)
- Champs montés par `field_bridge` (contrat DOM sérialiseur) plutôt que tags `<Field>` OWL ;
- règles métier locales (`rules_engine`) au lieu des onchange serveur ;
- templates compilés depuis l'arch au lieu de templates qweb servis par le serveur.
