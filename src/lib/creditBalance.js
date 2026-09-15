import mongoose from 'mongoose';
import { Transaction } from '@/src/models/Transactions';
import Customer from '@/src/models/Customer';

export const getCreditPaidTotal = (transaction = {}) => {
  const payments = Array.isArray(transaction.creditPayments) ? transaction.creditPayments : [];
  if (payments.length > 0) {
    return payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  }
  return Number(transaction.creditPaidAmount || 0);
};

export const getCreditBalance = (transaction = {}) => {
  const total = Number(transaction.creditOriginalTotal || transaction.total || 0);
  return Math.max(0, total - getCreditPaidTotal(transaction));
};

export const recalculateCustomerCreditBalance = async (customerId) => {
  if (!customerId || !mongoose.Types.ObjectId.isValid(String(customerId))) return;

  const openCredits = await Transaction.find({
    status: 'credit',
    creditCustomerId: new mongoose.Types.ObjectId(String(customerId)),
    creditStatus: { $nin: ['paid', 'written_off'] },
  }).select('creditBalance total creditOriginalTotal creditPaidAmount creditPayments');

  const creditBalance = openCredits.reduce((sum, transaction) => sum + getCreditBalance(transaction), 0);
  await Customer.findByIdAndUpdate(customerId, {
    type: 'CREDIT',
    isCreditCustomer: true,
    creditBalance,
    updatedAt: new Date(),
  });
};
