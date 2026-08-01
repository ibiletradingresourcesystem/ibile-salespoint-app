/**
 * CartContext - Unified cart & order engine for the POS system
 * 
 * Responsibilities:
 * - Manage active cart (items, quantities, discounts, notes)
 * - Manage order lifecycle (HELD, ORDERED, PENDING, COMPLETE)
 * - Provide shared cart operations across MENU, CUSTOMERS, ORDERS screens
 * - Handle local order persistence via localStorage/IndexedDB
 * - Track offline sync status
 * 
 * State Structure:
 * - activeCart: Current transaction being built
 * - orders: All saved orders (HELD, ORDERED, etc.)
 * - syncStatus: 'synced' | 'syncing' | 'error'
 * - lastSyncTime: ISO timestamp
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { autoSyncTransactions } from '../services/syncService';
import {
  getOnlineStatus,
  getPendingTransactionsCount,
  saveTransactionOffline,
} from '../lib/offlineSync';
import { getSyncMeta } from '../lib/indexedDB';
import { getRoomReservationDetails, isRoomProduct } from '../lib/roomReservations';

// ============================================================================
// CONTEXT DEFINITION
// ============================================================================

const CartContext = createContext();

// ============================================================================
// CART STATE STRUCTURE
// ============================================================================

const INITIAL_CART = {
  id: null, // null for new, UUID for existing
  recallSourceTransactionId: null, // original completed transaction being edited via refund recall
  onlineOrder: null, // online order metadata when processing web orders in POS
  items: [], // [{ id, name, category, price, quantity, discount, notes }, ...]
  discountPercent: 0,
  discountAmount: 0,
  subtotal: 0,
  tax: 0,
  total: 0,
  status: 'DRAFT', // DRAFT, HELD, ORDERED, PENDING, COMPLETE
  customer: null,
  staffMember: null,
  tenderType: null, // CASH, POS, etc.
  notes: '',
  createdAt: null,
  completedAt: null,
  syncedAt: null,
};

const INITIAL_STATE = {
  activeCart: { ...INITIAL_CART },
  orders: [],
  syncStatus: 'synced', // synced | syncing | error
  lastSyncTime: null,
  isOnline: true,
  error: null,
};

const getOrderContactDetails = (order = {}) => {
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

// ============================================================================
// PROVIDER COMPONENT
// ============================================================================

export function CartProvider({ children }) {
  const [state, setState] = useState(INITIAL_STATE);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [showPaymentPanel, setShowPaymentPanel] = useState(false);
  const lastAddRef = useRef({});

  const resolvePersistedSyncTime = useCallback(async (explicitSyncTime = null) => {
    const candidates = [];

    if (explicitSyncTime) {
      candidates.push(explicitSyncTime);
    }

    if (typeof window !== 'undefined') {
      candidates.push(localStorage.getItem('pos_lastSyncTime'));
    }

    try {
      const [productMeta, categoryMeta] = await Promise.all([
        getSyncMeta('lastProductSync'),
        getSyncMeta('lastCategorySync'),
      ]);

      candidates.push(productMeta?.timestamp, categoryMeta?.timestamp);
    } catch (error) {
      console.warn('Failed to resolve IndexedDB sync metadata:', error);
    }

    return candidates.reduce((latest, candidate) => {
      if (!candidate) return latest;

      const candidateDate = new Date(candidate);
      if (Number.isNaN(candidateDate.getTime())) {
        return latest;
      }

      if (!latest) {
        return candidateDate.toISOString();
      }

      return candidateDate > new Date(latest) ? candidateDate.toISOString() : latest;
    }, null);
  }, []);

  const refreshSyncState = useCallback(async ({ syncedAt = null } = {}) => {
    try {
      const pendingCount = await getPendingTransactionsCount();
      let persistedSyncTime = await resolvePersistedSyncTime(syncedAt);

      if (!persistedSyncTime && pendingCount === 0 && getOnlineStatus()) {
        persistedSyncTime = new Date().toISOString();
      }

      if (persistedSyncTime && typeof window !== 'undefined') {
        localStorage.setItem('pos_lastSyncTime', persistedSyncTime);
      }

      setPendingSyncCount(pendingCount);
      setState(prev => ({
        ...prev,
        isOnline: getOnlineStatus(),
        lastSyncTime: persistedSyncTime || prev.lastSyncTime || null,
      }));
    } catch (err) {
      console.error('Failed to refresh sync state:', err);
    }
  }, [resolvePersistedSyncTime]);

  // Load persisted orders from localStorage on mount
  useEffect(() => {
    try {
      const savedOrders = localStorage.getItem('pos_orders');
      const savedCart = localStorage.getItem('pos_activeCart');
      const savedSyncTime = localStorage.getItem('pos_lastSyncTime');

      setState(prev => ({
        ...prev,
        orders: savedOrders ? JSON.parse(savedOrders) : [],
        activeCart: savedCart ? JSON.parse(savedCart) : { ...INITIAL_CART },
        lastSyncTime: savedSyncTime,
        isOnline: getOnlineStatus(),
      }));

      refreshSyncState({ syncedAt: savedSyncTime });
    } catch (err) {
      console.error('Failed to load persisted cart state:', err);
    }
  }, [refreshSyncState]);

  // Persist state changes
  useEffect(() => {
    localStorage.setItem('pos_orders', JSON.stringify(state.orders));
    localStorage.setItem('pos_activeCart', JSON.stringify(state.activeCart));
  }, [state.orders, state.activeCart]);

  // Detect online/offline
  useEffect(() => {
    const handleConnectivityChange = () => {
      setState(prev => ({ ...prev, isOnline: getOnlineStatus() }));
      refreshSyncState();
    };

    window.addEventListener('online', handleConnectivityChange);
    window.addEventListener('offline', handleConnectivityChange);

    return () => {
      window.removeEventListener('online', handleConnectivityChange);
      window.removeEventListener('offline', handleConnectivityChange);
    };
  }, [refreshSyncState]);

  useEffect(() => {
    const handleSyncStateChange = (event) => {
      const syncedAt = event?.detail?.syncedAt || event?.detail?.lastSyncTime || null;

      if (syncedAt && typeof window !== 'undefined') {
        localStorage.setItem('pos_lastSyncTime', syncedAt);
      }

      refreshSyncState({ syncedAt });
    };

    window.addEventListener('pos:sync-state-changed', handleSyncStateChange);
    window.addEventListener('transactions:completed', handleSyncStateChange);

    return () => {
      window.removeEventListener('pos:sync-state-changed', handleSyncStateChange);
      window.removeEventListener('transactions:completed', handleSyncStateChange);
    };
  }, [refreshSyncState]);

  const manualSync = useCallback(async () => {
    setState(prev => ({
      ...prev,
      syncStatus: 'syncing',
      error: null,
      isOnline: getOnlineStatus(),
    }));

    try {
      const result = await autoSyncTransactions();
      const hasSuccessfulSync = Boolean(result?.success || Number(result?.synced || 0) > 0);
      const syncedAt = hasSuccessfulSync ? new Date().toISOString() : null;

      if (syncedAt && typeof window !== 'undefined') {
        localStorage.setItem('pos_lastSyncTime', syncedAt);
      }

      await refreshSyncState({ syncedAt });

      setState(prev => ({
        ...prev,
        syncStatus: result?.error ? 'error' : 'synced',
        lastSyncTime: syncedAt || prev.lastSyncTime,
        error: result?.error || null,
        isOnline: getOnlineStatus(),
      }));

      return result;
    } catch (err) {
      await refreshSyncState();
      setState(prev => ({
        ...prev,
        syncStatus: 'error',
        error: err?.message || 'Sync failed',
        isOnline: getOnlineStatus(),
      }));
      throw err;
    }
  }, [refreshSyncState]);

  // =========================================================================
  // CART OPERATIONS
  // =========================================================================

  const addItem = useCallback((product) => {
    setState(prev => {
      const productId = product?.id;
      if (productId) {
        const lastAt = lastAddRef.current[productId] || 0;
        const now = Date.now();
        if (now - lastAt < 250) {
          return prev;
        }
        lastAddRef.current[productId] = now;
      }

      const existing = prev.activeCart.items.find(item => item.id === product.id);
      const isRoom = isRoomProduct(product);
      const roomReservationDetails = isRoom ? getRoomReservationDetails(product) : null;
      let newItems;

      if (existing && isRoom) {
        newItems = prev.activeCart.items.map(item =>
          item.id === product.id
            ? {
                ...item,
                name: product.name,
                category: product.category,
                price: product.price,
                quantity: 1,
                notes: roomReservationDetails?.notes || item.notes || '',
                productType: product.productType,
                roomStatus: product.roomStatus || item.roomStatus || 'available',
                reservationDetails: roomReservationDetails,
              }
            : item
        );
      } else if (existing) {
        newItems = prev.activeCart.items.map(item =>
          item.id === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      } else {
        newItems = [
          ...prev.activeCart.items,
          {
            id: product.id,
            name: product.name,
            category: product.category,
            price: product.price,
            quantity: 1,
            discount: 0,
            notes: roomReservationDetails?.notes || '',
            productType: product.productType || 'standard',
            roomStatus: product.roomStatus || 'available',
            reservationDetails: roomReservationDetails,
          },
        ];
      }

      return {
        ...prev,
        activeCart: {
          ...prev.activeCart,
          items: newItems,
        },
      };
    });
  }, []);

  const updateQuantity = useCallback((itemId, quantity) => {
    setState(prev => {
      const targetItem = prev.activeCart.items.find(item => item.id === itemId);
      if (isRoomProduct(targetItem)) {
        return {
          ...prev,
          activeCart: {
            ...prev.activeCart,
            items: prev.activeCart.items.map(item =>
              item.id === itemId ? { ...item, quantity: 1 } : item
            ),
          },
        };
      }

      if (quantity <= 0) {
        return {
          ...prev,
          activeCart: {
            ...prev.activeCart,
            items: prev.activeCart.items.filter(item => item.id !== itemId),
          },
        };
      }

      return {
        ...prev,
        activeCart: {
          ...prev.activeCart,
          items: prev.activeCart.items.map(item =>
            item.id === itemId ? { ...item, quantity } : item
          ),
        },
      };
    });
  }, []);

  const removeItem = useCallback((itemId) => {
    setState(prev => ({
      ...prev,
      activeCart: {
        ...prev.activeCart,
        items: prev.activeCart.items.filter(item => item.id !== itemId),
      },
    }));
  }, []);

  const setItemDiscount = useCallback((itemId, discountAmount) => {
    setState(prev => ({
      ...prev,
      activeCart: {
        ...prev.activeCart,
        items: prev.activeCart.items.map(item =>
          item.id === itemId ? { ...item, discount: discountAmount } : item
        ),
      },
    }));
  }, []);

  const setItemNotes = useCallback((itemId, notes) => {
    setState(prev => ({
      ...prev,
      activeCart: {
        ...prev.activeCart,
        items: prev.activeCart.items.map(item =>
          item.id === itemId
            ? {
                ...item,
                notes,
                reservationDetails: isRoomProduct(item)
                  ? { ...getRoomReservationDetails(item), notes }
                  : item.reservationDetails,
              }
            : item
        ),
      },
    }));
  }, []);

  const setCartDiscount = useCallback((discountPercent) => {
    setState(prev => ({
      ...prev,
      activeCart: {
        ...prev.activeCart,
        discountPercent: Math.max(0, Math.min(100, discountPercent)),
      },
    }));
  }, []);

  // Set customer with optional promotion - applies discount to all items
  const setCustomer = useCallback((customer, promotion = null) => {
    setState(prev => {
      const newCart = {
        ...prev.activeCart,
        customer: customer,
        appliedPromotion: promotion,
      };

      // The promotion will be applied in calculateTotals
      // Just store the promotion object as-is
      if (promotion && promotion.active) {
        console.log('✅ Promotion applied:', {
          name: promotion.name,
          discountType: promotion.discountType,
          discountValue: promotion.discountValue,
          valueType: promotion.valueType
        });
      }

      return {
        ...prev,
        activeCart: newCart,
      };
    });
  }, []);

  // Clear customer from cart
  const clearCustomer = useCallback(() => {
    setState(prev => ({
      ...prev,
      activeCart: {
        ...prev.activeCart,
        customer: null,
        discountPercent: 0,
        discountAmount: 0,
        appliedPromotion: null,
      },
    }));
  }, []);

  // =========================================================================
  // ORDER OPERATIONS
  // =========================================================================

  const holdOrder = useCallback((staffInfo = null, locationInfo = null) => {
    if (state.activeCart.items.length === 0) {
      console.warn('Cannot hold empty cart');
      return;
    }

    const holdReferenceId = state.activeCart.id || `order_${Date.now()}`;

    // Calculate total for the held order
    const items = state.activeCart.items;
    const appliedPromotion = state.activeCart.appliedPromotion;
    let subtotal = 0;
    
    items.forEach(item => {
      let itemTotal = item.price * item.quantity - (item.discount || 0);
      
      // Apply promotion if active
      if (appliedPromotion && appliedPromotion.active) {
        if (appliedPromotion.discountType === 'PERCENTAGE') {
          const percentChange = appliedPromotion.discountValue / 100;
          if (appliedPromotion.valueType === 'INCREMENT') {
            itemTotal = itemTotal * (1 + percentChange);
          } else if (appliedPromotion.valueType === 'DISCOUNT') {
            itemTotal = itemTotal * (1 - percentChange);
          }
        } else if (appliedPromotion.discountType === 'FIXED' && appliedPromotion.fixedAmountApplyMode !== 'TOTAL') {
          if (appliedPromotion.valueType === 'INCREMENT') {
            itemTotal = itemTotal + appliedPromotion.discountValue;
          } else if (appliedPromotion.valueType === 'DISCOUNT') {
            itemTotal = Math.max(0, itemTotal - appliedPromotion.discountValue);
          }
        }
      }
      subtotal += itemTotal;
    });

    // Apply FIXED + TOTAL mode promotion
    if (appliedPromotion && appliedPromotion.active && appliedPromotion.discountType === 'FIXED' && appliedPromotion.fixedAmountApplyMode === 'TOTAL') {
      if (appliedPromotion.valueType === 'INCREMENT') {
        subtotal = subtotal + appliedPromotion.discountValue;
      } else if (appliedPromotion.valueType === 'DISCOUNT') {
        subtotal = Math.max(0, subtotal - appliedPromotion.discountValue);
      }
    }

    const newOrder = {
      ...state.activeCart,
      id: holdReferenceId,
      recallSourceTransactionId:
        state.activeCart.recallSourceTransactionId || holdReferenceId,
      status: 'HELD',
      createdAt: state.activeCart.createdAt || new Date().toISOString(),
      // Store staff and location info when holding
      staffMember: staffInfo || state.activeCart.staffMember,
      location: locationInfo || state.activeCart.location,
      // Store calculated total
      total: subtotal,
      subtotal: subtotal,
    };

    console.log('📋 Holding order with total:', subtotal);

    // =====================================================================
    // SAVE HELD ORDER AS TRANSACTION FOR INVENTORY REVIEW
    // =====================================================================
    // Convert cart items to transaction format
    const transactionItems = items.map(item => ({
      ...item,
      productId: item.id,
      name: item.name,
      price: item.price,
      quantity: isRoomProduct(item) ? 1 : item.quantity,
      discount: item.discount || 0,
      salePriceIncTax: item.price,
      qty: isRoomProduct(item) ? 1 : item.quantity,
      reservationDetails: isRoomProduct(item) ? getRoomReservationDetails(item) : undefined,
    }));

    // Create transaction object with "held" status
    // Handle location - it might be a string or an object with a name property
    const locationString = typeof locationInfo === 'string' 
      ? locationInfo 
      : (locationInfo?.name || locationInfo?.code || 'Default Location');
    
    // If this cart was recalled from an existing held transaction, update it instead of creating a new one
    const existingHeldId = state.activeCart.recallSourceTransactionId || null;

    const heldTransaction = {
      id: holdReferenceId,
      externalId: holdReferenceId,
      clientId: holdReferenceId,
      ...(existingHeldId ? { editTransactionId: existingHeldId } : {}),
      items: transactionItems,
      total: subtotal,
      subtotal: subtotal,
      tax: 0,
      discount: state.activeCart.discountAmount || 0,
      staffName: staffInfo?.name || staffInfo || 'POS Staff',
      staffId: staffInfo?._id || staffInfo?.id || null,
      location: locationString,
      device: state.activeCart.device || 'POS',
      tableName: state.activeCart.tableName || null,
      customerName: state.activeCart.customer?.name || null,
      status: 'held', // This marks it as a held transaction for inventory review
      tenderType: null, // No payment tender for held orders
      amountPaid: 0,
      change: 0,
      createdAt: existingHeldId ? (state.activeCart.createdAt || new Date().toISOString()) : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      tillId: state.activeCart.tillId || null,
      heldByStaffName: staffInfo?.name || staffInfo || 'POS Staff',
      heldByStaffId: staffInfo?._id || staffInfo?.id || null,
    };

    // Save held transaction to database (online) or queue offline
    if (getOnlineStatus()) {
      // Online: Send directly to server
      try {
        fetch('/api/transactions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(heldTransaction),
        })
          .then(response => {
            if (response.ok) {
              console.log('✅ Held order saved to database for inventory review');
            } else {
              console.warn('⚠️ Failed to save held order to database, queuing offline');
              saveTransactionOffline(heldTransaction);
            }
          })
          .catch(err => {
            console.warn('⚠️ Error saving held order online, queuing offline:', err);
            saveTransactionOffline(heldTransaction);
          });
      } catch (err) {
        console.error('⚠️ Failed to save held order:', err);
        saveTransactionOffline(heldTransaction);
      }
    } else {
      // Offline: Queue to IndexedDB
      console.log('🔴 Offline - Queuing held order for sync');
      saveTransactionOffline(heldTransaction)
        .then(() => {
          console.log('✅ Held order queued for database sync');
        })
        .catch(err => {
          console.error('⚠️ Failed to queue held order:', err);
        });
    }

    setState(prev => ({
      ...prev,
      orders: [...prev.orders, newOrder],
      activeCart: { ...INITIAL_CART },
    }));
  }, [state.activeCart]);

  const resumeOrder = useCallback((orderId) => {
    const order = state.orders.find(o => o.id === orderId);
    if (!order) {
      console.error('Order not found:', orderId);
      return;
    }

    setState(prev => ({
      ...prev,
      activeCart: order,
      orders: prev.orders.filter(o => o.id !== orderId),
    }));
  }, [state.orders]);

  const recallTransactionToCart = useCallback((transaction) => {
    if (!transaction || !Array.isArray(transaction.items)) {
      console.error('Invalid transaction for recall:', transaction);
      return;
    }

    const mappedItems = transaction.items.map((item) => ({
      id: item.productId || item.id,
      name: item.name,
      category: item.category,
      price: item.salePriceIncTax || item.price || 0,
      quantity: item.qty || item.quantity || 1,
      discount: item.discount || 0,
      notes: item.note || item.notes || '',
      productType: item.productType || 'standard',
      roomStatus: item.roomStatus || 'available',
      reservationDetails: isRoomProduct(item) ? getRoomReservationDetails(item) : null,
    }));

    setState(prev => ({
      ...prev,
      activeCart: {
        ...INITIAL_CART,
        id: transaction.id || transaction._id || null,
        recallSourceTransactionId: transaction.id || transaction._id || null,
        items: mappedItems,
        discountPercent: transaction.discount || 0,
        subtotal: transaction.subtotal || 0,
        tax: transaction.tax || 0,
        total: transaction.total || 0,
        status: 'DRAFT',
        customer: transaction.customerName ? { name: transaction.customerName } : null,
        createdAt: transaction.createdAt || new Date().toISOString(),
      },
    }));
  }, []);

  const loadOnlineOrderToCart = useCallback((order) => {
    if (!order) {
      console.error('Invalid online order for POS processing:', order);
      return;
    }

    const orderItems = Array.isArray(order.cartProducts) && order.cartProducts.length > 0
      ? order.cartProducts
      : (order.items || []);
    const contactDetails = getOrderContactDetails(order);

    const mappedItems = orderItems.map((item) => ({
      id: item.productId || item.id,
      name: item.name,
      category: item.category,
      price: item.salePriceIncTax || item.price || 0,
      quantity: item.qty || item.quantity || 1,
      discount: item.discount || 0,
      notes: item.note || item.notes || '',
      productType: item.productType || 'standard',
      roomStatus: item.roomStatus || 'available',
      reservationDetails: isRoomProduct(item) ? getRoomReservationDetails(item) : null,
    }));

    setState(prev => ({
      ...prev,
      activeCart: {
        ...INITIAL_CART,
        id: order.id || order._id || null,
        items: mappedItems,
        subtotal: Number(order.subtotal || order.total || 0),
        tax: Number(order.tax || 0),
        total: Number(order.total || 0),
        status: 'DRAFT',
        customer: {
          name: contactDetails.name || order.customerName || 'Online Customer',
          email: contactDetails.email || '',
          phone: contactDetails.phone || '',
          address: contactDetails.address || '',
          city: contactDetails.city || '',
          type: 'ONLINE',
        },
        createdAt: order.createdAt || new Date().toISOString(),
        onlineOrder: {
          id: order.id || order._id || null,
          status: order.status || 'Pending',
          paymentStatus: order.paymentStatus || 'Pending',
          requestedFinalStatus: order.requestedFinalStatus || 'Processing',
          siteKey: order.siteKey || 'store',
          sourceLabel: order.sourceLabel || 'Store Website',
          shippingDetails: contactDetails,
          shippingCost: Number(order.shippingCost || order.deliveryFee || 0),
          deliveryFeeName: order.deliveryFeeName || order.shippingName || 'Delivery Fee',
          discount: Number(order.discount || order.discountAmount || 0),
          discountName: order.discountName || order.discountReason || 'Discount',
          locationName: order.locationName || order.location || '',
          locationId: order.locationId || null,
        },
      },
    }));
  }, []);

  const deleteOrder = useCallback((orderId) => {
    setState(prev => ({
      ...prev,
      orders: prev.orders.filter(o => o.id !== orderId),
    }));
  }, []);

  const deleteCart = useCallback(() => {
    setState(prev => ({
      ...prev,
      activeCart: { ...INITIAL_CART },
    }));
  }, []);

  const completeOrder = useCallback((paymentMethod = 'CASH') => {
    if (state.activeCart.items.length === 0) {
      console.warn('Cannot complete empty cart');
      return;
    }

    // NOTE: Transaction saving is now handled by the Payment Modal
    // This function only clears the cart. No transaction object is created here.
    
    setState(prev => ({
      ...prev,
      activeCart: { ...INITIAL_CART }, // Clear the active cart
    }));

    console.log('✅ Cart cleared after payment');
  }, [state.activeCart]);

  // =========================================================================
  // CART CALCULATIONS
  // =========================================================================

  const calculateTotals = useCallback(() => {
    const { items, discountPercent, fixedDiscount, appliedPromotion } = state.activeCart;
    
    // Debug: Log promotion details
    if (appliedPromotion) {
      console.log('🎁 PROMOTION DEBUG:', {
        promotionName: appliedPromotion.name,
        discountType: appliedPromotion.discountType,
        discountValue: appliedPromotion.discountValue,
        valueType: appliedPromotion.valueType,
        active: appliedPromotion.active,
        fullPromotion: appliedPromotion
      });
    }
    
    // Calculate subtotal with promotion applied to each item
    let subtotal = 0;
    
    items.forEach(item => {
      let itemTotal = item.price * item.quantity - (item.discount || 0);
      const originalItemTotal = itemTotal;
      
      // Apply promotion INCREMENT/discount to item if customer selected
      if (appliedPromotion && appliedPromotion.active) {
        if (appliedPromotion.discountType === 'PERCENTAGE') {
          const percentChange = appliedPromotion.discountValue / 100;
          if (appliedPromotion.valueType === 'INCREMENT') {
            // INCREMENT increases the item price
            itemTotal = itemTotal * (1 + percentChange);
          } else if (appliedPromotion.valueType === 'DISCOUNT') {
            // DISCOUNT decreases the item price
            itemTotal = itemTotal * (1 - percentChange);
          }
          console.log(`📦 Item "${item.name}": Original: ₦${originalItemTotal}, After ${appliedPromotion.valueType} (${appliedPromotion.discountValue}%): ₦${itemTotal}`);
        } else if (appliedPromotion.discountType === 'FIXED' && appliedPromotion.fixedAmountApplyMode !== 'TOTAL') {
          // Fixed amount per item (default PER_ITEM mode) — multiply by quantity
          if (appliedPromotion.valueType === 'INCREMENT') {
            itemTotal = itemTotal + appliedPromotion.discountValue * item.quantity;
          } else if (appliedPromotion.valueType === 'DISCOUNT') {
            itemTotal = Math.max(0, itemTotal - appliedPromotion.discountValue * item.quantity);
          }
          console.log(`📦 Item "${item.name}": Original: ₦${originalItemTotal}, After ${appliedPromotion.valueType} (₦${appliedPromotion.discountValue} × ${item.quantity} items): ₦${itemTotal}`);
        }
        // FIXED + TOTAL mode is applied after the items loop below
      }
      
      subtotal += itemTotal;
    });

    // Apply FIXED + TOTAL mode promotion to the subtotal (not per-item)
    if (appliedPromotion && appliedPromotion.active && appliedPromotion.discountType === 'FIXED' && appliedPromotion.fixedAmountApplyMode === 'TOTAL') {
      if (appliedPromotion.valueType === 'INCREMENT') {
        subtotal = subtotal + appliedPromotion.discountValue;
      } else if (appliedPromotion.valueType === 'DISCOUNT') {
        subtotal = Math.max(0, subtotal - appliedPromotion.discountValue);
      }
      console.log(`💰 Fixed TOTAL mode: Applied ₦${appliedPromotion.discountValue} ${appliedPromotion.valueType} to cart total: ₦${subtotal}`);
    }

    // Apply fixed discount if any
    const fixedDiscountAmount = fixedDiscount || 0;
    const discountedSubtotal = Math.max(0, subtotal - fixedDiscountAmount);
    
    const tax = 0; // No tax for now
    const total = discountedSubtotal + tax;

    // Calculate the discount amount for display
    const rawSubtotal = items.reduce(
      (sum, item) => sum + item.price * item.quantity - (item.discount || 0),
      0
    );
    const priceDifference = rawSubtotal - subtotal + fixedDiscountAmount;
    const isIncrement = appliedPromotion?.active && appliedPromotion?.valueType === 'INCREMENT';
    // For increments, the "discount" is actually negative (price went up), so discountAmount should be 0
    // For discounts, it's positive (price went down)
    const discountAmount = isIncrement ? fixedDiscountAmount : Math.max(0, priceDifference);
    const incrementAmount = isIncrement ? Math.abs(rawSubtotal - subtotal) : 0;

    // Debug: Log final totals
    if (appliedPromotion) {
      console.log('💰 TOTALS DEBUG:', {
        rawSubtotal,
        subtotalAfterPromotion: subtotal,
        discountAmount,
        incrementAmount,
        fixedDiscountAmount,
        discountedSubtotal,
        total
      });
    }

    return {
      subtotal: rawSubtotal,
      discountAmount,
      incrementAmount,
      discountName: appliedPromotion?.active && appliedPromotion.valueType === 'DISCOUNT'
        ? (appliedPromotion.name || 'Discount')
        : (fixedDiscountAmount > 0 ? 'Discount' : ''),
      incrementName: appliedPromotion?.active && appliedPromotion.valueType === 'INCREMENT'
        ? (appliedPromotion.name || 'Additional Charge')
        : '',
      promotionValueType: appliedPromotion?.active ? appliedPromotion.valueType : null,
      discountedSubtotal,
      tax,
      total,
      itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    };
  }, [state.activeCart]);

  // =========================================================================
  // CONTEXT VALUE
  // =========================================================================

  const value = {
    // State
    activeCart: state.activeCart,
    orders: state.orders,
    syncStatus: state.syncStatus,
    lastSyncTime: state.lastSyncTime,
    isOnline: state.isOnline,
    error: state.error,
    pendingSyncCount,

    // Cart operations
    addItem,
    updateQuantity,
    removeItem,
    setItemDiscount,
    setItemNotes,
    setCartDiscount,
    setCustomer,
    clearCustomer,
    deleteCart,

    // Order operations
    holdOrder,
    resumeOrder,
    recallTransactionToCart,
    loadOnlineOrderToCart,
    deleteOrder,
    completeOrder,

    // Calculations
    calculateTotals,

    // Helpers
    getOrdersByStatus: (status) => state.orders.filter(o => o.status === status),
    clearCart: () => setState(prev => ({ ...prev, activeCart: { ...INITIAL_CART } })),
    getPendingSyncCount: () => pendingSyncCount,
    manualSync,

    // Payment UI
    showPaymentPanel,
    setShowPaymentPanel,
  };

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

// ============================================================================
// HOOK
// ============================================================================

export function useCart() {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error('useCart must be used within CartProvider');
  }
  return context;
}
