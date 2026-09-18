/**
 * Test de fumée du pilote OWL (vue kanban) hors du repo :
 *  1. compilation arch -> template OWL (kanban_arch_parser.js)
 *  2. montage OWL réel via jsdom (kanban_renderer.js + owl/app.js)
 *  3. rendu des cartes, t-if/t-else, t-set, t-attf, placeholder image
 *  4. clic de carte -> callback, destroy -> DOM nettoyé
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

const dom = new JSDOM(`<!DOCTYPE html><html><body></body></html>`, {
  url: "https://pwa.test/index.html",
  runScripts: "outside-only",
  pretendToBeVisual: true,
});

// 1) OWL chargé DANS le contexte jsdom (comme index.html le fait)
const owlCode = fs.readFileSync(path.join(REPO, "static/lib/owl.iife.js"), "utf8");
vm.runInContext(owlCode, dom.getInternalVMContext());
ok(!!dom.window.owl?.App, "owl.iife.js chargé (owl.App présent)");

// 2) Globals Node pour les modules ESM du moteur
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
// Stub Dexie : orm_service.js instancie new Dexie() à l'import (jamais utilisé ici)
globalThis.Dexie = class { version() { return { stores() {} }; } transaction() {} };

const { parseKanbanArch } = await import(REPO + "/static/src/views/kanban/kanban_arch_parser.js");
const { mountKanbanView } = await import(REPO + "/static/src/views/kanban/kanban_renderer.js");

const arch = `<?xml version="1.0"?>
<kanban>
  <field name="name"/>
  <field name="expected_revenue"/>
  <templates>
    <t t-name="kanban-box">
      <div class="oe_kanban_card oe_kanban_global_click">
        <strong class="o_kanban_record_title"><field name="name"/></strong>
        <div class="o_kanban_record_subtitle">
          <t t-set="revenue" t-value="record.expected_revenue.raw_value || 0"/>
          <span t-esc="revenue"/>
        </div>
        <img t-att-src="record.image_1920" alt="Image"/>
        <div t-if="record.activity_state.raw_value">
          <i t-attf-class="fa fa-circle status_{{record.activity_state.raw_value}}"/>
          <span t-out="record.user_id.value"/>
        </div>
        <div t-else="" class="text-muted">Pas d'activité</div>
        <button type="edit" class="o_kanban_edit">Editer</button>
      </div>
    </t>
  </templates>
</kanban>`;

const fieldsInfo = {
  name: { type: "char", label: "Name" },
  expected_revenue: { type: "monetary", label: "Expected Revenue" },
  user_id: { type: "many2one", label: "Responsable" },
  activity_state: { type: "selection", label: "Activité", selection: [["today", "Aujourd'hui"]] },
};

const records = [
  { id: 1, name: "Devis A", expected_revenue: 1500, user_id: [2, "Mitchell Admin"], activity_state: false },
  { id: 2, name: "Devis B", expected_revenue: 42, user_id: [2, "Mitchell Admin"], activity_state: "today" },
];

// --- 1. Compilation de l'arch ---
const parsed = parseKanbanArch(arch);
ok(!parsed.error, "arch kanban compilée sans erreur");
ok(parsed.templateName === "pwa_offline.KanbanRenderer", "nom de template renderer");
const reParsed = new dom.window.DOMParser().parseFromString(parsed.templateXml, "text/xml");
ok(!reParsed.querySelector("parsererror"), "template OWL produit = XML bien formé");
ok(parsed.templateXml.includes('t-esc="record.name.value"'), "<field name> réécrit en t-esc record.x.value");
ok(parsed.templateXml.includes('src="assets/default-app.png"'), "img t-att-src -> placeholder hors ligne");
ok(parsed.templateXml.includes("t-on-click"), "gestion du clic de carte présente");

// --- 2. Montage OWL réel ---
const target = document.createElement("div");
document.body.appendChild(target);
let clicked = null;
const { destroy } = await mountKanbanView(target, arch, fieldsInfo, records, (id) => { clicked = id; });

const cards = target.querySelectorAll(".o_kanban_record");
ok(cards.length === 2, `2 cartes OWL rendues (${cards.length})`);
ok(cards[0].querySelector(".o_kanban_record_title")?.textContent === "Devis A", "t-esc via <field> (record.name.value)");
ok(target.textContent.includes("1500"), "t-set + t-esc (scope local)");
ok(target.textContent.includes("Mitchell Admin"), "t-out (record.user_id.value)");
ok(target.textContent.includes("Pas d'activité"), "branche t-else (record 1)");
ok(!!target.querySelector("i.status_today"), "t-attf-class interpolé (record 2)");
const img = target.querySelector("img");
ok(img && img.getAttribute("src") === "assets/default-app.png", "placeholder image appliqué au DOM");

// --- 3. Clic de carte ---
cards[1].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
await new Promise((r) => setTimeout(r, 20));
ok(clicked === 2, "clic de carte -> onCardClick(2)");

// --- 4. Destroy ---
destroy();
ok(target.children.length === 0, "destroy() -> DOM OWL démonté");

// --- 5. Arch invalide -> dégradation propre ---
const bad = await mountKanbanView(document.body, "<kanban><templates/></kanban>", {}, [], () => {});
ok(typeof bad.destroy === "function", "arch sans template kanban-box -> fallback propre");
document.querySelectorAll(".o_kanban_view").forEach((el) => el.remove());

console.log("\n✅ TOUS LES TESTS PASSENT");