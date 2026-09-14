/**
 * Till figures for Close Till, worked out from the till's transactions.
 *
 * The cloud copy of a transaction is the source of truth (it knows about voids, refunds and edits,
 * and includes sales from every terminal on the till). Sales this terminal has not synced yet are
 * added from its local copy.
 */

import { addTenderAmount } from './tenderKey';

const text = (value) => (value === undefined || value === null ? '' : String(value));

export const getTransactionState = (tx = {}) => {
  const status = text(tx.status || 'completed').toLowerCase();
  const subStatus = text(tx.subStatus).toLowerCase();
  if (subStatus === 'void' || subStatus === 'voided') return 'void';
  if (status === 'refunded' || status === 'refund') return 'refund';
  if (status === 'held') return 'held';
  if (status === 'credit') return 'credit';
  return 'sale';
};

/**
 * Merge the cloud list of a till's transactions with this terminal's local copies.
 * serverTxs: from /api/till/[tillId]/transactions (null when the cloud could not be reached)
 */
export function mergeTillTransactions(serverTxs, localTxs = []) {
  const merged = new Map();
  const byServerId = new Map();
  const byExternalId = new Map();

  (serverTxs || []).forEach((tx) => {
    const key = text(tx._id || tx.id);
    const entry = { ...tx, source: 'server' };
    merged.set(key, entry);
    byServerId.set(key, key);
    if (tx.externalId) byExternalId.set(text(tx.externalId), key);
  });

  const localKeyOf = (tx) => `local:${text(tx.id || tx.externalId || tx.clientId)}`;
  const localByRef = new Map();
  localTxs.forEach((tx) => {
    [tx.id, tx.externalId, tx.clientId].filter(Boolean).forEach((ref) => localByRef.set(text(ref), localKeyOf(tx)));
  });

  // Plain local sales first, then edits so an edit can replace what it changed
  const ordered = [...localTxs].sort((a, b) => Number(Boolean(a.editTransactionId)) - Number(Boolean(b.editTransactionId)));

  ordered.forEach((tx) => {
    const refs = [tx.externalId, tx.clientId].filter(Boolean).map(text);
    const serverKey = refs.map((ref) => byExternalId.get(ref)).find(Boolean) || byServerId.get(text(tx.serverId));

    if (tx.editTransactionId) {
      const editRef = text(tx.editTransactionId);
      const targetKey = byServerId.get(editRef) || byExternalId.get(editRef) || localByRef.get(editRef);
      if (targetKey && merged.has(targetKey)) {
        const target = merged.get(targetKey);
        // Once the edit has synced, the cloud copy already includes it
        if (tx.synced !== true || target.source !== 'server') {
          merged.set(targetKey, { ...target, ...tx, source: 'local' });
        }
        return;
      }
      if (serverKey) return;
      if (serverTxs && tx.synced === true) return;
    }

    if (serverKey) return; // the cloud copy wins
    merged.set(localKeyOf(tx), { ...tx, source: 'local' });
  });

  return [...merged.values()].sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
}

/** Totals and lists for the Close Till screen. Only completed sales count towards takings. */
export function summarizeTillTransactions(transactions = []) {
  const summary = { totalSales: 0, transactionCount: 0, tenderBreakdown: {}, sales: [], voids: [], refunds: [], held: [], credit: [] };

  transactions.forEach((tx) => {
    const state = getTransactionState(tx);
    if (state === 'void') summary.voids.push(tx);
    else if (state === 'refund') summary.refunds.push(tx);
    else if (state === 'held') summary.held.push(tx);
    else if (state === 'credit') summary.credit.push(tx);
    else {
      const total = Number(tx.total || 0);
      summary.sales.push(tx);
      summary.totalSales += total;
      if (Array.isArray(tx.tenderPayments) && tx.tenderPayments.length > 0) {
        tx.tenderPayments.forEach((payment) => addTenderAmount(summary.tenderBreakdown, payment?.tenderName, payment?.amount, 'Cash'));
      } else {
        addTenderAmount(summary.tenderBreakdown, tx.tenderType, total, 'Cash');
      }
    }
  });

  summary.totalSales = Math.round(summary.totalSales * 100) / 100;
  summary.transactionCount = summary.sales.length;
  return summary;
}

/**
 * Terminals that took sales on this till, with any hand-over each one sent.
 * Local copies without a device id were made on this terminal.
 */
export function describeTillTerminals({ transactions = [], handovers = [], currentDeviceId = '', currentDeviceName = '' }) {
  const terminals = new Map();
  const terminalFor = (deviceId, deviceName) => {
    const key = deviceId || 'unknown';
    if (!terminals.has(key)) {
      terminals.set(key, {
        deviceId: deviceId || '',
        deviceName: deviceName || (deviceId ? `Terminal ${deviceId.replace(/[^a-z0-9]/gi, '').slice(-4).toUpperCase()}` : 'Earlier sales'),
        isCurrent: Boolean(deviceId) && deviceId === currentDeviceId,
        salesCount: 0,
        salesTotal: 0,
        handover: null,
      });
    }
    const terminal = terminals.get(key);
    if (deviceName) terminal.deviceName = deviceName;
    return terminal;
  };

  transactions.forEach((tx) => {
    if (getTransactionState(tx) !== 'sale') return;
    const deviceId = tx.deviceId || (tx.source === 'local' ? currentDeviceId : '');
    const terminal = terminalFor(deviceId, tx.deviceName || (deviceId === currentDeviceId ? currentDeviceName : ''));
    terminal.salesCount += 1;
    terminal.salesTotal = Math.round((terminal.salesTotal + Number(tx.total || 0)) * 100) / 100;
  });

  handovers.forEach((handover) => {
    if (!handover?.deviceId) return;
    const terminal = terminalFor(handover.deviceId, handover.deviceName);
    const current = terminal.handover;
    if (!current || new Date(handover.sentAt || 0) >= new Date(current.sentAt || 0)) terminal.handover = handover;
  });

  if (currentDeviceId) terminalFor(currentDeviceId, currentDeviceName);

  return [...terminals.values()].sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent) || a.deviceName.localeCompare(b.deviceName));
}
