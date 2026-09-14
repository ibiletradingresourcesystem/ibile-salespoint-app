/**
 * Corner radius scale driven by Settings → Layout → Border Radius.
 * Every rounded-* class reads these CSS variables, so one setting changes the whole POS.
 */

export const RADIUS_SCALES = {
  none: { sm: '0px', md: '0px', lg: '0px', xl: '0px', '2xl': '0px', pos: '0px' },
  small: { sm: '0.0625rem', md: '0.125rem', lg: '0.1875rem', xl: '0.25rem', '2xl': '0.3125rem', pos: '3px' },
  standard: { sm: '0.125rem', md: '0.25rem', lg: '0.375rem', xl: '0.5rem', '2xl': '0.625rem', pos: '6px' },
  large: { sm: '0.22rem', md: '0.38rem', lg: '0.58rem', xl: '0.82rem', '2xl': '1.02rem', pos: '12px' },
};

export function applyRadiusScale(preset, root = document.documentElement) {
  if (!root) return;
  const scale = RADIUS_SCALES[preset] || RADIUS_SCALES.standard;
  root.style.setProperty('--radius-sm', scale.sm);
  root.style.setProperty('--radius-md', scale.md);
  root.style.setProperty('--radius-lg', scale.lg);
  root.style.setProperty('--radius-xl', scale.xl);
  root.style.setProperty('--radius-2xl', scale['2xl']);
  root.style.setProperty('--pos-radius', scale.pos);
}
