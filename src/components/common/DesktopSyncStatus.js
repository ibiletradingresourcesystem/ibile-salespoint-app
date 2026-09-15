/**
 * Desktop app only: cloud connection and sync state in the POS top bar.
 * ONLINE · OFFLINE · SYNCING · SYNCED · SYNC ERROR, with details and "Sync now" on click.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { isDesktopApp } from '../../lib/desktopClient';

const LABELS = {
  checking: 'ONLINE',
  online: 'ONLINE',
  syncing: 'SYNCING',
  synced: 'SYNCED',
  offline: 'OFFLINE',
  error: 'SYNC ERROR',
  auth_error: 'SYNC ERROR',
  not_enrolled: 'NOT SET UP',
};

const STYLES = {
  checking: 'bg-white/20',
  online: 'bg-sky-500',
  syncing: 'bg-sky-500 animate-pulse',
  synced: 'bg-green-600',
  offline: 'bg-amber-500',
  error: 'bg-red-600',
  auth_error: 'bg-red-600',
  not_enrolled: 'bg-red-600',
};

const formatTime = (value) => {
  if (!value) return 'Never';
  const date = new Date(value);
  const minutes = Math.round((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  return date.toLocaleString('en-NG', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

const ENTITY_LABELS = {
  transactions: 'Sale',
  tills: 'Till',
  endofdayreports: 'End of day report',
  customers: 'Customer',
  staff_clock: 'Clock record',
  store_ui_settings: 'Display settings',
};

export default function DesktopSyncStatus() {
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState(null);
  const [open, setOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [attention, setAttention] = useState([]);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/desktop/status', { cache: 'no-store' });
      setStatus(await response.json());
    } catch {
      setStatus({ phase: 'error', lastError: 'The local POS service is not responding' });
    }
  }, []);

  useEffect(() => {
    if (!isDesktopApp()) return undefined;
    setEnabled(true);
    refresh();

    const interval = setInterval(refresh, 5000);
    const refreshSoon = () => setTimeout(refresh, 2500);
    window.addEventListener('transactions:completed', refreshSoon);
    window.addEventListener('pos:sync-state-changed', refreshSoon);
    return () => {
      clearInterval(interval);
      window.removeEventListener('transactions:completed', refreshSoon);
      window.removeEventListener('pos:sync-state-changed', refreshSoon);
    };
  }, [refresh]);

  const syncNow = async () => {
    setSyncing(true);
    try {
      await fetch('/api/desktop/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true, wait: true }),
      });
    } catch {
      // Status refresh below shows the result
    } finally {
      await refresh();
      setSyncing(false);
    }
  };

  const needsAttention = Number(status?.failed || 0) + Number(status?.conflicts || 0);

  useEffect(() => {
    if (!open || needsAttention === 0) {
      setAttention([]);
      return;
    }
    fetch('/api/desktop/outbox?status=failed,conflict', { cache: 'no-store' })
      .then((response) => response.json())
      .then((data) => setAttention(data.entries || []))
      .catch(() => setAttention([]));
  }, [open, needsAttention]);

  const retry = async (ids) => {
    await fetch('/api/desktop/outbox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'retry', ids }),
    }).catch(() => {});
    setTimeout(refresh, 3000);
  };

  if (!enabled || !status) return null;

  const phase = LABELS[status.phase] ? status.phase : 'error';

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={`px-2 py-1 rounded-full text-[10px] sm:text-xs font-bold text-white whitespace-nowrap touch-manipulation ${STYLES[phase]}`}
        title="Cloud sync status"
      >
        {LABELS[phase]}
        {status.pending > 0 ? ` · ${status.pending}` : ''}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-72 bg-white text-gray-800 rounded-lg shadow-xl z-50 p-4 text-sm">
          <div className="font-semibold mb-2">Cloud sync</div>
          <dl className="space-y-1">
            <div className="flex justify-between gap-2">
              <dt className="text-gray-500">Connection</dt>
              <dd className="font-medium">{status.cloudReachable === false ? 'Offline' : 'Online'}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-gray-500">Waiting to sync</dt>
              <dd className="font-medium">{status.pending ?? 0}</dd>
            </div>
            {needsAttention > 0 && (
              <div className="flex justify-between gap-2 text-red-700">
                <dt>Needs attention</dt>
                <dd className="font-medium">{needsAttention}</dd>
              </div>
            )}
            <div className="flex justify-between gap-2">
              <dt className="text-gray-500">Last synced</dt>
              <dd className="font-medium">{formatTime(status.lastSuccessAt)}</dd>
            </div>
          </dl>

          {status.cloudReachable === false && (
            <p className="mt-3 text-xs text-gray-600">
              Sales are saved on this computer and will sync automatically when the internet is back.
            </p>
          )}
          {status.phase === 'auth_error' && (
            <p className="mt-3 text-xs text-red-700">
              This POS is no longer authorised to sync. Ask a manager to set it up again from the app menu.
            </p>
          )}
          {status.lastError && status.phase !== 'offline' && (
            <p className="mt-3 text-xs text-red-700 break-words">{status.lastError}</p>
          )}

          {attention.length > 0 && (
            <div className="mt-3 border-t pt-3">
              <div className="text-xs font-semibold text-gray-700 mb-1">Not accepted by the cloud</div>
              <ul className="space-y-2 max-h-40 overflow-y-auto">
                {attention.slice(0, 10).map((entry) => (
                  <li key={entry._id} className="text-xs">
                    <div className="font-medium">
                      {ENTITY_LABELS[entry.entity] || entry.entity} · {entry.status === 'conflict' ? 'conflict' : 'rejected'}
                    </div>
                    <div className="text-gray-600 break-words">{entry.error}</div>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-gray-500">
                The data is kept on this computer. Ask a manager to check it in the management app, then retry.
              </p>
              <button
                type="button"
                onClick={() => retry(attention.map((entry) => entry._id))}
                className="mt-2 w-full rounded-md border border-cyan-600 text-cyan-700 font-semibold py-1.5 text-xs"
              >
                Retry these
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={syncNow}
            disabled={syncing || status.cloudReachable === false}
            className="mt-3 w-full rounded-md bg-cyan-600 hover:bg-cyan-700 disabled:bg-gray-300 text-white font-semibold py-2"
          >
            {syncing ? 'Syncing…' : 'Sync now'}
          </button>
        </div>
      )}
    </div>
  );
}
