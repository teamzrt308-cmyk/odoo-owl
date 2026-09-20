/**
 * Test de fumée de la restructuration (phase 1 & 2) :
 *  - registre "views" + dispatcher view.js
 *  - form_arch_parser (responsabilité parser/renderer)
 *  - webclient/breadcrumb extrait du control panel
 *  - widget statusbar déplacé dans views/fields/statusbar/
 *  - dynamic_field_attrs déplacé dans views/form/
 *  - notebook sans dépendance inverse (callback injecté)
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
globalThis.Dexie = class { version() { return { stores() {} }; } transaction() {} };
globalThis.localStorage = dom.window.localStorage;

// --- 1. Registre "views" + dispatcher ---
const { registry } = await import(REPO + "/static/src/core/registry.js");
await import(REPO + "/static/src/views/view.js");
const views = registry.category("views");
ok(views.contains("form") && views.contains("list") && views.contains("kanban"),
   'registry.category("views") : form/list/kanban enregistrés');
const actions = registry.category("actions");
ok(actions.contains("list_view") && actions.contains("form_view") && actions.contains("ir.actions.act_window"),
   "compatibilité tags actions conservée");

// --- 2. form_arch_parser ---
const { parseFormViewArch } = await import(REPO + "/static/src/views/form/form_arch_parser.js");
const goodArch = '<form><sheet><group><field name="name"/></group></sheet></form>';
const parsed = parseFormViewArch(goodArch);
ok(!parsed.error && parsed.formRoot.tagName === "form", "parseFormViewArch : arch valide -> formRoot");
const badParsed = parseFormViewArch("<not-a-form><x/></not-a-form>");
ok(!!badParsed.error, "parseFormViewArch : sans <form> -> erreur explicite");

// --- 3. Control panel + breadcrumb OWL (itération 7) ---
const cpModule = await import(REPO + "/static/src/search/control_panel/control_panel.js");
const bcModule = await import(REPO + "/static/src/webclient/breadcrumb/breadcrumb.js");
ok(cpModule.ControlPanel && cpModule.ControlPanel.name === "ControlPanel", "control panel -> composant OWL ControlPanel");
ok(bcModule.Breadcrumb && bcModule.Breadcrumb.name === "Breadcrumb", "webclient/breadcrumb -> composant OWL Breadcrumb");
ok(cpModule.ControlPanel.components && cpModule.ControlPanel.components.Breadcrumb === bcModule.Breadcrumb,
   "ControlPanel embarque Breadcrumb (static components)");
// Le comportement réel (save/undo, engrenage, pager, switcher) est
// couvert de bout en bout par test-controller-owl / test-list-controller-owl.

// --- 4. Widget statusbar OWL (views/fields/statusbar/) ---
// Composant OWL monté via le field bridge : ordre NATUREL des étapes
// (alignement Odoo 17 -- l'ancien rendu DOM les inversait), filtre
// statusbar_visible conservé, valeur courante toujours affichée.
const { renderStatusbarField } = await import(REPO + "/static/src/views/fields/statusbar/statusbar.js");
const sbNode = new dom.window.DOMParser().parseFromString(
  '<field name="state" widget="statusbar" statusbar_visible="draft,sent"/>', "text/xml"
).documentElement;
const sbInfo = { selection: [["draft", "Brouillon"], ["sent", "Envoyée"], ["done", "Terminée"]] };
const sbSpan = renderStatusbarField("state", sbInfo, sbNode, "sent");
ok(sbSpan.classList.contains("o_field_statusbar_mount") && sbSpan._owlReady, "statusbar : span field bridge + _owlReady");
// Le mount OWL attend la connexion au DOM (waitUntilConnected) : insérer avant l'attente.
document.body.appendChild(sbSpan);
await sbSpan._owlReady;
const sb = sbSpan.querySelector(".o_field_statusbar");
ok(!!sb && sb.classList.contains("o_field_widget") && sb.classList.contains("o_readonly_modifier"),
   "statusbar : wrapper o_field_widget o_readonly_modifier o_field_statusbar");
const sbButtons = [...sb.querySelectorAll(".o_arrow_button")];
const labels = sbButtons.map((b) => b.textContent);
ok(labels.join(",") === "Brouillon,Envoyée", `ordre naturel + filtre statusbar_visible (${labels.join(" | ")})`);
ok(sb.querySelector(".o_arrow_button_current")?.textContent === "Envoyée", "étape courante marquée");
ok(sbButtons[0].classList.contains("o_first") && sbButtons[sbButtons.length - 1].classList.contains("o_last"),
   "statusbar : o_first/o_last sur la liste VISIBLE");
ok(sbButtons.every((b) => b.disabled), "statusbar : étapes désactivées (lecture seule)");
ok(sb.querySelector('[data-value="sent"]')?.getAttribute("aria-checked") === "true", "statusbar : aria-checked sur l'étape courante");
// Sans valeur courante : la première étape est active (comportement historique)
const sbSpan2 = renderStatusbarField("state2", sbInfo, sbNode, undefined);
document.body.appendChild(sbSpan2);
await sbSpan2._owlReady;
ok(sbSpan2.querySelector(".o_arrow_button_current")?.textContent === "Brouillon", "statusbar : sans valeur -> 1re étape active");

// --- 5. dynamic_field_attrs (views/form/) ---
const { applyDynamicAttrs, markReadonly, resetDynamicAttrs, attachLiveBusinessRules } =
  await import(REPO + "/static/src/views/form/dynamic_field_attrs.js");
const input = document.createElement("input");
const fnode = new dom.window.DOMParser().parseFromString(
  '<field name="name" readonly="state == \'done\'"/>', "text/xml"
).documentElement;
applyDynamicAttrs(fnode, input, { state: "draft" });
ok(!input.readOnly, "attrs dynamiques : readonly=false si condition fausse");
applyDynamicAttrs(fnode, input, { state: "done" });
ok(input.readOnly, "attrs dynamiques : readonly appliqué si condition vraie");
resetDynamicAttrs(input, false);
ok(!input.readOnly, "resetDynamicAttrs : readonly retiré");

// attachLiveBusinessRules : ré-évaluation live sur un mini formulaire
const formEl = document.createElement("div");
formEl.innerHTML = `
  <div data-field-row="name"><div class="o_field_widget"><input id="field-name"></div></div>
  <div data-field-row="state"><div class="o_field_widget"><select id="field-state">
    <option value="draft">draft</option><option value="done">done</option>
  </select></div></div>`;
const archLive = `<form><field name="name" readonly="state == 'done'"/><field name="state"/></form>`;
const fieldsInfoLive = {
  name: { type: "char", label: "Nom" },
  state: { type: "selection", label: "État" },
};
const cleanupRules = attachLiveBusinessRules(archLive, formEl, fieldsInfoLive);
ok(typeof cleanupRules === "function", "attachLiveBusinessRules branché");
formEl.querySelector("#field-state").value = "done";
formEl.querySelector("#field-state").dispatchEvent(new dom.window.Event("change", { bubbles: true }));
const nameInput = formEl.querySelector("#field-name");
ok(nameInput.disabled, "ré-évaluation live : name verrouillé quand state=done");
formEl.querySelector("#field-state").value = "draft";
formEl.querySelector("#field-state").dispatchEvent(new dom.window.Event("change", { bubbles: true }));
ok(!nameInput.disabled, "ré-évaluation live : name déverrouillé quand state=draft");
cleanupRules();

// --- 6. Notebook : compilé dans le template form (form_arch_parser) ---
// Le notebook vanilla (core/notebook/) est supprimé : depuis l'itération 4,
// le renderer form est un composant OWL dont le template (compilé depuis
// l'arch) emporte les onglets ; la réactivité vit dans FormRenderer.state.
const { buildFormTemplate } = await import(REPO + "/static/src/views/form/form_arch_parser.js");
const nbRoot = new dom.window.DOMParser().parseFromString(
  `<form><notebook><page string="Onglet 1"><field name="a"/></page><page string="Onglet 2"><field name="b"/></page></notebook></form>`,
  "text/xml"
).documentElement;
const nbTpl = buildFormTemplate(nbRoot, {
  fieldsInfo: { a: { type: "char", label: "A" }, b: { type: "char", label: "B" } },
  initialValues: {}, hasRecordId: false,
});
ok(nbTpl.templateXml.includes('class="o_notebook"'), "buildFormTemplate : wrapper o_notebook");
ok((nbTpl.templateXml.match(/nav-link/g) || []).length === 2, "buildFormTemplate : 2 onglets émis");
ok(nbTpl.templateXml.includes("state.activePage === 1"), "buildFormTemplate : onglets réactifs (state.activePage)");
ok(nbTpl.fieldSlots.length === 2, "buildFormTemplate : chaque page emporte ses emplacements de champs");

console.log("\n✅ TOUS LES TESTS STRUCTURE PASSENT");