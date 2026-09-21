/**
 * audit-manifest.mjs — audit d'un export réel de `module_manifests`
 * (table Dexie `offline_sync_db_module_manifests.json`) contre le
 * moteur : parse des archs (liste / kanban / form) puis, avec
 * --mount, MONTAGE RUNTIME de chaque vue avec des enregistrements
 * factices (le parcours complet subit par les vraies archs Odoo 17).
 *
 * Usage : node audit-manifest.mjs [--mount] [export.json]
 * Affiche les archs qui cassent, les widgets utilisés et les menus
 * orphelins (modèles sans vues). Aucun réseau ; DOM jsdom embarqué.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");

// Stub Dexie : au montage, les widgets many2one consultent
// reference_records/record_cache via db.* -> tables vides mais présentes.
class StubTable {
  constructor() { this.rows = []; }
  put(r) { this.rows.push(r); return r; }
  async get() { return null; }
  where() { return { equals: () => ({ toArray: async () => [], first: async () => null }), anyOf: () => ({ toArray: async () => [] }) }; }
  toArray() { return Promise.resolve(this.rows); }
}
class StubDexie {
  constructor() {
    for (const t of ["reference_records", "record_cache", "catalog_cache", "list_cache", "sync_queue", "module_manifests", "security_info", "installed_apps", "local_ledger"]) {
      this[t] = new StubTable();
    }
  }
  version() { return { stores() {} }; }
  transaction() {}
}
globalThis.Dexie = StubDexie;
const { JSDOM } = await import("jsdom");
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://pwa.test/", runScripts: "outside-only", pretendToBeVisual: true });
const vm = await import("node:vm");
vm.runInContext(readFileSync(join(REPO, "static/lib/owl.iife.js"), "utf8"), dom.getInternalVMContext());
globalThis.owl = dom.window.owl;
globalThis.window = dom.window; globalThis.document = dom.window.document;
globalThis.Node = dom.window.Node; globalThis.Element = dom.window.Element;
globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer;
globalThis.MutationObserver = dom.window.MutationObserver;
globalThis.location = dom.window.location;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });

const { parseListArch } = await import(join(REPO, "static/src/views/list/list_arch_parser.js"));
const { parseKanbanArch } = await import(join(REPO, "static/src/views/kanban/kanban_arch_parser.js"));
const { parseFormViewArch, buildFormTemplate } = await import(join(REPO, "static/src/views/form/form_arch_parser.js"));
const { parseSearchArch } = await import(join(REPO, "static/src/search/search_arch_parser.js"));
const doMount = process.argv.includes("--mount");
let mountListView = null, mountKanbanView = null, mountFormRenderer = null;
if (doMount) {
  ({ mountListView } = await import(join(REPO, "static/src/views/list/list_renderer.js")));
  ({ mountKanbanView } = await import(join(REPO, "static/src/views/kanban/kanban_renderer.js")));
  ({ mountFormRenderer } = await import(join(REPO, "static/src/views/form/form_renderer.js")));
}

const tick = () => new Promise((r) => setTimeout(r, 0));
function fakeRecord(fields) {
  const rec = { id: 1 };
  for (const [n, fd] of Object.entries(fields || {})) {
    switch (fd.type) {
      case "char": rec[n] = "TEST"; break;
      case "text": rec[n] = "Texte"; break;
      case "integer": rec[n] = 1; break;
      case "float": case "monetary": rec[n] = 10.5; break;
      case "boolean": rec[n] = false; break;
      case "selection": rec[n] = Array.isArray(fd.selection) && fd.selection.length ? fd.selection[0][0] : false; break;
      case "date": rec[n] = "2026-01-21"; break;
      case "datetime": rec[n] = "2026-01-21 10:00:00"; break;
      case "many2one": rec[n] = [1, "Réf"]; break;
      default: rec[n] = false;
    }
  }
  return rec;
}
async function mountView(vtype, arch, fi, model) {
  const target = document.createElement("div");
  document.body.appendChild(target);
  try {
    if (vtype === "list") {
      await mountListView(target, arch, fi, [fakeRecord(fi)], () => {}, model, null);
      const rows = target.querySelectorAll(".o_data_row").length + target.querySelectorAll("td").length;
      return rows > 0 ? "ok" : "vide";
    }
    if (vtype === "kanban") {
      await mountKanbanView(target, arch, fi, [fakeRecord(fi)], () => {}, null, {});
      await tick();
      const cards = target.querySelectorAll(".o_kanban_record, .oe_kanban_card, .o_kanban_group").length;
      return cards > 0 ? "ok" : "vide";
    }
    const h = await mountFormRenderer(target, arch, fi, fakeRecord(fi), null, null);
    if (h && h.ready) await Promise.race([h.ready, new Promise((r) => setTimeout(r, 3000))]);
    await tick();
    const inputs = target.querySelectorAll("input, select, textarea, .o_owl_mount, button").length;
    return inputs > 0 ? "ok" : "vide";
  } finally {
    target.remove();
    await tick();
  }
}

const file = process.argv.slice(2).filter((a) => !a.startsWith("-")).pop() || "offline_sync_db_module_manifests.json";
const data = JSON.parse(readFileSync(file, "utf8"));
const mods = Array.isArray(data) ? data : [data];

let okL=0, okK=0, okF=0, okM=0, errL=[], errK=[], errF=[], errM=[];
const widgets = new Set(), viewTypes = new Set(), searchArchs = 0, orphanMenus = [];
const WIDGET_RE = /widget="([^"]+)"/g;

for (const mod of mods) {
  console.log(`\n══ module ${mod.technical_name} (${(mod.models||[]).length} modèles, ${(mod.menus||[]).length} menus)`);
  for (const [model, mv] of Object.entries(mod.views || {})) {
    const buckets = ["default", ...(mv.by_action ? Object.keys(mv.by_action) : [])];
    for (const bucket of buckets) {
      const views = bucket === "default" ? (mv.default || mv) : mv.by_action[bucket];
      if (!views || typeof views !== "object") continue;
      for (const [vtype, v] of Object.entries(views)) {
        viewTypes.add(vtype);
        const arch = v && v.arch;
        if (!arch || typeof arch !== "string") { if (v) console.log(`  ⚠ ${model}@${bucket}/${vtype}: PAS D'ARCH`); continue; }
        if (vtype === "search") searchArchs++;
        const fi = (mod.fields || {})[model] || {};
        if (doMount && ["list", "kanban", "form"].includes(vtype)) {
          try {
            const res = await mountView(vtype, arch, fi, model);
            if (res === "ok") okM++; else { errM.push(`${model}/${vtype}@${bucket}: rendu ${res}`); }
          } catch (e) { errM.push(`${model}/${vtype}@${bucket}: ${String(e.message || e).slice(0, 120)}`); }
        }
        if (vtype === "list") { try { parseListArch(arch, fi); okL++; } catch (e) { errL.push(`${model}@${bucket}: ${e.message}`); } }
        else if (vtype === "kanban") { try { parseKanbanArch(arch, fi); okK++; } catch (e) { errK.push(`${model}@${bucket}: ${e.message}`); } }
        else if (vtype === "form") {
          try {
            const pf = parseFormViewArch(arch);
            buildFormTemplate(pf.formRoot, { fieldsInfo: fi });
            okF++;
          } catch (e) { errF.push(`${model}@${bucket}: ${e.message}`); }
        }
        let m2; WIDGET_RE.lastIndex = 0;
        while ((m2 = WIDGET_RE.exec(arch))) widgets.add(`${vtype}:${m2[1]}`);
      }
    }
  }
  for (const menu of mod.menus || []) {
    if (menu.model && !(mod.views || {})[menu.model]) orphanMenus.push(`${mod.technical_name}: « ${menu.name} » -> ${menu.model} (action ${menu.action_id}) SANS VUES`);
  }
}

if (doMount) {
  console.log(`\n══ MONTAGE list/kanban/form : ${okM} ok / ${errM.length} err`);
  errM.slice(0, 12).forEach((e) => console.log("   ✗ M", e));
}
console.log(`\n══ PARSE list=${okL} ok / ${errL.length} err`);
errL.slice(0, 10).forEach((e) => console.log("   ✗ L", e));
console.log(`══ PARSE kanban=${okK} ok / ${errK.length} err`);
errK.slice(0, 10).forEach((e) => console.log("   ✗ K", e));
console.log(`══ PARSE form=${okF} ok / ${errF.length} err`);
errF.slice(0, 10).forEach((e) => console.log("   ✗ F", e));
console.log(`══ types de vues vus: ${[...viewTypes].sort().join(", ")} | archs <search>: ${searchArchs}`);
console.log(`══ widgets utilisés:\n     ${[...widgets].sort().join("\n     ")}`);
if (orphanMenus.length) {
  console.log(`══ menus orphelins (${orphanMenus.length}) — modèle sans vues dans le manifest :`);
  orphanMenus.slice(0, 15).forEach((e) => console.log("   ⚠", e));
  if (orphanMenus.length > 15) console.log(`   … +${orphanMenus.length - 15}`);
}
