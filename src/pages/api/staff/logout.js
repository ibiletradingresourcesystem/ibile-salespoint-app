/**
 * API Endpoint: POST /api/staff/logout
 * 
 * Clears the session cookie to end the authenticated session.
 */

import { clearSessionCookie } from '@/src/lib/sessionAuth';

export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  clearSessionCookie(res);
  return res.status(200).json({ success: true, message: 'Logged out' });
}
