import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTimes, faCoins, faPlus, faCheck } from "@fortawesome/free-solid-svg-icons";

function PettyCashPanel({ isOpen, onClose, staffName, location }) {
  const [tab, setTab] = useState("orders");
  const [vendors, setVendors] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  // New vendor order form
  const [selectedVendor, setSelectedVendor] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const locationParam = location ? `?location=${encodeURIComponent(location)}` : "";
      const [vendorRes, orderRes] = await Promise.all([
        fetch("/api/petty-cash/vendors"),
        fetch(`/api/petty-cash/orders${locationParam}`),
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

  const resetForm = () => {
    setSelectedVendor("");
    setDescription("");
    setAmount("");
  };

  const handleSubmitOrder = async (e) => {
    e.preventDefault();
    if (!selectedVendor || !amount) return;

    const vendor = vendors.find((v) => String(v._id) === selectedVendor);
    if (!vendor) return;

    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/petty-cash/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendorId: selectedVendor,
          vendorName: vendor.companyName || "",
          purpose: vendor.companyName || "Petty Cash Order",
          description: description.trim(),
          amount: Number(amount),
          location,
          staffName,
        }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to create vendor order");
      }

      setMessage({ type: "success", text: `Vendor order created — ₦${Number(amount).toLocaleString()}` });
      resetForm();
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

  const today = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });

  const modalContent = (
    <div className="fixed inset-0 z-[9999] bg-black/50 flex items-center justify-center p-4">
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
              tab === "orders" ? "border-b-2 border-blue-600 text-blue-600" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Vendor Orders ({orders.length})
          </button>
          <button
            onClick={() => { setTab("new"); resetForm(); }}
            className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${
              tab === "new" ? "border-b-2 border-blue-600 text-blue-600" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            <FontAwesomeIcon icon={faPlus} className="mr-1" />
            New Vendor Order
          </button>
        </div>

        {/* Message */}
        {message && (
          <div className={`mx-4 mt-3 px-3 py-2 rounded-lg text-sm ${
            message.type === "success" ? "bg-green-50 text-green-800 border border-green-200" : "bg-red-50 text-red-800 border border-red-200"
          }`}>
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
                No pending petty cash vendor orders for this location.
              </div>
            ) : (
              <div className="space-y-3">
                {orders.map((order) => (
                  <div key={order._id} className="border border-gray-200 rounded-lg p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-gray-900 truncate">
                          {order.vendorName || "Vendor"}
                        </p>
                        {order.description && (
                          <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{order.description}</p>
                        )}
                        <p className="text-sm font-bold text-gray-800 mt-1">
                          ₦{Number(order.amount || 0).toLocaleString()}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                            order.status === "Approved" ? "bg-green-100 text-green-700" :
                            order.status === "Ordered" ? "bg-blue-100 text-blue-700" :
                            "bg-gray-100 text-gray-600"
                          }`}>{order.status}</span>
                          {order.location && <span className="text-[10px] text-gray-400">{order.location}</span>}
                        </div>
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
            /* New Vendor Order Form */
            <form onSubmit={handleSubmitOrder} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Vendor *</label>
                <select
                  value={selectedVendor}
                  onChange={(e) => setSelectedVendor(e.target.value)}
                  required
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">Select a petty cash vendor</option>
                  {vendors.map((v) => (
                    <option key={v._id} value={v._id}>{v.companyName}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Amount (₦) *</label>
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
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes / Description</label>
                <textarea
                  placeholder="Any additional notes..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Order Date</label>
                  <input
                    type="text"
                    value={today}
                    disabled
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-600"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
                  <input
                    type="text"
                    value={location || "—"}
                    disabled
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-600"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={saving || !selectedVendor || !amount}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-semibold rounded-lg text-sm transition-colors"
              >
                {saving ? "Submitting..." : `Submit Order${amount ? ` (₦${Number(amount).toLocaleString()})` : ""}`}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return modalContent;
  return createPortal(modalContent, document.body);
}

export default PettyCashPanel;
