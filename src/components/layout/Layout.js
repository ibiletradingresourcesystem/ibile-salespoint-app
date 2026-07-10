/**
 * Main Layout Component - POS System
 * 
 * Handles authentication and routes to appropriate layout.
 * Uses StaffLogin for auth and EpoNowLayout for POS interface.
 */

import { useEffect, useState } from "react";
import Image from "next/image";
import StaffLogin from "./StaffLogin";
import POSLayout from "./POSLayout";
import HelpChatBot from "../common/HelpChatBot";
import UnsyncedDataModal from "../common/UnsyncedDataModal";
import { useStaff } from "../../context/StaffContext";
import { getStoreLogo } from "../../lib/logoCache";

const Layout = ({ children }) => {
  const { staff, location } = useStaff();
  const [isMounted, setIsMounted] = useState(false);
  const [showUnsyncedModal, setShowUnsyncedModal] = useState(false);

  // Prevent hydration mismatch - ensure client-side rendering
  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Listen for unsyncedData:open event from HelpChatBot
  useEffect(() => {
    const handleUnsyncedOpen = () => setShowUnsyncedModal(true);
    window.addEventListener("unsyncedData:open", handleUnsyncedOpen);
    return () => window.removeEventListener("unsyncedData:open", handleUnsyncedOpen);
  }, []);

  if (!isMounted) {
    return (
      <div className="flex items-center justify-center w-screen h-screen bg-gradient-to-br from-cyan-600 to-cyan-700">
        <div className="bg-gradient-to-br from-cyan-600 to-cyan-700 rounded-xl shadow-2xl p-8 text-center w-full max-w-md">
          {/* Logo */}
          <div className="w-24 h-24 bg-white rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg overflow-hidden">
            <Image 
              src={getStoreLogo()} 
              alt="Store Logo" 
              width={90}
              height={90}
              className="object-contain"
              onError={(e) => {
                e.target.onerror = null;
                e.target.src = '/images/placeholder.jpg';
              }}
              unoptimized
            />
          </div>

          {/* Loading Text */}
          <p className="text-white font-bold text-lg mb-2">Loading POS System</p>
          <p className="text-cyan-100 text-sm mb-6 font-medium">Initializing...</p>

          {/* Progress Bar */}
          <div className="mb-4">
            <div className="w-full h-2 bg-cyan-900 rounded-full overflow-hidden shadow-inner">
              <div 
                className="h-full bg-gradient-to-r from-cyan-300 to-green-300 rounded-full animate-pulse shadow-lg"
                style={{ width: '40%' }}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Show login if not authenticated
  if (!staff || !location) {
    return (
      <>
        <StaffLogin />
        <HelpChatBot />
        <UnsyncedDataModal isOpen={showUnsyncedModal} onClose={() => setShowUnsyncedModal(false)} />
      </>
    );
  }

  // Show POS layout with children
  return (
    <>
      <POSLayout>
        {children}
      </POSLayout>
      <HelpChatBot />
      <UnsyncedDataModal isOpen={showUnsyncedModal} onClose={() => setShowUnsyncedModal(false)} />
    </>
  );
};

export default Layout;
