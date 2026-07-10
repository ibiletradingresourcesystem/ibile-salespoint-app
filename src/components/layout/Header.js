import { useState, useEffect } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faSearch, faSignOutAlt } from "@fortawesome/free-solid-svg-icons";
import { useStaff } from "../../context/StaffContext";
import Router from "next/router";

/**
 * EpoNow Header Component
 * Dark teal background with store info, search, and navigation
 */
export default function Header({ onMenuToggle }) {
  const { staff, logout } = useStaff();
  const [dateTime, setDateTime] = useState("");

  useEffect(() => {
    const timer = setInterval(() => {
      setDateTime(
        new Date().toLocaleTimeString("en-GB", {
          day: "2-digit",
          month: "2-digit",
          year: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        })
      );
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const handleLogout = () => {
    logout();
    Router.push("/");
  };

  return (
    <header className="h-20 bg-gradient-to-r from-teal-700 via-teal-600 to-teal-700 text-white shadow-lg flex items-center justify-between px-6">
      {/* LEFT - Store Name & DateTime */}
      <div className="flex flex-col">
        <p className="font-bold text-lg uppercase tracking-wider">
          {staff?.locationName || "NO STORE"}
        </p>
        <p className="text-xs text-teal-100">{dateTime}</p>
      </div>

      {/* CENTER - Search */}
      <div className="flex-1 mx-8">
        <div className="relative w-64">
          <input
            type="text"
            placeholder="Search products..."
            className="w-full px-4 py-2 rounded-lg bg-teal-500/30 text-white placeholder-teal-200 focus:outline-none focus:ring-2 focus:ring-teal-300 border border-teal-400/50"
          />
          <FontAwesomeIcon
            icon={faSearch}
            className="absolute right-3 top-1/2 transform -translate-y-1/2 text-teal-200"
          />
        </div>
      </div>

      {/* RIGHT - Tabs & Logout */}
      <div className="flex items-center gap-6">
        {["ME", "CUSRS", "ORRS"].map((tab) => (
          <button
            key={tab}
            className="px-4 py-2 font-semibold text-sm transition hover:bg-teal-500/30 rounded"
          >
            {tab}
          </button>
        ))}
        <button
          onClick={handleLogout}
          className="p-2 hover:bg-teal-500/50 rounded-lg transition"
          title="Sign out"
        >
          <FontAwesomeIcon icon={faSignOutAlt} className="text-xl" />
        </button>
      </div>
    </header>
  );
}
