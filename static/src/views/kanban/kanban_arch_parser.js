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
  clone.querySelectorAll("field").forEach((fieldNode) => {
    const fieldName = fieldNode.getAttribute("name");
    const replacement = doc.createElement("t");
    replacement.setAttribute("t-esc", `record.${fieldName}.value`);
    for (const attr of Array.from(fieldNode.attributes)) {
      if (attr.name.startsWith("t-")) {
        replacement.setAttribute(attr.name, attr.value);
      }
    }
    fieldNode.replaceWith(replacement);
  });

  // Images dynamiques -> placeholder hors ligne (comportement historique).
  clone.querySelectorAll("img[t-att-src]").forEach((img) => {
    img.setAttribute("src", KANBAN_IMAGE_PLACEHOLDER);
    img.removeAttribute("t-att-src");
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
 * renderer : grille + boucle sur les records + gestion du clic de carte
 * (l'équivalent du oe_kanban_global_click d'Odoo, qui dans l'ancien
 * moteur était posé par le renderer lui-même).
 */
function buildRendererTemplate(cardInner) {
  return `
<t t-name="${RENDERER_TEMPLATE_NAME}">
  <div class="o_kanban_view o_kanban_ungrouped">
    <div t-if="props.records.length === 0" class="o_kanban_renderer o_kanban_no_records text-muted p-4 text-center">Aucun enregistrement.</div>
    <div t-else="" class="o_kanban_renderer o_kanban_grouped d-flex flex-wrap gap-3 p-3">
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
  return {
    templateName: RENDERER_TEMPLATE_NAME,
    templateXml: buildRendererTemplate(cardInner),
  };
}
