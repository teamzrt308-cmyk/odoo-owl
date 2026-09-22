/**
 * Test de fumée de la restructuration (phase 1 & 2) :
 *  - registre "views" + dispatcher view.js
 *  - form_arch_parser (responsabilité parser/renderer)
 *  - webclient/breadcrumb extrait du control panel
 *  - widget statusbar déplacé dans views/fields/statusbar/
 *  - attrs dynamiques réactifs via <FormField> (couche impérative supprimée)
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
// Composant OWL monté directement : ordre NATUREL des étapes
// (alignement Odoo 17 -- l'ancien rendu DOM les inversait), filtre
// statusbar_visible conservé, valeur courante toujours affichée.
const { StatusbarFieldOwl } = await import(REPO + "/static/src/views/fields/statusbar/statusbar.js");
// Montage direct du composant (itération 24 : plus de span de bridge) --
// props dérivées de l'arch : selection de fields_get, statusbar_visible.
async function mountStatusbar(props) {
  const host = document.createElement("span");
  document.body.appendChild(host);
  const app = new owl.App(StatusbarFieldOwl, { props });
  await app.mount(host);
  return host;
}
const sbInfo = { selection: [["draft", "Brouillon"], ["sent", "Envoyée"], ["done", "Terminée"]] };
const sbSpan = await mountStatusbar({ name: "state", selection: sbInfo.selection, visibleStates: ["draft", "sent"], initialValue: "sent" });
ok(!!sbSpan.querySelector(".o_field_statusbar"), "statusbar : composant OWL monté (<FormField> mode statusbar)");
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
const sbSpan2 = await mountStatusbar({ name: "state2", selection: sbInfo.selection, visibleStates: ["draft", "sent"] });
ok(sbSpan2.querySelector(".o_arrow_button_current")?.textContent === "Brouillon", "statusbar : sans valeur -> 1re étape active");

// --- 5. attrs dynamiques RÉACTIFS (<FormField>, itérations 23-24) ---
// L'ancienne couche impérative (applyDynamicAttrs/resetDynamicAttrs/
// attachLiveBusinessRules) est SUPPRIMÉE : readonly/required/invisible
// sont ré-évalués à chaque rendu du composant de champ sur le record
// réactif -- vérifié ici via le vrai mountFormRenderer.
const { mountFormRenderer } = await import(REPO + "/static/src/views/form/form_renderer.js");
const tick = () => new Promise((r) => setTimeout(r, 5));
const archLive = `<form><group><field name="name" readonly="state == 'done'"/><field name="state"/></group></form>`;
const fieldsInfoLive = {
  name: { type: "char", label: "Nom" },
  state: { type: "selection", label: "État", selection: [["draft", "Brouillon"], ["done", "Terminée"]] },
};
const dynHost = document.createElement("div");
document.body.appendChild(dynHost);
const { el: dynEl, ready: dynReady } = await mountFormRenderer(dynHost, archLive, fieldsInfoLive, { state: "draft" }, null, null);
await dynReady;
const nameInput = dynEl.querySelector("#field-name");
const stateSel = dynEl.querySelector("#field-state");
ok(nameInput && !nameInput.readOnly, "attrs réactifs : readonly=false si condition fausse");
stateSel.value = "done";
stateSel.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
let lockedOk = false;
for (let i = 0; i < 200 && !lockedOk; i++) {
  lockedOk = nameInput.readOnly === true;
  if (!lockedOk) await tick();
}
ok(lockedOk, "attrs réactifs : name verrouillé quand state=done (sans re-render)");
stateSel.value = "draft";
stateSel.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
let unlockedOk = false;
for (let i = 0; i < 200 && !unlockedOk; i++) {
  unlockedOk = nameInput.readOnly === false;
  if (!unlockedOk) await tick();
}
ok(unlockedOk, "attrs réactifs : name déverrouillé quand state=draft");

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