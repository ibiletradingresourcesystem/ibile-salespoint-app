const STORAGE_KEY = 'uiSettings';

export const DIRECTOR_MEMO_ACCOUNT_OPTIONS = [
  {
    value: 'catherine-ashenuga-farrer',
    label: 'Catherine Ashenuga Farrer',
  },
  {
    value: 'paul-farrer',
    label: 'Paul Farrer',
  },
];

export const defaultUiSettings = {
  sidebarSections: {
    print: false,
    stock: false,
    apps: false,
  },
  adminControls: {
    openTillCashEntry: false,
    adjustFloat: false,
    pettyCash: true,
  },
  cartPanelButtons: {
    print: true,
    pettyCash: true,
    adjust: true,
    delete: true,
    hold: true,
    pay: true,
  },
  layout: {
    sidebarWidth: 'standard', // compact | standard | wide
    cartPanelWidth: 'standard', // compact | standard | wide
    contentDensity: 'comfortable', // compact | comfortable | spacious
    borderRadius: 'standard', // none | small | standard | large
    productCardTextSize: 'standard', // small | standard | large | extra-large
  },
  payment: {
    scale: 'standard', // compact | standard | large
    contentSize: 'standard', // compact | standard | large
    keypadSize: 'standard', // compact | standard | large
    quickAmounts: {
      500: true,
      1000: true,
      2000: true,
      5000: true,
      10000: true,
      20000: true,
      50000: true,
      exact: true,
    },
  },
  system: {
    contentScale: 100, // percentage (60 - 150) — scales content for screens where resolution can't be adjusted
    showPrintPreview: true, // show/hide the branded print preview modal (false = print silently)
    autoRefreshProducts: true, // auto-refresh product quantities after each sale when online
    directorMemoAccount: {
      active: false,
      selected: DIRECTOR_MEMO_ACCOUNT_OPTIONS[0].value,
    },
  },
  login: {
    showExitButton: true, // show/hide EXIT button on login page
    showClockInOut: true, // show/hide clock in/out button on login page
    visibleLocationIds: [], // empty = show all locations; populated = show only selected
  },
};

const isObject = (value) =>
  value && typeof value === 'object' && !Array.isArray(value);

const mergeDeep = (base, override) => {
  if (!isObject(base)) return override;
  const next = { ...base };

  if (!isObject(override)) {
    return next;
  }

  Object.keys(override).forEach((key) => {
    if (isObject(base[key]) && isObject(override[key])) {
      next[key] = mergeDeep(base[key], override[key]);
    } else if (override[key] !== undefined) {
      next[key] = override[key];
    }
  });

  return next;
};

export const getUiSettings = () => {
  if (typeof window === 'undefined') {
    return { ...defaultUiSettings };
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return { ...defaultUiSettings };
    }

    const parsed = JSON.parse(stored);
    return mergeDeep(defaultUiSettings, parsed);
  } catch (err) {
    console.warn('Failed to load UI settings, using defaults.', err);
    return { ...defaultUiSettings };
  }
};

export const saveUiSettings = (settings) => {
  if (typeof window === 'undefined') {
    return settings;
  }

  const merged = mergeDeep(defaultUiSettings, settings || {});
  localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  window.dispatchEvent(
    new CustomEvent('uiSettings:updated', { detail: merged })
  );
  return merged;
};

export const resetUiSettings = () => saveUiSettings(defaultUiSettings);
