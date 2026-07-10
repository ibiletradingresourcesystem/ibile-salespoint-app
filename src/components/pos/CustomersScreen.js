/**
 * CustomersScreen Component
 * 
 * CUSTOMERS tab - displays and manages customer database.
 * - Search customers by name, phone, or email
 * - Filter by customer type (REGULAR, VIP, NEW, INACTIVE, BULK_BUYER, ONLINE)
 * - Add new customer
 * - View customer details
 * - Assign customer to current transaction with applicable promotions
 */

import React, { useState, useEffect } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faSearch,
  faPlus,
  faPhone,
  faEnvelope,
  faMapPin,
  faTag,
  faX,
  faCheck,
  faPercent,
} from '@fortawesome/free-solid-svg-icons';
import { useCart } from '../../context/CartContext';
import { showToast } from '../common/Toast';

const CUSTOMER_TYPES = ['REGULAR', 'VIP', 'NEW', 'INACTIVE', 'BULK_BUYER', 'ONLINE', 'CREDIT'];

const CUSTOMER_TYPE_COLORS = {
  VIP: 'bg-purple-100 text-purple-800 border-purple-300',
  REGULAR: 'bg-blue-100 text-blue-800 border-blue-300',
  NEW: 'bg-green-100 text-green-800 border-green-300',
  INACTIVE: 'bg-gray-100 text-gray-800 border-gray-300',
  BULK_BUYER: 'bg-orange-100 text-orange-800 border-orange-300',
  ONLINE: 'bg-cyan-100 text-cyan-800 border-cyan-300',
  CREDIT: 'bg-amber-100 text-amber-800 border-amber-300',
};

export default function CustomersScreen({ onNavigateToMenu }) {
  const { activeCart, setCustomer, clearCustomer } = useCart();
  const [customers, setCustomers] = useState([]);
  const [promotions, setPromotions] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedType, setSelectedType] = useState('');
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    email: '',
    address: '',
    type: 'REGULAR',
    isCreditCustomer: false,
    creditLimit: '',
    creditNotes: '',
  });
  const [adding, setAdding] = useState(false);

  // Fetch customers and promotions on mount
  useEffect(() => {
    fetchCustomers();
    fetchPromotions();
  }, []);

  const fetchCustomers = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/customers');
      if (response.ok) {
        const data = await response.json();
        setCustomers(Array.isArray(data) ? data : data.data || []);
      } else {
        setCustomers([]);
      }
    } catch (error) {
      console.error('Failed to fetch customers:', error);
      setCustomers([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchPromotions = async () => {
    try {
      const response = await fetch('/api/promotions');
      if (response.ok) {
        const data = await response.json();
        console.log('📢 Promotions API response:', data);
        const promoList = data.data || data.promotions || [];
        console.log('📢 Promotions loaded:', promoList.length, promoList);
        setPromotions(promoList);
      } else {
        console.error('❌ Failed to fetch promotions:', response.status);
      }
    } catch (error) {
      console.error('Failed to fetch promotions:', error);
    }
  };

  // Find applicable promotion for a customer type
  const findApplicablePromotion = (customerType) => {
    console.log('🔍 Finding promotion for customer type:', customerType);
    console.log('🔍 Available promotions:', promotions);
    
    if (!promotions || promotions.length === 0) {
      console.log('⚠️ No promotions available');
      return null;
    }

    // Find active promotions that target this customer type
    const applicablePromos = promotions.filter(promo => {
      console.log('🔍 Checking promo:', promo.name, 'active:', promo.active, 'targets:', promo.targetCustomerTypes);
      if (!promo.active) return false;
      if (!promo.targetCustomerTypes?.includes(customerType)) return false;
      
      // Check if promotion is within date range (if not indefinite)
      if (!promo.indefinite) {
        const now = new Date();
        const start = new Date(promo.startDate);
        const end = new Date(promo.endDate);
        if (now < start || now > end) return false;
      }
      
      return true;
    });

    console.log('✅ Applicable promotions:', applicablePromos);
    // Return highest priority (lowest number) or first match
    if (applicablePromos.length === 0) return null;
    return applicablePromos.sort((a, b) => (a.priority || 0) - (b.priority || 0))[0];
  };

  // Handle customer selection
  const handleSelectCustomer = (customer) => {
    const promotion = findApplicablePromotion(customer.type);
    setCustomer(customer, promotion);
    
    if (promotion) {
      console.log(`✅ Applied promotion "${promotion.name}" for ${customer.type} customer`);
    }
    // Auto-navigate back to menu after selecting a customer
    if (onNavigateToMenu) onNavigateToMenu();
  };

  // Handle customer deselection
  const handleDeselectCustomer = () => {
    clearCustomer();
  };

  const handleAddCustomer = async () => {
    if (!formData.name || !formData.phone) {
      showToast('Name and phone are required', 'warning');
      return;
    }

    try {
      setAdding(true);
      const response = await fetch('/api/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (response.ok) {
        const newCustomer = await response.json();
        setCustomers([...customers, newCustomer]);
        setFormData({
          name: '',
          phone: '',
          email: '',
          address: '',
          type: 'REGULAR',
          isCreditCustomer: false,
          creditLimit: '',
          creditNotes: '',
        });
        setShowAddForm(false);
        showToast('Customer added successfully!', 'success');
      }
    } catch (error) {
      console.error('Failed to add customer:', error);
      showToast('Error adding customer', 'error');
    } finally {
      setAdding(false);
    }
  };

  // Filter customers
  const filteredCustomers = customers.filter(customer => {
    const matchesSearch =
      customer.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (customer.phone && customer.phone.includes(searchTerm)) ||
      (customer.email && customer.email.toLowerCase().includes(searchTerm.toLowerCase()));

    const matchesType = selectedType ? customer.type === selectedType : true;

    return matchesSearch && matchesType;
  });

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header with Search and Add Button */}
      <div className="bg-white border-b border-gray-200 p-4 shadow-sm">
        <div className="flex gap-3 mb-4">
          {/* Search Input */}
          <div className="flex-1 relative">
            <FontAwesomeIcon
              icon={faSearch}
              className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400"
            />
            <input
              type="text"
              placeholder="Search by name, phone, or email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-3 text-sm border-2 border-gray-200 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all"
            />
          </div>

          {/* Add Customer Button */}
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="px-4 py-3 bg-green-500 hover:bg-green-600 text-white font-semibold rounded-lg transition-colors flex items-center gap-2"
          >
            <FontAwesomeIcon icon={faPlus} className="w-5 h-5" />
            <span className="hidden sm:inline">Add Customer</span>
            <span className="sm:hidden">Add</span>
          </button>
        </div>

        {/* Filter by Type */}
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setSelectedType('')}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              selectedType === ''
                ? 'bg-blue-500 text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            All Types
          </button>
          {CUSTOMER_TYPES.map(type => (
            <button
              key={type}
              onClick={() => setSelectedType(type)}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                selectedType === type
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              {type}
            </button>
          ))}
        </div>
      </div>

      {/* Add Customer Form */}
      {showAddForm && (
        <div className="bg-blue-50 border-b border-blue-200 p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              type="text"
              placeholder="Name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="px-3 py-2 border border-blue-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <input
              type="tel"
              placeholder="Phone"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              className="px-3 py-2 border border-blue-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <input
              type="email"
              placeholder="Email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="px-3 py-2 border border-blue-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <input
              type="text"
              placeholder="Address"
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              className="px-3 py-2 border border-blue-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <select
              value={formData.type}
              onChange={(e) => setFormData({
                ...formData,
                type: e.target.value,
                isCreditCustomer: e.target.value === 'CREDIT' ? true : formData.isCreditCustomer,
              })}
              className="px-3 py-2 border border-blue-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {CUSTOMER_TYPES.map(type => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
            <input
              type="number"
              min="0"
              placeholder="Credit limit"
              value={formData.creditLimit}
              onChange={(e) => setFormData({ ...formData, creditLimit: e.target.value })}
              className="px-3 py-2 border border-blue-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <label className="flex items-center gap-2 px-3 py-2 border border-blue-300 rounded-lg text-sm bg-white">
              <input
                type="checkbox"
                checked={formData.isCreditCustomer || formData.type === 'CREDIT'}
                onChange={(e) => setFormData({
                  ...formData,
                  isCreditCustomer: e.target.checked,
                  type: e.target.checked ? 'CREDIT' : formData.type === 'CREDIT' ? 'REGULAR' : formData.type,
                })}
              />
              Credit customer
            </label>
            <input
              type="text"
              placeholder="Credit notes"
              value={formData.creditNotes}
              onChange={(e) => setFormData({ ...formData, creditNotes: e.target.value })}
              className="px-3 py-2 border border-blue-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 sm:col-span-2"
            />
          </div>

          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setShowAddForm(false)}
              className="px-4 py-2 bg-gray-300 hover:bg-gray-400 text-gray-800 font-semibold rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleAddCustomer}
              disabled={adding}
              className="px-4 py-2 bg-green-500 hover:bg-green-600 disabled:bg-gray-400 text-white font-semibold rounded-lg transition-colors"
            >
              {adding ? 'Adding...' : 'Add Customer'}
            </button>
          </div>
        </div>
      )}

      {/* Currently Selected Customer Banner */}
      {activeCart.customer && (
        <div className="bg-gradient-to-r from-green-500 to-green-600 text-white px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FontAwesomeIcon icon={faCheck} className="w-5 h-5" />
            <div>
              <span className="font-bold">{activeCart.customer.name}</span>
              <span className="ml-2 text-green-100">({activeCart.customer.type})</span>
              {(activeCart.customer.isCreditCustomer || activeCart.customer.type === 'CREDIT') && (
                <span className="ml-3 bg-amber-100 text-amber-800 px-2 py-1 rounded text-sm font-bold">
                  Credit balance: ₦{Number(activeCart.customer.creditBalance || 0).toLocaleString('en-NG')}
                </span>
              )}
              {activeCart.appliedPromotion && (
                <span className="ml-3 bg-white/20 px-2 py-1 rounded text-sm">
                  <FontAwesomeIcon icon={faPercent} className="w-3 h-3 mr-1" />
                  {activeCart.appliedPromotion.name}: 
                  {activeCart.appliedPromotion.valueType === 'INCREMENT'
                    ? activeCart.appliedPromotion.discountType === 'PERCENTAGE'
                      ? ` ${activeCart.appliedPromotion.discountValue}% increase`
                      : ` ₦${activeCart.appliedPromotion.discountValue} added`
                    : activeCart.appliedPromotion.discountType === 'PERCENTAGE'
                      ? ` ${activeCart.appliedPromotion.discountValue}% off`
                      : ` ₦${activeCart.appliedPromotion.discountValue} off`
                  }
                </span>
              )}
            </div>
          </div>
          <button
            onClick={handleDeselectCustomer}
            className="px-3 py-1 bg-white/20 hover:bg-white/30 rounded-lg text-sm font-semibold transition-colors active:scale-95"
          >
            Remove
          </button>
        </div>
      )}

      {/* Customers List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="w-12 h-12 bg-cyan-600 rounded-full flex items-center justify-center mx-auto mb-3 shadow-md">
                <div className="animate-spin rounded-full h-6 w-6 border-2 border-white border-t-transparent"></div>
              </div>
              <div className="text-cyan-700 font-semibold text-sm">Loading customers...</div>
              <div className="w-32 h-1.5 bg-cyan-100 rounded-full mx-auto mt-3 overflow-hidden">
                <div className="h-full bg-gradient-to-r from-cyan-400 to-green-400 rounded-full animate-pulse" style={{ width: '60%' }}></div>
              </div>
            </div>
          </div>
        ) : filteredCustomers.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="text-4xl mb-2">👥</div>
              <div className="text-gray-500">No customers found</div>
              {searchTerm && (
                <div className="text-sm text-gray-400 mt-1">
                  Try adjusting your search
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
            {filteredCustomers.map(customer => {
              const isSelected = activeCart.customer?._id === customer._id;
              const applicablePromo = findApplicablePromotion(customer.type);
              
              return (
                <div
                  key={customer._id}
                  onClick={() => !isSelected && handleSelectCustomer(customer)}
                  className={`rounded-lg border-2 shadow-sm hover:shadow-md transition-all p-4 cursor-pointer active:scale-[0.98] ${
                    isSelected 
                      ? 'bg-green-50 border-green-500' 
                      : 'bg-white border-gray-200 hover:border-cyan-400'
                  }`}
                >
                  {/* Customer Type Badge & Selection Status */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      {isSelected && (
                        <div className="bg-green-500 text-white p-1 rounded-full">
                          <FontAwesomeIcon icon={faCheck} className="w-3 h-3" />
                        </div>
                      )}
                      <h3 className={`font-bold text-base line-clamp-1 ${isSelected ? 'text-green-800' : 'text-gray-900'}`}>
                        {customer.name}
                      </h3>
                    </div>
                    <span
                      className={`px-2 py-1 rounded text-xs font-semibold border ${
                        CUSTOMER_TYPE_COLORS[customer.type] || 'bg-gray-100 text-gray-800'
                      }`}
                    >
                      {customer.type}
                    </span>
                  </div>

                  {/* Applicable Promotion Badge */}
                  {applicablePromo && (
                    <div className="bg-gradient-to-r from-purple-100 to-pink-100 border border-purple-300 rounded-lg px-3 py-2 mb-3">
                      <div className="flex items-center gap-2 text-purple-800">
                        <FontAwesomeIcon icon={faPercent} className="w-4 h-4" />
                        <span className="text-sm font-semibold">{applicablePromo.name}</span>
                      </div>
                      <div className="text-xs text-purple-600 mt-1">
                        {applicablePromo.valueType === 'DISCOUNT' ? '🔽' : '🔼'}
                        {applicablePromo.discountType === 'PERCENTAGE' 
                          ? ` ${applicablePromo.discountValue}%`
                          : ` ₦${applicablePromo.discountValue}`
                        } {applicablePromo.valueType === 'DISCOUNT' ? 'discount' : 'INCREMENT'}
                      </div>
                    </div>
                  )}

                  {(customer.isCreditCustomer || customer.type === 'CREDIT') && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3 text-sm">
                      <div className="font-semibold text-amber-800">Credit customer</div>
                      <div className="text-xs text-amber-700 mt-1">
                        Balance: ₦{Number(customer.creditBalance || 0).toLocaleString('en-NG')} · Limit: {Number(customer.creditLimit || 0) > 0 ? `₦${Number(customer.creditLimit || 0).toLocaleString('en-NG')}` : 'No limit'}
                      </div>
                    </div>
                  )}

                  {/* Contact Info */}
                  <div className="space-y-2 text-sm text-gray-600 mb-3">
                    {customer.phone && (
                      <div className="flex items-center gap-2">
                        <FontAwesomeIcon icon={faPhone} className="w-4 h-4 text-blue-500" />
                        <span className="font-mono">{customer.phone}</span>
                      </div>
                    )}
                    {customer.email && (
                      <div className="flex items-center gap-2">
                        <FontAwesomeIcon icon={faEnvelope} className="w-4 h-4 text-blue-500" />
                        <span className="truncate text-xs">{customer.email}</span>
                      </div>
                    )}
                  </div>

                  {/* Select Button */}
                  {!isSelected && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleSelectCustomer(customer); }}
                      className="w-full py-2 bg-cyan-600 hover:bg-cyan-700 text-white font-semibold rounded-lg text-sm transition-colors active:scale-[0.98]"
                    >
                      Select Customer
                    </button>
                  )}
                  {isSelected && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeselectCustomer(); }}
                      className="w-full py-2 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-lg text-sm transition-colors active:scale-[0.98]"
                    >
                      Remove from Transaction
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
