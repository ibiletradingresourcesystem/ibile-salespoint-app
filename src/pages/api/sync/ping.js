/**
 * GET /api/sync/ping
 * Lightweight reachability check used by desktop installations before syncing.
 */

export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ success: true, service: 'ibile-pos-sync', serverTime: new Date().toISOString() });
}
