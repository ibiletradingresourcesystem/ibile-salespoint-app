/**
 * Browser side: detects the desktop app.
 *
 * The Electron preload (electron/preload.js) exposes window.posDesktop. In the desktop app the POS
 * API is the local server on this computer, so the preload also reports the browser as online to
 * the existing POS code; real cloud connectivity comes from /api/desktop/status instead.
 */

export const getDesktopBridge = () =>
  (typeof window !== 'undefined' && window.posDesktop?.isDesktop ? window.posDesktop : null);

export const isDesktopApp = () => Boolean(getDesktopBridge());
