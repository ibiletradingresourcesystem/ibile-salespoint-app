/**
 * CartPanel Component
 *
 * Persistent right checkout panel - table-based design with inline editing.
 *
 * Responsibilities:
 * - Display active cart/order line items in table format
 * - Show: Product name | Qty | Each price | Total
 * - Inline quantity controls when item is selected
 * - Per-item discount and notes
 * - Delete item functionality
 * - Cart-level calculations (discount, tax)
 * - Action buttons: MISC PRODUCT, PRINT, NO SALE, QUICK ADD, PETTY CASH, ADJUST FLOAT, DELETE, HOLD, PAY
 * - Empty state when no items
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faPlus,
  faMinus,
  faTrash,
  faStickyNote,
  faTag,
  faPrint,
  faBan,
  faTrashAlt,
  faClock,
  faMoneyBill,
  faChevronDown,
  faChevronUp,
  faBoxOpen,
  faGripVertical,
  faExclamationTriangle,
  faFileAlt,
  faSyncAlt,
  faTimes,
  faWifi,
} from "@fortawesome/free-solid-svg-icons";
import { useCart } from "../../context/CartContext";
import { useStaff } from "../../context/StaffContext";
import {
  getOnlineStatus,
  getPendingTransactions,
  getResolvedPendingTransactionsHistory,
  resolvePendingTransaction,
  saveTransactionOffline,
  syncPendingTransactionById,
  syncPendingTransactions,
} from "../../lib/offlineSync";
import { hasPosPermission } from "../../lib/posPermissions";
import {
  printTransactionReceipt,
  getReceiptSettings,
} from "../../lib/receiptPrinting";
import { getUiSettings } from "../../lib/uiSettings";
import AdjustFloatModal from "./AdjustFloatModal";
import NumKeypad from "../common/NumKeypad";
import { showToast } from "../common/Toast";
import {
  getRoomReservationDateRange,
  getRoomReservationDetails,
  isRoomProduct,
} from "../../lib/roomReservations";

const formatRoomPhone = (value) => {
  const digits = String(value || "").replace(/[^0-9]/g, "");
  if (!digits) return "";
  return [digits.slice(0, 4), digits.slice(4, 7), digits.slice(7, 11)]
    .filter(Boolean)
    .join(" ");
};

export default function CartPanel() {
  const [selectedItemId, setSelectedItemId] = useState(null);
  const [expandedItemId, setExpandedItemId] = useState(null);
  const [prevItemsLength, setPrevItemsLength] = useState(0);
  const selectedItemRef = useRef(null);
  const [showAdjustFloatModal, setShowAdjustFloatModal] = useState(false);
  const [receiptSettings, setReceiptSettings] = useState(null);
  const [cartBtnSettings, setCartBtnSettings] = useState(getUiSettings().cartPanelButtons || {});
  const [totalsCollapsed, setTotalsCollapsed] = useState(false);
  const [qtyEditorItemId, setQtyEditorItemId] = useState(null);
  const [qtyDraft, setQtyDraft] = useState("");
  const [showPendingTransactions, setShowPendingTransactions] = useState(false);
  const [pendingTransactions, setPendingTransactions] = useState([]);
  const [resolvedTransactions, setResolvedTransactions] = useState([]);
  const [pendingTransactionsLoading, setPendingTransactionsLoading] = useState(false);
  const [pendingTransactionsError, setPendingTransactionsError] = useState("");
  const [pendingActionId, setPendingActionId] = useState(null);
  const [pendingIsOnline, setPendingIsOnline] = useState(getOnlineStatus());
  const [pendingOverlayTab, setPendingOverlayTab] = useState("pending");
  const [isProcessingCredit, setIsProcessingCredit] = useState(false);
  const { staff, location, till } = useStaff(); // Get logged-in staff, location, and till
  const {
    activeCart,
    updateQuantity,
    removeItem,
    setItemDiscount,
    setItemNotes,
    setCartDiscount,
    calculateTotals,
    holdOrder,
    completeOrder,
    deleteCart,
    setShowPaymentPanel,
  } = useCart();

  const totals = calculateTotals();
  const isEmpty = activeCart.items.length === 0;
  const selectedCustomerCanUseCredit = Boolean(
    activeCart.customer?.isCreditCustomer || activeCart.customer?.type === "CREDIT"
  );
  const canViewResolvedHistory = hasPosPermission(staff, "viewAdvancedOrders");
  const canApplyDiscount = hasPosPermission(staff, "applyDiscount");

  const loadPendingTransactions = useCallback(async () => {
    setPendingTransactionsLoading(true);
    setPendingTransactionsError("");

    try {
      const [pending, resolved] = await Promise.all([
        getPendingTransactions(),
        canViewResolvedHistory ? getResolvedPendingTransactionsHistory() : Promise.resolve([]),
      ]);

      setPendingTransactions(pending);
      setResolvedTransactions(resolved);
      setPendingIsOnline(getOnlineStatus());
    } catch (error) {
      console.error("Failed to load pending transactions:", error);
      setPendingTransactionsError("Could not load pending transactions.");
    } finally {
      setPendingTransactionsLoading(false);
    }
  }, [canViewResolvedHistory]);

  const getCurrentTillIds = useCallback(() => {
    const tillIds = new Set();

    if (till?._id) {
      tillIds.add(String(till._id));
    }

    if (typeof window !== "undefined") {
      try {
        const savedTill = localStorage.getItem("till");
        if (savedTill) {
          const parsedTill = JSON.parse(savedTill);
          if (parsedTill?._id) {
            tillIds.add(String(parsedTill._id));
          }
          if (parsedTill?.serverTillId) {
            tillIds.add(String(parsedTill.serverTillId));
          }
        }
      } catch (error) {
        console.warn("Failed to read persisted till:", error);
      }
    }

    return tillIds;
  }, [till?._id]);

  const isCurrentTillTransaction = useCallback(
    (transaction) => {
      const tillIds = getCurrentTillIds();
      if (tillIds.size === 0) {
        return false;
      }

      return [transaction?.tillId, transaction?.originalOfflineTillId].some(
        (candidate) => candidate && tillIds.has(String(candidate))
      );
    },
    [getCurrentTillIds]
  );

  const formatPendingAmount = (amount) =>
    `₦${(Number(amount) || 0).toLocaleString("en-NG", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  const formatPendingDate = (value) => {
    if (!value) return "Just now";

    try {
      return new Date(value).toLocaleString("en-GB", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch (error) {
      return String(value);
    }
  };

  const closePendingTransactions = () => {
    setShowPendingTransactions(false);
    setPendingTransactionsError("");
    setPendingActionId(null);
    setPendingOverlayTab("pending");
  };

  const handlePendingTransactionSync = async (transaction) => {
    const transactionId = transaction?.id;
    if (!transactionId) return;

    if (!getOnlineStatus()) {
      setPendingIsOnline(false);
      showToast("Device is offline. Reconnect before syncing this transaction.", "warning");
      return;
    }

    setPendingActionId(String(transactionId));
    try {
      const result = await syncPendingTransactionById(transactionId);

      if (result?.success) {
        showToast("Transaction synced successfully.", "success");
      } else if (result?.reason === "already-synced") {
        showToast("Transaction was already synced.", "success");
      } else if (result?.reason === "till-not-mapped") {
        showToast("Till mapping is not ready yet for this transaction.", "warning");
      } else {
        showToast("Transaction could not be synced yet.", "error");
      }

      await loadPendingTransactions();
    } catch (error) {
      console.error("Failed to sync pending transaction:", error);
      showToast("Failed to sync the selected transaction.", "error");
    } finally {
      setPendingActionId(null);
      setPendingIsOnline(getOnlineStatus());
    }
  };

  const handlePendingTransactionResolve = async (transaction) => {
    const transactionId = transaction?.id;
    if (!transactionId) return;

    setPendingActionId(String(transactionId));
    try {
      const result = await resolvePendingTransaction(transactionId, {
        type: "previous-till",
        note: "Resolved from unsynced transactions panel.",
        tillId: till?._id || null,
        staffId: staff?._id || null,
        staffName: staff?.name || null,
        staffRole: staff?.role || null,
      });

      if (result?.success) {
        showToast("Previous till transaction resolved and cleared from the queue.", "success");
      } else {
        showToast("Transaction could not be resolved.", "error");
      }

      await loadPendingTransactions();
    } catch (error) {
      console.error("Failed to resolve pending transaction:", error);
      showToast("Failed to resolve the selected transaction.", "error");
    } finally {
      setPendingActionId(null);
    }
  };

  // Auto-highlight the last added item ONLY when a new item is added (not on deselect)
  useEffect(() => {
    const currentLength = activeCart.items.length;
    
    // Only auto-select if items were ADDED (length increased), not on deselect
    if (currentLength > prevItemsLength && currentLength > 0) {
      const lastItem = activeCart.items[currentLength - 1];
      setSelectedItemId(lastItem.id);
    }
    
    setPrevItemsLength(currentLength);
  }, [activeCart.items, prevItemsLength]);

  // Auto-scroll to selected item
  useEffect(() => {
    if (selectedItemRef.current) {
      selectedItemRef.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }
  }, [selectedItemId]);

  // Listen for settings changes
  useEffect(() => {
    const handleSettingsUpdate = (event) => {
      const s = event?.detail || getUiSettings();
      setCartBtnSettings(s.cartPanelButtons || {});
    };
    window.addEventListener("uiSettings:updated", handleSettingsUpdate);
    return () => window.removeEventListener("uiSettings:updated", handleSettingsUpdate);
  }, []);

  // Preload receipt settings so logo and branding are ready for printing
  useEffect(() => {
    getReceiptSettings().then((s) => setReceiptSettings(s)).catch(() => {});
  }, []);

  useEffect(() => {
    const handleOpenPendingTransactions = () => {
      setPendingOverlayTab("pending");
      setShowPendingTransactions(true);
    };

    const handleSyncStateChange = () => {
      setPendingIsOnline(getOnlineStatus());
      if (showPendingTransactions) {
        loadPendingTransactions();
      }
    };

    const handleConnectivityChange = () => {
      setPendingIsOnline(getOnlineStatus());
    };

    window.addEventListener("pos:pending-transactions:open", handleOpenPendingTransactions);
    window.addEventListener("pos:sync-state-changed", handleSyncStateChange);
    window.addEventListener("online", handleConnectivityChange);
    window.addEventListener("offline", handleConnectivityChange);

    return () => {
      window.removeEventListener("pos:pending-transactions:open", handleOpenPendingTransactions);
      window.removeEventListener("pos:sync-state-changed", handleSyncStateChange);
      window.removeEventListener("online", handleConnectivityChange);
      window.removeEventListener("offline", handleConnectivityChange);
    };
  }, [loadPendingTransactions, showPendingTransactions]);

  useEffect(() => {
    if (showPendingTransactions) {
      loadPendingTransactions();
    }
  }, [showPendingTransactions, loadPendingTransactions]);

  const handlePayment = async () => {
    if (isEmpty) {
      showToast("Cart is empty. Add items to complete payment.", "warning");
      return;
    }
    setShowPaymentPanel(true);
  };

  const handleCreditSale = async () => {
    if (isProcessingCredit) return;

    if (isEmpty) {
      showToast("Cart is empty. Add items before recording credit.", "warning");
      return;
    }

    if (!staff?._id || !staff?.name || !location?._id || !location?.name) {
      showToast("Staff or location missing. Please log in again.", "error");
      return;
    }

    if (!till?._id) {
      showToast("Open a till before recording a credit sale.", "warning");
      return;
    }

    const customer = activeCart.customer;
    if (!customer?._id || !selectedCustomerCanUseCredit) {
      showToast("Select a credit customer before using Credit.", "warning");
      return;
    }

    const creditLimit = Number(customer.creditLimit || 0);
    const existingBalance = Number(customer.creditBalance || 0);
    if (creditLimit > 0 && existingBalance + Number(totals.total || 0) > creditLimit) {
      showToast("This sale exceeds the customer's credit limit.", "error");
      return;
    }

    setIsProcessingCredit(true);
    try {
      const clientId = `pos-credit-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const transaction = {
        items: activeCart.items.map((item) => ({
          productId: item.id,
          name: item.name,
          quantity: isRoomProduct(item) ? 1 : item.quantity,
          price: item.price,
          qty: isRoomProduct(item) ? 1 : item.quantity,
          salePriceIncTax: item.price,
          discount: item.discount || 0,
          notes: item.notes || "",
          reservationDetails: isRoomProduct(item) ? getRoomReservationDetails(item) : undefined,
        })),
        externalId: clientId,
        clientId,
        total: totals.total,
        subtotal: totals.subtotal,
        tax: totals.tax,
        discount: totals.discountAmount || 0,
        discountName: totals.discountName || "Discount",
        incrementAmount: totals.incrementAmount || 0,
        incrementName: totals.incrementName || "Additional Charge",
        promotionValueType: totals.promotionValueType || null,
        customerType: customer.type || null,
        customerId: customer._id,
        customerName: customer.name,
        amountPaid: 0,
        change: 0,
        tenderType: "CREDIT",
        tenderPayments: [],
        tenders: { CREDIT: 0 },
        staffName: staff?.name || staff?.fullName || "POS Staff",
        staffId: staff?._id,
        storeId: staff?.storeId || "default-store",
        location: location?.name || "Default Location",
        locationId: location?._id,
        locationName: location?.name,
        locationAddress: location?.address || "",
        device: "POS",
        tableName: null,
        status: "credit",
        creditStatus: "open",
        creditCustomerId: customer._id,
        creditCustomerName: customer.name,
        creditOriginalTotal: totals.total,
        creditPaidAmount: 0,
        creditBalance: totals.total,
        creditNotes: "POS credit sale",
        transactionType: "pos",
        createdAt: new Date().toISOString(),
        tillId: till._id,
      };

      await saveTransactionOffline(transaction);
      if (getOnlineStatus()) {
        syncPendingTransactions().catch(() => {});
      }

      completeOrder("CREDIT");
      window.dispatchEvent(new CustomEvent("transactions:completed", { detail: { transaction } }));

      const settings = receiptSettings || (await getReceiptSettings());
      setReceiptSettings(settings);
      printTransactionReceipt({ ...transaction, _id: transaction._id || Date.now().toString() }, settings).catch(() => {});

      showToast("Credit sale recorded. Stock will reduce and payment is tracked in admin.", "success");
    } catch (error) {
      console.error("Failed to record credit sale:", error);
      showToast("Failed to record credit sale. Please try again.", "error");
    } finally {
      setIsProcessingCredit(false);
    }
  };

  const handlePrintCart = async () => {
    if (isEmpty) {
      showToast("Cart is empty. Add items to print.", "warning");
      return;
    }

    try {
      // Create a temporary transaction object for printing
      const printTransaction = {
        items: activeCart.items.map((item) => ({
          productId: item.id,
          name: item.name,
          quantity: item.quantity,
          price: item.price,
        })),
        total: totals.total,
        subtotal: totals.subtotal,
        discountAmount: totals.discountAmount,
        tax: totals.tax,
        payment: {
          method: "CASH",
          amount: totals.total,
          change: 0,
        },
        staffId: staff?._id,
        staffName: staff?.name,
        locationId: location?._id,
        locationName: location?.name,
        locationAddress: location?.address || "",
        tillId: till?._id,
        tillNumber: till?.number,
        timestamp: new Date(),
        _id: Date.now().toString(),
        status: "UNPAID", // Mark receipt as unpaid
      };

      // Get receipt settings
      const settings = receiptSettings || (await getReceiptSettings());
      setReceiptSettings(settings);

      // Print receipt (fire and forget)
      printTransactionReceipt(printTransaction, settings).catch(() => {
        // Ignore errors
      });
    } catch (error) {
      console.error("❌ Error printing receipt:", error);
      showToast("Error printing receipt. Please try again.", "error");
    }
  };

  const openQtyEditor = (item) => {
    setQtyEditorItemId(item.id);
    setQtyDraft(String(item.quantity || 1));
  };

  const closeQtyEditor = () => {
    setQtyEditorItemId(null);
    setQtyDraft("");
  };

  const applyQtyDraft = (itemId) => {
    const parsed = Math.max(1, Math.floor(Number(qtyDraft) || 1));
    updateQuantity(itemId, parsed);
    closeQtyEditor();
  };

  const qtyEditItem = activeCart.items.find((item) => item.id === qtyEditorItemId) || null;
  const activeOverlayCount = pendingOverlayTab === "resolved" ? resolvedTransactions.length : pendingTransactions.length;

  return (
    <div className="relative flex flex-col h-full bg-white touch-manipulation border-l border-neutral-200 text-xs sm:text-sm">
      {showPendingTransactions && (
        <div className="absolute inset-0 z-20 flex flex-col bg-white">
          <div className="flex items-center justify-between gap-3 bg-neutral-900 px-3 py-3 text-white sm:px-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-bold sm:text-base">
                <FontAwesomeIcon icon={faFileAlt} className="w-4 h-4 text-cyan-300" />
                <span className="truncate">Unsynced Transactions</span>
              </div>
              <p className="mt-1 text-[11px] text-neutral-300 sm:text-xs">
                {pendingOverlayTab === "resolved"
                  ? `${activeOverlayCount} resolved previous-till record${activeOverlayCount !== 1 ? "s" : ""}`
                  : `${activeOverlayCount} pending transaction${activeOverlayCount !== 1 ? "s" : ""}`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold ${
                  pendingIsOnline ? "bg-green-500/20 text-green-200" : "bg-red-500/20 text-red-200"
                }`}
              >
                <FontAwesomeIcon icon={faWifi} className="w-3 h-3" />
                {pendingIsOnline ? "Online" : "Offline"}
              </span>
              <button
                onClick={loadPendingTransactions}
                className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 text-white transition hover:bg-white/20 sm:h-8 sm:w-8"
                title="Refresh pending transactions"
              >
                <FontAwesomeIcon
                  icon={faSyncAlt}
                  className={`h-3.5 w-3.5 ${pendingTransactionsLoading ? "animate-spin" : ""}`}
                />
              </button>
              <button
                onClick={closePendingTransactions}
                className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 text-white transition hover:bg-white/20 sm:h-8 sm:w-8"
                title="Close pending transactions"
              >
                <FontAwesomeIcon icon={faTimes} className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="border-b border-neutral-200 bg-neutral-50 px-3 py-2 text-[11px] text-neutral-600 sm:px-4 sm:text-xs">
            Current till: {till?.number || till?.name || till?._id || "Not loaded"}
          </div>

          {canViewResolvedHistory && (
            <div className="flex gap-2 border-b border-neutral-200 bg-white px-3 py-2 sm:px-4">
              <button
                onClick={() => setPendingOverlayTab("pending")}
                className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-bold transition sm:text-xs ${
                  pendingOverlayTab === "pending"
                    ? "bg-cyan-600 text-white"
                    : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"
                }`}
              >
                <span>Pending</span>
                <span className={`rounded-full px-1.5 py-0.5 ${pendingOverlayTab === "pending" ? "bg-white/20 text-white" : "bg-white text-neutral-700"}`}>
                  {pendingTransactions.length}
                </span>
              </button>
              <button
                onClick={() => setPendingOverlayTab("resolved")}
                className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-bold transition sm:text-xs ${
                  pendingOverlayTab === "resolved"
                    ? "bg-neutral-900 text-white"
                    : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"
                }`}
              >
                <span>Resolved History</span>
                <span className={`rounded-full px-1.5 py-0.5 ${pendingOverlayTab === "resolved" ? "bg-white/10 text-white" : "bg-white text-neutral-700"}`}>
                  {resolvedTransactions.length}
                </span>
              </button>
            </div>
          )}

          <div className="flex-1 overflow-y-auto bg-neutral-50 p-3 sm:p-4">
            {pendingTransactionsLoading ? (
              <div className="flex h-full items-center justify-center text-neutral-500">
                <FontAwesomeIcon icon={faSyncAlt} className="mr-2 w-4 h-4 animate-spin" />
                Loading pending transactions...
              </div>
            ) : pendingTransactionsError ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                {pendingTransactionsError}
              </div>
            ) : pendingOverlayTab === "resolved" ? (
              resolvedTransactions.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center rounded-2xl border border-dashed border-neutral-300 bg-white p-6 text-center">
                  <FontAwesomeIcon icon={faFileAlt} className="mb-3 h-10 w-10 text-neutral-400" />
                  <p className="text-sm font-bold text-neutral-900">No resolved history yet</p>
                  <p className="mt-1 text-xs text-neutral-500">
                    Previous-till records resolved from this device will appear here for supervisor review.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {resolvedTransactions.map((transaction, index) => {
                    const transactionId = String(
                      transaction?.id || transaction?.externalId || transaction?.clientId || index
                    );

                    return (
                      <div
                        key={transactionId}
                        className="rounded-2xl border border-neutral-200 bg-white p-3 shadow-sm"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-xs font-bold text-neutral-900 sm:text-sm">
                              {transaction.externalId || transaction.clientId || transaction.id}
                            </p>
                            <p className="mt-1 text-[11px] text-neutral-500 sm:text-xs">
                              Resolved {formatPendingDate(transaction.resolvedAt || transaction.syncedAt)}
                            </p>
                          </div>
                          <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-bold text-emerald-700">
                            Resolved
                          </span>
                        </div>

                        <div className="mt-3 flex items-center justify-between gap-3">
                          <div className="text-lg font-black text-neutral-900 sm:text-xl">
                            {formatPendingAmount(transaction.total)}
                          </div>
                          <div className="text-[11px] text-neutral-500 sm:text-xs">
                            {transaction.items?.length || 0} item{(transaction.items?.length || 0) !== 1 ? "s" : ""}
                          </div>
                        </div>

                        <div className="mt-3 space-y-1.5 text-[11px] text-neutral-600 sm:text-xs">
                          <div className="flex items-center justify-between gap-3">
                            <span>Original sale</span>
                            <span className="truncate font-medium text-neutral-900">
                              {formatPendingDate(transaction.createdAt || transaction.timestamp)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span>Resolved by</span>
                            <span className="truncate font-medium text-neutral-900">
                              {transaction.resolvedByStaffName || transaction.resolvedByStaffId || "Supervisor"}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span>Role</span>
                            <span className="truncate font-medium text-neutral-900 capitalize">
                              {transaction.resolvedByStaffRole || "Supervisor"}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span>Location</span>
                            <span className="truncate font-medium text-neutral-900">
                              {transaction.locationName || transaction.location || location?.name || "-"}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span>Original till</span>
                            <span className="truncate font-mono text-neutral-700">
                              {transaction.originalOfflineTillId || transaction.tillId || "-"}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span>Resolved from till</span>
                            <span className="truncate font-mono text-neutral-700">
                              {transaction.resolvedByTillId || "-"}
                            </span>
                          </div>
                        </div>

                        {transaction.resolutionNote && (
                          <div className="mt-3 rounded-xl border border-neutral-200 bg-neutral-50 p-2.5 text-[11px] text-neutral-600 sm:text-xs">
                            {transaction.resolutionNote}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )
            ) : pendingTransactions.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center rounded-2xl border border-dashed border-neutral-300 bg-white p-6 text-center">
                <FontAwesomeIcon icon={faFileAlt} className="mb-3 h-10 w-10 text-green-500" />
                <p className="text-sm font-bold text-neutral-900">No unsynced transactions</p>
                <p className="mt-1 text-xs text-neutral-500">
                  The local transaction queue is clear for this device.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {pendingTransactions.map((transaction, index) => {
                  const transactionId = String(
                    transaction?.id || transaction?.externalId || transaction?.clientId || index
                  );
                  const belongsToCurrentTill = isCurrentTillTransaction(transaction);
                  const isActingOnTransaction = pendingActionId === transactionId;

                  return (
                    <div
                      key={transactionId}
                      className="rounded-2xl border border-neutral-200 bg-white p-3 shadow-sm"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-bold text-neutral-900 sm:text-sm">
                            {transaction.externalId || transaction.clientId || transaction.id}
                          </p>
                          <p className="mt-1 text-[11px] text-neutral-500 sm:text-xs">
                            {formatPendingDate(transaction.createdAt || transaction.timestamp)}
                          </p>
                        </div>
                        <span
                          className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold ${
                            belongsToCurrentTill
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {belongsToCurrentTill ? "This till" : "Previous till"}
                        </span>
                      </div>

                      <div className="mt-3 flex items-center justify-between gap-3">
                        <div className="text-lg font-black text-neutral-900 sm:text-xl">
                          {formatPendingAmount(transaction.total)}
                        </div>
                        <div className="text-[11px] text-neutral-500 sm:text-xs">
                          {transaction.items?.length || 0} item{(transaction.items?.length || 0) !== 1 ? "s" : ""}
                        </div>
                      </div>

                      <div className="mt-3 space-y-1.5 text-[11px] text-neutral-600 sm:text-xs">
                        <div className="flex items-center justify-between gap-3">
                          <span>Staff</span>
                          <span className="truncate font-medium text-neutral-900">
                            {transaction.staffName || "POS Staff"}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span>Location</span>
                          <span className="truncate font-medium text-neutral-900">
                            {transaction.locationName || transaction.location || location?.name || "-"}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <span>Till</span>
                          <span className="truncate font-mono text-neutral-700">
                            {transaction.originalOfflineTillId || transaction.tillId || "-"}
                          </span>
                        </div>
                      </div>

                      {transaction.items?.length > 0 && (
                        <div className="mt-3 rounded-xl bg-neutral-50 p-2">
                          <div className="space-y-1">
                            {transaction.items.slice(0, 3).map((item, itemIndex) => (
                              <div
                                key={`${transactionId}-${itemIndex}`}
                                className="flex items-center justify-between gap-2 text-[11px] text-neutral-600 sm:text-xs"
                              >
                                <span className="truncate text-neutral-700">
                                  {item.name || item.productName || "Item"}
                                </span>
                                <span className="shrink-0 font-medium text-neutral-900">
                                  {item.quantity || 1} x {formatPendingAmount(item.price || item.unitPrice || 0)}
                                </span>
                              </div>
                            ))}
                          </div>
                          {transaction.items.length > 3 && (
                            <p className="mt-2 text-[10px] text-neutral-500">
                              +{transaction.items.length - 3} more item{transaction.items.length - 3 !== 1 ? "s" : ""}
                            </p>
                          )}
                        </div>
                      )}

                      {!belongsToCurrentTill && (
                        <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-[11px] text-amber-800 sm:text-xs">
                          <FontAwesomeIcon icon={faExclamationTriangle} className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <span>
                            This transaction belongs to a previous till session. Resolve it here if it should no longer stay in the live sync queue.
                          </span>
                        </div>
                      )}

                      <div className="mt-3 flex gap-2">
                        {belongsToCurrentTill ? (
                          <button
                            onClick={() => handlePendingTransactionSync(transaction)}
                            disabled={isActingOnTransaction || !pendingIsOnline}
                            className="flex-1 rounded-xl bg-cyan-600 px-3 py-2 text-sm font-bold text-white transition hover:bg-cyan-700 disabled:cursor-not-allowed disabled:bg-neutral-300"
                          >
                            {isActingOnTransaction ? "Syncing..." : pendingIsOnline ? "Sync" : "Offline"}
                          </button>
                        ) : (
                          <button
                            onClick={() => handlePendingTransactionResolve(transaction)}
                            disabled={isActingOnTransaction}
                            className="flex-1 rounded-xl bg-amber-500 px-3 py-2 text-sm font-bold text-white transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:bg-neutral-300"
                          >
                            {isActingOnTransaction ? "Resolving..." : "Resolve"}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {isEmpty ? (
        // Empty Cart State
        <div className="flex-1 flex flex-col items-center justify-center text-neutral-400 p-3 text-center">
          <div className="text-3xl sm:text-5xl mb-2 opacity-40">🍽️</div>
          <div className="text-sm sm:text-base font-bold mb-1 text-neutral-600">
            Add a Dish or Drink
          </div>
          <div className="text-[11px] sm:text-xs text-neutral-500">
            Tap a product to add to the bill
          </div>
          <div className="mt-6 w-24 h-0.5 bg-neutral-300 rounded-full"></div>
        </div>
      ) : (
        // Cart Content
        <>
          {/* Table Header */}
          <div className="bg-neutral-100 border-b border-neutral-300 sticky top-0 z-10">
            <div className="grid grid-cols-12 gap-2 px-2 sm:px-3 py-2 text-[10px] sm:text-xs font-semibold text-neutral-600 uppercase">
              <div className="col-span-5">Product</div>
              <div className="col-span-2 text-center">Qty</div>
              <div className="col-span-2 text-right">Each</div>
              <div className="col-span-3 text-right">Total</div>
            </div>
          </div>

          {/* Line Items */}
          <div className="flex-1 overflow-y-auto bg-white divide-y divide-neutral-200">
            {activeCart.items.map((item) => {
              // Calculate adjusted price if promotion is active
              let adjustedPrice = item.price;
              if (
                activeCart.appliedPromotion &&
                activeCart.appliedPromotion.active
              ) {
                if (activeCart.appliedPromotion.discountType === "PERCENTAGE") {
                  const percentChange =
                    activeCart.appliedPromotion.discountValue / 100;
                  if (activeCart.appliedPromotion.valueType === "INCREMENT") {
                    // INCREMENT increases the price
                    adjustedPrice = item.price * (1 + percentChange);
                  } else {
                    // DISCOUNT decreases the price
                    adjustedPrice = item.price * (1 - percentChange);
                  }
                } else if (
                  activeCart.appliedPromotion.discountType === "FIXED" &&
                  activeCart.appliedPromotion.fixedAmountApplyMode !== "TOTAL"
                ) {
                  // Fixed discount per item (PER_ITEM mode)
                  if (activeCart.appliedPromotion.valueType === "INCREMENT") {
                    adjustedPrice =
                      item.price + activeCart.appliedPromotion.discountValue;
                  } else {
                    adjustedPrice = Math.max(
                      0,
                      item.price - activeCart.appliedPromotion.discountValue,
                    );
                  }
                }
                // FIXED + TOTAL mode: no per-item adjustment shown
              }
              const itemTotal =
                adjustedPrice * item.quantity - (item.discount || 0);
              const hasPromoAdjustment = adjustedPrice !== item.price;
              const isRoomItem = isRoomProduct(item);
              const roomReservation = isRoomItem ? getRoomReservationDetails(item) : null;
              const roomDateRange = isRoomItem ? getRoomReservationDateRange(item) : "";
              const hasRoomReservation = Boolean(
                roomReservation?.guestName ||
                  roomReservation?.guestPhone ||
                  roomDateRange ||
                  roomReservation?.notes
              );

              return (
                <div key={item.id}>
                  {/* Normal Item View */}
                  {selectedItemId !== item.id ? (
                    <div
                      onClick={() => setSelectedItemId(item.id)}
                      className="grid grid-cols-12 gap-1 px-2 py-2 items-center hover:bg-primary-50 cursor-pointer transition-colors duration-base"
                    >
                      <div className="col-span-5">
                        <div className="text-xs sm:text-sm font-medium text-neutral-700 line-clamp-1">
                          {item.name}
                        </div>
                        {(item.discount > 0 || hasPromoAdjustment) && (
                          <div className="text-xs text-purple-600 mt-0.5 font-semibold">
                            {hasPromoAdjustment && (
                              <span>
                                {activeCart.appliedPromotion.valueType ===
                                "INCREMENT"
                                  ? "↑"
                                  : "↓"}{" "}
                                Promo
                              </span>
                            )}
                            {item.discount > 0 && (
                              <span className="ml-1">
                                -₦{item.discount.toLocaleString()}
                              </span>
                            )}
                          </div>
                        )}
                        {hasRoomReservation && (
                          <div className="mt-0.5 text-[10px] font-semibold text-cyan-700 line-clamp-1">
                            {roomReservation?.guestName || "Room booking"}{roomDateRange ? ` · ${roomDateRange}` : ""}
                          </div>
                        )}
                      </div>
                      <div className="col-span-2 text-center text-xs sm:text-sm font-semibold text-neutral-900">
                        {item.quantity}
                      </div>
                      <div className="col-span-2 text-right">
                        {hasPromoAdjustment ? (
                          <div>
                            <div className="text-xs text-gray-400 line-through">
                              ₦{Math.round(item.price).toLocaleString()}
                            </div>
                            <div
                              className={`text-sm font-semibold ${activeCart.appliedPromotion.valueType === "INCREMENT" ? "text-blue-600" : "text-green-600"}`}
                            >
                              ₦{Math.round(adjustedPrice).toLocaleString()}
                            </div>
                          </div>
                        ) : (
                            <div className="text-sm sm:text-base text-neutral-600">
                              ₦{Math.round(item.price).toLocaleString()}
                            </div>
                          )}
                      </div>
                      <div
                      className={`col-span-3 text-right text-sm sm:text-base font-semibold ${hasPromoAdjustment ? (activeCart.appliedPromotion.valueType === "INCREMENT" ? "text-blue-700" : "text-green-700") : "text-neutral-900"}`}
                    >
                        ₦{Math.round(itemTotal).toLocaleString()}
                      </div>
                    </div>
                  ) : (
                    // Selected Item View - Expanded with primary background
                    <div
                      ref={selectedItemRef}
                      className="bg-primary-500 text-white"
                    >
                      {/* Item Header with Price Info - All on one line */}
                      <div 
                        className="px-3 py-3 border-b border-primary-600 cursor-pointer hover:bg-primary-600 transition-colors"
                        onClick={() => setSelectedItemId(null)}
                      >
                        <div className="grid grid-cols-3 gap-2 items-center">
                          <div className="col-span-1">
                            <div className="text-xs font-bold line-clamp-1">
                              {item.name}
                            </div>
                          </div>
                          <div className="col-span-1 text-center">
                            <div className="opacity-80 text-xs">EACH</div>
                            {hasPromoAdjustment ? (
                              <div>
                                <div className="text-xs line-through opacity-70">
                                  ₦{Math.round(item.price).toLocaleString()}
                                </div>
                                <div className="font-bold text-sm">
                                  ₦{Math.round(adjustedPrice).toLocaleString()}
                                </div>
                              </div>
                            ) : (
                              <div className="font-bold text-sm">
                                ₦{Math.round(item.price).toLocaleString()}
                              </div>
                            )}
                          </div>
                          <div className="col-span-1 text-right">
                            <div className="opacity-80 text-xs">TOTAL</div>
                            <div className="font-bold text-sm">
                              ₦{Math.round(itemTotal).toLocaleString()}
                            </div>
                          </div>
                        </div>
                        {hasPromoAdjustment && (
                          <div className="mt-2 text-xs text-blue-100 font-semibold">
                            {activeCart.appliedPromotion.valueType === "INCREMENT"
                              ? "↑ Price Increase"
                              : "↓ Discount Applied"}
                            {" "}({activeCart.appliedPromotion.discountValue}
                            {activeCart.appliedPromotion.discountType === "PERCENTAGE"
                              ? "%"
                              : "₦"}
                            )
                          </div>
                        )}
                        {hasRoomReservation && (
                          <div className="mt-2 rounded-lg border border-white/20 bg-white/10 p-2 text-[11px] leading-relaxed text-white">
                            <div className="font-bold">Guest: {roomReservation?.guestName || "Not set"}</div>
                            <div className="mt-1 grid grid-cols-1 gap-1 sm:grid-cols-2">
                              {roomReservation?.guestPhone && (
                                <div>Phone: {formatRoomPhone(roomReservation.guestPhone)}</div>
                              )}
                              {roomDateRange && <div>Stay: {roomDateRange}</div>}
                            </div>
                            {roomReservation?.notes && (
                              <div className="mt-1 border-t border-white/20 pt-1">Notes: {roomReservation.notes}</div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Expanded Controls */}
                      <div 
                        className="px-3 py-2 space-y-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {/* Quantity Control - Center */}
                        {isRoomItem ? (
                          <div className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-center text-xs font-bold">
                            ROOM BOOKING · QTY FIXED AT 1
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center justify-center gap-3">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  updateQuantity(
                                    item.id,
                                    Math.max(1, item.quantity - 1),
                                  );
                                }}
                                className="w-9 h-9 flex items-center justify-center rounded-lg bg-white text-primary-600 font-bold transition-colors duration-base hover:bg-neutral-100"
                              >
                                <FontAwesomeIcon
                                  icon={faMinus}
                                  className="w-4 h-4"
                                />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openQtyEditor(item);
                                }}
                                className="text-center w-14 rounded-lg border border-white/30 bg-white/10 hover:bg-white/20 transition py-1"
                              >
                                <div className="text-2xl font-bold">
                                  {item.quantity}
                                </div>
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  updateQuantity(item.id, item.quantity + 1);
                                }}
                                className="w-9 h-9 flex items-center justify-center rounded-lg bg-white text-primary-600 font-bold transition-colors duration-base hover:bg-neutral-100"
                              >
                                <FontAwesomeIcon
                                  icon={faPlus}
                                  className="w-4 h-4"
                                />
                              </button>
                            </div>

                            {/* Quantity Label */}
                            <div className="text-center text-xs font-semibold tracking-wider">
                              QTY
                            </div>
                          </>
                        )}

                        {/* Action Buttons */}
                        <div className="flex gap-1.5 pt-1 justify-center">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedItemId(
                                expandedItemId === item.id ? null : item.id,
                              );
                            }}
                            className="flex flex-col items-center gap-0.5 px-2 py-1.5 bg-white text-primary-600 font-bold hover:opacity-80 transition-opacity rounded-lg text-xs"
                          >
                            <FontAwesomeIcon
                              icon={faStickyNote}
                              className="w-3.5 h-3.5"
                            />
                            <span>NOTE</span>
                          </button>
                          {canApplyDiscount && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setItemDiscount(
                                item.id,
                                (item.discount || 0) + 100,
                              );
                            }}
                            className="flex flex-col items-center gap-0.5 px-2 py-1.5 bg-white text-primary-600 font-bold hover:opacity-80 transition-opacity rounded-lg text-xs"
                          >
                            <FontAwesomeIcon icon={faTag} className="w-3.5 h-3.5" />
                            <span>DISC</span>
                          </button>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              removeItem(item.id);
                              setSelectedItemId(null);
                            }}
                            className="flex flex-col items-center gap-0.5 px-2 py-1.5 bg-white text-red-600 font-bold hover:opacity-80 transition-opacity rounded-lg text-xs"
                          >
                            <FontAwesomeIcon
                              icon={faTrashAlt}
                              className="w-4 h-4"
                            />
                            <span>DEL</span>
                          </button>
                        </div>

                        {/* Note Input */}
                        {expandedItemId === item.id && (
                          <div 
                            className="pt-3 border-t border-blue-400"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type="text"
                              placeholder="Add note..."
                              value={item.notes || ""}
                              onChange={(e) =>
                                setItemNotes(item.id, e.target.value)
                              }
                              onClick={(e) => e.stopPropagation()}
                              className="w-full text-xs p-2 border border-blue-400 rounded bg-blue-600 text-white placeholder-blue-200 outline-none focus:ring-2 focus:ring-white"
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Collapse/Expand Totals Button */}
          <div className="bg-neutral-50 border-b border-neutral-200 flex justify-center py-2">
            <button
              onClick={() => setTotalsCollapsed(!totalsCollapsed)}
              className="text-neutral-600 hover:text-neutral-900 transition-colors duration-base"
              title={totalsCollapsed ? "Show totals" : "Hide totals"}
            >
              <FontAwesomeIcon icon={totalsCollapsed ? faChevronUp : faChevronDown} className="w-4 h-4" />
            </button>
          </div>

          {/* Totals Section */}
          {!totalsCollapsed && (
          <div className="bg-neutral-50 border-t border-neutral-300 p-3">
            {/* Customer Promotion Note */}
            {activeCart.appliedPromotion && (
              <div className="mb-2 pb-2 border-b border-neutral-200">
                <div className="flex justify-between text-sm">
                  <span className="text-purple-700 font-semibold flex items-center gap-1">
                    {activeCart.appliedPromotion.name}
                  </span>
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="flex justify-between">
                <span className="text-neutral-700 font-semibold">ITEMS</span>
                <span className="text-neutral-900 font-bold text-base">
                  {totals.itemCount}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-700 font-semibold">SUBTOTAL</span>
                <span className="text-neutral-700 font-bold text-base">
                  ₦{Math.round(totals.subtotal).toLocaleString()}
                </span>
              </div>
              {totals.discountAmount > 0 && (
                <div className="flex justify-between col-span-2">
                  <span
                    className={`font-semibold ${activeCart.appliedPromotion?.valueType === "INCREMENT" ? "text-blue-600" : "text-green-600"}`}
                  >
                    {activeCart.appliedPromotion?.valueType === "INCREMENT"
                      ? "INCREMENT"
                      : "SAVINGS"}
                  </span>
                  <span
                    className={`font-bold text-base ${activeCart.appliedPromotion?.valueType === "INCREMENT" ? "text-blue-600" : "text-green-600"}`}
                  >
                    {activeCart.appliedPromotion?.valueType === "INCREMENT"
                      ? "+"
                      : "-"}
                    ₦{Math.round(totals.discountAmount).toLocaleString()}
                  </span>
                </div>
              )}
              <div className="flex justify-between col-span-2 pt-2 border-t border-neutral-200">
                <span className="text-neutral-900 font-bold text-base">
                  TOTAL DUE
                </span>
                <span className="text-cyan-700 font-black text-lg">
                  ₦{Math.round(totals.total).toLocaleString()}
                </span>
              </div>
            </div>
          </div>
          )}

          {/* Action Buttons Grid */}
          <div className="bg-white border-t border-neutral-300 p-2 space-y-2">
            {/* Row 1: Utility Buttons */}
            <div className="flex gap-2">
              {cartBtnSettings.print !== false && (
              <button
                onClick={handlePrintCart}
                className="flex-1 px-2 py-2 sm:py-3 text-xs sm:text-sm font-bold bg-neutral-300 hover:bg-neutral-400 text-neutral-900 rounded-lg transition-colors duration-base flex flex-col items-center gap-1 min-h-12 sm:min-h-16"
              >
                <FontAwesomeIcon icon={faPrint} className="w-4 h-4" />
                <span>PRINT</span>
              </button>
              )}
              {cartBtnSettings.pettyCash !== false && (
              <button className="flex-1 px-2 py-2 sm:py-3 text-xs sm:text-sm font-bold bg-neutral-300 hover:bg-neutral-400 text-neutral-900 rounded-lg transition-colors duration-base flex flex-col items-center gap-1 min-h-12 sm:min-h-16">
                <FontAwesomeIcon icon={faMoneyBill} className="w-4 h-4" />
                <span>PETTY CASH</span>
              </button>
              )}
              {cartBtnSettings.adjust !== false && (
              <button
                onClick={() => setShowAdjustFloatModal(true)}
                className="flex-1 px-2 py-2 sm:py-3 text-xs sm:text-sm font-bold bg-neutral-300 hover:bg-neutral-400 text-neutral-900 rounded-lg transition-colors duration-base flex flex-col items-center gap-1 min-h-12 sm:min-h-16"
              >
                <FontAwesomeIcon icon={faGripVertical} className="w-4 h-4" />
                <span>ADJUST</span>
              </button>
              )}
            </div>

            {/* Row 2: Action Buttons */}
            <div className="flex gap-2">
              {cartBtnSettings.delete !== false && (
              <button
                onClick={deleteCart}
                className="flex-1 px-2 py-2.5 sm:py-3.5 text-xs sm:text-sm font-bold bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors duration-base flex flex-col items-center gap-1 min-h-12 sm:min-h-18"
              >
                <FontAwesomeIcon icon={faTrashAlt} className="w-5 h-5" />
                <span>DELETE</span>
              </button>
              )}
              {cartBtnSettings.hold !== false && (
              <button
                onClick={() => holdOrder(staff, location)}
                className="flex-1 px-2 py-2.5 sm:py-3.5 text-xs sm:text-sm font-bold bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors duration-base flex flex-col items-center gap-1 min-h-12 sm:min-h-18"
              >
                <FontAwesomeIcon icon={faClock} className="w-5 h-5" />
                <span>HOLD</span>
              </button>
              )}
              {selectedCustomerCanUseCredit && (
              <button
                onClick={handleCreditSale}
                disabled={isProcessingCredit}
                className="flex-1 px-2 py-2.5 sm:py-3.5 text-xs sm:text-sm font-bold bg-amber-500 hover:bg-amber-600 disabled:bg-neutral-300 disabled:text-neutral-500 text-white rounded-lg transition-colors duration-base flex flex-col items-center gap-1 min-h-12 sm:min-h-18"
              >
                <FontAwesomeIcon icon={faFileAlt} className="w-5 h-5" />
                <span>{isProcessingCredit ? "SAVING" : "CREDIT"}</span>
              </button>
              )}
              {cartBtnSettings.pay !== false && (
              <button
                onClick={handlePayment}
                className="flex-1 px-2 py-2.5 sm:py-3.5 text-xs sm:text-sm font-bold bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors duration-base flex flex-col items-center gap-1 min-h-12 sm:min-h-18"
              >
                <FontAwesomeIcon icon={faMoneyBill} className="w-5 h-5" />
                <span>PAY</span>
              </button>
              )}
            </div>
          </div>
        </>
      )}

      {/* Adjust Float Modal */}
      <AdjustFloatModal
        isOpen={showAdjustFloatModal}
        onClose={() => setShowAdjustFloatModal(false)}
      />

      {qtyEditItem && (
        <div className="absolute inset-0 z-40 bg-black/35 flex items-end" onClick={closeQtyEditor}>
          <div
            className="w-full bg-gradient-to-b from-cyan-600 to-cyan-700 border-t border-cyan-300 rounded-t-2xl shadow-2xl p-3 space-y-3 max-h-[78%] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="text-white font-bold text-sm">Enter Quantity</div>
                <div className="text-cyan-100 text-xs">{qtyEditItem.name}</div>
              </div>
              <button
                onClick={closeQtyEditor}
                className="px-3 py-2 rounded-lg bg-white/15 hover:bg-white/25 text-white font-bold text-xs transition"
              >
                CLOSE
              </button>
            </div>

            <div className="bg-white/10 border border-cyan-300 rounded-xl p-2">
              <NumKeypad
                value={qtyDraft}
                onChange={(next) => {
                  const sanitized = String(next || "").replace(/[^0-9]/g, "");
                  setQtyDraft(sanitized);
                }}
                placeholder="QTY"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={closeQtyEditor}
                className="py-3 rounded-lg bg-white/15 hover:bg-white/25 text-white font-bold text-sm transition"
              >
                Cancel
              </button>
              <button
                onClick={() => applyQtyDraft(qtyEditItem.id)}
                className="py-3 rounded-lg bg-green-500 hover:bg-green-600 text-white font-bold text-sm transition"
              >
                Apply Qty
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
