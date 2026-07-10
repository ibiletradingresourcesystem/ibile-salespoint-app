import mongoose from 'mongoose';

const customerSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true, sparse: true },
  phone: String,
  address: String,
  type: {
    type: String,
    enum: ["REGULAR", "VIP", "NEW", "INACTIVE", "BULK_BUYER", "ONLINE", "CREDIT"],
    default: "REGULAR"
  },
  isCreditCustomer: { type: Boolean, default: false },
  creditLimit: { type: Number, default: 0 },
  creditBalance: { type: Number, default: 0 },
  creditNotes: { type: String, default: "" },
  lastCreditPaymentAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

const Customer = mongoose.models.Customer || mongoose.model('Customer', customerSchema);

export default Customer;
