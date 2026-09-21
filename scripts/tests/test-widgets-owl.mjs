/**
 * Test des widgets de champ additionnels (itération 21) :
 * priority, badge, boolean_toggle, radio, image, email/phone/url,
 * handle, statinfo (button_box) -- rendu, interaction, contrat
 * sérialiseur (#field-<name>), cellules de liste, carte kanban image.
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
globalThis.localStorage = dom.window.localStorage;
globalThis.sessionStorage = dom.window.sessionStorage;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
Object.defineProperty(globalThis.navigator, "onLine", { value: false, configurable: true });
globalThis.Dexie = class { constructor() {} version() { return { stores() {} }; } transaction() {} };

const { mountFormRenderer } = await import(REPO + "/static/src/views/form/form_renderer.js");
const { mountListView } = await import(REPO + "/static/src/views/list/list_renderer.js");
const { mountKanbanView } = await import(REPO + "/static/src/views/kanban/kanban_renderer.js");
const { collectFormData } = await import(REPO + "/static/src/views/form/form_serializer.js");

// ── A. FORMULAIRE : les 10 widgets ──
const fieldsInfo = {
  priority: { type: "selection", label: "Priorité", selection: [["0", "Normal"], ["1", "Élevé"]] },
  tag: { type: "selection", label: "Étiquette", selection: [["a", "Urgent"], ["b", "Normal"]] },
  active: { type: "boolean", label: "Actif" },
  color: { type: "selection", label: "Couleur", selection: [["r", "Rouge"], ["g", "Vert"], ["b", "Bleu"]] },
  image_1920: { type: "char", label: "Image" },
  image_empty: { type: "char", label: "Image vide" },
  email: { type: "char", label: "E-mail" },
  phone: { type: "char", label: "Téléphone" },
  website: { type: "char", label: "Site web" },
  sequence: { type: "integer", label: "Séquence" },
  picking_count: { type: "integer", label: "Transferts" },
};
const IMG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const formArch = `<form>
  <sheet>
    <div class="oe_button_box">
      <button name="action_view_picking" type="action" class="oe_stat_button" icon="fa-truck">
        <field name="picking_count" widget="statinfo" string="Transferts"/>
      </button>
    </div>
    <group>
      <field name="priority" widget="priority"/>
      <field name="tag" widget="badge"/>
      <field name="active" widget="boolean_toggle"/>
      <field name="color" widget="radio"/>
      <field name="image_1920" widget="image"/>
      <field name="image_empty" widget="image"/>
      <field name="email" widget="email"/>
      <field name="phone" widget="phone"/>
      <field name="website" widget="url"/>
      <field name="sequence" widget="handle"/>
    </group>
  </sheet>
</form>`;

const initialValues = {
  id: 1,
  priority: "0", tag: "a", active: true, color: "g",
  image_1920: IMG_BASE64, image_empty: false,
  email: "client@example.com", phone: "+261340000000", website: "example.mg",
  sequence: 10, picking_count: 4,
};

const target = document.createElement("div");
document.body.appendChild(target);
const h = await mountFormRenderer(target, formArch, fieldsInfo, initialValues, null, null);
if (h && h.ready) await Promise.race([h.ready, new Promise((r) => setTimeout(r, 3000))]);
await tick();

// priority : 2 étoiles, la 1re remplie (valeur "0" = rang 0)
let stars = target.querySelectorAll(".o_priority .o_priority_star");
ok(stars.length === 2, "wg : priority -> 2 étoiles");
ok(stars[0].className.includes("fa-star") && !stars[1].className.includes("fa-star-o") === false,
   "wg : priority -> 1re étoile remplie (rang 0)");
stars[1].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
await tick();
ok(target.querySelector("#field-priority").value === "1", "wg : clic 2e étoile -> valeur « 1 » (input caché)");
ok(stars[1].className.includes("fa-star") && stars[1].className.includes("text-warning"), "wg : 2e étoile désormais remplie");

// badge
const badge = target.querySelector(".o_tag_badge");
ok(!!badge && badge.textContent === "Urgent", "wg : badge -> libellé selection « Urgent »");

// boolean_toggle : checkbox native #field-active (contrat sérialiseur)
const toggle = target.querySelector("#field-active");
ok(!!toggle && toggle.type === "checkbox" && toggle.checked === true, "wg : boolean_toggle -> coché (contrat #field-name)");
toggle.click();
await tick();
ok(toggle.checked === false, "wg : boolean_toggle -> bascule au clic");

// radio
const radios = target.querySelectorAll(`input[name="radio-color"]`);
ok(radios.length === 3, "wg : radio -> 3 boutons");
ok(radios[1].checked === true, "wg : radio -> « g » pré-coché");
radios[2].click();
await tick();
ok(target.querySelector("#field-color").value === "b", "wg : radio -> clic « b » synchronise l'input caché");

// image : data URI depuis le base64 du cache + placeholder si vide
const img = target.querySelector(".o_field_image .o_image_preview");
ok(img && img.src.startsWith("data:image/png;base64," + IMG_BASE64.slice(0, 8)), "wg : image -> aperçu base64 du cache");
const imgs = target.querySelectorAll(".o_field_image .o_image_preview");
ok(imgs[1].src.endsWith("assets/default-app.png"), "wg : image vide -> placeholder local");

// email / phone / url : input + bouton-lien local
const opens = [];
dom.window.open = (u) => { opens.push(u); return null; };
const linkBtn = (idx) => target.querySelectorAll(".o_field_link button")[idx];
ok(!!target.querySelector("#field-email[type=email]") && linkBtn(0).innerHTML.includes("fa-envelope"), "wg : email -> input type=email + icône enveloppe");
linkBtn(0).dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
ok(opens.includes("mailto:client@example.com"), "wg : email -> clic ouvre mailto: local");
ok(!!target.querySelector("#field-phone[type=tel]"), "wg : phone -> input type=tel");
linkBtn(2).dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
ok(opens.includes("https://example.mg"), "wg : url -> clic ouvre https:// (préfixe auto)");

// statinfo : tuile button_box (icône + compteur + libellé, valeur compile-time)
const tile = target.querySelector(".oe_button_box .oe_stat_button");
ok(!!tile && tile.querySelector(".o_stat_icon").className.includes("fa-truck"), "wg : statinfo -> icône fa-truck");
ok(tile.querySelector(".o_stat_value").textContent === "4", "wg : statinfo -> compteur 4");
ok(tile.querySelector(".o_stat_text").textContent === "Transferts", "wg : statinfo -> libellé « Transferts »");

// handle en form : rendu neutre, pas d'input #field-sequence bloquant
ok(!target.querySelector("#field-sequence"), "wg : handle -> invisible en formulaire (pas de champ sérialisé)");

// ── B. SÉRIALISEUR : collectFormData lit les widgets ──
const data = collectFormData(target, fieldsInfo);
ok(data.priority === "1" && data.color === "b", "wg : collectFormData -> priority « 1 » + radio « b »");
ok(data.active === false && data.email === "client@example.com", "wg : collectFormData -> toggle false + email saisi");
ok(data.tag === "a" && data.image_1920 === IMG_BASE64, "wg : collectFormData -> badge + base64 image");

// ── C. LISTE : cellules par widget ──
const listFields = {
  sequence: { type: "integer", label: "Séq." },
  priority: { type: "selection", label: "Priorité", selection: [["0", "Normal"], ["1", "Élevé"], ["2", "Urgent"]] },
  active: { type: "boolean", label: "Actif" },
  tag: { type: "selection", label: "Étiquette", selection: [["a", "Urgent"], ["b", "Normal"]] },
  image_1920: { type: "char", label: "Image" },
};
const listArch = `<list>
  <field name="sequence" widget="handle"/>
  <field name="priority" widget="priority"/>
  <field name="active" widget="boolean_toggle"/>
  <field name="tag" widget="badge"/>
  <field name="image_1920" widget="image"/>
</list>`;
const listRecords = [{ id: 1, sequence: 10, priority: "1", active: true, tag: "b", image_1920: IMG_BASE64 }];
const listTarget = document.createElement("div");
document.body.appendChild(listTarget);
await mountListView(listTarget, listArch, listFields, listRecords, () => {}, "test.model", null);
await tick();

ok(listTarget.querySelector(".o_row_handle"), "wg liste : poignée handle affichée");
ok(listTarget.querySelector(".o_priority_display").textContent === "★★", "wg liste : priority -> « ★★ » (rang 1)");
const toggleCell = listTarget.querySelector(".o_data_cell .fa-check-circle");
ok(!!toggleCell, "wg liste : boolean_toggle -> icône verte");
ok(!!listTarget.querySelector(".o_data_cell .badge"), "wg liste : badge -> pastille");
const listImg = listTarget.querySelector(".o_list_image");
ok(listImg && listImg.src.startsWith("data:image/png;base64,"), "wg liste : image -> vignette base64");

// ── D. KANBAN : widget image sur la carte ──
const kanbanFields = { name: { type: "char", label: "Nom" }, image_1920: { type: "char", label: "Image" } };
const kanbanArch = `<kanban>
  <field name="name"/><field name="image_1920"/>
  <templates><t t-name="kanban-box">
    <div class="oe_kanban_card oe_kanban_global_click">
      <field name="image_1920" widget="image"/>
      <field name="name"/>
    </div>
  </t></templates>
</kanban>`;
const kanbanTarget = document.createElement("div");
document.body.appendChild(kanbanTarget);
await mountKanbanView(kanbanTarget, kanbanArch, kanbanFields, [
  { id: 1, name: "Produit A", image_1920: IMG_BASE64 },
  { id: 2, name: "Produit B", image_1920: false },
], () => {}, null, {});
await tick();

const cardImgs = kanbanTarget.querySelectorAll(".oe_kanban_card img");
ok(cardImgs.length === 2, "wg kanban : widget image -> <img> sur les cartes");
ok(cardImgs[0].getAttribute("src").startsWith("data:image/png;base64,"), "wg kanban : carte 1 -> image base64 réelle");
ok(cardImgs[1].getAttribute("src").endsWith("assets/default-app.png"), "wg kanban : carte 2 -> placeholder local");

console.log("\n✅ TOUS LES TESTS WIDGETS PASSENT");
