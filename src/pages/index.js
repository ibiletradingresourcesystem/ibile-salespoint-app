/**
 * Main POS System Page
 * 
 * Screen content only.
 * Layout, CartPanel, Sidebar, TopBar all provided by EpoNowLayout wrapper.
 */

import React, { useState, useEffect } from 'react';
import MenuScreen from '../components/pos/MenuScreen';
import CustomersScreen from '../components/pos/CustomersScreen';
import OrdersScreen from '../components/pos/OrdersScreen';

export default function POSPage({ activeTab, onTabChange }) {
  // Use prop if provided by layout, otherwise use local state
  const [localActiveTab, setLocalActiveTab] = useState('MENU');
  const currentTab = activeTab !== undefined ? activeTab : localActiveTab;
  const setCurrentTab = onTabChange || setLocalActiveTab;

  const renderScreen = () => {
    switch (currentTab) {
      case 'MENU':
        return <MenuScreen />;
      case 'CUSTOMERS':
        return <CustomersScreen onNavigateToMenu={() => setCurrentTab('MENU')} />;
      case 'ORDERS':
        return <OrdersScreen onNavigateToMenu={() => setCurrentTab('MENU')} />;
      default:
        return <MenuScreen />;
    }
  };

  return (
    // h-full, not flex-1: the layout's screen area isn't a flex container, so flex-1 left this sized to its
    // content and screens couldn't fill the height (e.g. Complete Payment "Fit to screen")
    <div className="h-full min-h-0 flex flex-col overflow-hidden bg-gray-50">
      {renderScreen()}
    </div>
  );
}
