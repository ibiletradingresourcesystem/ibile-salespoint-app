import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTimes, faCoins, faPlus, faCheck, faPen, faTrash } from "@fortawesome/free-solid-svg-icons";

function PettyCashPanel({ isOpen, onClose, staffName, location }) {
  const [tab, setTab] = useState("orders");
  const [vendors, setVendors] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  // New/Edit vendor order form
  const [selectedVendor, setSelectedVendor] = useState("");
  const [description, setDescription] = useState("");
  const [productEntries, setProductEntries] = useState([]);
  const [editingOrderId, setEditingOrderId] = useState(null);

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
    setProductEntries([]);
    setEditingOrderId(null);
  };

  // When vendor changes, load their products into entries
  const handleVendorChange = (vendorId) => {
    setSelectedVendor(vendorId);
    if (!vendorId) {
      setProductEntries([]);
      return;
    }
    const vendor = vendors.find((v) => String(v._id) === vendorId);
    if (vendor && Array.isArray(vendor.products) && vendor.products.length > 0) {
      setProductEntries(
        vendor.products.map((p) => ({
          productId: p.productId || String(p.product),
          productName: p.productName || "",
          costPrice: p.costPrice || p.price || 0,
          quantity: 0,
        }))
      );
    } else {
      setProductEntries([]);
    }
  };

  const updateEntryQty = (index, qty) => {
    setProductEntries((prev) =>
      prev.map((e, i) => (i === index ? { ...e, quantity: Math.max(0, Number(qty) || 0) } : e))
    );
  };

  const removeEntry = (index) => {
    setProductEntries((prev) => prev.filter((_, i) => i !== index));
  };

  const addCustomEntry = () => {
    setProductEntries((prev) => [...prev, { productId: "", productName: "", costPrice: 0, quantity: 1 }]);
  };

  const totalAmount = productEntries.reduce((sum, e) => sum + (e.costPrice || 0) * (e.quantity || 0), 0);

  const handleSubmitOrder = async (e) => {
    e.preventDefault();
    if (!selectedVendor) return;

    const validEntries = productEntries.filter((p) => p.productId && p.quantity > 0);
    if (validEntries.length === 0) {
      setMessage({ type: "error", text: "Add at least one product with quantity" });
      return;
    }

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
          products: validEntries,
          location,
          staffName,
        }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to create vendor order");
      }

      setMessage({ type: "success", text: `Vendor order created — ₦${totalAmount.toLocaleString()}` });
      resetForm();
      setTab("orders");
      fetchData();
    } catch (err) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setSaving(false);
    }
  };

  const handleEditOrder = (order) => {
    setEditingOrderId(order._id);
    setSelectedVendor(String(order.vendor || ""));
    setDescription(order.description || "");
    // Load existing product entries
    if (Array.isArray(order.products) && order.products.length > 0) {
      setProductEntries(order.products.map((p) => ({
        productId: p.productId || "",
        productName: p.productName || "",
        costPrice: p.costPrice || 0,
        quantity: p.quantity || 0,
      })));
    } else {
      // Fall back to vendor products
      const vendor = vendors.find((v) => String(v._id) === String(order.vendor));
      if (vendor && Array.isArray(vendor.products)) {
        setProductEntries(vendor.products.map((p) => ({
          productId: p.productId || String(p.product),
          productName: p.productName || "",
          costPrice: p.costPrice || p.price || 0,
          quantity: 0,
        })));
      } else {
        setProductEntries([]);
      }
    }
    setTab("new");
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    if (!editingOrderId) return;

    const validEntries = productEntries.filter((p) => p.productId && p.quantity > 0);
    if (validEntries.length === 0) {
      setMessage({ type: "error", text: "Add at least one product with quantity" });
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/petty-cash/orders", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: editingOrderId,
          products: validEntries.map(e => ({
            productId: e.productId || "",
            productName: e.productName || "",
            costPrice: Number(e.costPrice) || 0,
            quantity: Number(e.quantity) || 0,
          })),
          description: description.trim(),
          staffName,
          location,
        }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to update order");
      }

      setMessage({ type: "success", text: `Order updated successfully — ₦${validEntries.reduce((sum, e) => sum + (e.costPrice || 0) * (e.quantity || 0), 0).toLocaleString()}` });
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
      // Find the order to get its products
      const order = orders.find(o => o._id === orderId);
      if (!order) throw new Error("Order not found");

      const res = await fetch("/api/petty-cash/receive", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId,
          products: order.products || [],
          staffName,
          location,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to mark as received");
      }

      // Keep order in list with Received status
      setMessage({ type: "success", text: "✓ Items received — stock updated. Now mark as paid when payment is made." });
      fetchData();
    } catch (err) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setSaving(false);
    }
  };

  const handleMarkPaid = async (orderId) => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/petty-cash/orders", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId,
          action: "mark-paid",
          staffName,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to mark as paid");
      }

      setMessage({ type: "success", text: "✓ Order marked as paid" });
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
    <div className="fixed inset-0 z-[9999] bg-black/50 flex items-center justify-center p-4 overflow-hidden">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md h-[90vh] max-h-[90vh] flex flex-col flex-1">
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
            onClick={() => { setTab("orders"); resetForm(); }}
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
            {editingOrderId ? "Edit Order" : "New Vendor Order"}
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
        <div className="flex-1 overflow-y-auto p-4 min-h-0">
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
                        {Array.isArray(order.products) && order.products.length > 0 && (
                          <div className="mt-1 space-y-0.5">
                            {order.products.map((p, i) => (
                              <p key={i} className="text-[11px] text-gray-600">
                                {p.productName} × {p.quantity}
                              </p>
                            ))}
                          </div>
                        )}
                        {order.description && (
                          <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{order.description}</p>
                        )}
                        <p className="text-sm font-bold text-gray-800 mt-1">
                          ₦{Number(order.amount || 0).toLocaleString()}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                            order.status === "Approved" ? "bg-green-100 text-green-700" :
                            order.status === "Received" ? "bg-cyan-100 text-cyan-700" :
                            order.status === "Paid" ? "bg-emerald-100 text-emerald-700" :
                            order.status === "Ordered" ? "bg-blue-100 text-blue-700" :
                            "bg-gray-100 text-gray-600"
                          }`}>{order.status}</span>
                          {order.location && <span className="text-[10px] text-gray-400">{order.location}</span>}
                        </div>
                      </div>
                      <div className="flex flex-col gap-1.5 shrink-0">
                        {(order.status === "Ordered" || order.status === "Approved") && (
                          <>
                            <button
                              onClick={() => handleEditOrder(order)}
                              disabled={saving}
                              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white text-xs font-semibold rounded-lg flex items-center gap-1"
                            >
                              <FontAwesomeIcon icon={faPen} className="w-3 h-3" />
                              Edit
                            </button>
                            <button
                              onClick={() => handleReceive(order._id)}
                              disabled={saving}
                              className="px-3 py-1.5 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white text-xs font-semibold rounded-lg flex items-center gap-1"
                            >
                              <FontAwesomeIcon icon={faCheck} className="w-3 h-3" />
                              Receive
                            </button>
                          </>
                        )}
                        {order.status === "Received" && (
                          <button
                            onClick={() => handleMarkPaid(order._id)}
                            disabled={saving}
                            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 text-white text-xs font-semibold rounded-lg flex items-center gap-1"
                          >
                            <FontAwesomeIcon icon={faCheck} className="w-3 h-3" />
                            Mark Paid
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : (
            /* New/Edit Vendor Order Form */
            <form onSubmit={editingOrderId ? handleSaveEdit : handleSubmitOrder} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Vendor *</label>
                <select
                  value={selectedVendor}
                  onChange={(e) => handleVendorChange(e.target.value)}
                  required
                  disabled={!!editingOrderId}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm disabled:bg-gray-100"
                >
                  <option value="">Select a petty cash vendor</option>
                  {vendors.map((v) => (
                    <option key={v._id} value={v._id}>{v.companyName}</option>
                  ))}
                </select>
              </div>

              {/* Product Entries */}
              {productEntries.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Products * ({productEntries.length})</label>
                  <div className="space-y-2 max-h-64 overflow-y-auto border border-gray-200 rounded-lg p-2 bg-gray-50">
                    {productEntries.map((entry, idx) => (
                      <div key={idx} className="flex items-center gap-2 bg-white rounded-lg px-3 py-2 border border-gray-200">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-gray-800 truncate">{entry.productName || "Product"}</p>
                          <p className="text-[10px] text-gray-500">₦{(entry.costPrice || 0).toLocaleString()} each</p>
                        </div>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={entry.quantity}
                          onChange={(e) => updateEntryQty(idx, e.target.value)}
                          className="w-20 border border-gray-300 rounded px-2 py-1 text-sm text-center font-semibold"
                          placeholder="Qty"
                          autoFocus
                        />
                        <button
                          type="button"
                          onClick={() => removeEntry(idx)}
                          className="p-1 text-red-400 hover:text-red-600"
                        >
                          <FontAwesomeIcon icon={faTrash} className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedVendor && productEntries.length === 0 && (
                <div className="text-center py-4 text-gray-400 text-sm">
                  This vendor has no products configured.
                  <br />
                  <span className="text-xs">Add products to this vendor from the Inventory system.</span>
                </div>
              )}

              {/* Total */}
              {totalAmount > 0 && (
                <div className="bg-blue-50 rounded-lg px-3 py-2 text-sm font-bold text-blue-800">
                  Total: ₦{totalAmount.toLocaleString()}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes / Description</label>
                <textarea
                  placeholder="Any additional notes..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
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
                disabled={saving || !selectedVendor || totalAmount <= 0}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-semibold rounded-lg text-sm transition-colors"
              >
                {saving ? "Saving..." : editingOrderId ? `Update Order (₦${totalAmount.toLocaleString()})` : `Submit Order (₦${totalAmount.toLocaleString()})`}
              </button>

              {editingOrderId && (
                <button
                  type="button"
                  onClick={() => { resetForm(); setTab("orders"); }}
                  className="w-full py-2 text-gray-600 hover:text-gray-800 text-sm font-medium"
                >
                  Cancel Edit
                </button>
              )}
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
