/**
 * model/rules_engine/rules/purchase_order.js
 * ============================================
 * Règles compute/onchange pour purchase.order(.line) -- équivalent JS des
 * @api.onchange('product_id') et @api.depends('product_qty', 'price_unit')
 * du modèle Python purchase.order.line.
 *
 * Déplacé depuis :
 *  - views/fields/one2many/one2many_field.js::applyCatalogSelection()
 *    (le calcul name/price_unit/price_subtotal/price_total y était dupliqué
 *    deux fois : une pour les lignes existantes, une pour les nouvelles)
 *  - views/fields/one2many/compute_engine.js (recalcul du total qty*price,
 *    fait indépendamment en lisant le DOM)
 */

export const purchaseOrderLineRules = [
  {
    model: "purchase.order.line",
    method: "_onchange_product_id",
    trigger: { fields: ["product_id"] },
    // db : snapshot { get(model, id) } -- résolu par rules_engine à partir
    // du cache local product.product (ou fourni directement par
    // one2many_field.js à partir du catalogue déjà en mémoire).
    compute(line, db) {
      const product = db.get("product.product", line.product_id);
      if (!product) return null;
      const updates = {
        name: product.display_name || product.name,
        price_unit: Number(product.price) || 0,
      };
      // Comme le dict {'warning': {...}} que la méthode Python peut
      // retourner : avertir quand le produit n'a pas de prix d'achat
      // (le webclient l'affiche en toast non bloquant, itération 17).
      if (!Number(product.price)) {
        updates.warning = {
          title: "Prix fournisseur manquant",
          message: `Le produit « ${product.display_name || product.name || line.product_id} » n'a pas de prix d'achat défini.`,
        };
      }
      return updates;
    },
  },
  {
    model: "purchase.order.line",
    method: "_compute_amount",
    computes: ["price_subtotal", "price_total"],
    // @api.depends('product_qty', 'price_unit', 'discount') -- la remise
    // ligne existe dans Odoo 17 (champ présent dans les manifests réels).
    trigger: { fields: ["product_qty", "price_unit", "discount"] },
    compute(line) {
      const qty = Number(line.product_qty) || 0;
      const priceUnit = Number(line.price_unit) || 0;
      const discount = Math.min(Math.max(Number(line.discount) || 0, 0), 100);
      const subtotal = qty * priceUnit * (1 - discount / 100);
      // Pas de module account.tax hors ligne (les taux ne sont pas
      // embarqués dans le manifest) : price_total = price_subtotal,
      // écart documenté dans docs/alignement-odoo.md.
      return {
        price_subtotal: Number(subtotal.toFixed(2)),
        price_total: Number(subtotal.toFixed(2)),
      };
    },
  },
  {
    model: "purchase.order.line",
    type: "constraint",
    method: "_check_quantity",
    // @api.constrains('product_qty') -- miroir de la contrainte Python :
    // une quantité fournie doit être strictement positive (absente =
    // ligne en cours de saisie, rien à vérifier).
    constrains: ["product_qty"],
    validate(line) {
      const qty = line.product_qty;
      if (qty === undefined || qty === null || qty === false || qty === "") return { valid: true };
      if (Number(qty) <= 0) {
        return { valid: false, message: "La quantité achetée doit être strictement positive." };
      }
      return { valid: true };
    },
  },
];

export const purchaseOrderRules = [
  {
    model: "purchase.order",
    method: "_compute_amounts",
    computes: ["amount_untaxed", "amount_tax", "amount_total"],
    // @api.depends('order_line.price_subtotal', ...) -- même cascade que
    // la méthode Python : le HT vient des SOUS-TOTAUX de lignes (pas des
    // TTC), la TVA vaut 0 hors ligne (pas de account.tax embarqué, écart
    // documenté) et le total = HT + TVA, comme chez Odoo.
    trigger: { fields: ["order_line.price_subtotal"] },
    compute(order) {
      const lines = order.order_line || [];
      const untaxed = lines.reduce((sum, l) => sum + (Number(l.price_subtotal) || 0), 0);
      const tax = 0;
      return {
        amount_untaxed: Number(untaxed.toFixed(2)),
        amount_tax: Number(tax.toFixed(2)),
        amount_total: Number((untaxed + tax).toFixed(2)),
      };
    },
  },
];
