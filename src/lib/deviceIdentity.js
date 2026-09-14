/**
 * A stable id and name for this POS terminal (kept in localStorage).
 * Used to tell terminals apart when several share one location's till.
 */

const ID_KEY = 'pos_device_id';
const NAME_KEY = 'pos_device_name';

const makeId = () => {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    // fall through
  }
  return `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

export function getDeviceId() {
  if (typeof window === 'undefined') return '';
  try {
    let id = localStorage.getItem(ID_KEY);
    if (!id) {
      id = makeId();
      localStorage.setItem(ID_KEY, id);
    }
    return id;
  } catch {
    return '';
  }
}

export function getDeviceName() {
  if (typeof window === 'undefined') return '';
  try {
    const saved = (localStorage.getItem(NAME_KEY) || '').trim();
    if (saved) return saved;
  } catch {
    // fall through
  }
  const id = getDeviceId();
  return id ? `Terminal ${id.replace(/[^a-z0-9]/gi, '').slice(-4).toUpperCase()}` : 'This terminal';
}
