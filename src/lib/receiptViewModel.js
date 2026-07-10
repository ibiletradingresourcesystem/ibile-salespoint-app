const DEFAULT_COMPANY_NAME = 'Store';
const DEFAULT_RECEIPT_MESSAGE = '';
const DEFAULT_QR_DESCRIPTION = '';
const DIRECTOR_MEMO_ACCOUNTS = [
  {
    value: 'catherine-ashenuga-farrer',
    label: 'Catherine Ashenuga Farrer',
  },
  {
    value: 'paul-farrer',
    label: 'Paul Farrer',
  },
];

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const cleanString = (value) => String(value || '').trim();

export function escapeHtml(value) {
  return cleanString(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

export function formatReceiptNaira(amount) {
  return `₦${toNumber(amount).toLocaleString('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatReceiptDateTime(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return '';

  return date.toLocaleString('en-NG', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function normalizeReceiptFontSize(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 6.5;
  return Math.min(9, Math.max(4, parsed));
}

const getLineTotal = (item) => {
  const explicitTotal = item?.lineTotal ?? item?.total;
  if (explicitTotal !== undefined && explicitTotal !== null) return toNumber(explicitTotal);
  return toNumber(item?.price || item?.unitPrice || item?.salePriceIncTax) * toNumber(item?.quantity || item?.qty || 1, 1);
};

const getItemUnitPrice = (item) => {
  const quantity = Math.max(1, toNumber(item?.quantity || item?.qty || 1, 1));
  if (item?.price !== undefined || item?.unitPrice !== undefined || item?.salePriceIncTax !== undefined) {
    return toNumber(item?.price || item?.unitPrice || item?.salePriceIncTax);
  }
  return getLineTotal(item) / quantity;
};

const getAdjustmentAmount = (transaction, keys = []) => {
  for (const key of keys) {
    const value = toNumber(transaction?.[key], 0);
    if (value > 0) return value;
  }
  return 0;
};

const pushAmountLine = (lines, label, amount, type = 'add') => {
  const numericAmount = toNumber(amount, 0);
  if (numericAmount <= 0) return;
  lines.push({ label, amount: numericAmount, type });
};

const getNamedAdjustments = (transaction, baseDiscount, incrementAmount) => {
  const lines = [];

  const discountName = cleanString(
    transaction?.discountName ||
    transaction?.discountLabel ||
    transaction?.promotionName ||
    transaction?.appliedPromotion?.name ||
    transaction?.customerType
  ) || 'Discount';

  pushAmountLine(lines, discountName, baseDiscount, 'subtract');

  const incrementName = cleanString(
    transaction?.incrementName ||
    transaction?.incrementLabel ||
    transaction?.promotionName ||
    transaction?.appliedPromotion?.name
  ) || 'Price Adjustment';
  pushAmountLine(lines, incrementName, incrementAmount, 'add');

  const deliveryFeeName = cleanString(
    transaction?.deliveryFeeName ||
    transaction?.shippingName ||
    transaction?.shippingLabel ||
    transaction?.deliveryName ||
    'Delivery Fee'
  );
  pushAmountLine(lines, deliveryFeeName, getAdjustmentAmount(transaction, ['deliveryFee', 'deliveryCharge', 'shippingCost', 'shippingFee']), 'add');
  pushAmountLine(lines, 'Service Fee', getAdjustmentAmount(transaction, ['serviceFee', 'serviceCharge']), 'add');
  pushAmountLine(lines, 'Handling Fee', getAdjustmentAmount(transaction, ['handlingFee', 'handlingCharge']), 'add');

  const additionalLines = [
    ...(Array.isArray(transaction?.additionalCharges) ? transaction.additionalCharges : []),
    ...(Array.isArray(transaction?.fees) ? transaction.fees : []),
    ...(Array.isArray(transaction?.adjustments) ? transaction.adjustments : []),
  ];

  additionalLines.forEach((line) => {
    const amount = toNumber(line?.amount || line?.value, 0);
    if (amount <= 0) return;
    const rawType = cleanString(line?.type).toLowerCase();
    const type = rawType === 'discount' || rawType === 'subtract' ? 'subtract' : 'add';
    const label = cleanString(line?.name || line?.label || (type === 'subtract' ? 'Discount' : 'Fee'));
    lines.push({ label, amount, type });
  });

  return lines;
};

const getQrImageSrc = (settings) => {
  const dataUrl = cleanString(settings?.qrDataUrl);
  if (dataUrl) return dataUrl;

  const qrUrl = cleanString(settings?.qrUrl);
  if (!qrUrl) return '';

  return `https://api.qrserver.com/v1/create-qr-code/?size=110x110&margin=1&data=${encodeURIComponent(qrUrl)}`;
};

const getDirectorMemoAccount = (settings = {}) => {
  const config = settings.directorMemoAccount || settings.system?.directorMemoAccount || {};
  const selected = cleanString(config.selected || config.value || config.name);
  const option = DIRECTOR_MEMO_ACCOUNTS.find((account) => (
    account.value === selected || account.label.toLowerCase() === selected.toLowerCase()
  )) || DIRECTOR_MEMO_ACCOUNTS[0];

  return {
    active: config.active === true,
    value: option.value,
    name: option.label,
  };
};

export function buildReceiptViewModel(transaction = {}, settings = {}) {
  const rawItems = Array.isArray(transaction.items) ? transaction.items : [];
  const items = rawItems.map((item) => {
    const quantity = toNumber(item?.quantity || item?.qty || 1, 1);
    const unitPrice = getItemUnitPrice(item);
    const lineTotal = getLineTotal(item);

    return {
      name: cleanString(item?.name || item?.productName || item?.description || 'Item'),
      quantity,
      unitPrice,
      lineTotal,
    };
  });

  const itemSubtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
  const subtotal = toNumber(transaction.subtotal, itemSubtotal) || itemSubtotal;
  const tax = toNumber(transaction.tax, 0);
  const discount = toNumber(transaction.discount ?? transaction.discountAmount, 0);
  const incrementAmount = toNumber(transaction.incrementAmount, 0);
  const adjustmentLines = getNamedAdjustments(transaction, discount, incrementAmount);
  const adjustmentTotal = adjustmentLines.reduce((sum, line) => (
    line.type === 'subtract' ? sum - line.amount : sum + line.amount
  ), 0);
  const computedTotal = Math.max(0, subtotal + tax + adjustmentTotal);
  const total = toNumber(transaction.total, computedTotal) || computedTotal;
  const change = toNumber(transaction.change, 0);
  const amountPaid = toNumber(transaction.amountPaid, total);
  const paymentStatus = cleanString(transaction.status || settings.paymentStatus || 'paid').toUpperCase() === 'UNPAID'
    ? 'UNPAID'
    : 'PAID';
  const locationName = cleanString(transaction.locationName || transaction.location || settings.locationName || settings.storeName);
  const companyName = cleanString(settings.companyDisplayName || settings.companyName || settings.storeName || DEFAULT_COMPANY_NAME);
  const storePhone = cleanString(settings.storePhone || transaction.locationPhone);
  const website = cleanString(settings.website);
  const email = cleanString(settings.email);
  const contactLine = [storePhone ? `Tel: ${storePhone}` : '', website, email].filter(Boolean).join(' | ');
  const receiptId = cleanString(transaction._id || transaction.id || transaction.externalId || transaction.clientId).slice(0, 12).toUpperCase();
  const tenderPayments = Array.isArray(transaction.tenderPayments) && transaction.tenderPayments.length > 0
    ? transaction.tenderPayments
    : [{ tenderName: transaction.tenderType || 'CASH', amount: amountPaid || total }];

  return {
    companyName,
    companyLogo: cleanString(settings.companyLogo || settings.logo),
    locationName: locationName || companyName,
    address: cleanString(transaction.locationAddress || settings.businessAddress || settings.address),
    contactLine,
    taxNumber: cleanString(settings.taxNumber),
    title: 'Sales Receipt',
    dateTime: formatReceiptDateTime(transaction.createdAt || transaction.timestamp || transaction.completedAt),
    receiptId,
    staffName: cleanString(transaction.staffName || transaction.staff?.name || 'POS Staff'),
    tillLabel: cleanString(transaction.tillNumber || transaction.tillId) || 'Till',
    status: paymentStatus,
    fontSize: normalizeReceiptFontSize(settings.fontSize),
    fontFamily: cleanString(settings.fontFamily) || 'Arial',
    items,
    totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
    subtotal,
    tax,
    adjustmentLines,
    total,
    amountPaid,
    change,
    tenderPayments: tenderPayments.map((payment) => ({
      name: cleanString(payment?.tenderName || payment?.name || transaction.tenderType || 'CASH'),
      amount: toNumber(payment?.amount, total),
    })),
    qrUrl: cleanString(settings.qrUrl),
    qrImageSrc: getQrImageSrc(settings),
    qrDescription: cleanString(settings.qrDescription || DEFAULT_QR_DESCRIPTION),
    receiptMessage: cleanString(settings.receiptMessage || DEFAULT_RECEIPT_MESSAGE),
    refundDays: toNumber(settings.refundDays, 0),
    directorMemoAccount: getDirectorMemoAccount(settings),
  };
}
