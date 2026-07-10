/**
 * API Endpoint: GET/PUT /api/ui-settings
 *
 * Store-level UI settings with local fallback in client.
 */

import { mongooseConnect } from '@/src/lib/mongoose';
import Store from '@/src/models/Store';
import { defaultUiSettings } from '@/src/lib/uiSettings';
import { sanitizeBody } from '@/src/lib/apiValidation';

const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

const mergeDeep = (base, override) => {
  if (!isObject(base)) return override;
  const next = { ...base };
  if (!isObject(override)) return next;
  Object.keys(override).forEach((key) => {
    if (isObject(base[key]) && isObject(override[key])) {
      next[key] = mergeDeep(base[key], override[key]);
    } else if (override[key] !== undefined) {
      next[key] = override[key];
    }
  });
  return next;
};

export default async function handler(req, res) {
  const { method } = req;
  const storeId = method === 'GET' ? req.query.storeId : req.body.storeId;

  if (!storeId) {
    return res.status(400).json({ success: false, message: 'storeId is required' });
  }

  try {
    await mongooseConnect();
    const store = await Store.findById(storeId);

    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found' });
    }

    if (method === 'GET') {
      const merged = mergeDeep(defaultUiSettings, store.uiSettings || {});
      return res.status(200).json({ success: true, settings: merged });
    }

    if (method === 'PUT') {
      req.body = sanitizeBody(req.body);
      const incoming = req.body.settings || {};
      const merged = mergeDeep(defaultUiSettings, incoming);
      store.uiSettings = merged;
      await store.save();
      return res.status(200).json({ success: true, settings: merged });
    }

    return res.status(405).json({ success: false, message: 'Method not allowed' });
  } catch (error) {
    console.error('UI settings error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}
