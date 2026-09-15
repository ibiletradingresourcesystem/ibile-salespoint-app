/**
 * Models bound to a specific MongoDB connection.
 *
 * Web: the normal models on the app's connection (unchanged behaviour).
 * Desktop: the same schemas on the direct connection to the customer's cloud MongoDB, for data that
 * lives only in the cloud (web-shop orders, petty cash) and for sync.
 */

import mongoose from 'mongoose';
import { mongooseConnect } from '@/src/lib/mongoose';
import { isDesktopServer } from '@/src/lib/runtime';
import { Transaction } from '@/src/models/Transactions';
import Till from '@/src/models/Till';
import EndOfDayReport from '@/src/models/EndOfDayReport';
import Customer from '@/src/models/Customer';
import Staff from '@/src/models/Staff';
import Store from '@/src/models/Store';
import Product from '@/src/models/Product';
import Tender from '@/src/models/Tender';
import { Category } from '@/src/models/Category';
import Promotion from '@/src/models/Promotion';
import SystemTheme from '@/src/models/SystemTheme';
import Order from '@/src/models/Order';

// Collections owned by the management app that the POS reads and writes loosely
const LOOSE_COLLECTIONS = {
  PettyCashTransaction: { collection: 'pettycashtransactions' },
  Vendor: { collection: 'vendors' },
  PosExpense: { collection: 'expenses', timestamps: true },
  PosExpenseCategory: { collection: 'expensecategories', timestamps: true },
};

const MODELS = { Transaction, Till, EndOfDayReport, Customer, Staff, Store, Product, Tender, Category, Promotion, SystemTheme, Order };

export function modelsFor(connection) {
  const bound = { connection };
  for (const [name, model] of Object.entries(MODELS)) {
    bound[name] = connection === mongoose.connection
      ? model
      : connection.models[name] || connection.model(name, model.schema);
  }
  for (const [name, options] of Object.entries(LOOSE_COLLECTIONS)) {
    bound[name] = connection.models[name] || connection.model(
      name,
      new mongoose.Schema({}, { strict: false, collection: options.collection, timestamps: Boolean(options.timestamps) })
    );
  }
  return bound;
}

/** Models for data that always lives in the cloud database. */
export async function cloudDataModels() {
  if (isDesktopServer()) {
    const { getCloudConnection } = await import('@/src/lib/desktop/cloudDb');
    return modelsFor(await getCloudConnection());
  }
  await mongooseConnect();
  return modelsFor(mongoose.connection);
}

/**
 * Same as cloudDataModels(), for routes that connect outside their own error handling. On the
 * desktop, when the cloud database cannot be reached, it answers 503 with a clear message and
 * returns null. On the web, errors propagate exactly as before.
 */
export async function cloudDataModelsOrRespond(res) {
  try {
    return await cloudDataModels();
  } catch (error) {
    if (!isDesktopServer()) throw error;
    const message = 'This needs a connection to the cloud database. Check the internet connection. Sales keep working offline.';
    res.status(503).json({ success: false, code: 'CLOUD_UNAVAILABLE', error: message, message });
    return null;
  }
}
