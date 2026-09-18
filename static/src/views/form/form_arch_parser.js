/**
 * views/form/form_arch_parser.js
 * ==============================
 * Parsing + compilation de l'arch XML d'une vue formulaire -- mêmes
 * responsabilités que form_arch_parser.js chez Odoo 17 : transformer
 * l'arch brute en une structure exploitable par le renderer, SANS
 * générer le moindre DOM. Comme dans le webclient natif, le renderer
 * (form_renderer.js) reçoit un TEMPLATE compilé depuis l'arch.
 *
 * Spécificité hors ligne : les widgets de champ ne sont pas des tags
 * <Field> OWL dans le template (les composants de champ du moteur sont
 * montés par owl/field_bridge.js pour préserver le contrat DOM du
 * sérialiseur) -- le template n'emporte que des EMPLACEMENTS
 * (data-form-slot), remplis par FormRenderer après le mount.
 */

import { isNodeVisible, evaluateSimpleCondition } from "../../core/py_js/py_utils.js";
import { canRenderField } from "../fields/field.js";

const TEMPLATE_NAME = "form_view_compiled";

/**
 * @param {string} archXml - l'arch XML brute de la vue form
 * @returns {{ formRoot: Element } | { error: string }}
 */
export function parseFormViewArch(archXml) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(archXml, "text/xml");

  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    return { error: "Erreur de parsing XML : " + parseError.textContent };
  }

  const formRoot = doc.querySelector("form");
  if (!formRoot) {
    return { error: "Aucun élément <form> trouvé dans cette vue." };
  }

  return { formRoot };
}

// ---------------------------------------------------------------------------
// Compilation arch -> template OWL
// ---------------------------------------------------------------------------

function escapeXml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function getItemSpan(node) {
  const raw = node.getAttribute("colspan");
  const span = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(span) && span > 0 ? span : 1;
}

/**
 * Enregistre un emplacement de champ (monté impérativement par
 * FormRenderer après le render) et retourne son markup.
 * mode :
 *  - "cell"         : la cellule complète de renderField (label inclus),
 *  - "cell-nolabel" : la cellule sans son <label> (le template l'émet),
 *  - "widget"       : seuls les enfants du .o_field_widget (paire
 *                     <label for="..."> explicite, comme buildLabeledItem).
 */
function emitFieldSlot(node, ctx, mode) {
  const index = ctx.slots.length;
  ctx.slots.push({ index, kind: "field", node, mode, name: node.getAttribute("name") });
  return `<div class="o_form_field_slot" data-form-slot="${index}"></div>`;
}

function emitStandaloneLabel(node) {
  const forAttr = node.getAttribute("for");
  const stringAttr = node.getAttribute("string");
  const forPart = forAttr ? ` for="field-${escapeXml(forAttr)}"` : "";
  return `<label class="o_form_label"${forPart}>${escapeXml(stringAttr || forAttr || "")}</label>`;
}

function emitButtonBox(node, ctx) {
  if (!ctx.hasRecordId) return "";
  const buttons = Array.from(node.children)
    .filter((c) => c.tagName === "button")
    .map((btnNode) => {
      const label = btnNode.getAttribute("string") || "";
      if (!label) return "";
      return `<button type="button" class="oe_stat_button btn"><div class="o_stat_info"><span class="o_stat_text">${escapeXml(label)}</span></div></button>`;
    })
    .join("");
  return buttons ? `<div class="oe_button_box">${buttons}</div>` : "";
}

function emitNotebook(node, ctx) {
  const pages = Array.from(node.children).filter(
    (c) => c.tagName === "page" && isNodeVisible(c, ctx.securityContext, ctx.initialValues)
  );
  if (pages.length === 0) return "";

  const tabs = pages
    .map((page, i) => {
      const label = page.getAttribute("string") || `Page ${i + 1}`;
      return `<li class="nav-item"><a href="#" class="nav-link" t-att-class="{active: state.activePage === ${i}}" t-on-click="(ev) => this.onTabClick(ev, ${i})">${escapeXml(label)}</a></li>`;
    })
    .join("");
  const panes = pages
    .map((page, i) => {
      const content = emitChildren(page.children, ctx);
      return `<div class="tab-pane" t-att-class="{active: state.activePage === ${i}}">${content}</div>`;
    })
    .join("");
  return `<div class="o_notebook"><div class="o_notebook_headers"><ul class="nav nav-tabs">${tabs}</ul></div><div class="tab-content">${panes}</div></div>`;
}

/**
 * Portage de form_group.js (supprimé) vers la génération de template :
 * mêmes classes o_group/o_inner_group/o_cell, même bucketisation des
 * lignes (newline, colspan), labels de gauche émis STATIQUEMENT dans le
 * template, cellules de saisie déléguées aux emplacements de champs.
 */
function emitGroup(node, ctx) {
  const childGroups = Array.from(node.children).filter((c) => c.tagName === "group");
  const title = node.getAttribute("string")
    ? `<h2 class="o_horizontal_separator mt-4 mb-3 text-uppercase fw-bolder small">${escapeXml(node.getAttribute("string"))}</h2>`
    : "";

  if (childGroups.length > 0) {
    const outerMaxCols = parseInt(node.getAttribute("col"), 10) || 2;
    const colSize = Math.max(1, Math.round(12 / outerMaxCols));
    const parts = [title];
    for (const child of node.children) {
      if (!isNodeVisible(child, ctx.securityContext, ctx.initialValues)) continue;
      if (child.tagName === "group") {
        const itemSpan = getItemSpan(child);
        const extraClass = itemSpan !== outerMaxCols ? ` col-lg-${itemSpan * colSize}` : "";
        parts.push(emitInnerGroup(child, ctx, extraClass));
      } else {
        parts.push(emitNode(child, ctx));
      }
    }
    return `<div class="o_group row align-items-start">${parts.filter(Boolean).join("")}</div>`;
  }

  return emitInnerGroup(node, ctx, "");
}

function emitInnerGroup(node, ctx, extraClass) {
  const maxCols = parseInt(node.getAttribute("col"), 10) || 2;
  const title = node.getAttribute("string")
    ? `<h2 class="o_horizontal_separator mt-4 mb-3 text-uppercase fw-bolder small">${escapeXml(node.getAttribute("string"))}</h2>`
    : "";

  const items = collectGroupItems(node, ctx);
  if (items.length === 0) {
    return title ? `<div class="o_inner_group grid${extraClass}">${title}</div>` : "";
  }

  const rows = bucketItemsIntoRows(items, maxCols);
  const rowsHtml = rows
    .filter((row) => row.length > 0)
    .map((row) => emitGroupRow(row, maxCols, ctx))
    .join("");
  return `<div class="o_inner_group grid${extraClass}">${title}${rowsHtml}</div>`;
}

function collectGroupItems(node, ctx) {
  const items = [];
  const children = Array.from(node.children);

  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (!isNodeVisible(child, ctx.securityContext, ctx.initialValues)) continue;

    // Paire <label for="x"/><...champ x.../> : label explicite repositionné
    // à gauche de la cellule de saisie (comme buildLabeledItem).
    if (child.tagName === "label") {
      const forAttr = child.getAttribute("for");
      const next = children[i + 1];
      if (
        forAttr &&
        next &&
        isNodeVisible(next, ctx.securityContext, ctx.initialValues) &&
        nodeContainsField(next, forAttr)
      ) {
        items.push({ type: "pair", labelNode: child, siblingNode: next, itemSpan: getItemSpan(next), newline: false });
        i++;
        continue;
      }
    }

    if (child.tagName === "field") {
      const info = ctx.fieldsInfo[child.getAttribute("name")];
      if (!canRenderField(info)) continue; // ancien comportement : rendu null -> item absent
      const nolabel = child.getAttribute("nolabel") === "1" || (info && info.type === "one2many");
      items.push({ type: "field", node: child, hasLabel: !nolabel, itemSpan: getItemSpan(child), newline: false });
      continue;
    }

    if (child.tagName === "newline") {
      if (items.length) items[items.length - 1].newline = true;
      continue;
    }

    const html = emitNode(child, ctx);
    if (html) {
      items.push({
        type: "other",
        html: `<div class="o_cell flex-grow-1 flex-sm-grow-0">${html}</div>`,
        itemSpan: getItemSpan(child),
        newline: false,
      });
    }
  }
  return items;
}

function emitGroupRow(row, maxCols, ctx) {
  const labelCount = row.filter((it) => it.type === "pair" || (it.type === "field" && it.hasLabel)).length;
  const sizeOfDataCell = 100 / Math.max(1, maxCols - labelCount);

  const cells = [];
  for (const item of row) {
    if (item.type === "pair") {
      cells.push(emitLabelCell(item.labelNode, item.siblingNode, ctx));
      cells.push(emitInputCell(item.itemSpan, emitPairedSibling(item.siblingNode, ctx), sizeOfDataCell));
      continue;
    }
    if (item.type === "field") {
      if (item.hasLabel) {
        const info = ctx.fieldsInfo[item.node.getAttribute("name")];
        cells.push(emitLabelCell(null, item.node, ctx, info ? info.label : item.node.getAttribute("name")));
      }
      cells.push(
        emitInputCell(item.itemSpan, emitFieldSlot(item.node, ctx, "cell-nolabel"), item.hasLabel ? sizeOfDataCell : null)
      );
      continue;
    }
    cells.push(item.html);
  }
  return `<div class="o_wrap_field d-flex d-sm-contents flex-column mb-3 mb-sm-0">${cells.join("")}</div>`;
}

function emitLabelCell(labelNode, fieldNode, ctx, forcedText = null) {
  let forAttr;
  let text;
  if (labelNode) {
    forAttr = labelNode.getAttribute("for");
    const info = ctx.fieldsInfo[forAttr];
    text = labelNode.getAttribute("string") || (info ? info.label : forAttr);
  } else {
    forAttr = fieldNode.getAttribute("name");
    text = forcedText;
  }
  return `<div class="o_cell o_wrap_label flex-grow-1 flex-sm-grow-0 w-100 text-break text-900"><label class="o_form_label" for="field-${escapeXml(forAttr)}">${escapeXml(text)}</label></div>`;
}

function emitInputCell(itemSpan, content, width) {
  const styles = [];
  if (itemSpan - 1 > 1) styles.push(`grid-column: span ${itemSpan - 1}`);
  if (width != null) styles.push(`width: ${(Math.max(1, itemSpan - 1)) * width}%`);
  const styleAttr = styles.length ? ` style="${styles.join("; ")}"` : "";
  return `<div class="o_cell o_wrap_input flex-grow-1 flex-sm-grow-0 text-break"${styleAttr}>${content}</div>`;
}

/**
 * Sibling d'une paire <label for="x"/> : le champ apparié est rendu en
 * mode "widget" (seuls les enfants du .o_field_widget), comme
 * buildLabeledItem ; les autres enfants passent par emitNode.
 */
function emitPairedSibling(siblingNode, ctx) {
  if (siblingNode.tagName === "field") {
    return emitFieldSlot(siblingNode, ctx, "widget");
  }
  return Array.from(siblingNode.children)
    .map((inner) => {
      if (!isNodeVisible(inner, ctx.securityContext, ctx.initialValues)) return "";
      if (inner.tagName === "field") return emitFieldSlot(inner, ctx, "widget");
      return emitNode(inner, ctx);
    })
    .filter(Boolean)
    .join("");
}

function bucketItemsIntoRows(items, maxCols) {
  const rows = [];
  let currentRow = [];
  let reserved = 0;

  for (const item of items) {
    if (item.newline && currentRow.length) {
      rows.push(currentRow);
      currentRow = [];
      reserved = 0;
    }
    if (item.itemSpan + reserved > maxCols && currentRow.length) {
      rows.push(currentRow);
      currentRow = [];
      reserved = 0;
    }
    currentRow.push(item);
    reserved += item.itemSpan;
  }
  if (currentRow.length) rows.push(currentRow);
  return rows;
}

function nodeContainsField(node, fieldName) {
  if (node.tagName === "field" && node.getAttribute("name") === fieldName) return true;
  return Array.from(node.querySelectorAll ? node.querySelectorAll("field") : []).some(
    (f) => f.getAttribute("name") === fieldName
  );
}

function emitHeader(node, ctx) {
  let buttonsHtml = "";
  let primaryUsed = false;
  for (const btnNode of Array.from(node.children).filter((c) => c.tagName === "button")) {
    const label = btnNode.getAttribute("string");
    if (!label) continue;

    const invisibleExpr = btnNode.getAttribute("invisible");
    if (invisibleExpr && evaluateSimpleCondition(invisibleExpr, ctx.initialValues) === true) continue;

    const idx = ctx.headerButtons.length;
    ctx.headerButtons.push({
      type: btnNode.getAttribute("type"),
      name: btnNode.getAttribute("name"),
    });
    const isPrimary =
      (btnNode.getAttribute("class") || "").includes("oe_highlight") || !primaryUsed;
    primaryUsed = true;
    buttonsHtml += `<button type="button" class="btn ${isPrimary ? "btn-primary" : "btn-secondary"}" t-on-click="() => this.onHeaderButton(${idx})">${escapeXml(label)}</button>`;
  }
  const headerHtml = `<div class="o_statusbar_buttons d-flex align-items-center align-content-around flex-wrap gap-1">${buttonsHtml}</div>`;

  // Chez Odoo le statusbar est un widget de champ : slot délégué au
  // widget statusbar (views/fields/statusbar/), pas du markup header.
  let statusbarHtml = "";
  const statusField = Array.from(node.querySelectorAll("field")).find(
    (f) => f.getAttribute("widget") === "statusbar"
  );
  if (statusField) {
    const fieldName = statusField.getAttribute("name");
    const info = ctx.fieldsInfo[fieldName];
    if (info && info.selection) {
      const index = ctx.slots.length;
      ctx.slots.push({ index, kind: "statusbar", node: statusField, mode: "statusbar", name: fieldName });
      statusbarHtml = `<div class="o_statusbar_slot" data-form-slot="${index}"></div>`;
    }
  }

  return { headerHtml, statusbarHtml };
}

function emitChildren(children, ctx) {
  return Array.from(children)
    .map((child) => emitNode(child, ctx))
    .filter(Boolean)
    .join("");
}

function emitNode(node, ctx) {
  if (!isNodeVisible(node, ctx.securityContext, ctx.initialValues)) return "";

  const classAttr = node.getAttribute("class") || "";

  switch (node.tagName) {
    case "sheet": {
      const inner = emitChildren(node.children, ctx);
      return inner ? `<div>${inner}</div>` : "";
    }
    case "group":
      return emitGroup(node, ctx);
    case "notebook":
      return emitNotebook(node, ctx);
    case "page": {
      const inner = emitChildren(node.children, ctx);
      return inner ? `<div class="tab-pane">${inner}</div>` : "";
    }
    case "field":
      return canRenderField(ctx.fieldsInfo[node.getAttribute("name")]) ? emitFieldSlot(node, ctx, "cell") : "";
    case "label":
      return emitStandaloneLabel(node);
    case "div": {
      if (classAttr.includes("oe_button_box")) return emitButtonBox(node, ctx);
      const inner = emitChildren(node.children, ctx);
      return inner ? `<div>${inner}</div>` : "";
    }
    case "h1": {
      const inner = Array.from(node.children)
        .map((child) => {
          if (!isNodeVisible(child, ctx.securityContext, ctx.initialValues)) return "";
          // Champ dans un titre : rendu SANS label (comme l'ancien h1).
          if (child.tagName === "field") {
            if (!canRenderField(ctx.fieldsInfo[child.getAttribute("name")])) return "";
            return emitFieldSlot(child, ctx, "cell-nolabel");
          }
          return emitNode(child, ctx);
        })
        .filter(Boolean)
        .join("");
      return inner ? `<h1 class="o_row">${inner}</h1>` : "";
    }
    case "button":
    case "widget":
      return "";
    default: {
      const inner = emitChildren(node.children, ctx);
      return inner ? `<div>${inner}</div>` : "";
    }
  }
}

const CHATTER_HTML = `<div class="o-mail-ChatterContainer o-mail-Form-chatter oe_chatter o-aside">
            <div class="o-mail-Chatter w-100 h-100 flex-grow-1 d-flex flex-column overflow-auto">
              <div class="o-mail-Chatter-top position-sticky top-0">
                <div class="o-mail-Chatter-topbar d-flex flex-shrink-0 flex-grow-0 px-3 overflow-x-auto">
                  <button type="button" class="o-mail-Chatter-sendMessage btn text-nowrap me-1 btn-primary my-2" t-on-click="() => this.onChatterClick()">Envoyer un message</button>
                  <button type="button" class="o-mail-Chatter-logNote btn text-nowrap me-1 btn-secondary my-2" t-on-click="() => this.onChatterClick()">Note</button>
                  <div class="flex-grow-1 d-flex">
                    <button type="button" class="o-mail-Chatter-activity btn btn-secondary text-nowrap my-2" t-on-click="() => this.onChatterClick()"><span>Activités</span></button>
                    <span class="o-mail-Chatter-topbarGrow flex-grow-1 pe-2"></span>
                    <button type="button" class="o-mail-Chatter-search btn btn-link text-action" aria-label="Rechercher des messages" t-on-click="() => this.onChatterClick()">
                      <i class="oi oi-search" role="img"></i>
                    </button>
                  </div>
                </div>
              </div>
              <div class="o-mail-Chatter-content">
                <div class="o-mail-Thread position-relative flex-grow-1 d-flex flex-column overflow-auto pb-4 text-muted small p-3">
                  Historique non disponible hors-ligne pour l'instant.
                </div>
              </div>
            </div>
          </div>`;

/**
 * Compile l'arch parsée en template OWL + la liste des emplacements de
 * champs. Visibilité (invisible/attrs) et button_box sont résolus à la
 * COMPILATION (valeurs figées au mount, comme l'ancien compilateur DOM) ;
 * les onglets du notebook restent réactifs via FormRenderer.state.
 *
 * @param {Element} formRoot - racine <form> issue de parseFormViewArch
 * @param {Object} params - { fieldsInfo, initialValues, securityContext, hasRecordId }
 * @returns {{ templateName: string, templateXml: string, fieldSlots: Array, headerButtons: Array }}
 */
export function buildFormTemplate(formRoot, { fieldsInfo, initialValues, securityContext, hasRecordId }) {
  const ctx = {
    fieldsInfo: fieldsInfo || {},
    initialValues: initialValues || {},
    securityContext,
    hasRecordId,
    slots: [],
    headerButtons: [],
  };
  let headerHtml = `<div class="o_statusbar_buttons d-flex align-items-center align-content-around flex-wrap gap-1"></div>`;
  let statusbarHtml = "";
  const headerNode = Array.from(formRoot.children).find((c) => c.tagName === "header");
  if (headerNode) {
    ({ headerHtml, statusbarHtml } = emitHeader(headerNode, ctx));
  }

  const sheetHtml = Array.from(formRoot.children)
    .filter((c) => c.tagName !== "header")
    .map((c) => emitNode(c, ctx))
    .filter(Boolean)
    .join("");

  const templateXml = `<t t-name="${TEMPLATE_NAME}">
      <div class="o_form_view" t-ref="root">
        <div class="o_content">
          <div class="o_form_renderer o_form_editable d-flex flex-nowrap h-100">
            <div class="o_form_sheet_bg">
              <div class="o_form_statusbar position-relative d-flex justify-content-between mb-0 mb-md-2 pb-2 pb-md-0">${headerHtml}${statusbarHtml}</div>
              <div class="o_form_sheet position-relative">${sheetHtml}</div>
            </div>
            ${CHATTER_HTML}
          </div>
        </div>
      </div>
    </t>`;

  return {
    templateName: TEMPLATE_NAME,
    templateXml,
    fieldSlots: ctx.slots,
    headerButtons: ctx.headerButtons,
  };
}
