import { JSDOM } from "jsdom";
import fs from "node:fs"; import vm from "node:vm"; import path from "node:path";
const REPO = "/home/user/odoo-owl";
const dom = new JSDOM(`<!DOCTYPE html><html><body></body></html>`, { url: "https://pwa.test/", runScripts: "outside-only", pretendToBeVisual: true });
vm.runInContext(fs.readFileSync(path.join(REPO, "static/lib/owl.iife.js"), "utf8"), dom.getInternalVMContext());
for (const k of ["owl","document","window","Node","Element","DOMParser","XMLSerializer","MutationObserver","location","localStorage","sessionStorage"]) globalThis[k] = dom.window[k];
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
Object.defineProperty(dom.window.navigator, "onLine", { value: false, configurable: true });
Object.defineProperty(globalThis.navigator, "onLine", { value: false, configurable: true });
dom.window.alert = () => {};
class FakeTable { constructor(rows=[], keyFn=null){this.rows=rows;this.keyFn=keyFn;} async put(o){this.rows.push(o);} async bulkPut(){} async add(o){this.rows.push(o);return {id:1};} async update(){} async get(k){return this.keyFn ? (this.rows.find(r=>this.keyFn(r,k))||undefined) : undefined;} where(){return {equals:()=>({toArray:async()=>[],count:async()=>0}),toArray:async()=>[]};} }
class FakeDexie { constructor(){ for (const t of ["sync_queue","reference_records","cache_meta","catalog_cache","security_info","record_cache","installed_apps","local_ledger","list_cache"]) this[t]=new FakeTable(); this.module_manifests=new FakeTable([],(r,k)=>r.technical_name===k); } version(){return {stores(){}};} transaction(){} }
globalThis.Dexie = FakeDexie;
const { db } = await import(REPO + "/static/src/core/orm_service.js");
const fieldsInfo = { name: { type: "char", label: "Référence" }, state: { type: "selection", label: "État", selection: [["draft","Brouillon"],["done","Validé"]] } };
const searchArch = `<?xml version="1.0"?><search><filter name="filter_done" string="Validés" domain="[('state','=','done')]"/></search>`;
await db.module_manifests.put({ technical_name: "sales", fields: { "crm.lead": fieldsInfo }, views: { "crm.lead": { default: { list: { arch: `<list><field name="name"/><field name="state"/></list>` }, search: { arch: searchArch } } } } });
await db.list_cache.put({ model: "crm.lead::a1", records: [{id:1,name:"SO001",state:"draft"},{id:2,name:"SO002",state:"done"}], total: 2 });
const { initRulesEngine } = await import(REPO + "/static/src/model/rules_engine/rules_engine.js");
const { allRules } = await import(REPO + "/static/src/model/rules_engine/rules/index.js");
initRulesEngine(allRules);
const { mountView } = await import(REPO + "/static/src/views/view.js");
const c = document.createElement("div"); document.body.appendChild(c);
const d = await mountView(c, { view: "list", module: "sales", model: "crm.lead", actionId: "a1" }, { doAction(){}, goBack(){} });
for (let i=0;i<80;i++) await new Promise(r=>setTimeout(r,25));
console.log("STATUT:", JSON.stringify(c.querySelector(".px-3.py-1")?.textContent));
const btns = [...c.querySelectorAll("button")].map(b=>b.className.split(" ").filter(x=>x.startsWith("o_")).join("."));
console.log("filtres btn:", btns.some(x=>x.includes("o_filters_button")));
console.log("rows:", c.querySelectorAll(".o_data_row").length);
// toggle filtre
const fb = c.querySelector(".o_filters_button");
if (fb) { fb.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); await new Promise(r=>setTimeout(r,50));
  const item = c.querySelector(".o_filters_menu a.dropdown-item");
  console.log("menu items:", [...c.querySelectorAll(".o_filters_menu a.dropdown-item")].map(a=>a.textContent.trim()).join(" | "));
  item.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  for (let i=0;i<80;i++) { if (c.querySelectorAll(".o_data_row").length === 1) break; await new Promise(r=>setTimeout(r,25)); }
  console.log("rows après filtre:", c.querySelectorAll(".o_data_row").length);
  console.log("facette:", !!c.querySelector(".o_searchview_facet"), c.querySelector(".o_searchview_facet")?.textContent.trim());
}
d();
