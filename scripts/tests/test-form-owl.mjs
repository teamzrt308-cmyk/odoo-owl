/**
 * Test de fumée jsdom du renderer form OWL (itération 4) :
 *  - template compilé depuis l'arch (scaffolding, groups, notebook, h1)
 *  - header : boutons visibles/invisibles, type="object" branché
 *  - statusbar délégué au widget de champ
 *  - champs montés dans les emplacements (contrat sérialiseur)
 *  - notebook réactif (changement d'onglet)
 *  - button_box, chatter, collectFormData, re-mount + destroy
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
const tick = () => new Promise((r) => setTimeout(r, 25));

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
globalThis.alert = () => alerts.push("alert"); // conservé : plus utilisé, garde-fou (aucun appel attendu)

// Itération 16 : les alert() sont remplacés par le service de
// notifications -> on écoute le bus pour les assertions de toasts.
const notifEvents = [];
const { bus } = await import(REPO + "/static/src/core/bus/bus_service.js");
bus.addEventListener("notification:changed", (ev) => notifEvents.push(ev.detail));

class FakeTable {
  constructor(rows = []) { this.rows = rows; }
  async put() {} async bulkPut() {}
  where() { const rows = this.rows; return { equals: () => ({ toArray: async () => rows }) }; }
  async get() { return null; }
  async add() { return { id: 1 }; }
}
const referenceRows = [
  { model: "res.partner", id: 1, display_name: "Alice" },
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
dom.window.alert = (m) => alerts.push(m);

const { mountFormRenderer } = await import(REPO + "/static/src/views/form/form_renderer.js");
const { parseFormViewArch } = await import(REPO + "/static/src/views/form/form_arch_parser.js");
const { initRulesEngine } = await import(REPO + "/static/src/model/rules_engine/rules_engine.js");
const { allRules } = await import(REPO + "/static/src/model/rules_engine/rules/index.js");
initRulesEngine(allRules);
const { collectFormData } = await import(REPO + "/static/src/views/form/form_serializer.js");

const fieldsInfo = {
  name: { type: "char", label: "Référence" },
  partner_id: { type: "many2one", relation: "res.partner", label: "Client" },
  amount: { type: "float", label: "Montant" },
  date_order: { type: "date", label: "Date" },
  note: { type: "text", label: "Note interne" },
  client_ref: { type: "char", label: "Référence client" },
  secret_note: { type: "char", label: "Note secrète" },
  state: { type: "selection", label: "État", selection: [["draft", "Brouillon"], ["done", "Validé"]] },
  order_line: {
    type: "one2many", relation: "sale.order.line", label: "Lignes",
    sub_fields: {
      product_id: { type: "many2one", relation: "product.product", label: "Article" },
      product_uom_qty: { type: "float", label: "Quantité" },
      price_unit: { type: "float", label: "Prix" },
      price_subtotal: { type: "float", label: "Sous-total" },
    },
  },
};

const archXml = `<form>
  <header>
    <button name="action_confirm" type="object" string="Confirmer"/>
    <button name="action_cancel" type="object" string="Annuler" invisible="1"/>
    <button name="action_print" string="Imprimer"/>
    <field name="state" widget="statusbar"/>
  </header>
  <sheet>
    <div class="oe_button_box">
      <button string="Livraisons" type="object" name="action_view_deliveries"/>
    </div>
    <h1><field name="name"/></h1>
    <group string="En-tête">
      <group string="Client">
        <field name="partner_id"/>
        <field name="amount" readonly="1"/>
        <field name="secret_note" invisible="1"/>
      </group>
      <group string="Divers">
        <field name="date_order"/>
        <field name="note" nolabel="1" colspan="2"/>
      </group>
    </group>
    <notebook>
      <page string="Lignes">
        <field name="order_line">
          <list>
            <field name="product_id"/>
            <field name="product_uom_qty"/>
            <field name="price_unit"/>
            <field name="price_subtotal"/>
          </list>
        </field>
      </page>
      <page string="Divers">
        <field name="client_ref"/>
      </page>
    </notebook>
  </sheet>
</form>`;

const initialValues = {
  id: 42,
  name: "SO017",
  partner_id: [1, "Alice"],
  amount: 250.5,
  date_order: "2026-01-15",
  note: "Livraison 2 colis",
  client_ref: "REF-88",
  state: "draft",
  order_line: [
    { id: 11, product_id: [5, "Desk"], product_uom_qty: 2, price_unit: 30, price_subtotal: 60, price_total: 60 },
  ],
};

// ── parseFormViewArch inchangé (contrat test-structure) ──
{
  const parsed = parseFormViewArch(archXml);
  ok(!parsed.error && parsed.formRoot.tagName === "form", "form : parseFormViewArch -> formRoot");
}

const host = document.createElement("div");
document.body.appendChild(host);
const { el, ready, destroy } = await mountFormRenderer(host, archXml, fieldsInfo, initialValues, { is_admin: false }, (m) => (lastObjectMethod = m));
await ready;
let lastObjectMethod = null;

// ── 1. Scaffolding ──
ok(el.classList.contains("o_form_view"), "form : racine .o_form_view");
ok(!!el.querySelector(".o_form_sheet_bg .o_form_sheet"), "form : sheet_bg + sheet");
ok(!!el.querySelector(".o-mail-ChatterContainer"), "form : chatter stub présent");
ok(el.querySelector(".o_form_statusbar .o_statusbar_buttons").children.length === 2,
   "form : 2 boutons de header (invisible='1' filtré à la compilation)");
const headerButtons = [...el.querySelectorAll(".o_statusbar_buttons button")];
ok(headerButtons[0].classList.contains("btn-primary") && headerButtons[1].classList.contains("btn-secondary"),
   "form : 1er bouton primaire, suivant secondaire");

// ── 2. Bouton type="object" branché + fallback alert ──
headerButtons[0].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
await tick();
ok(lastObjectMethod === "action_confirm", "form : bouton type=object -> onObjectButtonClick(name)");
headerButtons[1].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
await tick();
ok(notifEvents.length === 1 && notifEvents[0][0].type === "warning" && notifEvents[0][0].message.includes("non disponible hors-ligne"),
   "form : bouton sans type -> toast warning (service de notifications)");
notifEvents.length = 0;

// ── 3. Statusbar délégué au widget de champ ──
const statusbar = el.querySelector(".o_form_statusbar .o_field_statusbar");
ok(!!statusbar && statusbar.textContent.includes("Brouillon"), "form : statusbar rendu, état courant visible");

// ── 4. h1 : champ sans label, valeur serveur ──
const h1 = el.querySelector("h1.o_row");
const nameInput = h1 && h1.querySelector("#field-name");
ok(nameInput && nameInput.value === "SO017", "form : champ du h1 rendu sans label");
ok(!h1.querySelector("label"), "form : aucun label dans le h1");

// ── 5. Groups : titres, labels, readonly statique, tuple m2o ──
const h2s = [...el.querySelectorAll(".o_horizontal_separator")].map((h) => h.textContent);
ok(h2s.includes("En-tête") && h2s.includes("Client") && h2s.includes("Divers"), "form : titres de groupes");
ok(!!el.querySelector('label[for="field-partner_id"]'), "form : label du many2one émis par le template");
const partnerInput = el.querySelector("#field-partner_id");
ok(partnerInput && partnerInput.value === "Alice", "form : tuple m2o affiché (Alice)");
const partnerHidden = el.querySelector('input[name="partner_id_id"]');
ok(partnerHidden && partnerHidden.value === "1", "form : input caché partner_id_id = 1");
const amountInput = el.querySelector("#field-amount");
ok(amountInput && amountInput.value === "250.5" && amountInput.readOnly === true, "form : readonly statique appliqué (amount)");
ok(!el.querySelector("#field-secret_note"), "form : champ invisible absent du rendu");
const noteArea = el.querySelector("#field-note");
ok(noteArea && noteArea.value === "Livraison 2 colis" && !noteArea.closest(".o_wrap_field").querySelector("label"),
   "form : nolabel=1 -> pas de label (note)");

// ── 6. Notebook réactif ──
const navLinks = [...el.querySelectorAll(".o_notebook .nav-link")];
ok(navLinks.length === 2 && navLinks[0].textContent === "Lignes" && navLinks[1].textContent === "Divers",
   "form : 2 onglets émis depuis l'arch");
const panes = [...el.querySelectorAll(".o_notebook .tab-pane")];
ok(panes[0].classList.contains("active") && !panes[1].classList.contains("active"), "form : 1re page active par défaut");
navLinks[1].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
await tick();
const panes2 = [...el.querySelectorAll(".o_notebook .tab-pane")];
ok(!panes2[0].classList.contains("active") && panes2[1].classList.contains("active"), "form : clic 2e onglet -> bascule active");
ok(!!el.querySelector("#field-client_ref"), "form : champ de la 2e page rendu");
navLinks[0].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
await tick();

// ── 7. Button box (record existant uniquement) ──
const statBtn = el.querySelector(".oe_button_box .oe_stat_button .o_stat_text");
ok(statBtn && statBtn.textContent === "Livraisons", "form : button_box rendu (record existant)");

// ── 8. Chatter : alert au clic ──
el.querySelector(".o-mail-Chatter-sendMessage").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
await tick();
ok(notifEvents.length === 1 && notifEvents[0][0].title === "Action indisponible",
   "form : bouton chatter -> toast (service de notifications)");
notifEvents.length = 0;

// ── 9. one2many monté + collectFormData (contrat sérialiseur) ──
ok(!!el.querySelector('[data-one2many="order_line"] [data-o2m-root="true"]'), "form : hôte one2many présent");
const data = collectFormData(el, fieldsInfo);
ok(data.name === "SO017" && data.amount === 250.5, "form : collectFormData lit les scalaires");
ok(data.partner_id === 1, "form : collectFormData lit le many2one (id)");
ok(data.date_order === "2026-01-15" && data.note === "Livraison 2 colis", "form : collectFormData lit date + texte");
ok(Array.isArray(data.order_line) && data.order_line.length === 1 && data.order_line[0].product_id === 5,
   "form : collectFormData lit les lignes one2many via getLines()");

// ── 10. Re-mount (refresh) + destroy ──
const host2 = document.createElement("div");
document.body.appendChild(host2);
const second = await mountFormRenderer(host2, archXml, fieldsInfo, { ...initialValues, name: "SO018" }, null, null);
await second.ready;
ok(second.el.querySelector("#field-name").value === "SO018", "form : re-mount avec nouvelles valeurs");
second.destroy();
ok(host2.childElementCount === 0, "form : destroy -> DOM retiré");

destroy();
ok(host.childElementCount === 0, "form : destroy du mount initial -> DOM retiré");

console.log("\n✅ TOUS LES TESTS FORM OWL PASSENT");