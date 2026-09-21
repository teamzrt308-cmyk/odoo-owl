/**
 * views/kanban/kanban_arch_parser.js
 * ==================================
 * Compilation de l'arch XML d'une vue kanban en TEMPLATE OWL -- la même
 * responsabilité que kanban_arch_parser.js chez Odoo, dont le vrai
 * webclient compile les templates de l'arch (t-name="kanban-box") en
 * templates QWeb/OWL consommés par KanbanRecord/KanbanRenderer.
 *
 * Ici la compilation est faite à chaud (runtime) : les directives du
 * template kanban (t-if, t-esc, t-out, t-att-class, t-attf-class,
 * t-set...) sont des directives QWeb NATIVES d'OWL -- elles sont
 * conservées telles quelles ; seuls les nœuds spécifiques au moteur
 * hors ligne sont réécrits :
 *   - <field name="x"/>            ->  <t t-esc="record.x.value"/>
 *   - <img t-att-src="..."/>       ->  <img src="assets/default-app.png"/>
 *     (placeholder d'image hors ligne, comme l'ancien moteur)
 *
 * Chaque carte est rendue avec `record` en scope (proxy
 * { raw_value, value } par champ, construit par kanban_renderer.js),
 * exactement comme dans l'ancien moteur et comme chez Odoo.
 *
 * DIFFÉRENCE ASSUMÉE avec l'ancien kanban_compiler.js : les expressions
 * ne sont plus traduites Python->JS avant évaluation. Les arch kanban
 * Odoo sont écrites pour le QWeb JS (opérateurs &&/||/!), elles sont
 * donc évaluables nativement par OWL -- la couche de traduction ne
 * servait que pour des archs non standards.
 */

const RENDERER_TEMPLATE_NAME = "pwa_offline.KanbanRenderer";
const KANBAN_IMAGE_PLACEHOLDER = "assets/default-app.png";

/**
 * Sérialise en texte template OWL les enfants transformés du template
 * kanban-box. On passe par un clone transformé + XMLSerializer plutôt
 * que par une concaténation manuelle : l'arch source est du XML
 * bien-formé, la sortie le reste donc quoi qu'il arrive (attributs
 * échappés, balises auto-fermées...).
 */
function compileCardTemplate(templateNode, doc) {
  const clone = templateNode.cloneNode(true);

  // <field name="x"/> -> <t t-esc="record.x.value"/> (les attributs t-if
  // éventuels du champ sont conservés -- OWL les gère nativement).
  // Images dynamiques STATIQUES -> placeholder hors ligne (comportement
  // historique). Passe AVANT la transform des champs : le widget image
  // recrée ensuite des <img t-att-src> dynamiques qu'il faut laisser.

  clone.querySelectorAll("img[t-att-src]").forEach((img) => {
    img.setAttribute("src", KANBAN_IMAGE_PLACEHOLDER);
    img.removeAttribute("t-att-src");
  });

  // NOTE : cette passe tourne APRÈS la passe des <img> statiques
  // (sinon elle recréerait des t-att-src que celle-ci écraserait).
  clone.querySelectorAll("field").forEach((fieldNode) => {
    const fieldName = fieldNode.getAttribute("name");
    let replacement;
    if (fieldNode.getAttribute("widget") === "image") {
      // Widget image : la valeur base64 du cache local devient une vraie
      // image de carte (placeholder si vide) -- comme le widget image Odoo.
      replacement = doc.createElement("img");
      replacement.setAttribute("class", "o_kanban_image_inner_pic");
      replacement.setAttribute("alt", fieldName);
      replacement.setAttribute(
        "t-att-src",
        `record.${fieldName}.raw_value ? 'data:image/png;base64,' + record.${fieldName}.raw_value : '${KANBAN_IMAGE_PLACEHOLDER}'`
      );
    } else {
      replacement = doc.createElement("t");
      replacement.setAttribute("t-esc", `record.${fieldName}.value`);
    }
    for (const attr of Array.from(fieldNode.attributes)) {
      if (attr.name.startsWith("t-")) {
        replacement.setAttribute(attr.name, attr.value);
      }
    }
    fieldNode.replaceWith(replacement);
  });

  const serializer = new XMLSerializer();
  let inner = "";
  for (const child of Array.from(clone.childNodes)) {
    inner += serializer.serializeToString(child);
  }
  return inner;
}

/**
 * Enveloppe le contenu compilé d'une carte dans le template complet du
 * renderer : TROIS branches (comme KanbanRenderer natif) --
 *  - groupé (props.groupBy + props.columns) : colonnes verticales avec
 *    en-tête (libellé + compteur) et cartes du groupe ;
 *  - vide : message « Aucun enregistrement. » ;
 *  - à plat : grille de cartes (comportement historique).
 * Le clic de carte reproduit le oe_kanban_global_click d'Odoo.
 */
function buildRendererTemplate(cardInner) {
  return `
<t t-name="${RENDERER_TEMPLATE_NAME}">
  <div class="o_kanban_view" t-ref="root">
    <div t-if="props.groupBy and props.columns and props.columns.length > 0" class="o_kanban_renderer o_kanban_grouped d-flex gap-3 p-3 overflow-auto">
      <div t-foreach="props.columns" t-as="column" t-key="column.key"
           t-att-class="'o_kanban_group' + (state.dragOverColumn === column.key ? ' o_kanban_drag_over' : '')"
           style="min-width: 320px; width: 320px; flex-shrink: 0;"
           t-on-dragover.prevent="(ev) => this.onColumnDragOver(ev, column.key)"
           t-on-drop.prevent="(ev) => this.onColumnDrop(ev, column.key)"
           t-on-dragend="() => this.onRecordDragEnd()">
        <div class="o_kanban_header d-flex align-items-center gap-2 py-2">
          <span class="o_kanban_group_title fw-bold" t-esc="column.label"/>
          <span class="o_kanban_count badge text-bg-secondary" t-esc="column.records.length"/>
        </div>
        <div class="o_kanban_group_records d-flex flex-column gap-2">
          <div t-if="column.records.length === 0" class="text-muted small">Aucune carte.</div>
          <div t-else="" t-foreach="column.records" t-as="record"
               t-key="record.id.raw_value != null ? record.id.raw_value : record_index"
               class="o_kanban_record" style="cursor:pointer;"
               t-att-draggable="props.canDrag ? 'true' : 'false'"
               t-on-click="() => props.onCardClick(record.id.raw_value)"
               t-on-dragstart="(ev) => this.onRecordDragStart(ev, record.id.raw_value)">
            ${cardInner}
          </div>
        </div>
        <div t-if="props.onQuickCreate" class="o_kanban_quick_add text-muted small mt-1" role="button"
             t-on-click="() => this.openQuickCreate(column.key)">+ Créer</div>
        <div t-if="state.quickCreateColumn === column.key" class="o_kanban_quick_create mt-1" t-on-click.stop="">
          <input type="text" class="form-control form-control-sm o_quick_create_input"
                 placeholder="Ajouter une carte..." t-on-keydown="(ev) => this.onQuickCreateKeydown(ev, column.key)"
                 t-on-blur="() => this.closeQuickCreate()"/>
        </div>
      </div>
    </div>
    <div t-elif="props.records.length === 0" class="o_kanban_renderer o_kanban_no_records text-muted p-4 text-center">Aucun enregistrement.</div>
    <div t-else="" class="o_kanban_renderer o_kanban_ungrouped d-flex flex-wrap gap-3 p-3">
      <div t-foreach="props.records" t-as="record"
           t-key="record.id.raw_value != null ? record.id.raw_value : record_index"
           class="o_kanban_record" style="width:300px;cursor:pointer;"
           t-on-click="() => props.onCardClick(record.id.raw_value)">
        ${cardInner}
      </div>
    </div>
  </div>
</t>`;
}

/**
 * @param {string} archXml - l'arch XML brute de la vue kanban
 * @returns {{ templateName: string, templateXml: string } | { error: string }}
 */
export function parseKanbanArch(archXml) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(archXml, "text/xml");

  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    return { error: "Erreur de parsing XML : " + parseError.textContent };
  }

  const kanbanRoot = doc.querySelector("kanban");
  const templateNode = doc.querySelector('templates > t[t-name="kanban-box"]');
  if (!kanbanRoot || !templateNode) {
    return { error: "Arch kanban invalide : élément <kanban> ou <t t-name=\"kanban-box\"> introuvable." };
  }

  const cardInner = compileCardTemplate(templateNode, doc);
  // Sous-templates (<t t-name="kanban-menu">, "SalesTeamDashboardGraph"…)
  // : les archs Odoo 17 réelles en contiennent et les cartes les
  // référencent via <t t-call="..."/> -- ils doivent être enregistrés
  // comme templates OWL à part entière sous peine de « Missing
  // template » au mount (chacun est une entrée de la map templates).
  const subTemplates = {};
  for (const t of doc.querySelectorAll("templates > t[t-name]")) {
    const name = t.getAttribute("t-name");
    if (!name || name === "kanban-box") continue;
    subTemplates[name] = `<t t-name="${name}">${compileCardTemplate(t, doc)}</t>`;
  }
  return {
    templateName: RENDERER_TEMPLATE_NAME,
    templateXml: buildRendererTemplate(cardInner),
    subTemplates,
    // group by par défaut de l'arch (default_group_by, comme le natif)
    // + champs déclarés dans l'arch (racine ET template -- les archs
    // kanban Odoo déclarent aux deux endroits), dédupliqués.
    defaultGroupBy: kanbanRoot.getAttribute("default_group_by") || null,
    fields: [...new Set(
      Array.from(kanbanRoot.querySelectorAll("field"))
        .map((f) => f.getAttribute("name"))
        .filter(Boolean)
    )],
  };
}
