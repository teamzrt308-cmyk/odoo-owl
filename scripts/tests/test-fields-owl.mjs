/**
 * Test de fumée jsdom des widgets de champ OWL (owl/field_bridge.js) :
 * montage réel de owl.iife.js, rendu de chaque widget, intégration avec
 * le sérialiseur du formulaire (getElementValue), attrs dynamiques.
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

const { renderCharField } = await import(REPO + "/static/src/views/fields/char/char_field.js");
const { renderTextField } = await import(REPO + "/static/src/views/fields/text/text_field.js");
const { renderIntegerField } = await import(REPO + "/static/src/views/fields/integer/integer_field.js");
const { renderFloatField } = await import(REPO + "/static/src/views/fields/float/float_field.js");
const { renderBooleanField } = await import(REPO + "/static/src/views/fields/boolean/boolean_field.js");
const { renderSelectionField } = await import(REPO + "/static/src/views/fields/selection/selection_field.js");
const { renderDateField } = await import(REPO + "/static/src/views/fields/date/date_field.js");
const { renderDatetimeField } = await import(REPO + "/static/src/views/fields/datetime/datetime_field.js");
const { renderMonetaryField } = await import(REPO + "/static/src/views/fields/monetary/monetary_field.js");
const { getElementValue } = await import(REPO + "/static/src/views/form/form_serializer.js");

// Montage helper : renderOwlField retourne le conteneur sync, OWL monte async.
async function mount(widgetEl) {
  document.body.appendChild(widgetEl);
  for (let i = 0; i < 100; i++) {
    const input = widgetEl.querySelector("input, textarea, select");
    if (input) return input;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("mount OWL du champ introuvable (timeout)");
}

// --- char ---
const charInfo = { type: "char", label: "Nom" };
const charNode = new dom.window.DOMParser().parseFromString('<field name="name" placeholder="Nom du client"/>', "text/xml").documentElement;
const charInput = await mount(renderCharField("name", charInfo, charNode, "Alice"));
ok(charInput.tagName === "INPUT" && charInput.type === "text", "char : <input type=text>");
ok(charInput.value === "Alice", "char : valeur initiale");
ok(charInput.placeholder === "Nom du client", "char : placeholder depuis l'arch");
ok(charInput.id === "field-name", "char : id field-<name> (sérialiseur)");

// --- text ---
const textInfo = { type: "text", label: "Note" };
const ta = await mount(renderTextField("note", textInfo, null, "Ligne 1\nLigne 2"));
ok(ta.tagName === "TEXTAREA", "text : <textarea>");
ok(ta.value === "Ligne 1\nLigne 2", "text : contenu initial");
ok(!ta.required, "text : node null -> pas de required");

// --- integer ---
const intInput = await mount(renderIntegerField("qty", { type: "integer", label: "Qté" }, null, 42));
ok(intInput.type === "number" && intInput.step === "1", "integer : type=number step=1");
ok(intInput.value === "42", "integer : valeur");
ok(getElementValue(intInput, { type: "integer" }) === 42, "integer : getElementValue -> 42 (nombre)");

// integer false -> vide
const intEmpty = await mount(renderIntegerField("qty2", { type: "integer" }, null, false));
ok(intEmpty.value === "", "integer : false -> champ vide");

// --- float ---
const floatInput = await mount(renderFloatField("rate", { type: "float" }, null, 3.14));
ok(floatInput.type === "number" && floatInput.step === "any", "float : step=any");
ok(floatInput.value === "3.14", "float : valeur décimale");
ok(getElementValue(floatInput, { type: "float" }) === 3.14, "float : getElementValue -> 3.14");

// --- boolean ---
const boolInput = await mount(renderBooleanField("active", { type: "boolean" }, null, true));
ok(boolInput.type === "checkbox", "boolean : <input type=checkbox>");
ok(boolInput.checked === true, "boolean : coché");
ok(getElementValue(boolInput, { type: "boolean" }) === true, "boolean : getElementValue -> true");
boolInput.checked = false;
ok(getElementValue(boolInput, { type: "boolean" }) === false, "boolean : décoché -> false");

// --- selection ---
const selInfo = { type: "selection", label: "État", required: true, selection: [["draft", "Brouillon"], ["sent", "Envoyée"]] };
const selNode = new dom.window.DOMParser().parseFromString('<field name="state"/>', "text/xml").documentElement;
const selInput = await mount(renderSelectionField("state", selInfo, selNode, "sent"));
ok(selInput.tagName === "SELECT", "selection : <select>");
ok(selInput.required === true, "selection : required statique (info.required, cf. field_bridge)");
const opts = [...selInput.querySelectorAll("option")];
ok(opts.length === 3, "selection : option vide + 2 options");
ok(selInput.value === "sent", "selection : valeur sélectionnée");
ok(getElementValue(selInput, { type: "selection" }) === "sent", "selection : getElementValue -> 'sent'");

// --- date ---
const dateInput = await mount(renderDateField("date_order", { type: "date" }, null, "2026-09-18"));
ok(dateInput.type === "date" && dateInput.value === "2026-09-18", "date : type=date + ISO");

// --- datetime ---
const dtInput = await mount(renderDatetimeField("create_date", { type: "datetime" }, null, "2026-09-18T10:30"));
ok(dtInput.type === "datetime-local" && dtInput.value === "2026-09-18T10:30", "datetime : type=datetime-local");

// --- monetary ---
const monInput = await mount(renderMonetaryField("amount_total", { type: "monetary" }, null, 1500));
ok(monInput.readOnly === true, "monetary : lecture seule");
ok(monInput.value === "1500.00", "monetary : formaté à 2 décimales");

// --- attrs dynamiques (readonly/required expression) ---
const dynNode = new dom.window.DOMParser().parseFromString(
  `<field name="locked_field" readonly="state == 'done'" required="state != 'done'"/>`, "text/xml"
).documentElement;
const lockedInfo = { type: "char", label: "Verrouillé" };
const roInput = await mount(renderCharField("locked_field", lockedInfo, dynNode, "X", { state: "done" }));
ok(roInput.readOnly === true, "attrs dynamiques : readonly évalué au mount (state=done)");
ok(roInput.required === false, "attrs dynamiques : required=false quand state=done");

const roInput2 = await mount(renderCharField("locked_field", lockedInfo, dynNode, "X", { state: "draft" }));
ok(roInput2.readOnly === false && roInput2.required === true, "attrs dynamiques : required évalué au mount (state=draft)");

// --- conteneur du pont ---
const wrapper = document.querySelector('[data-owl-field="name"]');
ok(wrapper && wrapper.classList.contains("o_owl_mount") && wrapper.classList.contains("o_field_char_mount"),
   "field_bridge : conteneur o_owl_mount + data-owl-field");

document.body.innerHTML = "";
console.log("\n✅ TOUS LES TESTS CHAMP OWL PASSENT");