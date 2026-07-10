/**
 * Component Styling Utilities
 * Reusable className builders for consistent styling
 */

import { colors, spacing, typography, borderRadius, shadows, components } from './designTokens';

// Button Styles
export const buttonStyles = {
  base: `
    ${components.button.transition}
    ${components.button.borderRadius}
    ${components.button.fontWeight}
    cursor-pointer
    inline-flex
    items-center
    justify-center
    gap-2
    disabled:opacity-50
    disabled:cursor-not-allowed
  `.trim().replace(/\s+/g, ' '),

  primary: `
    bg-blue-600
    text-white
    hover:bg-blue-700
    active:bg-blue-800
    focus:outline-none
    focus:ring-2
    focus:ring-blue-500
    focus:ring-offset-2
  `.trim().replace(/\s+/g, ' '),

  secondary: `
    bg-orange-500
    text-white
    hover:bg-orange-600
    active:bg-orange-700
    focus:outline-none
    focus:ring-2
    focus:ring-orange-500
    focus:ring-offset-2
  `.trim().replace(/\s+/g, ' '),

  outline: `
    border
    border-neutral-300
    text-neutral-700
    hover:bg-neutral-50
    active:bg-neutral-100
    focus:outline-none
    focus:ring-2
    focus:ring-blue-500
    focus:ring-offset-2
  `.trim().replace(/\s+/g, ' '),

  ghost: `
    text-neutral-700
    hover:bg-neutral-100
    active:bg-neutral-200
    focus:outline-none
    focus:ring-2
    focus:ring-blue-500
  `.trim().replace(/\s+/g, ' '),

  danger: `
    bg-red-600
    text-white
    hover:bg-red-700
    active:bg-red-800
    focus:outline-none
    focus:ring-2
    focus:ring-red-500
    focus:ring-offset-2
  `.trim().replace(/\s+/g, ' '),

  success: `
    bg-green-600
    text-white
    hover:bg-green-700
    active:bg-green-800
    focus:outline-none
    focus:ring-2
    focus:ring-green-500
    focus:ring-offset-2
  `.trim().replace(/\s+/g, ' '),

  sm: `px-3 py-1.5 text-sm`,
  md: `px-4 py-2 text-base`,
  lg: `px-6 py-3 text-lg`,
  xl: `px-8 py-4 text-xl`,
};

// Input Styles
export const inputStyles = {
  base: `
    ${components.input.padding}
    ${components.input.fontSize}
    ${components.input.borderRadius}
    w-full
    ${components.input.border}
    focus:outline-none
    focus:ring-2
    focus:ring-blue-500
    focus:ring-offset-0
    focus:border-blue-500
    ${components.input.transition}
    placeholder:text-neutral-400
  `.trim().replace(/\s+/g, ' '),

  error: `
    border-red-500
    focus:ring-red-500
    focus:border-red-500
  `.trim().replace(/\s+/g, ' '),

  disabled: `
    bg-neutral-100
    cursor-not-allowed
    opacity-60
  `.trim().replace(/\s+/g, ' '),
};

// Card Styles
export const cardStyles = {
  base: `
    ${components.card.backgroundColor}
    rounded-lg
    ${components.card.boxShadow}
    overflow-hidden
  `.trim().replace(/\s+/g, ' '),

  elevated: `
    ${components.card.backgroundColor}
    rounded-xl
    ${shadows.lg}
    overflow-hidden
  `.trim().replace(/\s+/g, ' '),

  outline: `
    ${components.card.backgroundColor}
    rounded-lg
    border
    border-neutral-200
    overflow-hidden
  `.trim().replace(/\s+/g, ' '),

  flat: `
    bg-neutral-50
    rounded-lg
    overflow-hidden
  `.trim().replace(/\s+/g, ' '),
};

// Modal Styles
export const modalStyles = {
  overlay: `
    fixed
    inset-0
    bg-black
    bg-opacity-50
    flex
    items-center
    justify-center
    z-50
    p-4
  `.trim().replace(/\s+/g, ' '),

  content: `
    ${components.modal.backgroundColor}
    ${components.modal.borderRadius}
    ${components.modal.boxShadow}
    w-full
    max-w-md
    max-h-[90vh]
    overflow-y-auto
  `.trim().replace(/\s+/g, ' '),

  large: `
    max-w-2xl
  `.trim().replace(/\s+/g, ' '),

  header: `
    px-6
    py-4
    border-b
    border-neutral-200
    flex
    items-center
    justify-between
  `.trim().replace(/\s+/g, ' '),

  body: `
    px-6
    py-4
  `.trim().replace(/\s+/g, ' '),

  footer: `
    px-6
    py-4
    border-t
    border-neutral-200
    flex
    gap-3
    justify-end
  `.trim().replace(/\s+/g, ' '),
};

// Badge Styles
export const badgeStyles = {
  base: `
    ${components.badge.padding}
    ${components.badge.fontSize}
    ${components.badge.borderRadius}
    ${components.badge.fontWeight}
    inline-block
    whitespace-nowrap
  `.trim().replace(/\s+/g, ' '),

  primary: `bg-blue-100 text-blue-800`,
  secondary: `bg-orange-100 text-orange-800`,
  success: `bg-green-100 text-green-800`,
  danger: `bg-red-100 text-red-800`,
  warning: `bg-yellow-100 text-yellow-800`,
  neutral: `bg-neutral-100 text-neutral-800`,
};

// Text Styles
export const textStyles = {
  h1: `text-4xl font-bold text-neutral-900`,
  h2: `text-3xl font-bold text-neutral-900`,
  h3: `text-2xl font-bold text-neutral-900`,
  h4: `text-xl font-semibold text-neutral-900`,
  h5: `text-lg font-semibold text-neutral-900`,
  h6: `text-base font-semibold text-neutral-900`,

  body: `text-base text-neutral-700`,
  bodySmall: `text-sm text-neutral-700`,
  bodySmallSecondary: `text-sm text-neutral-500`,
  caption: `text-xs text-neutral-500`,

  label: `text-sm font-medium text-neutral-700`,
  labelSmall: `text-xs font-medium text-neutral-600`,
};

// Layout Styles
export const layoutStyles = {
  container: `
    mx-auto
    px-4
    sm:px-6
    lg:px-8
    max-w-7xl
  `.trim().replace(/\s+/g, ' '),

  section: `
    py-8
    sm:py-12
    lg:py-16
  `.trim().replace(/\s+/g, ' '),

  gridCols2: `grid grid-cols-1 sm:grid-cols-2 gap-6`,
  gridCols3: `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6`,
  gridCols4: `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6`,
};

// Utility function to combine styles
export const cx = (...classes) => {
  return classes.filter(Boolean).join(' ');
};
