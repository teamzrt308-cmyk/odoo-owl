/**
 * Test de fumée jsdom des widgets relationnels OWL :
 *  - many2one : label initial, recherche, sélection, création locale, no_create
 *  - many2many_tags : tags initiaux, ajout, retrait, JSON caché
 *  - one2many : rendu, saisie -> règles (_compute_amount), total réactif,
 *    ajout/suppression de lignes, getLines (avec _deleted), applyLineUpdates,
 *    adjustLineFields, intégration collectFormData
 */
import { JSDOM } from "jsdom";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";

const REPO = "/home/user/odoo-owl";
const ok = (cond, label) => {
  if (!cond) { console.error("✗ ÉCHEC :", label); process.exit(1); }
  console.log("✓", label);
};
const tick = () => new Promise((r) => setTimeout(r, 40));

const dom = new JSDOM(`<!DOCTYPE html><html><body></body></html>`, {
  url: "https://pwa.test/index.html", runScripts: "outside-only", pretendToBeVisual: true,
});
vm.runInContext(fs.readFileSync(path.join(REPO, "static/lib/owl.iife.js"), "utf8"), dom.getInternalVMContext());
globalThis.owl = dom.window.owl;
globalThis.document = dom.window.document;
globalThis.window = dom.window;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;
globalThis.DOMParser = dom.window.DOMParser;
globalThis.XMLSerializer = dom.window.XMLSerializer;
globalThis.MutationObserver = dom.window.MutationObserver;
globalThis.location = dom.window.location;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });

// --- Stub Dexie : tables utilisées par les modules importés ---
const queuedActions = [];
class FakeTable {
  constructor(rows = []) { this.rows = rows; }
  async put() {} async bulkPut() {}
  where() {
    const rows = this.rows;
    return { equals: () => ({ toArray: async () => rows }) };
  }
  async get() { return null; }
  async add(obj) { queuedActions.push(obj); return { id: queuedActions.length }; }
}
const referenceRows = [
  { model: "res.partner", id: 1, display_name: "Alice" },
  { model: "res.partner", id: 2, display_name: "Bob" },
  { model: "res.currency", id: 1, display_name: "USD", symbol: "$", position: "before" },
  { model: "product.product", id: 5, display_name: "Desk" },
];
class FakeDexie {
  constructor() {
    this.sync_queue = new FakeTable();
    this.reference_records = new FakeTable(referenceRows);
    this.cache_meta = new FakeTable();
    this.catalog_cache = new FakeTable();
  }
  version() { return { stores() {} }; }
  transaction() {}
}
globalThis.Dexie = FakeDexie;

const alerts = [];
globalThis.window.alert = (m) => alerts.push(m);
dom.window.alert = (m) => alerts.push(m);

const { renderMany2oneField } = await import(REPO + "/static/src/views/fields/many2one/many2one_field.js");
const { renderMany2manyTagsField } = await import(REPO + "/static/src/views/fields/many2many_tags/many2many_tags_field.js");
const { renderOne2manyField } = await import(REPO + "/static/src/views/fields/one2many/one2many_field.js");
const { collectFormData } = await import(REPO + "/static/src/views/form/form_serializer.js");
// Le moteur de règles est initialisé au démarrage de l'app (main.js) ;
// le test doit le faire explicitement.
const { initRulesEngine } = await import(REPO + "/static/src/model/rules_engine/rules_engine.js");
const { allRules } = await import(REPO + "/static/src/model/rules_engine/rules/index.js");
initRulesEngine(allRules);

async function mount(widgetEl) {
  document.body.appendChild(widgetEl);
  for (let i = 0; i < 150; i++) {
    if (widgetEl._owlComponent) return widgetEl._owlComponent;
    await tick();
  }
  throw new Error("mount OWL introuvable (timeout)");
}

// ═══════════════════ 1. MANY2ONE ═══════════════════
{
  const info = { type: "many2one", relation: "res.partner", label: "Client" };
  const node = new dom.window.DOMParser().parseFromString('<field name="partner_id" placeholder="Choisir..."/>', "text/xml").documentElement;

  let changed = null;
  const host = renderMany2oneField("partner_id", info, node, 1, {});
  host._testOnChange = (v) => (changed = v);
  const comp = await mount(host);

  const input = host.querySelector("input[type=text]");
  const hidden = host.querySelector('input[type=hidden]');
  ok(!!input && !!hidden, "m2o : input texte + input caché rendus");
  ok(hidden.value === "1", "m2o : valeur initiale (id) dans le champ caché");
  ok(input.value === "Alice", "m2o : libellé résolu depuis le cache de référence");
  ok(input.placeholder === "Choisir...", "m2o : placeholder depuis l'arch");

  // Recherche
  input.value = "Bo";
  input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  await tick();
  const allItems = [...host.querySelectorAll(".dropdown-item")];
  const suggestions = allItems.filter((a) => !a.textContent.startsWith("Créer"));
  ok(suggestions.length === 1 && suggestions[0].textContent === "Bob", "m2o : recherche filtre les suggestions");
  ok(allItems.length === 2, "m2o : option « Créer » présente en plus des suggestions");

  // Sélection
  suggestions[0].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  await tick();
  ok(host.querySelector('input[type=hidden]').value === "2", "m2o : sélection -> id dans le champ caché");
  ok(input.value === "Bob", "m2o : libellé mis à jour");

  // Création locale (canCreate par défaut)
  input.value = "Zoé";
  input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  await tick();
  const createLink = [...host.querySelectorAll(".dropdown-item")].find((a) => a.textContent.startsWith("Créer"));
  ok(!!createLink, "m2o : option « Créer ... » proposée");
  createLink.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  await tick();
  const hiddenAfter = host.querySelector('input[type=hidden]').value;
  ok(hiddenAfter.startsWith("tmp:"), "m2o : création locale -> référence tmp:<uuid>");
  ok(queuedActions.some((a) => a.operation === "create" && a.model_name === "res.partner"), "m2o : création mise en file de sync");

  // no_create respecté
  const nodeNC = new dom.window.DOMParser().parseFromString('<field name="partner_id" options="{\'no_create\': True}"/>', "text/xml").documentElement;
  const hostNC = renderMany2oneField("partner2", info, nodeNC, false, {});
  await mount(hostNC);
  const inputNC = hostNC.querySelector("input[type=text]");
  inputNC.value = "Xy";
  inputNC.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  await tick();
  ok(![...hostNC.querySelectorAll(".dropdown-item")].some((a) => a.textContent.startsWith("Créer")), "m2o : options.no_create -> pas d'option Créer");
}

// ═══════════════════ 2. MANY2MANY TAGS ═══════════════════
{
  const info = { type: "many2many", relation: "res.partner", label: "Tags" };
  let changed = null;
  const host = renderMany2manyTagsField("tag_ids", info, null, [1], {});
  const comp = await mount(host);
  comp.props.onChange = (v) => (changed = v);

  const hidden = host.querySelector('input[type=hidden]');
  ok(hidden.value === "[1]", "m2m : JSON initial dans le champ caché");
  ok(host.textContent.includes("Alice"), "m2m : tag initial affiché");

  // Ajout via recherche
  const input = host.querySelector("input[type=text]");
  input.value = "Bo";
  input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  await tick();
  const item = host.querySelector(".dropdown-item");
  ok(!!item && item.textContent === "Bob", "m2m : recherche -> suggestion");
  item.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  await tick();
  ok(JSON.parse(host.querySelector('input[type=hidden]').value).join(",") === "1,2", "m2m : ajout -> JSON [1,2]");
  ok(changed && changed.join(",") === "1,2", "m2m : onChange émis avec les ids");

  // Retrait du premier tag
  const removeLink = host.querySelector(".badge a");
  removeLink.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  await tick();
  ok(JSON.parse(host.querySelector('input[type=hidden]').value).join(",") === "2", "m2m : retrait -> JSON [2]");
  ok(host.textContent.includes("Bob") && !host.textContent.includes("Alice"), "m2m : badge retiré du DOM");
}

// ═══════════════════ 3. ONE2MANY ═══════════════════
{
  const subFields = {
    product_id: { type: "many2one", relation: "product.product", label: "Article" },
    product_uom_qty: { type: "float", label: "Quantité" },
    price_unit: { type: "float", label: "Prix" },
    price_subtotal: { type: "float", label: "Sous-total" },
    price_total: { type: "float", label: "Total" },
    purchase_line_id: { type: "many2one", relation: "purchase.order.line", label: "Ligne achat" },
  };
  const archNode = new dom.window.DOMParser().parseFromString(`
    <field name="order_line">
      <list>
        <field name="product_id"/>
        <field name="product_uom_qty"/>
        <field name="price_unit"/>
        <field name="price_subtotal"/>
        <field name="price_total"/>
      </list>
    </field>`, "text/xml").documentElement;
  const info = { type: "one2many", relation: "sale.order.line", label: "Lignes", sub_fields: subFields };

  const initialRows = [
    { id: 11, product_id: [5, "Desk"], product_uom_qty: 2, price_unit: 30, price_subtotal: 60, price_total: 60, purchase_line_id: [99, "POL/1"] },
  ];

  const host = renderOne2manyField("order_line", info, archNode, initialRows, {});
  document.body.appendChild(host);
  for (let i = 0; i < 150; i++) { if (host._owlComponent) break; await tick(); }
  ok(!!host._owlComponent && host._owlOne2many === true, "o2m : composant OWL monté, API publiées sur l'hôte");

  // Rendu initial
  const rows = host.querySelectorAll("tbody tr.o_data_row");
  ok(rows.length === 1, "o2m : 1 ligne initiale rendue");
  // Le libellé many2one vient du tuple serveur : OWL pose la PROPRIÉTÉ
  // value de l'input (pas l'attribut HTML) — on lit la propriété.
  const cellInput = host.querySelector('[data-line-field="product_id"] input[type=text]');
  ok(cellInput && cellInput.value === "Desk", "o2m : cellule many2one (produit) affiche le libellé");
  const qtyInput = rows[0].querySelector('[data-line-field="product_uom_qty"] input');
  ok(qtyInput && qtyInput.value === "2", "o2m : cellule quantité rendue avec la valeur serveur");

  // getLines : tuple many2one normalisé en id + champs techniques préservés
  let lines = host.getLines();
  ok(lines.length === 1 && lines[0].product_id === 5, "o2m : getLines normalise le tuple m2o en id");
  ok(lines[0].purchase_line_id !== undefined, "o2m : champs techniques hors colonnes préservés (purchase_line_id)");

  // Saisie quantité -> règle _compute_amount -> sous-total/total + total pied
  qtyInput.value = "3";
  qtyInput.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  await tick(); await tick();
  lines = host.getLines();
  ok(lines[0].price_subtotal === 90 && lines[0].price_total === 90, "o2m : règle _compute_amount (3 × 30 = 90)");
  ok(/Total:\s*90[.,]00/.test(host.textContent), "o2m : total du pied réactif (Total: 90,00)");
  const subtotalInput = host.querySelector('[data-line-field="price_subtotal"] input');
  await tick();
  ok(subtotalInput.value === "90", "o2m : cellule sous-total ré-affichée depuis l'état");

  // Ajout d'une ligne
  const addLink = host.querySelector(".o_field_x2many_list_row_add a");
  addLink.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  await tick();
  ok(host.querySelectorAll("tbody tr.o_data_row").length === 2, "o2m : « Ajouter une ligne » -> 2 lignes");
  lines = host.getLines();
  ok(lines.length === 2 && !lines[1].id, "o2m : nouvelle ligne sans id");

  // Suppression de la ligne AVEC id -> matérialisée _deleted
  const firstRow = host.querySelectorAll("tbody tr.o_data_row")[0];
  firstRow.querySelector(".o_list_record_remove button").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  await tick();
  lines = host.getLines();
  ok(lines.some((l) => l.id === 11 && l._deleted === true), "o2m : suppression ligne initiale -> {id, _deleted:true}");

  // applyLineUpdates : fusionne les valeurs recalculées (épargne le champ focalisé)
  host.applyLineUpdates([{ id: undefined, product_uom_qty: 7, price_unit: 50, price_subtotal: 350, price_total: 350 }]);
  await tick();
  const line0 = host.getLines()[0];
  ok(line0.price_subtotal === 350 && line0.price_total === 350, "o2m : applyLineUpdates fusionne les valeurs recalculées");
  const qtyEl = host.querySelector('[data-line-field="product_uom_qty"] input');
  qtyEl.focus();
  host.applyLineUpdates([{ product_uom_qty: 999, price_total: 351 }]);
  ok(host.getLines()[0].product_uom_qty !== 999, "o2m : applyLineUpdates épargne le champ en cours de saisie");
  qtyEl.blur();

  // adjustLineFields : deltas du ledger
  host.adjustLineFields(undefined, {}); // no-op sans id — ne doit pas planter
  const host2 = renderOne2manyField("order_line2", info, archNode, initialRows, {});
  document.body.appendChild(host2);
  for (let i = 0; i < 150; i++) { if (host2._owlComponent) break; await tick(); }
  host2.adjustLineFields(11, { qty_received: 3 });
  ok(host2.getLines()[0].qty_received === 3, "o2m : adjustLineFields applique les deltas du ledger (champ hors colonnes)");

  // Intégration sérialiseur
  const container = document.createElement("div");
  container.setAttribute("data-one2many", "order_line");
  container.appendChild(host2);
  const fieldsInfo = { order_line: info };
  const data = collectFormData(container, fieldsInfo);
  ok(Array.isArray(data.order_line) && data.order_line[0].id === 11 && data.order_line[0].qty_received === 3,
     "o2m : collectFormData lit getLines() (sérialiseur intégré)");

  // colonnes optionnelles : engrenage présent
  const archOpt = new dom.window.DOMParser().parseFromString(`
    <field name="order_line">
      <list>
        <field name="product_id"/>
        <field name="price_unit" optional="hide"/>
      </list>
    </field>`, "text/xml").documentElement;
  const hostOpt = renderOne2manyField("ol3", { ...info, sub_fields: subFields }, archOpt, [], {});
  document.body.appendChild(hostOpt);
  await mount(hostOpt);
  ok(!!hostOpt.querySelector(".o_optional_columns_dropdown"), "o2m : engrenage colonnes optionnelles rendu");
  const hiddenTh = hostOpt.querySelector("th.o2m-col-ol3-price_unit");
  ok(hiddenTh && hiddenTh.classList.contains("d-none"), "o2m : colonne optional=hide masquée par défaut");
}

document.body.innerHTML = "";
console.log("\n✅ TOUS LES TESTS RELATIONNELS PASSENT");