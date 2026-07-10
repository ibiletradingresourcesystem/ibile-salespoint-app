const toPlainTenderObject = (source) => {
  if (!source) {
    return {};
  }

  if (typeof source.toJSON === 'function') {
    try {
      const json = source.toJSON();
      if (json && typeof json === 'object' && !Array.isArray(json)) {
        return json;
      }
    } catch (error) {
      // Fall through to the next strategy.
    }
  }

  if (typeof source.entries === 'function') {
    try {
      return Object.fromEntries(source.entries());
    } catch (error) {
      // Fall through to the next strategy.
    }
  }

  if (typeof source.forEach === 'function') {
    try {
      const result = {};
      source.forEach((value, key) => {
        result[key] = value;
      });
      return result;
    } catch (error) {
      // Fall through to the next strategy.
    }
  }

  return typeof source === 'object' && !Array.isArray(source) ? source : {};
};

export const normalizeTenderName = (value, fallback = '') => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || fallback;
  }

  if (value === null || value === undefined) {
    return fallback;
  }

  const normalized = String(value).trim();
  return normalized || fallback;
};

export const normalizeTenderPayments = (payments = [], fallback = 'CASH') => {
  if (!Array.isArray(payments)) {
    return [];
  }

  return payments.map((payment) => ({
    ...payment,
    tenderName: normalizeTenderName(payment?.tenderName, fallback),
    amount: Number(payment?.amount || 0),
  }));
};

export const addTenderAmount = (target, tenderName, amount, fallback = '') => {
  const key = normalizeTenderName(tenderName, fallback);

  if (!key) {
    return target;
  }

  target[key] = Number(target[key] || 0) + Number(amount || 0);
  return target;
};

export const normalizeTenderBreakdown = (source = {}, fallback = '') => {
  const normalized = {};

  Object.entries(toPlainTenderObject(source)).forEach(([key, amount]) => {
    addTenderAmount(normalized, key, amount, fallback);
  });

  return normalized;
};

export const toNormalizedTenderMap = (source = {}, fallback = '') =>
  new Map(Object.entries(normalizeTenderBreakdown(source, fallback)));

export const getTenderAmount = (source = {}, tenderName, fallback = '') => {
  const normalizedName = normalizeTenderName(tenderName, fallback);

  if (!normalizedName) {
    return 0;
  }

  return Object.entries(toPlainTenderObject(source)).reduce((total, [key, amount]) => {
    if (normalizeTenderName(key, fallback) !== normalizedName) {
      return total;
    }

    return total + Number(amount || 0);
  }, 0);
};