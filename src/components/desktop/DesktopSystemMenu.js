/**
 * Desktop app only: the SYSTEM button in the login and setup headers.
 *
 * The desktop window has no Windows title bar or menu, so its actions live here: sync, backups,
 * updates, logs, about, minimize. Restoring a backup and setting the POS up again need a manager or
 * admin passcode, which the app checks before doing anything.
 */

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faCog,
  faDatabase,
  faDownload,
  faFileAlt,
  faFolderOpen,
  faInfoCircle,
  faLink,
  faMinus,
  faSync,
  faUndo,
} from '@fortawesome/free-solid-svg-icons';
import { getDesktopBridge } from '../../lib/desktopClient';
import PinPad from './PinPad';

const MANAGER_ROLES = new Set(['admin', 'manager', 'senior staff']);

const PROTECTED = {
  restore: {
    title: 'Restore from backup',
    detail: 'The data on this computer will be replaced by a backup you choose next.',
    run: (bridge, manager) => bridge.restoreBackup(manager),
  },
  reenroll: {
    title: 'Set up this POS again',
    detail: 'This POS stops syncing until it is connected to the cloud database again. Data on this computer is kept.',
    run: (bridge, manager) => bridge.reenroll(manager),
  },
};

function Overlay({ children, onClose }) {
  return createPortal(
    <div className="desktop-no-drag fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={(event) => event.stopPropagation()}>{children}</div>
    </div>,
    document.body
  );
}

function ManagerConfirm({ action, bridge, onClose }) {
  const [managers, setManagers] = useState([]);
  const [staffId, setStaffId] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/staff/list', { cache: 'no-store' })
      .then((response) => response.json())
      .then((data) => {
        setManagers((data.data || []).filter(
          (member) => member.isActive !== false && MANAGER_ROLES.has(String(member.role || '').trim().toLowerCase())
        ));
      })
      .catch(() => setError('Could not load staff.'));
  }, []);

  const confirm = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await PROTECTED[action].run(bridge, { staffId, pin });
      if (result?.ok === false && !result.canceled) {
        setError(result.error || 'Not allowed');
        setPin('');
        return;
      }
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Overlay onClose={busy ? undefined : onClose}>
      <div className="w-[min(92vw,720px)] bg-gradient-to-b from-cyan-700 to-cyan-800 border border-cyan-500/60 rounded-2xl shadow-2xl p-5 text-white">
        <h2 className="font-bold text-lg tracking-wide">{PROTECTED[action].title.toUpperCase()}</h2>
        <p className="text-cyan-100 text-sm mt-1">{PROTECTED[action].detail} A manager or admin must confirm.</p>

        <div className="mt-4 flex flex-col md:flex-row gap-5">
          <div className="flex-1">
            <p className="text-white font-semibold text-xs mb-2">SELECT MANAGER</p>
            <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto">
              {managers.length === 0 && <div className="col-span-2 text-sm text-cyan-100">No managers available</div>}
              {managers.map((member) => (
                <button
                  key={member._id}
                  type="button"
                  onClick={() => setStaffId(member._id)}
                  className={`p-3 rounded-lg font-semibold transition flex flex-col items-center gap-1 ${
                    staffId === member._id ? 'bg-yellow-400 text-cyan-900 ring-2 ring-yellow-300' : 'bg-cyan-800 text-white hover:bg-cyan-700 border border-cyan-600'
                  }`}
                >
                  <span className={`w-9 h-9 rounded-full flex items-center justify-center font-bold ${staffId === member._id ? 'bg-cyan-700 text-white' : 'bg-cyan-600'}`}>
                    {member.name?.charAt(0)?.toUpperCase() || '?'}
                  </span>
                  <span className="text-xs break-words">{member.name}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="w-full md:w-72 flex-shrink-0 flex flex-col items-center">
            <PinPad value={pin} onChange={setPin} disabled={busy} />
            {error && (
              <div className="w-full max-w-xs mt-3 p-2.5 bg-red-600/95 text-white rounded-lg text-xs text-center font-semibold border border-red-400">
                {error}
              </div>
            )}
            <div className="w-full max-w-xs mt-3 flex gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="flex-1 py-3 rounded-lg border border-cyan-500/60 text-white font-bold hover:bg-cyan-700 disabled:opacity-50"
              >
                CANCEL
              </button>
              <button
                type="button"
                onClick={confirm}
                disabled={busy || !staffId || pin.length !== 4}
                className="flex-1 py-3 rounded-lg font-bold border border-cyan-500/60 bg-cyan-400 hover:bg-cyan-300 text-cyan-900 disabled:bg-gray-400 disabled:text-gray-600"
              >
                {busy ? 'CHECKING…' : 'CONFIRM'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Overlay>
  );
}

function About({ bridge, onClose }) {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    bridge.getInfo().then(setInfo).catch(() => setInfo({}));
  }, [bridge]);

  const rows = info && [
    ['Version', info.appVersion],
    ['Computer name', info.installationName],
    ['Installation ID', info.installationId],
    ['Location', info.locationName || '—'],
    ['Cloud database', info.enrolled ? `${info.cloudHost} / ${info.cloudDbName}` : 'Not set up'],
    ['Data folder', info.dataFolder],
  ];

  return (
    <Overlay onClose={onClose}>
      <div className="w-[min(92vw,520px)] bg-gradient-to-b from-cyan-700 to-cyan-800 border border-cyan-500/60 rounded-2xl shadow-2xl p-5 text-white">
        <div className="flex items-center gap-3">
          <div className="w-14 h-14 bg-white rounded-full flex items-center justify-center shadow-lg overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/images/logo.png" alt="Ibile" className="w-11 h-11 object-contain" />
          </div>
          <div>
            <h2 className="font-bold text-lg">Ibile POS</h2>
            <p className="text-cyan-100 text-sm">Desktop System POS</p>
          </div>
        </div>
        <dl className="mt-4 space-y-2 text-sm">
          {(rows || []).map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4 border-b border-cyan-600/50 pb-1.5">
              <dt className="text-cyan-100">{label}</dt>
              <dd className="font-semibold text-right break-all">{value || '—'}</dd>
            </div>
          ))}
        </dl>
        <button type="button" onClick={onClose} className="mt-5 w-full py-3 rounded-lg font-bold bg-cyan-400 hover:bg-cyan-300 text-cyan-900">
          CLOSE
        </button>
      </div>
    </Overlay>
  );
}

export default function DesktopSystemMenu({ variant = 'login', className = '' }) {
  const [bridge, setBridge] = useState(null);
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState(null); // 'restore' | 'reenroll' | 'about'
  const [notice, setNotice] = useState('');
  const menuRef = useRef(null);

  useEffect(() => {
    setBridge(getDesktopBridge());
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(''), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  if (!bridge) return null;

  const run = (action) => async () => {
    setOpen(false);
    await action();
  };

  const items = [
    ...(variant === 'login'
      ? [
          { label: 'Sync now', icon: faSync, action: async () => { await bridge.syncNow(); setNotice('Sync started'); } },
          { label: 'Back up now', icon: faDatabase, action: () => bridge.backupNow() },
          { label: 'Open backups folder', icon: faFolderOpen, action: () => bridge.openBackupsFolder() },
          { label: 'Restore from backup…', icon: faUndo, action: () => setDialog('restore') },
          { label: 'Check for updates', icon: faDownload, action: () => bridge.checkForUpdates() },
          { label: 'Set up this POS again…', icon: faLink, action: () => setDialog('reenroll') },
        ]
      : []),
    { label: 'Open logs folder', icon: faFileAlt, action: () => bridge.openLogsFolder() },
    { label: 'About Ibile POS', icon: faInfoCircle, action: () => setDialog('about') },
    { label: 'Minimize', icon: faMinus, action: () => bridge.minimize() },
  ];

  return (
    <div ref={menuRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="px-4 py-1.5 border-2 border-white text-white rounded-full font-semibold text-sm hover:bg-cyan-600 transition flex items-center gap-2"
      >
        <FontAwesomeIcon icon={faCog} className="w-4 h-4" />
        SYSTEM
      </button>

      {open && (
        <div role="menu" className="desktop-no-drag absolute right-0 top-full mt-2 w-64 z-50 bg-cyan-800 border border-cyan-500/60 rounded-xl shadow-2xl py-1.5 text-white">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={run(item.action)}
              className="w-full px-4 py-2.5 text-left text-sm font-semibold hover:bg-cyan-700 flex items-center gap-3"
            >
              <FontAwesomeIcon icon={item.icon} className="w-4 h-4 text-cyan-200" />
              {item.label}
            </button>
          ))}
        </div>
      )}

      {notice && (
        <div className="desktop-no-drag absolute right-0 top-full mt-2 whitespace-nowrap z-50 bg-green-600 text-white text-xs font-semibold px-3 py-2 rounded-lg shadow-lg">
          {notice}
        </div>
      )}

      {(dialog === 'restore' || dialog === 'reenroll') && (
        <ManagerConfirm action={dialog} bridge={bridge} onClose={() => setDialog(null)} />
      )}
      {dialog === 'about' && <About bridge={bridge} onClose={() => setDialog(null)} />}
    </div>
  );
}

/** Minimize button for the POS top bar (desktop app only). */
export function DesktopMinimizeButton({ className = '' }) {
  const [bridge, setBridge] = useState(null);
  useEffect(() => {
    setBridge(getDesktopBridge());
  }, []);
  if (!bridge) return null;
  return (
    <button
      type="button"
      onClick={() => bridge.minimize()}
      title="Minimize"
      className={`p-1.5 sm:p-2 hover:bg-white/20 rounded transition-colors touch-manipulation min-h-9 min-w-9 sm:min-h-10 sm:min-w-10 ${className}`}
    >
      <FontAwesomeIcon icon={faMinus} className="w-5 h-5" />
    </button>
  );
}
