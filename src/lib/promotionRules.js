/**
 * Product promotion rules — what a promotion is, when it is on, and what it takes off a line.
 *
 * The same file is in both apps, word for word: lib/promotionRules.js in the management app, which
 * sets promotions up, and src/lib/promotionRules.js in the till, which charges them. Change one,
 * copy it to the other. Nothing here touches a database or the screen.
 *
 * A promotion is one of:
 *   price     each one at the promo price                    "₦900 each"
 *   multibuy  every `buyQty` of them together for the price   "Buy 2 for ₦1,500"
 *   percent   buy `buyQty` or more and each is `percent`% off "Buy 1, save 10%"
 *
 * It runs from a start to an end (date and time), only on the days picked (none picked: every
 * day), and only for the customer types picked (none picked: everyone, walk-ins included). Days are
 * the shop's, in Lagos.
 */

export const PROMOTION_TYPES = ["price", "multibuy", "percent"];

export const PROMOTION_TYPE_LABELS = {
  price: "Promo price each",
  multibuy: "Buy X for ₦",
  percent: "% discount",
};

export const PROMOTION_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export const PROMOTION_DAY_LABELS = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };

/** The customer types a promotion can be kept for (the customer record's own types). */
export const PROMOTION_CUSTOMER_TYPES = ["REGULAR", "VIP", "NEW", "BULK_BUYER", "ONLINE", "CREDIT"];

const WEEKDAY_BY_INDEX = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
/** Lagos is UTC+1 all year. */
const SHOP_OFFSET_MS = 60 * 60 * 1000;

const money = (value) => Math.round((Number(value) || 0) * 100) / 100;

const naira = (value) => `₦${money(value).toLocaleString("en-NG")}`;

/** The day of the week in the shop at a moment: "mon" … "sun". */
export function shopWeekday(moment = new Date()) {
  return WEEKDAY_BY_INDEX[new Date(new Date(moment).getTime() + SHOP_OFFSET_MS).getUTCDay()];
}

/** The promotion a product carries, in the shape these rules read, or null when it has none. */
export function promotionOf(product) {
  if (!product?.isPromotion) return null;
  const type = PROMOTION_TYPES.includes(product.promoType) ? product.promoType : "price";
  const buyQty = Math.floor(Number(product.promoBuyQty) || 0);
  return {
    name: String(product.promoName || "").trim(),
    type,
    buyQty: Math.max(type === "multibuy" ? 2 : 1, buyQty || (type === "multibuy" ? 2 : 1)),
    price: money(product.promoPrice),
    percent: Number(product.promoPercent) || 0,
    start: product.promoStart || null,
    end: product.promoEnd || null,
    days: Array.isArray(product.promoDays) ? product.promoDays.filter((day) => PROMOTION_DAYS.includes(day)) : [],
    customerTypes: Array.isArray(product.promoCustomerTypes)
      ? product.promoCustomerTypes.map((type) => String(type).toUpperCase()).filter(Boolean)
      : [],
  };
}

/** The deal in a few words: "Buy 2 for ₦1,500", "Buy 1, save 10%", "₦900 each". */
export function describePromotion(promo) {
  if (!promo) return "";
  if (promo.type === "multibuy") return `Buy ${promo.buyQty} for ${naira(promo.price)}`;
  if (promo.type === "percent") {
    return promo.buyQty > 1 ? `Buy ${promo.buyQty} or more, save ${promo.percent}%` : `Buy 1, save ${promo.percent}%`;
  }
  return `${naira(promo.price)} each`;
}

/** What the customer sees on the receipt: the promotion's name, else the deal itself. */
export function promotionLabel(promo) {
  return promo?.name || describePromotion(promo);
}

/**
 * Why a promotion does not apply right now, or "" when it does:
 * "not-started", "ended", "day" (not one of its days) or "customer" (not one of its customer types).
 */
export function promotionBlock(promo, { now = new Date(), customerType = null } = {}) {
  if (!promo) return "none";
  const moment = new Date(now);
  if (promo.start && new Date(promo.start) > moment) return "not-started";
  if (promo.end && new Date(promo.end) < moment) return "ended";
  const days = promo.days || [];
  const customerTypes = promo.customerTypes || [];
  if (days.length > 0 && !days.includes(shopWeekday(moment))) return "day";
  if (customerTypes.length > 0 && !customerTypes.includes(String(customerType || "").toUpperCase())) return "customer";
  return "";
}

/** What a promotion takes off a line of `quantity` at `unitPrice` each. Never more than the line. */
export function promotionDiscount(promo, { unitPrice, quantity }) {
  const price = Math.max(0, Number(unitPrice) || 0);
  const qty = Math.max(0, Number(quantity) || 0);
  if (!promo || price <= 0 || qty <= 0) return 0;

  let discount = 0;
  if (promo.type === "multibuy") {
    const groups = Math.floor(qty / promo.buyQty);
    discount = groups * Math.max(0, promo.buyQty * price - promo.price);
  } else if (promo.type === "percent") {
    if (qty >= promo.buyQty) discount = (price * qty * Math.min(Math.max(promo.percent, 0), 100)) / 100;
  } else if (promo.price > 0) {
    discount = qty * Math.max(0, price - promo.price);
  }
  return Math.min(money(discount), money(price * qty));
}

/**
 * What is wrong with a promotion for a product at `normalPrice`, or "" when it gives a real saving.
 */
export function promotionProblem(promo, normalPrice) {
  const normal = Number(normalPrice) || 0;
  if (!promo) return "No promotion";
  if (!(normal > 0)) return "This product has no price to take a promotion off";
  if (promo.type === "percent") {
    if (!(promo.percent > 0 && promo.percent < 100)) return "The discount must be between 1% and 99%";
    return "";
  }
  if (!(promo.price > 0)) return "The promo price must be more than ₦0";
  if (promo.type === "multibuy") {
    if (promo.buyQty < 2) return "Buy at least 2 for a multi-buy";
    if (promo.price >= promo.buyQty * normal) {
      return `${promo.buyQty} cost ${naira(promo.buyQty * normal)} at the normal price; the deal must be less`;
    }
    return "";
  }
  if (promo.price >= normal) return `The promo price must be below the normal price of ${naira(normal)}`;
  return "";
}
