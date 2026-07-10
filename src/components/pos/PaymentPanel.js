/**
 * PaymentPanel Component
 *
 * Renders the payment flow inline on the content side.
 */

import React, { useState, useEffect } from "react";
import Image from "next/image";
import { useCart } from "../../context/CartContext";
import { useStaff } from "../../context/StaffContext";
import { useErrorHandler } from "../../hooks/useErrorHandler";
import {
  saveTransactionOffline,
  getOnlineStatus,
  syncPendingTransactions,
  resolveTillId,
} from "../../lib/offlineSync";
import {
  printTransactionReceipt,
  getReceiptSettings,
} from "../../lib/receiptPrinting";
import PaymentModal from "./PaymentModal";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowLeft } from "@fortawesome/free-solid-svg-icons";
import { getUiSettings } from "@/src/lib/uiSettings";
import { getStoreLogo } from "@/src/lib/logoCache";
import ThankYouNote from "./ThankYouNote";
import OpenTillModal from "./OpenTillModal";
import { showToast } from '../common/Toast';

export default function PaymentPanel() {
  const ONLINE_PAYMENT_CHANNELS = new Set(['paystack', 'paystack-webhook', 'online']);
  const [showThankYouModal, setShowThankYouModal] = useState(false);
  const [showOpenTillModal, setShowOpenTillModal] = useState(false);
  const [receiptSettings, setReceiptSettings] = useState(null);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const { staff, location, till } = useStaff();
  const { handleError } = useErrorHandler();
  const {
    activeCart,
    calculateTotals,
    completeOrder,
    showPaymentPanel,
    setShowPaymentPanel,
  } = useCart();

  const totals = calculateTotals();
  const isEmpty = activeCart.items.length === 0;
  const onlineOrderContext = activeCart.onlineOrder || null;
  const isOnlineOrderCheckout = Boolean(onlineOrderContext?.id);
  const requestedFinalStatus = onlineOrderContext?.requestedFinalStatus === 'Delivered' ? 'Delivered' : 'Processing';
  const onlineOrderStatus = String(onlineOrderContext?.status || '').trim();
  const onlineOrderTotal = isOnlineOrderCheckout
    ? Number(activeCart.total || totals.total || 0)
    : Number(totals.total || 0);
  const onlineOrderSubtotal = isOnlineOrderCheckout
    ? Number(activeCart.subtotal || totals.subtotal || onlineOrderTotal || 0)
    : Number(totals.subtotal || 0);
  const onlineOrderShippingCost = Number(onlineOrderContext?.shippingCost || onlineOrderContext?.deliveryFee || 0);
  const onlineOrderDiscount = Number(onlineOrderContext?.discount || onlineOrderContext?.discountAmount || 0);
  const normalizedOnlinePaymentChannel = String(onlineOrderContext?.paymentChannel || '').trim().toLowerCase();
  const prepaidTenderName = ONLINE_PAYMENT_CHANNELS.has(normalizedOnlinePaymentChannel) ? 'ONLINE' : 'MANUAL ENTRY';
  const isPrepaidOnlineOrder = isOnlineOrderCheckout && (
    Boolean(onlineOrderContext?.paid) ||
    onlineOrderContext?.paymentStatus === 'Paid'
  );
  const [uiSettings, setUiSettings] = useState(getUiSettings());

  useEffect(() => {
    const handleSettingsUpdate = (event) => {
      if (event?.detail) {
        setUiSettings(event.detail);
      } else {
        setUiSettings(getUiSettings());
      }
    };

    handleSettingsUpdate();
    window.addEventListener("uiSettings:updated", handleSettingsUpdate);
    return () => window.removeEventListener("uiSettings:updated", handleSettingsUpdate);
  }, []);

  // Preload receipt settings so logo and branding are ready for printing
  useEffect(() => {
    getReceiptSettings().then((s) => setReceiptSettings(s)).catch(() => {});
  }, []);

  const buildPrepaidOnlinePaymentDetails = () => ({
    tenderType: prepaidTenderName,
    tenderPayments: [{ tenderId: null, tenderName: prepaidTenderName, amount: onlineOrderTotal }],
    tenders: { [prepaidTenderName]: onlineOrderTotal },
    totalPaid: onlineOrderTotal,
    change: 0,
    amountPaid: onlineOrderTotal,
  });

  const completeOnlineOrderFromPos = async (paymentDetails) => {
    if (!getOnlineStatus()) {
      throw new Error('Online orders can only be completed while the POS is online.');
    }

    let resolvedTillId = till?._id;
    if (resolvedTillId && String(resolvedTillId).startsWith('offline-till-')) {
      resolvedTillId = await resolveTillId(resolvedTillId, {
        staffId: staff?._id || null,
        staffName: staff?.name || staff?.fullName || 'POS Staff',
        storeId: staff?.storeId || null,
        locationId: location?._id || null,
        openingBalance: Number(till?.openingBalance || 0),
      });
    }

    if (!resolvedTillId) {
      throw new Error('Till session is not yet synced. Please tap Sync Now, then retry payment.');
    }

    const response = await fetch(`/api/orders/${onlineOrderContext.id}/complete-from-pos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tillId: resolvedTillId,
        staffId: staff?._id || null,
        staffName: staff?.name || staff?.fullName || 'POS Staff',
        locationId: location?._id || null,
        locationName: location?.name || '',
        finalStatus: requestedFinalStatus,
        paymentDetails,
      }),
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result?.success) {
      throw new Error(result?.error || 'Failed to complete online order from POS.');
    }

    return result;
  };

  const handlePaymentConfirm = async (paymentDetails) => {
    // Prevent double-firing of the entire payment handler
    if (isProcessingPayment) {
      console.warn('⚠️ Payment already processing, ignoring duplicate call');
      return;
    }
    setIsProcessingPayment(true);

    try {
      if (!staff?._id || !staff?.name || !location?._id || !location?.name) {
        throw new Error("Staff or location missing. Please log in again.");
      }
      if (!till?._id) {
        throw new Error("Till not open. Please open a till before payment.");
      }

      if (isOnlineOrderCheckout) {
        const result = await completeOnlineOrderFromPos(paymentDetails);
        const finalOrderStatus = result.order?.status || requestedFinalStatus;
        const transaction = result.transaction || {
          _id: `order-${onlineOrderContext.id}`,
          createdAt: new Date().toISOString(),
          items: activeCart.items.map((item) => ({
            productId: item.id,
            name: item.name,
            quantity: item.quantity,
            price: item.price,
          })),
          subtotal: onlineOrderSubtotal,
          tax: totals.tax,
          total: onlineOrderTotal,
          discount: onlineOrderDiscount || totals.discountAmount || 0,
          discountName: onlineOrderContext?.discountName || 'Discount',
          shippingCost: onlineOrderShippingCost,
          deliveryFeeName: onlineOrderContext?.deliveryFeeName || 'Delivery Fee',
          amountPaid: paymentDetails.amountPaid || onlineOrderTotal,
          change: paymentDetails.change,
          tenderType: paymentDetails.tenderType,
          tenderPayments: paymentDetails.tenderPayments,
          customerName: activeCart.customer?.name,
          staffName: staff?.name || staff?.fullName || 'POS Staff',
          location: location?.name || 'Default Location',
          status: 'completed',
        };

        completeOrder(paymentDetails.tenderType || 'ONLINE');
        window.dispatchEvent(new CustomEvent('transactions:completed', { detail: { transaction } }));
        window.dispatchEvent(new CustomEvent('orders:online-updated', {
          detail: {
            orderId: onlineOrderContext.id,
            status: finalOrderStatus,
          },
        }));

        setShowPaymentPanel(false);
        setShowThankYouModal(true);

        const settings = receiptSettings || (await getReceiptSettings());
        setReceiptSettings(settings);
        await printTransactionReceipt({
          ...transaction,
          _id: transaction._id || transaction.id || Date.now().toString(),
        }, settings).catch(() => {});

        if (result.alreadyProcessed) {
          showToast('Online sale was already recorded for this order.', 'warning');
        } else if (finalOrderStatus === 'Delivered' && result.emailState === 'sent') {
          showToast('Online sale recorded, order marked delivered, and customer notified.', 'success');
        } else if (finalOrderStatus === 'Delivered' && result.emailState === 'failed') {
          showToast('Online sale recorded and order marked delivered, but the delivery email failed to send.', 'warning');
        } else if (finalOrderStatus === 'Delivered') {
          showToast('Online sale recorded and order marked delivered, but customer notification was skipped.', 'warning');
        } else if (result.emailState === 'sent') {
          showToast('Online sale recorded and customer notified. Mark the order delivered after fulfilment is completed.', 'success');
        } else if (result.emailState === 'failed') {
          showToast('Online sale recorded, but customer processing email failed to send.', 'warning');
        } else {
          showToast('Online sale recorded, but customer processing notification was skipped.', 'warning');
        }

        return;
      }

      const clientId = `pos-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const editTransactionId = activeCart.recallSourceTransactionId || null;

      const transaction = {
        items: activeCart.items.map((item) => ({
          productId: item.id,
          name: item.name,
          quantity: item.quantity,
          price: item.price,
        })),
        ...(editTransactionId ? {} : { externalId: clientId, clientId }),
        ...(editTransactionId ? { editTransactionId, subStatus: "edited" } : {}),
        total: totals.total,
        subtotal: totals.subtotal,
        tax: totals.tax,
        discount: totals.discountAmount || 0,
        discountName: totals.discountName || 'Discount',
        incrementAmount: totals.incrementAmount || 0,
        incrementName: totals.incrementName || 'Additional Charge',
        promotionValueType: totals.promotionValueType || null,
        customerType: activeCart.customer?.type || null,
        amountPaid: paymentDetails.amountPaid,
        change: paymentDetails.change,
        tenderType: paymentDetails.tenderType,
        tenderPayments: paymentDetails.tenderPayments,
        tenders: paymentDetails.tenders,
        staffName: staff?.name || staff?.fullName || "POS Staff",
        staffId: staff?._id,
        storeId: staff?.storeId || "default-store",
        location: location?.name || "Default Location",
        locationId: location?._id,
        locationName: location?.name,
        locationAddress: location?.address || "",
        device: "POS",
        tableName: null,
        customerName: activeCart.customer?.name,
        status: "completed",
        transactionType: "pos",
        createdAt: new Date().toISOString(),
        tillId: till._id,
      };

      // Always save locally first for full offline/online reconciliation
      await saveTransactionOffline(transaction);

      if (getOnlineStatus()) {
        // Best-effort immediate sync (single call only — no duplicates)
        syncPendingTransactions().catch(() => {});
      }

      completeOrder("CASH");
      window.dispatchEvent(new CustomEvent("transactions:completed", { detail: { transaction } }));

      setShowPaymentPanel(false);
      setShowThankYouModal(true);

      const settings = receiptSettings || (await getReceiptSettings());
      setReceiptSettings(settings);

      const receiptTransaction = {
        ...transaction,
        _id: transaction._id || Date.now().toString(),
      };

      printTransactionReceipt(receiptTransaction, settings).catch(() => {});
    } catch (error) {
      handleError(error, {
        context: "PaymentPanel - handlePaymentConfirm",
        showAlert: true,
        alertMessage: "Error saving transaction. Please try again.",
      });
    } finally {
      setIsProcessingPayment(false);
    }
  };

  if (!showPaymentPanel) return null;

  const paymentScale = uiSettings.payment?.scale || "standard";
  const paymentContentSize = uiSettings.payment?.contentSize || "standard";

  const scaleClass = {
    compact: "scale-[0.98]",
    standard: "scale-100",
    large: "scale-[1.02]",
  }[paymentScale] || "scale-100";

  const contentSizeClass = {
    compact: "text-[14px]",
    standard: "text-[16px]",
    large: "text-[18px]",
  }[paymentContentSize] || "text-[16px]";

  const handleTillOpened = () => {
    setShowOpenTillModal(false);
  };

  return (
    <div className={`h-full min-h-0 flex flex-col bg-gradient-to-br from-slate-50 via-white to-cyan-50 border border-neutral-200 rounded-2xl shadow-lg overflow-hidden relative z-50 ${scaleClass} ${contentSizeClass}`}>
      {/* Payment Header */}
      <div className="flex items-center gap-3 px-3 py-2 sm:px-4 sm:py-3 bg-white border-b border-neutral-200 flex-shrink-0">
        <button
          onClick={() => setShowPaymentPanel(false)}
          className="w-9 h-9 sm:w-10 sm:h-10 rounded-full border border-neutral-200 bg-white hover:bg-neutral-100 transition flex items-center justify-center"
          aria-label="Back to menu"
        >
          <FontAwesomeIcon icon={faArrowLeft} className="w-4 h-4 text-neutral-700" />
        </button>
        <div className="text-sm sm:text-base font-semibold text-neutral-900">
          {requestedFinalStatus === 'Delivered'
            ? (isPrepaidOnlineOrder ? 'Record & Deliver' : 'Pay & Deliver')
            : (isPrepaidOnlineOrder ? 'Record Online Sale' : 'Complete Payment')}
        </div>
      </div>

      {/* Payment Body */}
      <div className="flex-1 min-h-0 p-2 sm:p-4 overflow-y-auto">
        {!till ? (
          <div className="h-full flex flex-col items-center justify-center text-center border-2 border-dashed border-cyan-300 bg-white/80 rounded-2xl p-4 sm:p-6">
            <div className="text-base sm:text-lg font-semibold text-neutral-900">Open a till to accept payment</div>
            <div className="text-xs sm:text-sm text-neutral-600 mt-2 max-w-md">
              This session has no active till. Open a till first so sales can be recorded correctly.
            </div>
            <button
              onClick={() => setShowOpenTillModal(true)}
              className="mt-3 sm:mt-4 px-4 py-2 sm:px-5 sm:py-2.5 bg-cyan-600 hover:bg-cyan-700 text-white font-bold rounded-lg transition text-sm sm:text-base"
            >
              Open Till
            </button>
          </div>
        ) : isPrepaidOnlineOrder ? (
          <div className="h-full flex flex-col justify-center gap-4 border border-emerald-200 bg-emerald-50/70 rounded-2xl p-4 sm:p-6">
            <div>
              <div className="text-base sm:text-lg font-semibold text-neutral-900">Payment has already been confirmed for this order</div>
              <div className="text-xs sm:text-sm text-neutral-600 mt-2 max-w-lg">
                {requestedFinalStatus === 'Delivered'
                  ? `Recording this sale will attribute it to ${location?.name || 'this location'} and mark the order as delivered immediately.`
                  : `Recording this sale will attribute it to ${location?.name || 'this location'}. After fulfilment is complete, use the order panel to mark delivery and notify the customer.`}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-neutral-200 bg-white p-3">
                <div className="text-xs font-semibold uppercase tracking-[0.12em] text-neutral-500">Order</div>
                <div className="mt-1 text-sm font-semibold text-neutral-900">#{String(onlineOrderContext.id || '').slice(-8)}</div>
                <div className="mt-2 text-sm text-neutral-600">{onlineOrderContext.sourceLabel || 'Store Website'}</div>
              </div>
              <div className="rounded-xl border border-neutral-200 bg-white p-3">
                <div className="text-xs font-semibold uppercase tracking-[0.12em] text-neutral-500">Total</div>
                <div className="mt-1 text-xl font-bold text-neutral-900">₦{Number(onlineOrderTotal || 0).toLocaleString('en-NG')}</div>
                <div className="mt-2 text-sm text-emerald-700">Recorded tender: {prepaidTenderName}</div>
              </div>
            </div>

            <button
              onClick={() => handlePaymentConfirm(buildPrepaidOnlinePaymentDetails())}
              disabled={isProcessingPayment}
              className="px-4 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl transition disabled:opacity-60"
            >
              {isProcessingPayment
                ? (requestedFinalStatus === 'Delivered' ? 'Recording & Delivering...' : 'Recording Sale...')
                : (requestedFinalStatus === 'Delivered' ? 'Record & Deliver' : 'Record Sale')}
            </button>
          </div>
        ) : (
          <PaymentModal
            inline
            total={isOnlineOrderCheckout ? onlineOrderTotal : totals.total}
            onConfirm={handlePaymentConfirm}
            onCancel={() => setShowPaymentPanel(false)}
          />
        )}

        {isEmpty && (
          <div className="mt-3 text-xs sm:text-sm text-red-600 font-semibold">
            Cart is empty. Add items to complete payment.
          </div>
        )}
      </div>

      {/* Processing Overlay — blocks all interaction while saving + printing */}
      {isProcessingPayment && (
        <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-[60] rounded-2xl">
          <div className="bg-white rounded-2xl shadow-2xl p-8 text-center max-w-sm w-full mx-4">
            <div className="w-20 h-20 bg-primary-50 rounded-full flex items-center justify-center mx-auto mb-5 shadow-lg overflow-hidden">
              <Image
                src={getStoreLogo()}
                alt="Store Logo"
                width={72}
                height={72}
                className="object-contain"
                onError={(e) => { e.target.onerror = null; e.target.src = '/images/placeholder.jpg'; }}
                unoptimized
              />
            </div>
            <div className="w-10 h-10 border-4 border-primary-200 border-t-primary-600 rounded-full animate-spin mx-auto mb-4" />
            <p className="text-lg font-bold text-gray-800 mb-1">Processing Transaction</p>
            <p className="text-sm text-gray-500">Saving &amp; printing receipt...</p>
            <div className="mt-4 w-full h-2 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-primary-400 to-primary-600 rounded-full animate-pulse" style={{ width: '80%' }} />
            </div>
          </div>
        </div>
      )}

      {/* Thank You Modal */}
      <ThankYouNote
        isOpen={showThankYouModal}
        onClose={() => setShowThankYouModal(false)}
        receiptSettings={receiptSettings || {}}
        companyLogo={receiptSettings?.companyLogo}
      />

      <OpenTillModal
        isOpen={showOpenTillModal}
        onClose={() => setShowOpenTillModal(false)}
        onTillOpened={handleTillOpened}
        staffData={staff}
        locationData={location}
      />
    </div>
  );
}
