/**
 * OrdersScreen Component
 * 
 * ORDERS tab - displays transaction history with advanced filtering.
 * - Order lifecycle tabs: HELD, ORDERED, PENDING, COMPLETE
 * - Date and time picker filters
 * - Advanced filter button for staff/customer/tender type
 * - Clickable rows that load order into cart panel
 * - Offline sync warning banner
 */

import React, { useState, useEffect, useCallback } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faCalendar,
  faClock,
  faSliders,
  faX,
  faChevronDown,
  faSync,
  faUndo,
  faPrint,
} from '@fortawesome/free-solid-svg-icons';
import { useCart } from '../../context/CartContext';
import { useStaff } from '../../context/StaffContext';
import { getCompletedTransactions, cacheCompletedTransactions, getCachedCompletedTransactions } from '../../lib/offlineSync';
import { getReceiptSettings, printTransactionReceipt } from '../../lib/receiptPrinting';
import { hasPosPermission } from '@/src/lib/posPermissions';
import { showToast } from '../common/Toast';

const ORDER_STATUS_TABS = ['HELD', 'ORDERED', 'PENDING', 'COMPLETE'];

const normalizeToken = (value) => String(value || '').trim().toLowerCase();

const inferSiteKeyFromLocation = (location) => {
  const haystack = [location?.name, location?.code, location?.locationCode]
    .map(normalizeToken)
    .filter(Boolean)
    .join(' ');

  return haystack.includes('hotel') ? 'hotel' : 'store';
};

const getOrderContactDetails = (order) => {
  const shippingDetails = order?.shippingDetails || {};
  const customerSnapshot = order?.customerSnapshot || {};
  const customer = order?.customer || {};

  return {
    name: shippingDetails.name || customerSnapshot.name || customer.name || '',
    email: shippingDetails.email || customerSnapshot.email || customer.email || '',
    phone: shippingDetails.phone || customerSnapshot.phone || customer.phone || '',
    address: shippingDetails.address || customerSnapshot.address || customer.address || '',
    city: shippingDetails.city || customerSnapshot.city || customer.city || '',
  };
};

const getOrderSourceLabel = (siteKey) => (siteKey === 'hotel' ? 'Hotel Website' : 'Store Website');

export default function OrdersScreen({ onNavigateToMenu }) {
  const [activeStatus, setActiveStatus] = useState('HELD');
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedTime, setSelectedTime] = useState('');
  const [filteredOrders, setFilteredOrders] = useState([]);
  const [completedTransactions, setCompletedTransactions] = useState([]);
  const [onlineOrders, setOnlineOrders] = useState([]);
  const [isLoadingCompleted, setIsLoadingCompleted] = useState(false);
  const [isLoadingOnlineOrders, setIsLoadingOnlineOrders] = useState(false);
  const [processingOrderId, setProcessingOrderId] = useState(null);
  const [deliveringOrderId, setDeliveringOrderId] = useState(null);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [showRefundModal, setShowRefundModal] = useState(false);
  const [showDetailPanel, setShowDetailPanel] = useState(false);
  const [detailOrder, setDetailOrder] = useState(null);
  const [refundLoading, setRefundLoading] = useState(false);
  const [refundError, setRefundError] = useState(null);
  const [printingOrderId, setPrintingOrderId] = useState(null);
  const [receiptSettings, setReceiptSettings] = useState(null);
  const {
    isOnline,
    lastSyncTime,
    resumeOrder,
    recallTransactionToCart,
    loadOnlineOrderToCart,
    orders,
    setShowPaymentPanel,
  } = useCart();
  const { staff, till, location } = useStaff();

  const canRefund = hasPosPermission(staff, 'refundAccess');
  const canViewAdvancedOrders = hasPosPermission(staff, 'viewAdvancedOrders');

  const visibleTabs = canViewAdvancedOrders
    ? ORDER_STATUS_TABS
    : ORDER_STATUS_TABS.filter(t => t !== 'ORDERED' && t !== 'PENDING');

  const fetchOnlineOrders = useCallback(async () => {
    setIsLoadingOnlineOrders(true);
    try {
      if (!isOnline) {
        setOnlineOrders([]);
        return;
      }

      const params = new URLSearchParams({ limit: '200' });
      const siteKey = inferSiteKeyFromLocation(location);
      params.append('siteKey', siteKey);
      params.append('includeUnassigned', 'true');

      if (location?._id) {
        params.append('locationId', String(location._id));
      }
      if (location?.name) {
        params.append('locationName', String(location.name));
      }

      const response = await fetch(`/api/orders/online?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch online orders: ${response.status}`);
      }

      const result = await response.json();
      const onlineOrderData = result.data || [];
      console.log(`✅ Fetched ${onlineOrderData.length} online orders for ORDERED tab`);
      setOnlineOrders(onlineOrderData);
    } catch (error) {
      console.error('Failed to fetch online orders:', error);
      setOnlineOrders([]);
    } finally {
      setIsLoadingOnlineOrders(false);
    }
  }, [isOnline, location]);

  // Fetch completed transactions from server (online) or IndexedDB (offline)
  const fetchCompletedTransactions = useCallback(async () => {
    setIsLoadingCompleted(true);
    try {
      let completed = [];

      // Try to use cached data first (much faster)
      const cached = getCachedCompletedTransactions();
      if (cached.length > 0) {
        console.log(`⚡ Using ${cached.length} cached transactions`);
        setCompletedTransactions(cached);
      }

      if (isOnline) {
        // Online: Fetch from server API - filter by today's date
        try {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const tomorrow = new Date(today);
          tomorrow.setDate(tomorrow.getDate() + 1);

          const params = new URLSearchParams({
            startDate: today.toISOString(),
            endDate: tomorrow.toISOString(),
            limit: 500,
          });
          // Filter by current till session if available
          if (till?._id) {
            params.append('tillId', till._id);
          }

          const response = await fetch(`/api/transactions/completed?${params}`);
          if (response.ok) {
            const result = await response.json();
            completed = result.data || result || [];
            console.log(`✅ Fetched ${completed.length} completed transactions from server (today)`);
            // Cache the fresh data
            cacheCompletedTransactions(completed);
          } else {
            console.warn('Failed to fetch from server, falling back to IndexedDB');
            completed = await getCompletedTransactions();
          }
        } catch (error) {
          console.warn('Error fetching from server:', error, 'falling back to IndexedDB');
          completed = await getCompletedTransactions();
        }
      } else {
        // Offline: Fetch from IndexedDB filtered by today and current till
        console.log('🔴 Offline mode - fetching from IndexedDB');
        let allCompleted = await getCompletedTransactions();
        
        // Filter for today's transactions
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        
        completed = allCompleted.filter(tx => {
          const txDate = new Date(tx.createdAt);
          const isToday = txDate >= today && txDate < tomorrow;
          // Also filter by tillId if available
          const matchesTill = till?._id ? (tx.tillId === till._id || tx.tillId?.toString() === till._id) : true;
          return isToday && matchesTill;
        });
      }

      setCompletedTransactions(completed);
    } catch (error) {
      console.error('Failed to fetch completed transactions:', error);
      setCompletedTransactions([]);
    } finally {
      setIsLoadingCompleted(false);
    }
  }, [isOnline, till]);

  // Load completed transactions on mount and when switching to COMPLETE tab or online status changes
  useEffect(() => {
    if (activeStatus === 'COMPLETE') {
      fetchCompletedTransactions();
    }
  }, [activeStatus, fetchCompletedTransactions, isOnline]);

  useEffect(() => {
    if (activeStatus === 'ORDERED') {
      fetchOnlineOrders();
    }
  }, [activeStatus, fetchOnlineOrders]);

  useEffect(() => {
    const handleOnlineOrderUpdated = () => {
      if (activeStatus === 'ORDERED') {
        fetchOnlineOrders();
      }
    };

    window.addEventListener('orders:online-updated', handleOnlineOrderUpdated);
    return () => window.removeEventListener('orders:online-updated', handleOnlineOrderUpdated);
  }, [activeStatus, fetchOnlineOrders]);

  useEffect(() => {
    if (activeStatus !== 'ORDERED') {
      return undefined;
    }

    const handleVisibilityRefresh = () => {
      if (document.visibilityState === 'visible') {
        fetchOnlineOrders();
      }
    };

    const handleWindowFocus = () => {
      fetchOnlineOrders();
    };

    document.addEventListener('visibilitychange', handleVisibilityRefresh);
    window.addEventListener('focus', handleWindowFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityRefresh);
      window.removeEventListener('focus', handleWindowFocus);
    };
  }, [activeStatus, fetchOnlineOrders]);

  // Refresh completed transactions on external updates
  useEffect(() => {
    const handleCompletedUpdate = () => {
      if (activeStatus === 'COMPLETE') {
        fetchCompletedTransactions();
      }
    };

    window.addEventListener('transactions:completed', handleCompletedUpdate);
    return () => window.removeEventListener('transactions:completed', handleCompletedUpdate);
  }, [activeStatus, fetchCompletedTransactions]);

  // Handle refund request
  const handleRefund = async (order, action) => {
    if (!canRefund) {
      showToast('You do not have permission to refund transactions.', 'error');
      return;
    }

    setRefundLoading(true);
    setRefundError(null);

    try {
      const payload = {
        transactionId: order.id,
        action: action, // 'recall' (to cart, no save) or 'process' (mark as edited/deleted)
        refundReason: '',
        staffId: staff._id,
      };

      if (action === 'process') {
        // Ask user if they want to process or discard
        const response = await fetch('/api/transactions/refund', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.message || 'Failed to process refund');
        }

        const data = await response.json();
        showToast(`Transaction marked as ${data.refundStatus}${data.subStatus ? ` (${data.subStatus})` : ''}`, 'success');
        
        // Refresh completed transactions
        await fetchCompletedTransactions();
      } else if (action === 'recall') {
        // Recall to cart without saving as refund
        recallTransactionToCart(order);
        showToast('Transaction recalled to cart. Make edits and complete again.', 'success');
        // Auto-navigate back to menu after recalling to cart
        if (onNavigateToMenu) onNavigateToMenu();
      }

      setShowRefundModal(false);
      setSelectedOrder(null);
    } catch (err) {
      setRefundError(err.message);
    } finally {
      setRefundLoading(false);
    }
  };

  const buildPrintableTransaction = useCallback((order) => ({
    _id: String(order.id || Date.now()),
    createdAt: order.createdAt || new Date().toISOString(),
    items: (order.items || []).map((item) => ({
      productId: item.productId || item.id,
      name: item.name || 'Unknown Item',
      quantity: item.quantity || item.qty || 1,
      price: Number(item.price || item.salePriceIncTax || 0),
    })),
    subtotal: Number(order.subtotal || order.total || 0),
    tax: Number(order.tax || 0),
    discount: Number(order.discount || 0),
    incrementAmount: Number(order.incrementAmount || 0),
    promotionValueType: order.promotionValueType || null,
    customerType: order.customerType || null,
    total: Number(order.total || 0),
    amountPaid: Number(order.amountPaid || order.total || 0),
    change: Number(order.change || 0),
    customerName: order.customer || 'Walk-in',
    staffName: order.staffMember || 'POS Staff',
    tenderType: order.tenderType || null,
    tenderPayments: order.tenderPayments || [],
    location: order.location || till?.locationName || 'Main Store',
    locationAddress: order.locationAddress || '',
    status: 'completed',
  }), [till?.locationName]);

  const handlePrintOrder = useCallback(async (order) => {
    if (!order) return;
    try {
      setPrintingOrderId(order.id);
      const settings = receiptSettings || (await getReceiptSettings());
      if (!receiptSettings) {
        setReceiptSettings(settings);
      }
      const printable = buildPrintableTransaction(order);
      await printTransactionReceipt(printable, settings);
    } catch (err) {
      showToast(err?.message || 'Failed to print transaction receipt.', 'error');
    } finally {
      setPrintingOrderId(null);
    }
  }, [buildPrintableTransaction, receiptSettings]);

  // Filter orders by status
  useEffect(() => {
    let sourceOrders = [];

    if (activeStatus === 'COMPLETE') {
      // Use completed transactions from IndexedDB
      sourceOrders = completedTransactions.map(tx => {
        // Handle multi-tender display - show all tenders
        let tenderDisplay = null;
        if (tx.tenderPayments && Array.isArray(tx.tenderPayments) && tx.tenderPayments.length > 0) {
          // Multiple tenders - show "Split" or list them
          if (tx.tenderPayments.length === 1) {
            tenderDisplay = tx.tenderPayments[0].tenderName;
          } else {
            tenderDisplay = tx.tenderPayments.map(p => p.tenderName).join(', ');
          }
        } else if (tx.tenderType) {
          tenderDisplay = tx.tenderType;
        }

        return {
          id: tx.id || tx._id,
          time: tx.createdAt ? new Date(tx.createdAt).toLocaleString() : 'N/A',
          createdAt: tx.createdAt || new Date().toISOString(),
          customer: tx.customerName || 'Walk-in',
          staffMember: tx.staffName || 'Unknown',
          heldByStaffName: tx.heldByStaffName || null,
          location: tx.location || 'Main Store',
          locationAddress: tx.locationAddress || '',
          tenderType: tenderDisplay,
          tenderPayments: tx.tenderPayments || [],
          total: tx.total || 0,
          subtotal: tx.subtotal || 0,
          tax: tx.tax || 0,
          discount: tx.discount || 0,
          incrementAmount: tx.incrementAmount || 0,
          promotionValueType: tx.promotionValueType || null,
          customerType: tx.customerType || null,
          status: tx.status || 'completed',
          subStatus: tx.subStatus || null,
          items: tx.items || [],
          amountPaid: tx.amountPaid || tx.total,
          change: tx.change || 0,
        };
      });
    } else if (activeStatus === 'ORDERED') {
      sourceOrders = onlineOrders.map(order => {
        const orderItems = Array.isArray(order.cartProducts) && order.cartProducts.length > 0
          ? order.cartProducts
          : (order.items || []);
        const contactDetails = getOrderContactDetails(order);
        const siteKey = order.siteKey || inferSiteKeyFromLocation(location);

        return {
          id: order.id || order._id,
          time: order.createdAt ? new Date(order.createdAt).toLocaleString() : 'N/A',
          createdAt: order.createdAt || new Date().toISOString(),
          customer: contactDetails.name || order.customerName || 'Online Customer',
          customerEmail: contactDetails.email || '',
          customerPhone: contactDetails.phone || '',
          staffMember: getOrderSourceLabel(siteKey),
          heldByStaffName: null,
          location: order.locationName || (siteKey === 'hotel' ? 'Hotel' : 'Store'),
          locationAddress: contactDetails.address
            ? `${contactDetails.address}, ${contactDetails.city || ''}`.trim().replace(/,$/, '')
            : '',
          tenderType: order.status || 'Pending',
          paymentStatus: order.paymentStatus || 'Pending',
          total: order.total || 0,
          subtotal: order.subtotal || order.total || 0,
          tax: 0,
          discount: 0,
          shippingCost: order.shippingCost || 0,
          status: order.status || 'Pending',
          reservationStatus: order.reservationStatus || null,
          hasPosTransaction: Boolean(order.hasPosTransaction),
          posTransactionId: order.posTransactionId || null,
          posTransactionCreatedAt: order.posTransactionCreatedAt || null,
          items: orderItems,
          amountPaid: order.paymentStatus === 'Paid' ? (order.total || 0) : 0,
          change: 0,
          source: 'E-Commerce',
          sourceLabel: getOrderSourceLabel(siteKey),
          siteKey,
          shippingDetails: contactDetails,
        };
      });
    } else {
      // Use held orders from CartContext
      if (!orders || orders.length === 0) {
        setFilteredOrders([]);
        return;
      }

      sourceOrders = orders
        .filter(order => order.status === activeStatus)
        .map(order => ({
          id: order.id,
          time: order.createdAt ? new Date(order.createdAt).toLocaleString() : 'N/A',
          customer: order.customer?.name || 'Walk-in',
          staffMember: order.staffMember?.name || order.staffMember || 'Unknown',
          location: order.location?.name || order.location || 'Unknown',
          tenderType: order.status === 'HELD' ? null : (order.tenderType || null), // Don't show tender for HELD
          total: order.total || 0,
          status: order.status,
          items: order.items || [],
        }));
    }

    // Apply date filter if selected
    let filtered = sourceOrders;
    if (selectedDate) {
      const filterDate = new Date(selectedDate).toDateString();
      filtered = filtered.filter(order => {
        const orderDate = new Date(order.createdAt || order.time).toDateString();
        return orderDate === filterDate;
      });
    }

    setFilteredOrders(filtered);
  }, [activeStatus, selectedDate, orders, completedTransactions, onlineOrders, location]);

  const handleOrderSelect = (order) => {
    if (activeStatus === 'COMPLETE' || activeStatus === 'ORDERED') {
      // Show detail panel for completed transactions
      setDetailOrder(order);
      setShowDetailPanel(true);
    } else {
      // Resume held orders to cart
      resumeOrder(order.id);
      // Auto-navigate back to menu after resuming held order
      if (onNavigateToMenu) onNavigateToMenu();
    }
  };

  const handleProcessOnlineOrder = useCallback((order, options = {}) => {
    const run = async () => {
      if (!order) {
        return;
      }

      const requestedFinalStatus = options?.finalStatus === 'Delivered' ? 'Delivered' : 'Processing';

      if (!isOnline) {
        showToast('Online orders can only be processed while the POS is online.', 'error');
        return;
      }

      setProcessingOrderId(order.id);

      try {
        let nextOrder = {
          ...order,
          requestedFinalStatus,
          locationName: location?.name || order.locationName || order.location || '',
          locationId: location?._id || order.locationId || null,
        };

        loadOnlineOrderToCart(nextOrder);
        setShowDetailPanel(false);
        setDetailOrder(null);
        setShowPaymentPanel(true);

        if (onNavigateToMenu) {
          onNavigateToMenu();
        }
      } catch (error) {
        showToast(error.message || 'Failed to process order in POS.', 'error');
      } finally {
        setProcessingOrderId(null);
      }
    };

    run();
  }, [isOnline, loadOnlineOrderToCart, location?._id, location?.name, onNavigateToMenu, setShowPaymentPanel]);

  const handleMarkDelivered = useCallback((order) => {
    const run = async () => {
      if (!order) {
        return;
      }

      if (!isOnline) {
        showToast('Delivered notifications require an online connection.', 'error');
        return;
      }

      setDeliveringOrderId(order.id);

      try {
        const response = await fetch(`/api/orders/${order.id}/mark-delivered`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            locationId: location?._id || null,
            locationName: location?.name || order.location || '',
          }),
        });

        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result?.success) {
          throw new Error(result?.error || 'Failed to mark order delivered.');
        }

        window.dispatchEvent(new CustomEvent('orders:online-updated', {
          detail: { orderId: order.id, status: 'Delivered' },
        }));

        if (result.emailState === 'sent') {
          showToast('Order marked delivered and customer notified.', 'success');
        } else if (result.emailState === 'failed') {
          showToast('Order marked delivered, but the delivery email could not be sent.', 'warning');
        } else {
          showToast('Order marked delivered, but customer notification was skipped.', 'warning');
        }

        setShowDetailPanel(false);
        setDetailOrder(null);
        await fetchOnlineOrders();
      } catch (error) {
        showToast(error.message || 'Failed to mark order delivered.', 'error');
      } finally {
        setDeliveringOrderId(null);
      }
    };

    run();
  }, [fetchOnlineOrders, isOnline, location?._id, location?.name]);

  const formatSyncTime = (isoString) => {
    if (!isoString) return 'Never synced';
    const date = new Date(isoString);
    const now = new Date();
    const diffMins = Math.floor((now - date) / 60000);
    if (diffMins < 1) return 'Just synced';
    if (diffMins < 60) return `${diffMins}m ago`;
    return `${Math.floor(diffMins / 60)}h ago`;
  };

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Offline Warning Banner */}
      {!isOnline && (
        <div className="bg-yellow-50 border-l-4 border-yellow-400 p-3 flex items-start gap-2 text-sm text-yellow-800">
          <FontAwesomeIcon icon={faX} className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div>
            <div className="font-semibold">Out of sync</div>
            <div className="text-xs text-yellow-700">
              Last synced: {formatSyncTime(lastSyncTime)}. New orders or changes from other devices won&apos;t appear until
              you are back online.
            </div>
          </div>
        </div>
      )}

      {/* Status Tabs */}
      <div className="bg-blue-600 text-white px-3 py-2 flex gap-1.5 overflow-x-auto">
        {visibleTabs.map(status => (
          <button
            key={status}
            onClick={() => setActiveStatus(status)}
            className={`px-3 py-1.5 font-semibold text-xs whitespace-nowrap rounded transition-colors touch-manipulation ${
              activeStatus === status
                ? 'bg-blue-800 text-white'
                : 'bg-blue-700 hover:bg-blue-500 text-blue-100'
            }`}
          >
            {status}
          </button>
        ))}
      </div>

      {/* Filter Controls */}
      <div className="bg-white border-b border-gray-200 p-2 flex gap-1.5 flex-wrap">
        <div className="flex-1 min-w-44">
          <label className="flex items-center gap-1.5 px-2 py-1.5 bg-gray-50 rounded border border-gray-300">
            <FontAwesomeIcon icon={faCalendar} className="w-3 h-3 text-gray-600" />
            <input
              type="date"
              value={selectedDate}
              onChange={e => setSelectedDate(e.target.value)}
              className="bg-transparent text-xs w-full outline-none"
              placeholder="Choose Date"
            />
          </label>
        </div>

        <div className="flex-1 min-w-44">
          <label className="flex items-center gap-1.5 px-2 py-1.5 bg-gray-50 rounded border border-gray-300">
            <FontAwesomeIcon icon={faClock} className="w-3 h-3 text-gray-600" />
            <input
              type="time"
              value={selectedTime}
              onChange={e => setSelectedTime(e.target.value)}
              className="bg-transparent text-xs w-full outline-none"
              placeholder="Choose Time"
            />
          </label>
        </div>

        <button className="px-3 py-1.5 bg-blue-500 text-white rounded font-semibold text-xs hover:bg-blue-600 flex items-center gap-1.5 transition-colors touch-manipulation">
          <FontAwesomeIcon icon={faSliders} className="w-3 h-3" />
          <span className="hidden sm:inline">ADVANCED FILTER</span>
          <span className="sm:hidden">FILTER</span>
        </button>
        
        {/* Refresh button for completed transactions */}
        {(activeStatus === 'COMPLETE' || activeStatus === 'ORDERED') && (
          <button 
            onClick={activeStatus === 'COMPLETE' ? fetchCompletedTransactions : fetchOnlineOrders}
            disabled={activeStatus === 'COMPLETE' ? isLoadingCompleted : isLoadingOnlineOrders}
            className="px-3 py-1.5 bg-green-500 text-white rounded font-semibold text-xs hover:bg-green-600 flex items-center gap-1.5 transition-colors touch-manipulation disabled:opacity-50"
          >
            <FontAwesomeIcon icon={faSync} className={`w-3 h-3 ${(activeStatus === 'COMPLETE' ? isLoadingCompleted : isLoadingOnlineOrders) ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">REFRESH</span>
          </button>
        )}
      </div>

      {/* Orders Table */}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-200 sticky top-0">
            <tr className="border-b border-gray-300">
              <th className="text-left p-2 text-gray-700">TIME</th>
              <th className="text-left p-2 text-gray-700 hidden sm:table-cell">CUSTOMER</th>
              <th className="text-left p-2 text-gray-700 hidden md:table-cell">STAFF MEMBER</th>
              <th className="text-left p-2 text-gray-700">{activeStatus === 'ORDERED' ? 'STATUS' : 'TENDER TYPE'}</th>
              <th className="text-right p-2 text-gray-700">TOTAL</th>
              {activeStatus === 'COMPLETE' && <th className="text-center p-2 text-gray-700">ACTIONS</th>}
            </tr>
          </thead>
          <tbody>
            {filteredOrders.map(order => (
              <tr
                key={order.id}
                className="border-b border-gray-200 hover:bg-blue-50 transition-colors touch-manipulation"
              >
                <td 
                  className="p-2 text-gray-800 font-medium cursor-pointer"
                  onClick={() => handleOrderSelect(order)}
                >
                  {order.time}
                </td>
                <td 
                  className="p-2 text-gray-800 cursor-pointer hidden sm:table-cell"
                  onClick={() => handleOrderSelect(order)}
                >
                  {order.customer}
                </td>
                <td 
                  className="p-2 text-gray-800 cursor-pointer hidden md:table-cell"
                  onClick={() => handleOrderSelect(order)}
                >
                  {order.staffMember}
                </td>
                <td 
                  className="p-2 text-gray-800 uppercase text-xs font-semibold cursor-pointer"
                  onClick={() => handleOrderSelect(order)}
                >
                  {activeStatus === 'ORDERED' ? (
                    <div className="flex flex-col gap-1">
                      <span
                        className={`inline-flex w-fit rounded px-2 py-1 normal-case ${
                          order.status === 'Pending' || order.status === 'Pending Payment'
                            ? 'bg-amber-100 text-amber-800'
                            : order.status === 'Processing' || order.status === 'Inventory Reserved'
                            ? 'bg-blue-100 text-blue-800'
                            : order.status === 'Shipped'
                            ? 'bg-purple-100 text-purple-800'
                            : 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {order.status}
                      </span>
                      <span className="text-[10px] normal-case text-gray-500">
                        Payment: {order.paymentStatus || 'Pending'}
                      </span>
                    </div>
                  ) : order.tenderType ? (
                    <span
                      className={`px-2 py-1 rounded ${
                        order.tenderType === 'CASH'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-purple-100 text-purple-800'
                      }`}
                    >
                      {order.tenderType === 'HYDROGEN_POS' ? 'HYDROGEN POS' : order.tenderType}
                    </span>
                  ) : (
                    <span className="px-2 py-1 rounded bg-gray-100 text-gray-500 italic">
                      Pending
                    </span>
                  )}
                </td>
                <td 
                  className="p-2 text-gray-800 font-bold text-right cursor-pointer"
                  onClick={() => handleOrderSelect(order)}
                >
                  ₦{order.total.toLocaleString()}
                </td>
                {activeStatus === 'COMPLETE' && (
                  <td className="p-2 text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handlePrintOrder(order);
                        }}
                        disabled={printingOrderId === order.id}
                        className="px-2 py-1 bg-blue-500 hover:bg-blue-600 text-white rounded text-xs font-semibold flex items-center gap-1 transition-colors disabled:opacity-60"
                      >
                        <FontAwesomeIcon icon={faPrint} className="w-2.5 h-2.5" />
                        {printingOrderId === order.id ? 'Printing...' : 'Print'}
                      </button>
                      {canRefund && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedOrder(order);
                            setShowRefundModal(true);
                          }}
                          className="px-2 py-1 bg-orange-500 hover:bg-orange-600 text-white rounded text-xs font-semibold flex items-center gap-1 transition-colors"
                        >
                          <FontAwesomeIcon icon={faUndo} className="w-2.5 h-2.5" />
                          Refund
                        </button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>

        {filteredOrders.length === 0 && (
          <div className="flex items-center justify-center h-48 text-gray-400">
            <div className="text-center">
              <div className="text-2xl mb-1">📋</div>
              <div className="text-xs">
                {activeStatus === 'ORDERED' ? 'No online orders' : `No ${activeStatus.toLowerCase()} orders`}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Transaction Detail Slide-Out Panel */}
      {showDetailPanel && detailOrder && (
        <div className="fixed inset-0 bg-black/50 z-40" onClick={() => setShowDetailPanel(false)}>
          <div 
            className="absolute right-0 top-0 h-full w-full sm:w-[37%] sm:min-w-[360px] bg-white shadow-2xl transform transition-transform duration-300 ease-out overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white px-4 py-3 flex items-center justify-between flex-shrink-0">
              <div>
                <h3 className="text-base font-bold">{detailOrder.source === 'E-Commerce' ? 'Online Order Details' : 'Transaction Details'}</h3>
                <p className="text-blue-100 text-sm">{detailOrder.time}</p>
              </div>
              <button
                onClick={() => setShowDetailPanel(false)}
                className="p-1.5 hover:bg-white/20 rounded transition-colors"
              >
                <FontAwesomeIcon icon={faX} className="w-4 h-4" />
              </button>
            </div>

            {/* Transaction Info */}
            <div className="p-3 bg-gray-50 border-b border-gray-200 space-y-2 flex-shrink-0">
              <div className="flex justify-between">
                <span className="text-gray-600 text-sm">Order ID</span>
                <span className="font-semibold text-gray-800 text-sm">{detailOrder.id?.toString().slice(-8)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600 text-sm">Customer</span>
                <span className="font-semibold text-gray-800 text-sm">{detailOrder.customer}</span>
              </div>
              {detailOrder.source === 'E-Commerce' && detailOrder.location && (
                <div className="flex justify-between gap-4">
                  <span className="text-gray-600 text-sm">Fulfilment</span>
                  <span className="text-right font-semibold text-gray-800 text-sm">{detailOrder.location}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-gray-600 text-sm">{detailOrder.source === 'E-Commerce' ? 'Source' : 'Completed By'}</span>
                <span className="font-semibold text-gray-800 text-sm">{detailOrder.sourceLabel || detailOrder.staffMember}</span>
              </div>
              {detailOrder.heldByStaffName && (
                <div className="flex justify-between">
                  <span className="text-gray-600 text-sm">Held By</span>
                  <span className="font-semibold text-gray-800 text-sm">{detailOrder.heldByStaffName}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-gray-600 text-sm">Payment</span>
                <span className="font-semibold text-gray-800 text-sm">{detailOrder.paymentStatus || detailOrder.tenderType || 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600 text-sm">Status</span>
                <span className="font-semibold text-gray-800 text-sm">
                  {(detailOrder.status || 'completed').toString().toUpperCase()}
                  {detailOrder.subStatus ? ` (${detailOrder.subStatus})` : ''}
                </span>
              </div>
              {detailOrder.reservationStatus && (
                <div className="flex justify-between">
                  <span className="text-gray-600 text-sm">Reservation</span>
                  <span className="font-semibold text-gray-800 text-sm">{detailOrder.reservationStatus}</span>
                </div>
              )}
              {detailOrder.shippingDetails?.address && (
                <div className="flex justify-between gap-4">
                  <span className="text-gray-600 text-sm">Delivery</span>
                  <span className="text-right font-semibold text-gray-800 text-sm">
                    {detailOrder.shippingDetails.address}
                    {detailOrder.shippingDetails.city ? `, ${detailOrder.shippingDetails.city}` : ''}
                  </span>
                </div>
              )}
            </div>

            {/* Items List */}
            <div className="flex-1 overflow-y-auto p-3">
              <h4 className="text-sm font-bold text-gray-700 uppercase mb-2">Items ({detailOrder.items?.length || 0})</h4>
              <div className="space-y-2">
                {detailOrder.items && detailOrder.items.map((item, idx) => (
                  <div key={idx} className="bg-white border border-gray-200 rounded-lg p-2.5 flex justify-between items-start gap-2">
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-gray-800">{item.name}</p>
                      <p className="text-sm text-gray-600 mt-0.5">
                        {item.qty || item.quantity} × ₦{Number(item.salePriceIncTax || item.price || 0).toLocaleString('en-NG')}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-gray-800">
                        ₦{Number((item.qty || item.quantity || 1) * (item.salePriceIncTax || item.price || 0)).toLocaleString('en-NG')}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Totals */}
            <div className="p-3 bg-gray-100 border-t border-gray-200 space-y-1.5 flex-shrink-0">
              <div className="flex justify-between text-sm text-gray-700">
                <span>Subtotal</span>
                <span>₦{Number(detailOrder.subtotal || detailOrder.total || 0).toLocaleString('en-NG')}</span>
              </div>
              {detailOrder.discount > 0 && (
                <div className="flex justify-between text-sm text-orange-600 font-semibold">
                  <span>Discount</span>
                  <span>-₦{Number(detailOrder.discount).toLocaleString('en-NG')}</span>
                </div>
              )}
              {detailOrder.tax > 0 && (
                <div className="flex justify-between text-sm text-gray-700">
                  <span>Tax</span>
                  <span>₦{Number(detailOrder.tax).toLocaleString('en-NG')}</span>
                </div>
              )}
              {detailOrder.shippingCost > 0 && (
                <div className="flex justify-between text-sm text-gray-700">
                  <span>Shipping</span>
                  <span>₦{Number(detailOrder.shippingCost).toLocaleString('en-NG')}</span>
                </div>
              )}
              <div className="flex justify-between text-sm font-bold text-gray-800 pt-1.5 border-t-2 border-gray-300">
                <span>Total</span>
                <span>₦{Number(detailOrder.total || 0).toLocaleString('en-NG')}</span>
              </div>
              {detailOrder.tenderPayments && detailOrder.tenderPayments.length > 1 && (
                <div className="pt-1.5 mt-1.5 border-t border-gray-300">
                  <p className="text-sm font-bold text-gray-700 mb-1">Split Payment:</p>
                  {detailOrder.tenderPayments.map((tp, idx) => (
                    <div key={idx} className="flex justify-between text-sm text-gray-700">
                      <span>{tp.tenderName}</span>
                      <span>₦{Number(tp.amount || 0).toLocaleString('en-NG')}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className={`p-3 bg-white border-t border-gray-200 grid gap-2 flex-shrink-0 ${detailOrder.source === 'E-Commerce' ? 'grid-cols-1 sm:grid-cols-4' : 'grid-cols-1 sm:grid-cols-3'}`}>
              {detailOrder.source === 'E-Commerce' && (
                <button
                  onClick={() => handleProcessOnlineOrder(detailOrder, { finalStatus: 'Processing' })}
                  disabled={processingOrderId === detailOrder.id || detailOrder.hasPosTransaction}
                  className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-semibold transition-colors active:scale-95 disabled:opacity-60"
                >
                  {processingOrderId === detailOrder.id
                    ? 'Starting...'
                    : detailOrder.hasPosTransaction
                    ? 'Sale Recorded'
                    : detailOrder.status === 'Processing'
                    ? 'Resume POS Sale'
                    : 'Process in POS'}
                </button>
              )}
              {detailOrder.source === 'E-Commerce' && !detailOrder.hasPosTransaction && detailOrder.status !== 'Delivered' && (
                <button
                  onClick={() => handleProcessOnlineOrder(detailOrder, { finalStatus: 'Delivered' })}
                  disabled={processingOrderId === detailOrder.id}
                  className="px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-semibold transition-colors active:scale-95 disabled:opacity-60"
                >
                  {processingOrderId === detailOrder.id ? 'Opening...' : 'Process as Delivered'}
                </button>
              )}
              {detailOrder.source === 'E-Commerce' && detailOrder.hasPosTransaction && detailOrder.status !== 'Delivered' && (
                <button
                  onClick={() => handleMarkDelivered(detailOrder)}
                  disabled={deliveringOrderId === detailOrder.id}
                  className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition-colors active:scale-95 disabled:opacity-60"
                >
                  {deliveringOrderId === detailOrder.id ? 'Sending...' : 'Mark Delivered'}
                </button>
              )}
              {detailOrder.source !== 'E-Commerce' && (
                <button
                  onClick={() => handlePrintOrder(detailOrder)}
                  disabled={printingOrderId === detailOrder.id}
                  className="px-3 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm font-semibold transition-colors active:scale-95 disabled:opacity-60"
                >
                  <FontAwesomeIcon icon={faPrint} className="mr-1 w-3.5 h-3.5" />
                  {printingOrderId === detailOrder.id ? 'Printing...' : 'Print'}
                </button>
              )}
              {detailOrder.source !== 'E-Commerce' && (canRefund ? (
                <button
                  onClick={() => {
                    setShowDetailPanel(false);
                    setSelectedOrder(detailOrder);
                    setShowRefundModal(true);
                  }}
                  className="flex-1 px-3 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-sm font-semibold transition-colors active:scale-95"
                >
                  <FontAwesomeIcon icon={faUndo} className="mr-1 w-3.5 h-3.5" />
                  Refund
                </button>
              ) : (
                <div />
              ))}
              <button
                onClick={() => setShowDetailPanel(false)}
                className="px-3 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-lg text-sm font-semibold transition-colors active:scale-95"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Refund Modal */}
      {showRefundModal && selectedOrder && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
            <div className="bg-gradient-to-r from-orange-500 to-orange-600 text-white px-6 py-4">
              <h3 className="text-lg font-bold">Refund Transaction</h3>
              <p className="text-orange-100 text-sm">Order ID: {selectedOrder.id?.toString().slice(-8)}</p>
            </div>

            <div className="p-6 space-y-4">
              <div className="bg-gray-50 p-4 rounded-lg">
                <p className="text-sm text-gray-600">Total Amount</p>
                <p className="text-2xl font-bold text-gray-800">₦{selectedOrder.total.toLocaleString()}</p>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <p className="text-sm text-blue-800">
                  <strong>Recall to Cart:</strong> Make edits and reprocess (saved as &quot;edited&quot;)
                </p>
              </div>
              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                <p className="text-sm text-red-800">
                  <strong>Process Refund:</strong> Mark transaction as &quot;refund&quot; with sub-status &quot;void&quot;
                </p>
              </div>

              {refundError && (
                <div className="bg-red-50 border border-red-300 rounded-lg p-3">
                  <p className="text-sm text-red-700">{refundError}</p>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => handleRefund(selectedOrder, 'recall')}
                  disabled={refundLoading}
                  className="flex-1 px-4 py-3 bg-blue-500 hover:bg-blue-600 text-white font-bold rounded-lg transition-colors disabled:opacity-50"
                >
                  Recall to Cart
                </button>
                <button
                  onClick={() => handleRefund(selectedOrder, 'process')}
                  disabled={refundLoading}
                  className="flex-1 px-4 py-3 bg-red-500 hover:bg-red-600 text-white font-bold rounded-lg transition-colors disabled:opacity-50"
                >
                  {refundLoading ? 'Processing...' : 'Process Refund'}
                </button>
              </div>

              <button
                onClick={() => {
                  setShowRefundModal(false);
                  setSelectedOrder(null);
                  setRefundError(null);
                }}
                disabled={refundLoading}
                className="w-full px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold rounded-lg transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
