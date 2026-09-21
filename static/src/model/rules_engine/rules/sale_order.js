/**
 * model/rules_engine/rules/sale_order.js
 * =========================================
 * Miroir de purchase_order.js pour sale.order(.line) -- même logique
 * métier, mais le champ de quantité s'appelle "product_uom_qty" côté
 * vente (au lieu de "product_qty" côté achat).
 *
 * Déplacé depuis les mêmes fichiers que purchase_order.js (voir ce
 * fichier pour le détail), le générique one2many_field.js gérant les deux
 * modèles avec la même fonction avant cette extraction.
 */

export const saleOrderLineRules = [
  {
    model: "sale.order.line",
    method: "_onchange_product_id",
    trigger: { fields: ["product_id"] },
    compute(line, db) {
      const product = db.get("product.product", line.product_id);
      if (!product) return null;
      return {
        name: product.display_name || product.name,
        price_unit: Number(product.price) || 0,
      };
    },
  },
  {
    model: "sale.order.line",
    method: "_compute_amount",
    computes: ["price_subtotal", "price_total"],
    // @api.depends('product_uom_qty', 'price_unit', 'discount')
    trigger: { fields: ["product_uom_qty", "price_unit", "discount"] },
    compute(line) {
      const qty = Number(line.product_uom_qty) || 0;
      const priceUnit = Number(line.price_unit) || 0;
      const discount = Math.min(Math.max(Number(line.discount) || 0, 0), 100);
      const subtotal = qty * priceUnit * (1 - discount / 100);
      // Pas de module account.tax hors ligne (taux non embarqués dans le
      // manifest) : price_total = price_subtotal, écart documenté.
      return {
        price_subtotal: Number(subtotal.toFixed(2)),
        price_total: Number(subtotal.toFixed(2)),
      };
    },
  },
  {
    model: "sale.order.line",
    type: "constraint",
    method: "_check_quantity",
    // @api.constrains('product_uom_qty') -- miroir de la contrainte
    // Python : une quantité fournie doit être strictement positive.
    constrains: ["product_uom_qty"],
    validate(line) {
      const qty = line.product_uom_qty;
      if (qty === undefined || qty === null || qty === false || qty === "") return { valid: true };
      if (Number(qty) <= 0) {
        return { valid: false, message: "La quantité vendue doit être strictement positive." };
      }
      return { valid: true };
    },
  },
];

export const saleOrderRules = [
  {
    model: "sale.order",
    method: "_compute_amounts",
    computes: ["amount_untaxed", "amount_tax", "amount_total"],
    // @api.depends('order_line.price_subtotal', ...) -- même cascade que
    // la méthode Python : HT = Σ sous-totaux de lignes, TVA = 0 hors
    // ligne (écart documenté), total = HT + TVA.
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
  {
    model: "sale.order",
    type: "constraint",
    method: "_check_dates",
    // @api.constrains('commitment_date', 'date_order') -- la date de
    // livraison souhaitée ne peut pas précéder la date de commande.
    constrains: ["commitment_date", "date_order"],
    validate(order) {
      const commitment = order.commitment_date;
      const ordered = order.date_order;
      if (!commitment || !ordered) return { valid: true };
      if (String(commitment) < String(ordered)) {
        return { valid: false, message: "La date de livraison souhaitée précède la date de commande." };
      }
      return { valid: true };
    },
  },
];
