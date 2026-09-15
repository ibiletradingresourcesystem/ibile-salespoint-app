/**
 * Logo Cache Utility
 * 
 * Manages permanent caching of the store logo URL.
 * After first load from the database, the logo URL is stored in localStorage
 * and used everywhere across the system — even offline.
 * 
 * Usage:
 *   import { getStoreLogo, setStoreLogo } from '@/src/lib/logoCache';
 *   const logo = getStoreLogo();  // returns cached URL or fallback
 */

const LOGO_CACHE_KEY = 'cachedStoreLogo';
const FALLBACK_LOGO = '/images/placeholder.jpg';

/**
 * Get the cached store logo URL.
 * Returns the permanently stored logo, or fallback if none cached yet.
 */
export function getStoreLogo() {
  if (typeof window === 'undefined') return FALLBACK_LOGO;
  try {
    const cached = localStorage.getItem(LOGO_CACHE_KEY);
    return cached || FALLBACK_LOGO;
  } catch {
    return FALLBACK_LOGO;
  }
}

/**
 * Logo for screens shown before or around login. In the desktop app, when no store logo is cached
 * yet (or it cannot load offline), the Ibile logo is shown instead of the grey placeholder.
 * Receipts keep using getStoreLogo().
 */
export function getBrandFallbackLogo() {
  if (typeof window !== 'undefined' && window.posDesktop?.isDesktop) return '/images/logo.png';
  return FALLBACK_LOGO;
}

export function getDisplayLogo() {
  return hasStoreLogo() ? getStoreLogo() : getBrandFallbackLogo();
}

/**
 * Save the store logo URL permanently to localStorage.
 * Only updates if the value is a valid non-empty string.
 * @param {string} logoUrl - The logo URL from store data
 */
export function setStoreLogo(logoUrl) {
  if (typeof window === 'undefined') return;
  if (!logoUrl || typeof logoUrl !== 'string' || logoUrl.trim() === '') return;
  try {
    localStorage.setItem(LOGO_CACHE_KEY, logoUrl.trim());
    console.log('✅ Store logo cached permanently:', logoUrl.trim());
  } catch (err) {
    console.warn('⚠️ Could not cache store logo:', err.message);
  }
}

/**
 * Check if a store logo has been cached.
 * @returns {boolean}
 */
export function hasStoreLogo() {
  if (typeof window === 'undefined') return false;
  try {
    return !!localStorage.getItem(LOGO_CACHE_KEY);
  } catch {
    return false;
  }
}
