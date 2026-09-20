/**
 * GET /api/store/logo-data
 *
 * The store logo as a data URI, for the one job that needs its pixels: turning it into dots for a
 * thermal printer (src/lib/escposImage.js). A logo kept in cloud storage is on another origin, so
 * the page cannot read it out of a canvas; through here it arrives as same-origin data instead.
 *
 * The address is read from the store record, never from the request, so this cannot be used to
 * fetch anything else.
 */
import { mongooseConnect } from '@/src/lib/mongoose';
import Store from '@/src/models/Store';

const MAX_BYTES = 2 * 1024 * 1024;
const CACHE_MS = 10 * 60 * 1000;

let cache = { url: '', dataUrl: '', at: 0 };

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    await mongooseConnect();
    const store = await Store.findOne({}).select('logo').lean();
    const url = String(store?.logo || '').trim();

    if (!url) return res.status(200).json({ success: true, dataUrl: '' });
    if (url.startsWith('data:')) return res.status(200).json({ success: true, dataUrl: url });
    if (!/^https?:\/\//i.test(url)) return res.status(200).json({ success: true, dataUrl: '' });

    if (cache.url === url && cache.dataUrl && Date.now() - cache.at < CACHE_MS) {
      return res.status(200).json({ success: true, dataUrl: cache.dataUrl });
    }

    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const contentType = String(response.headers.get('content-type') || '');
    if (!response.ok || !contentType.startsWith('image/')) {
      return res.status(200).json({ success: true, dataUrl: '' });
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0 || buffer.length > MAX_BYTES) {
      return res.status(200).json({ success: true, dataUrl: '' });
    }

    const dataUrl = `data:${contentType.split(';')[0]};base64,${buffer.toString('base64')}`;
    cache = { url, dataUrl, at: Date.now() };
    return res.status(200).json({ success: true, dataUrl });
  } catch (error) {
    // No logo on the printout rather than a failed print
    return res.status(200).json({ success: true, dataUrl: '', message: error.message });
  }
}
