/**
 * Records the expense for a petty cash order paid on the POS.
 *
 * Mirrors syncPettyCashExpense() in the inventory (management) app's lib/petty-cash-transactions.js,
 * so an order paid on the POS appears on the Expenses page and in reports exactly like one paid there.
 */
import mongoose from "mongoose";

export const PETTY_CASH_EXPENSE_CATEGORY = "Supplies/Stock Purchase";

// Own model names so these never clash with other loose models registered on the same collections.
// timestamps matter: the Expenses page and reports date and sort expenses by createdAt.
const PosExpense =
  mongoose.models.PosExpense ||
  mongoose.model("PosExpense", new mongoose.Schema({}, { strict: false, timestamps: true, collection: "expenses" }));
const PosExpenseCategory =
  mongoose.models.PosExpenseCategory ||
  mongoose.model(
    "PosExpenseCategory",
    new mongoose.Schema({}, { strict: false, timestamps: true, collection: "expensecategories" })
  );

function toObjectId(value) {
  const id = value?._id ?? value;
  return id && mongoose.Types.ObjectId.isValid(String(id)) ? new mongoose.Types.ObjectId(String(id)) : null;
}

async function ensureExpenseCategory(ExpenseCategoryModel) {
  const filter = { name: PETTY_CASH_EXPENSE_CATEGORY };
  try {
    return await ExpenseCategoryModel.findOneAndUpdate(filter, { $setOnInsert: filter }, { upsert: true, new: true }).lean();
  } catch (err) {
    // Category names are unique; another request may have created it at the same moment
    if (err?.code === 11000) return ExpenseCategoryModel.findOne(filter).lean();
    throw err;
  }
}

/**
 * Create or update the expense for a paid petty cash transaction.
 * Safe to call more than once for the same order: it is matched by the order id.
 * models: optional { PosExpense, PosExpenseCategory } for another connection (the desktop app's
 * direct cloud connection); without them this app's models are used.
 * @returns the expense _id
 */
export async function recordPettyCashExpense(transaction, models = {}) {
  const ExpenseModel = models.PosExpense || PosExpense;
  const ExpenseCategoryModel = models.PosExpenseCategory || PosExpenseCategory;
  const sourceId = String(transaction._id);
  const category = await ensureExpenseCategory(ExpenseCategoryModel);
  const paidBy = transaction.paidBy || transaction.requestedBy || null;

  const payload = {
    title: `${transaction.vendorName || transaction.purpose || "Petty Cash"} Purchase`,
    amount: Number(transaction.amount) || 0,
    categoryId: category._id,
    categoryName: PETTY_CASH_EXPENSE_CATEGORY,
    description: [transaction.description, transaction.paymentReference].filter(Boolean).join(" | "),
    locationName: transaction.location || "",
    expenseDate: transaction.paidAt || new Date(),
    staffName: paidBy?.name || "",
    staffId: toObjectId(paidBy?._id),
    sourceType: "petty-cash-transaction",
    sourceId,
    vendor: {
      _id: toObjectId(transaction.vendor),
      companyName: transaction.vendorName || "",
    },
  };

  const linkedExpenseId = toObjectId(transaction.expense);
  const existing =
    (linkedExpenseId && (await ExpenseModel.findById(linkedExpenseId).select("_id").lean())) ||
    (await ExpenseModel.findOne({ sourceType: "petty-cash-transaction", sourceId }).select("_id").lean());

  if (existing) {
    await ExpenseModel.updateOne({ _id: existing._id }, { $set: payload });
    return existing._id;
  }

  const created = await ExpenseModel.create(payload);
  return created._id;
}
