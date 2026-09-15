/**
 * What moves between a desktop installation and the cloud, and in which direction.
 *
 * PUSH (desktop -> cloud): records created at the till. Lower priority numbers are sent first so
 * referenced records (customers, tills) reach the cloud before the sales that point at them.
 *
 * PULL (cloud -> desktop): data the POS needs to operate, managed in the management app.
 *   snapshot    - small collections, fetched whole when their ETag changes (these models have no
 *                 reliable updatedAt, so a cursor could miss changes)
 *   incremental - large collections with Mongoose timestamps, fetched by updatedAt cursor
 */

export const PUSH_ENTITIES = {
  customers: { priority: 10, mode: 'document' },
  tills: { priority: 20, mode: 'document' },
  transactions: { priority: 30, mode: 'document' },
  endofdayreports: { priority: 40, mode: 'document' },
  staff_clock: { priority: 50, mode: 'payload' },
  store_ui_settings: { priority: 60, mode: 'payload' },
};

// All of these are pulled on every sync; manifestIntervalMs limits the full product check
export const PULL_ENTITIES = [
  { name: 'store', strategy: 'snapshot' },
  { name: 'systemthemes', strategy: 'snapshot' },
  { name: 'tenders', strategy: 'snapshot' },
  { name: 'categories', strategy: 'snapshot' },
  { name: 'promotions', strategy: 'snapshot' },
  { name: 'staff', strategy: 'snapshot' },
  { name: 'customers', strategy: 'snapshot' },
  { name: 'products', strategy: 'incremental', manifestIntervalMs: 24 * 60 * 60 * 1000 },
];

export const PULL_ENTITY_NAMES = PULL_ENTITIES.map((entity) => entity.name);

export const isPushEntity = (name) => Object.prototype.hasOwnProperty.call(PUSH_ENTITIES, name);

/** Customer fields a cashier can change at the till. Credit balance is derived, never pushed. */
export const CUSTOMER_POS_FIELDS = [
  'name',
  'email',
  'phone',
  'address',
  'type',
  'isCreditCustomer',
  'creditLimit',
  'creditNotes',
];
