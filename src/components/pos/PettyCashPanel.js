import { useState, useEffect, useCallback } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTimes, faCoins, faPlus, faCheck } from "@fortawesome/free-solid-svg-icons";

function PettyCashPanel({ isOpen, onClose, staffName, location }) {
  const [tab, setTab] = useState("orders"); // "orders" | "new"
  const [vendors, setVendors] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  // New entry form
  const [selectedVendor, setSelectedVendor] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [vendorRes, orderRes] = await Promise.all([
        fetch("/api/petty-cash/vendors"),
        fetch(`/api/petty-cash/orders?location=${encodeURIComponent(location || "")}`),
      ]);
      const vendorData = await vendorRes.json();
      const orderData = await orderRes.json();
      setVendors(vendorData.vendors || []);
      setOrders(orderData.orders || []);
    } catch (err) {
      console.error("Failed to load petty cash data:", err);
    } finally {
      setLoading(false);
    }
  }, [location]);

  useEffect(() => {
    if (isOpen) {
      fetchData();
      setMessage(null);
    }
  }, [isOpen, fetchData]);

  const handleVendorSelect = (vendorId) => {
    setSelectedVendor(vendorId);
    const vendor = vendors.find((v) => String(v._id) === vendorId);
    if (vendor) {
      setVendorName(vendor.companyName || "");
    }
  };

  const handleSubmitNew = async (e) => {
    e.preventDefault();
    if (!vendorName.trim() || !purpose.trim() || !amount) return;

    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/petty-cash/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendorId: selectedVendor || undefined,
          vendorName: vendorName.trim(),
          purpose: purpose.trim(),
          amount: Number(amount),
          location,
          staffName,
          paymentMethod,
        }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to create entry");
      }

      setMessage({ type: "success", text: `₦${Number(amount).toLocaleString()} petty cash recorded` });
      setSelectedVendor("");
      setVendorName("");
      setPurpose("");
      setAmount("");
      setPaymentMethod("cash");
      setTab("orders");
      fetchData();
    } catch (err) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setSaving(false);
    }
  };

  const handleReceive = async (orderId) => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/petty-cash/receive", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, staffName, location }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to mark as received");
      }

      setMessage({ type: "success", text: "Order marked as paid" });
      fetchData();
    } catch (err) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <FontAwesomeIcon icon={faCoins} className="text-amber-600 w-5 h-5" />
            <h2 className="text-lg font-bold text-gray-900">Petty Cash</h2>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg">
            <FontAwesomeIcon icon={faTimes} className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200">
          <button
            onClick={() => setTab("orders")}
            className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${
              tab === "orders"
                ? "border-b-2 border-blue-600 text-blue-600"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Pending Orders ({orders.length})
          </button>
          <button
            onClick={() => setTab("new")}
            className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${
              tab === "new"
                ? "border-b-2 border-blue-600 text-blue-600"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            <FontAwesomeIcon icon={faPlus} className="mr-1" />
            New Entry
          </button>
        </div>

        {/* Message */}
        {message && (
          <div
            className={`mx-4 mt-3 px-3 py-2 rounded-lg text-sm ${
              message.type === "success"
                ? "bg-green-50 text-green-800 border border-green-200"
                : "bg-red-50 text-red-800 border border-red-200"
            }`}
          >
            {message.text}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="text-center py-8 text-gray-400">Loading...</div>
          ) : tab === "orders" ? (
            orders.length === 0 ? (
              <div className="text-center py-8 text-gray-400">
                No pending petty cash orders for this location.
              </div>
            ) : (
              <div className="space-y-3">
                {orders.map((order) => (
                  <div
                    key={order._id}
                    className="border border-gray-200 rounded-lg p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-gray-900 truncate">
                          {order.purpose || order.vendorName || "Petty Cash"}
                        </p>
                        {order.vendorName && (
                          <p className="text-xs text-gray-500">{order.vendorName}</p>
                        )}
                        <p className="text-sm font-bold text-gray-800 mt-1">
                          ₦{Number(order.amount || 0).toLocaleString()}
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          Status: {order.status}
                        </p>
                      </div>
                      {(order.status === "Ordered" || order.status === "Approved") && (
                        <button
                          onClick={() => handleReceive(order._id)}
                          disabled={saving}
                          className="shrink-0 px-3 py-1.5 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white text-xs font-semibold rounded-lg flex items-center gap-1"
                        >
                          <FontAwesomeIcon icon={faCheck} className="w-3 h-3" />
                          Receive
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : (
            /* New Entry Form */
            <form onSubmit={handleSubmitNew} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Vendor
                </label>
                {vendors.length > 0 ? (
                  <select
                    value={selectedVendor}
                    onChange={(e) => handleVendorSelect(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="">Select or type custom vendor</option>
                    {vendors.map((v) => (
                      <option key={v._id} value={v._id}>
                        {v.companyName}
                      </option>
                    ))}
                  </select>
                ) : null}
                <input
                  type="text"
                  placeholder="Vendor name"
                  value={vendorName}
                  onChange={(e) => {
                    setVendorName(e.target.value);
                    if (selectedVendor) setSelectedVendor("");
                  }}
                  required
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-2"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Purpose / Description
                </label>
                <input
                  type="text"
                  placeholder="e.g. Office supplies"
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                  required
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Amount (₦)
                  </label>
                  <input
                    type="number"
                    placeholder="0"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    min="1"
                    step="1"
                    required
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Payment Method
                  </label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="cash">Cash</option>
                    <option value="transfer">Transfer</option>
                  </select>
                </div>
              </div>

              <button
                type="submit"
                disabled={saving || !vendorName.trim() || !purpose.trim() || !amount}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-semibold rounded-lg text-sm transition-colors"
              >
                {saving ? "Saving..." : "Record Petty Cash Payment"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

export default PettyCashPanel;
