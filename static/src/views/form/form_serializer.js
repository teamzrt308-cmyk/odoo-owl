/**
 * views/form/form_serializer.js
 * Serializes the current DOM state of a rendered form into a values ​​object, ready to
 * be sent via core/network/rpc_service.js.
 */

/**
 * Reconstruit un documentGraph {root, lines} à partir de l'état DOM actuel
 * du formulaire, au format attendu par rules_engine.js::runDocumentRules()/
 * validateDocument(). Réutilise collectFormData() pour ne pas dupliquer la
 * lecture du DOM -- ne fait que réorganiser son résultat.
 *
 * @param {Object} [rawRootValues] - dernier enregistrement racine complet
 *   connu (voir form_controller.js::currentReferenceValues), utilisé comme
 *   base pour des champs présents côté serveur mais non déclarés dans
 *   l'arch XML du formulaire (ex: location_id/location_dest_id sur un
 *   stock.picking en vue simplifiée mono-étape). Les valeurs actuellement
 *   affichées dans le DOM restent toujours prioritaires.
 */
export function buildDocumentGraph(container, fieldsInfo, rawRootValues = {}) {
  const formData = collectFormData(container, fieldsInfo);
  const root = { ...rawRootValues };
  const lines = {};

  for (const [fieldName, info] of Object.entries(fieldsInfo)) {
    if (info.type === "one2many") {
      // info.relation : modèle des lignes (ex: "purchase.order.line"),
      // fourni par fields_get() -- même hypothèse que one2many_field.js.
      if (info.relation) {
        lines[fieldName] = { model: info.relation, rows: formData[fieldName] || [] };
      }
      continue;
    }
    if (fieldName in formData) {
      root[fieldName] = formData[fieldName];
    }
  }

  return { root, lines };
}

/**
 * Réapplique dans le DOM les champs racine recalculés par runDocumentRules()
 * -- uniquement les champs scalaires simples (les many2one/many2many ne
 * sont jamais des champs "compute" dans ce projet pour l'instant). Ignore
 * le champ actuellement en cours de saisie pour ne pas gêner l'utilisateur.
 * Le mapping des LIGNES one2many est géré par le composant OWL du widget
 * (host.applyLineUpdates, voir fields/one2many/one2many_field.js).
 */
export function applyDocumentGraphToDom(container, fieldsInfo, graph) {
  for (const [fieldName, value] of Object.entries(graph.root || {})) {
    const info = fieldsInfo[fieldName];
    if (!info || info.type === "many2one" || info.type === "many2many" || info.type === "one2many") continue;
    const el = container.querySelector(`#field-${fieldName}`);
    if (!el || el === document.activeElement) continue;
    setElementValue(el, info, value);
  }
}

function setElementValue(el, info, value) {
  switch (info.type) {
    case "boolean":
      el.checked = !!value;
      return;
    case "many2one":
    case "many2many":
      return; // non géré -- voir commentaire ci-dessus
    default:
      el.value = value === false || value === undefined || value === null ? "" : value;
  }
}

export function collectFormData(container, fieldsInfo) {
  const data = {};

  for (const [fieldName, info] of Object.entries(fieldsInfo)) {
    if (info.type === "many2one") {
      const hiddenInput = container.querySelector(`input[name="${fieldName}_id"]`);
      const rawVal = hiddenInput ? hiddenInput.value : "";
      data[fieldName] = rawVal
        ? (rawVal.startsWith("tmp:") ? rawVal : parseInt(rawVal, 10))
        : false;
      continue;
    }

    if (info.type === "one2many") {
      // Le widget one2many est un composant OWL (views/fields/one2many/)
      // qui publie getLines() sur son hôte DOM (voir owl/field_bridge.js) :
      // les valeurs des lignes viennent de l'état réactif du composant,
      // plus aucun scraping DOM. Les suppressions de lignes initiales y
      // sont déjà matérialisées { id, _deleted: true }.
      const fieldWrapper = container.querySelector(`[data-one2many="${fieldName}"] [data-o2m-root="true"]`);
      if (!fieldWrapper || !fieldWrapper._owlOne2many) {
        data[fieldName] = [];
        continue;
      }
      data[fieldName] = fieldWrapper.getLines();
      continue;
    }

    if (info.type === "many2many") {
      const hiddenInput = container.querySelector(`input[name="${fieldName}"]`);
      let ids = [];
      if (hiddenInput && hiddenInput.value) {
        try {
          ids = JSON.parse(hiddenInput.value);
        } catch (e) {
          ids = [];
        }
      }
      data[fieldName] = ids;
      continue;
    }

    const el = container.querySelector(`#field-${fieldName}`);
    if (!el) continue;
    data[fieldName] = getElementValue(el, info);
  }

  return data;
}

export function getElementValue(el, info) {
  switch (info.type) {
    case "boolean":
      return el.checked;
    case "integer":
      return el.value ? parseInt(el.value, 10) : false;
    case "float":
      return el.value ? parseFloat(el.value) : false;
    case "monetary":
      return el.value ? parseFloat(el.value) : false;
    case "many2one": {
      const hidden = el.querySelector('input[type="hidden"]');
      const rawVal = hidden ? hidden.value : "";
      return rawVal
        ? (rawVal.startsWith("tmp:") ? rawVal : parseInt(rawVal, 10))
        : false;
    }
    case "many2many": {
      const hidden = el.querySelector('input[type="hidden"]');
      if (!hidden || !hidden.value) return [];
      try {
        return JSON.parse(hidden.value);
      } catch (e) {
        return [];
      }
    }
    case "date":
      return el.value || false;
    default:
      return el.value || false;
  }
}