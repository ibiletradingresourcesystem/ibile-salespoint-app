/**
 * TabNavigation Component
 * 
 * Screen switching tabs displayed in gray container
 * - MENU: Product selection and ordering
 * - CUSTOMERS: Customer management
 * - ORDERS: Order history and management
 */

import React from 'react';

export default function TabNavigation({ activeTab, onTabChange }) {
  return (
    <div className="bg-neutral-300 rounded-lg flex gap-1 px-1.5 py-1.5 items-center w-full text-[11px] sm:text-xs">
      {['MENU', 'CUSTOMERS', 'ORDERS'].map(tab => (
        <button
          key={tab}
          onClick={() => onTabChange(tab)}
          className={`px-2.5 py-1.5 sm:px-3 sm:py-2 font-semibold transition-colors duration-base rounded-lg touch-manipulation flex-1 min-h-8 sm:min-h-9 ${
            activeTab === tab
              ? 'bg-white text-neutral-700 shadow-md'
              : 'bg-transparent text-neutral-600 hover:text-neutral-800'
          }`}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}
