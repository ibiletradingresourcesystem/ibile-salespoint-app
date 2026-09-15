import mongoose from 'mongoose';
import { syncTracking } from '@/src/lib/desktop/syncTracking';

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
  // Desktop sync: set when the customer was first created on a desktop installation
  installationId: { type: String },
  syncedAt: { type: Date },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// Desktop runtime: queue customers created or edited at the till (no-op on the cloud deployment)
customerSchema.plugin(syncTracking, { entity: 'customers' });

const Customer = mongoose.models.Customer || mongoose.model('Customer', customerSchema);

export default Customer;
