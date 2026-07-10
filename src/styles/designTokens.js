/**
 * Design System Tokens
 * Centralized styling constants for consistency across the app
 */

export const colors = {
  // Primary Colors
  primary: {
    50: '#f0f9ff',
    100: '#e0f2fe',
    200: '#bae6fd',
    300: '#7dd3fc',
    400: '#38bdf8',
    500: '#0ea5e9',
    600: '#0284c7',
    700: '#0369a1',
    800: '#075985',
    900: '#0c3d66',
  },

  // Secondary Colors - Orange (for CTAs, important actions)
  secondary: {
    50: '#fff7ed',
    100: '#ffedd5',
    200: '#fed7aa',
    300: '#fdba74',
    400: '#fb923c',
    500: '#f97316',
    600: '#ea580c',
    700: '#c2410c',
    800: '#9a3412',
    900: '#7c2d12',
  },

  // Success Colors
  success: {
    50: '#f0fdf4',
    100: '#dcfce7',
    200: '#bbf7d0',
    400: '#4ade80',
    500: '#22c55e',
    600: '#16a34a',
    700: '#15803d',
    900: '#14532d',
  },

  // Error/Danger Colors
  error: {
    50: '#fef2f2',
    100: '#fee2e2',
    200: '#fecaca',
    400: '#f87171',
    500: '#ef4444',
    600: '#dc2626',
    700: '#b91c1c',
    900: '#7f1d1d',
  },

  // Warning Colors
  warning: {
    50: '#fffbeb',
    100: '#fef3c7',
    200: '#fde68a',
    400: '#fbbf24',
    500: '#f59e0b',
    600: '#d97706',
    700: '#b45309',
    900: '#78350f',
  },

  // Neutral/Gray Colors
  neutral: {
    50: '#f9fafb',
    100: '#f3f4f6',
    150: '#ececf1',
    200: '#e5e7eb',
    300: '#d1d5db',
    400: '#9ca3af',
    500: '#6b7280',
    600: '#4b5563',
    700: '#374151',
    800: '#1f2937',
    900: '#111827',
  },

  // Semantic Colors
  background: '#ffffff',
  surface: '#f9fafb',
  border: '#e5e7eb',
  text: {
    primary: '#111827',
    secondary: '#6b7280',
    tertiary: '#9ca3af',
    inverse: '#ffffff',
  },
};

export const spacing = {
  0: '0',
  1: '0.25rem',    // 4px
  2: '0.5rem',     // 8px
  3: '0.75rem',    // 12px
  4: '1rem',       // 16px
  6: '1.5rem',     // 24px
  8: '2rem',       // 32px
  10: '2.5rem',    // 40px
  12: '3rem',      // 48px
  16: '4rem',      // 64px
};

export const typography = {
  // Font sizes - increased
  fontSize: {
    xs: '14px',
    sm: '16px',
    base: '18px',
    lg: '20px',
    xl: '22px',
    '2xl': '28px',
    '3xl': '32px',
    '4xl': '40px',
  },

  // Font weights
  fontWeight: {
    light: 300,
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
    extrabold: 800,
  },

  // Line heights
  lineHeight: {
    tight: 1.2,
    normal: 1.5,
    relaxed: 1.6,
    loose: 1.75,
  },

  // Letter spacing
  letterSpacing: {
    tight: '-0.01em',
    normal: '0em',
    wide: '0.02em',
  },
};

export const borderRadius = {
  none: '0px',
  sm: '0.25rem',   // 4px
  base: '0.375rem', // 6px
  md: '0.5rem',    // 8px
  lg: '0.75rem',   // 12px
  xl: '1rem',      // 16px
  '2xl': '1.5rem', // 24px
  full: '9999px',
};

export const shadows = {
  none: 'none',
  sm: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
  base: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)',
  md: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
  lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
  xl: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
};

export const transitions = {
  fast: '150ms',
  base: '200ms',
  slow: '300ms',
  slowest: '500ms',
  timing: 'cubic-bezier(0.4, 0, 0.2, 1)',
};

// Component specific tokens
export const components = {
  button: {
    padding: {
      sm: `${spacing[2]} ${spacing[4]}`,
      md: `${spacing[3]} ${spacing[6]}`,
      lg: `${spacing[4]} ${spacing[8]}`,
    },
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
    borderRadius: borderRadius.lg,
    transition: `all ${transitions.base} ${transitions.timing}`,
  },

  input: {
    padding: `${spacing[3]} ${spacing[4]}`,
    fontSize: typography.fontSize.base,
    borderRadius: borderRadius.md,
    border: `1px solid ${colors.neutral[300]}`,
    transition: `all ${transitions.base} ${transitions.timing}`,
  },

  card: {
    padding: spacing[6],
    borderRadius: borderRadius.lg,
    boxShadow: shadows.base,
    backgroundColor: colors.background,
  },

  modal: {
    borderRadius: borderRadius.xl,
    boxShadow: shadows.xl,
    backgroundColor: colors.background,
  },

  badge: {
    padding: `${spacing[1]} ${spacing[3]}`,
    fontSize: typography.fontSize.xs,
    borderRadius: borderRadius.full,
    fontWeight: typography.fontWeight.semibold,
  },
};
