import { useState, useEffect } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCog,
  faPrint,
  faBoxes,
  faGripHorizontal,
  faCloud,
  faCog as faSettings,
  faQuestionCircle,
  faPlusCircle,
  faBan,
  faPlus,
  faMinus,
  faTrash,
  faCoins,
  faExchangeAlt,
} from "@fortawesome/free-solid-svg-icons";
import { useStaff } from "../../context/StaffContext";
import Header from "../layout/Header";

/**
 * EpoNow-Inspired POS System
 * Complete layout with sidebar, category grid, and cart panel
 */
export default function POSSystem() {
  const { staff } = useStaff();

  // State
  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [discountPercent, setDiscountPercent] = useState(0);
  const [discountAmount, setDiscountAmount] = useState(0);

  // Fetch categories and products
  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch("/api/products");
        if (res.ok) {
          const data = await res.json();
          const prods = Array.isArray(data) ? data : data.products || [];
          setProducts(prods);

          // Extract unique categories
          const cats = [...new Set(prods.map((p) => p.category))].filter(
            Boolean
          );
          setCategories(
            cats.map((cat) => ({
              name: cat,
              color: getRandomColor(),
            }))
          );
        }
      } catch (err) {
        console.error("Error fetching products:", err);
      }
    };

    fetchData();
  }, []);

  // Get random color for categories
  const getRandomColor = () => {
    const colors = [
      "bg-teal-600",
      "bg-teal-500",
      "bg-cyan-600",
      "bg-blue-600",
      "bg-amber-700",
      "bg-orange-700",
      "bg-green-700",
      "bg-slate-700",
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  };

  // Get products for selected category
  const displayedProducts = selectedCategory
    ? products.filter((p) => p.category === selectedCategory)
    : [];

  // Add to cart
  const addToCart = (product) => {
    const existing = cart.find((item) => item._id === product._id);
    if (existing) {
      setCart(
        cart.map((item) =>
          item._id === product._id
            ? { ...item, quantity: (item.quantity || 1) + 1 }
            : item
        )
      );
    } else {
      setCart([...cart, { ...product, quantity: 1 }]);
    }
  };

  // Update quantity
  const updateQuantity = (productId, quantity) => {
    if (quantity <= 0) {
      setCart(cart.filter((item) => item._id !== productId));
    } else {
      setCart(
        cart.map((item) =>
          item._id === productId ? { ...item, quantity } : item
        )
      );
    }
  };

  // Calculate totals
  const subtotal = cart.reduce(
    (sum, item) => sum + (item.salePriceIncTax || 0) * (item.quantity || 1),
    0
  );
  const discount = (subtotal * discountPercent) / 100 + discountAmount;
  const total = subtotal - discount;
  const tax = (total * 0.075).toFixed(2);
  const due = (parseFloat(total) + parseFloat(tax)).toFixed(2);

  return (
    <div className="flex flex-col h-full w-full bg-gray-100">
      {/* HEADER */}
      <div className="flex-none">
        <Header />
      </div>

      {/* MAIN LAYOUT */}
      <div className="flex flex-1 overflow-hidden">
        {/* LEFT SIDEBAR */}
        <div className="w-48 bg-gray-900 text-white flex flex-col border-r border-gray-700 overflow-y-auto">
          {/* Menu Section */}
          <div className="p-4 border-b border-gray-700">
            <h3 className="font-bold text-sm uppercase tracking-wider">Menu</h3>
          </div>
          <nav className="space-y-2 p-3">
            {[
              { icon: faCog, label: "Admin" },
              { icon: faPrint, label: "Print" },
              { icon: faBoxes, label: "Stock" },
              { icon: faGripHorizontal, label: "Apps" },
            ].map((item, i) => (
              <button
                key={i}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-gray-800 transition text-gray-300 hover:text-white text-sm"
              >
                <FontAwesomeIcon icon={item.icon} className="w-5" />
                <span>{item.label}</span>
              </button>
            ))}
          </nav>

          {/* Divider */}
          <div className="border-t border-gray-700 my-4" />

          {/* Bottom Section */}
          <nav className="space-y-2 p-3 flex-1">
            {[
              { icon: faCloud, label: "Cloud Sync" },
              { icon: faSettings, label: "Settings" },
              { icon: faQuestionCircle, label: "Support" },
            ].map((item, i) => (
              <button
                key={i}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-gray-800 transition text-gray-300 hover:text-white text-sm"
              >
                <FontAwesomeIcon icon={item.icon} className="w-5" />
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
        </div>

        {/* MAIN CONTENT - Category Grid */}
        <div className="flex-1 bg-teal-800 p-6 overflow-y-auto">
          {selectedCategory ? (
            <div>
              <button
                onClick={() => setSelectedCategory(null)}
                className="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 mb-4"
              >
                ← Back to Categories
              </button>

              {/* Products Grid */}
              <div className="grid grid-cols-3 gap-4">
                {displayedProducts.map((product) => (
                  <button
                    key={product._id}
                    onClick={() => addToCart(product)}
                    className="bg-teal-600 hover:bg-teal-700 text-white p-4 rounded-lg text-center transition transform hover:scale-105 flex flex-col items-center justify-center h-28"
                  >
                    <p className="font-semibold text-sm mb-1 line-clamp-2">
                      {product.name}
                    </p>
                    <p className="text-xs text-teal-100">
                      ₦{(product.salePriceIncTax || 0).toFixed(2)}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            // Category Grid
            <div className="grid grid-cols-3 gap-4">
              {categories.map((cat, i) => (
                <button
                  key={i}
                  onClick={() => setSelectedCategory(cat.name)}
                  className={`${cat.color} hover:opacity-90 text-white font-bold p-6 rounded-lg text-center transition h-32 uppercase text-sm tracking-wide`}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* RIGHT CART PANEL */}
        <div className="w-96 bg-gray-300 flex flex-col border-l border-gray-400 shadow-lg overflow-hidden">
          {/* CART HEADER */}
          <div className="bg-gray-400 p-4 border-b border-gray-500 flex items-center justify-between flex-shrink-0">
            <h2 className="font-bold text-gray-800">Bill</h2>
            <div className="text-xs text-gray-700">
              <p>Staff: {staff?.name}</p>
              <p>Till: {staff?.locationName}</p>
            </div>
          </div>

          {/* CART ITEMS */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {cart.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-500">
                <div className="text-6xl mb-4">⬇️</div>
                <p className="text-center font-semibold">Add a Dish or Drink</p>
                <p className="text-center text-sm">Tap a product to add to the bill</p>
              </div>
            ) : (
              cart.map((item) => (
                <div
                  key={item._id}
                  className="bg-white p-3 rounded-lg flex justify-between items-center"
                >
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-gray-800">
                      {item.name}
                    </p>
                    <p className="text-xs text-gray-600">
                      ₦{(item.salePriceIncTax || 0).toFixed(2)} x{item.quantity}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() =>
                        updateQuantity(item._id, (item.quantity || 1) - 1)
                      }
                      className="p-1 hover:bg-gray-200 rounded"
                    >
                      <FontAwesomeIcon
                        icon={faMinus}
                        className="w-3 text-gray-600"
                      />
                    </button>
                    <span className="text-xs font-semibold w-4 text-center">
                      {item.quantity}
                    </span>
                    <button
                      onClick={() =>
                        updateQuantity(item._id, (item.quantity || 1) + 1)
                      }
                      className="p-1 hover:bg-gray-200 rounded"
                    >
                      <FontAwesomeIcon
                        icon={faPlus}
                        className="w-3 text-gray-600"
                      />
                    </button>
                    <button
                      onClick={() => updateQuantity(item._id, 0)}
                      className="p-1 hover:bg-red-200 rounded"
                    >
                      <FontAwesomeIcon
                        icon={faTrash}
                        className="w-3 text-red-600"
                      />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* TOTALS */}
          <div className="bg-white p-4 border-t border-gray-400 space-y-2 flex-shrink-0">
            <div className="flex justify-between text-sm">
              <span className="text-gray-700">ITEMS</span>
              <span className="font-semibold">{cart.length}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-700">TOTAL DISCOUNT</span>
              <span className="font-semibold text-red-600">
                ₦{discount.toFixed(2)}
              </span>
            </div>
            <div className="border-t pt-2 flex justify-between font-bold text-lg">
              <span>TOTAL</span>
              <span>₦{total.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm text-gray-600">
              <span>TAX</span>
              <span>₦{tax}</span>
            </div>
            <div className="border-t pt-2 flex justify-between font-bold text-lg text-red-600">
              <span>DUE</span>
              <span>₦{due}</span>
            </div>
          </div>

          {/* DISCOUNT INPUT */}
          <div className="bg-gray-400 p-3 border-t border-gray-500 flex-shrink-0">
            <div className="flex gap-2">
              <input
                type="number"
                placeholder="Discount %"
                value={discountPercent}
                onChange={(e) =>
                  setDiscountPercent(Math.max(0, parseFloat(e.target.value) || 0))
                }
                className="flex-1 px-2 py-1 text-sm rounded border border-gray-500"
              />
              <input
                type="number"
                placeholder="₦ Amount"
                value={discountAmount}
                onChange={(e) =>
                  setDiscountAmount(Math.max(0, parseFloat(e.target.value) || 0))
                }
                className="flex-1 px-2 py-1 text-sm rounded border border-gray-500"
              />
            </div>
          </div>

          {/* ACTION BUTTONS ROW 1 */}
          <div className="grid grid-cols-4 gap-2 p-3 bg-gray-400 border-t border-gray-500 flex-shrink-0">
            {[
              { icon: faPlusCircle, label: "MISC\nPRODUCT" },
              { icon: faPrint, label: "PRINT" },
              { icon: faBan, label: "NO SALE" },
              { icon: faPlusCircle, label: "QUICK ADD\nPRODUCT" },
            ].map((btn, i) => (
              <button
                key={i}
                className="flex flex-col items-center gap-1 px-1 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded text-xs"
              >
                <FontAwesomeIcon icon={btn.icon} className="w-4" />
                <span className="whitespace-pre-wrap text-[9px] text-center leading-tight">
                  {btn.label}
                </span>
              </button>
            ))}
          </div>

          {/* ACTION BUTTONS ROW 2 */}
          <div className="grid grid-cols-4 gap-2 p-3 bg-gray-400 border-t border-gray-500 flex-shrink-0">
            {[
              { icon: faCoins, label: "PETTY\nCASH" },
              { icon: faExchangeAlt, label: "ADJUST\nFLOAT" },
              { icon: null, label: "" },
              { icon: null, label: "" },
            ].map((btn, i) =>
              btn.label ? (
                <button
                  key={i}
                  className="flex flex-col items-center gap-1 px-1 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded text-xs"
                >
                  {btn.icon && (
                    <FontAwesomeIcon icon={btn.icon} className="w-4" />
                  )}
                  <span className="whitespace-pre-wrap text-[9px] text-center leading-tight">
                    {btn.label}
                  </span>
                </button>
              ) : (
                <div key={i} />
              )
            )}
          </div>

          {/* MAIN ACTION BUTTONS */}
          <div className="grid grid-cols-3 gap-2 p-3 bg-gray-400 border-t border-gray-500 flex-shrink-0">
            <button className="bg-red-600 hover:bg-red-700 text-white font-bold py-3 rounded transition">
              DELETE
            </button>
            <button className="bg-teal-600 hover:bg-teal-700 text-white font-bold py-3 rounded transition">
              HOLD
            </button>
            <button className="bg-green-600 hover:bg-green-700 text-white font-bold py-3 rounded transition">
              PAY
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * EpoNow-Inspired POS System with Hamburger Toggle
 * Layout: Header | Left Sidebar + Main Content (toggleable) | Right Cart Panel
 */
function POSSystemComponent() {
  const { staff, logout } = useStaff();

  // State
  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [discountPercent, setDiscountPercent] = useState(0);
  const [discountAmount, setDiscountAmount] = useState(0);
  const [showMenu, setShowMenu] = useState(false);
  const [dateTime, setDateTime] = useState("");

  // Update time
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

  // Fetch categories and products
  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch("/api/products");
        if (res.ok) {
          const data = await res.json();
          const prods = Array.isArray(data) ? data : data.products || [];
          setProducts(prods);

          // Extract unique categories
          const cats = [...new Set(prods.map((p) => p.category))].filter(
            Boolean
          );
          setCategories(cats.map((cat) => ({ name: cat, color: getRandomColor() })));
        }
      } catch (err) {
        console.error("Error fetching products:", err);
      }
    };

    fetchData();
  }, []);

  // Get random color for categories
  const getRandomColor = () => {
    const colors = [
      "bg-teal-600",
      "bg-teal-500",
      "bg-cyan-600",
      "bg-blue-600",
      "bg-amber-700",
      "bg-green-700",
      "bg-slate-700",
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  };

  // Get products for selected category
  const displayedProducts = selectedCategory
    ? products.filter((p) => p.category === selectedCategory)
    : products.slice(0, 12);

  // Add to cart
  const addToCart = (product) => {
    const existing = cart.find((item) => item._id === product._id);
    if (existing) {
      setCart(
        cart.map((item) =>
          item._id === product._id
            ? { ...item, quantity: (item.quantity || 1) + 1 }
            : item
        )
      );
    } else {
      setCart([...cart, { ...product, quantity: 1 }]);
    }
  };

  // Update quantity
  const updateQuantity = (productId, quantity) => {
    if (quantity <= 0) {
      setCart(cart.filter((item) => item._id !== productId));
    } else {
      setCart(
        cart.map((item) =>
          item._id === productId ? { ...item, quantity } : item
        )
      );
    }
  };

  // Calculate totals
  const subtotal = cart.reduce(
    (sum, item) => sum + (item.salePriceIncTax || 0) * (item.quantity || 1),
    0
  );
  const discount = (subtotal * discountPercent) / 100 + discountAmount;
  const total = subtotal - discount;
  const tax = (total * 0.075).toFixed(2);
  const due = (parseFloat(total) + parseFloat(tax)).toFixed(2);

  const handleLogout = () => {
    logout();
    Router.push("/");
  };

  return (
    <div className="flex h-full w-full bg-gray-100 flex-col">
      {/* HEADER */}
      <header className="h-20 flex-none bg-gradient-to-r from-teal-700 via-teal-600 to-teal-700 text-white shadow-lg flex items-center justify-between px-6">
        {/* LEFT - Hamburger & Location/Time */}
        <div className="flex items-center gap-4">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="p-2 hover:bg-teal-500/50 rounded-lg transition text-white"
            title="Toggle menu"
          >
            <FontAwesomeIcon icon={faBars} className="text-xl" />
          </button>
          <div className="flex flex-col text-sm">
            <p className="font-bold text-lg uppercase tracking-wider">
              {staff?.locationName || "STORE"}
            </p>
            <p className="text-xs text-teal-100">{dateTime}</p>
          </div>
        </div>

        {/* CENTER - Search */}
        <div className="flex-1 mx-8 flex items-center">
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
        <div className="flex items-center gap-1">
          {["MENU", "CUSTOMERS", "ORDERS"].map((tab) => (
            <button
              key={tab}
              className="px-6 py-2 font-semibold text-sm transition-all whitespace-nowrap hover:bg-teal-500/40"
            >
              {tab}
            </button>
          ))}
          <button
            onClick={handleLogout}
            className="ml-4 p-2 hover:bg-teal-500/50 rounded-lg transition-all text-teal-100 hover:text-white"
            title="Sign out"
          >
            <FontAwesomeIcon icon={faSignOutAlt} className="text-xl" />
          </button>
        </div>
      </header>

      {/* MAIN LAYOUT */}
      <div className="flex flex-1 overflow-hidden">
        {/* LEFT SIDEBAR - Always Visible */}
        <div className="w-48 bg-gray-900 text-white flex flex-col border-r border-gray-700">
          <div className="p-4 border-b border-gray-700">
            <h3 className="font-bold text-sm uppercase tracking-wider">Menu</h3>
          </div>
          <nav className="flex-1 space-y-2 p-3">
            {[
              { icon: faCog, label: "Admin" },
              { icon: faPrint, label: "Print" },
              { icon: faBoxes, label: "Stock" },
              { icon: faGripHorizontal, label: "Apps" },
            ].map((item, i) => (
              <button
                key={i}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-gray-800 transition text-gray-300 hover:text-white text-sm"
              >
                <FontAwesomeIcon icon={item.icon} className="w-5" />
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
        </div>

        {/* MAIN CONTENT - Hidden by default, shown when hamburger is clicked */}
        {showMenu && (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* CATEGORY/PRODUCT GRID */}
            <div className="flex-1 overflow-y-auto p-6 bg-gray-50">
              {selectedCategory ? (
                <div className="mb-4">
                  <button
                    onClick={() => setSelectedCategory(null)}
                    className="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 mb-4"
                  >
                    ← Back to Categories
                  </button>
                </div>
              ) : null}

              <div className="grid grid-cols-3 gap-4">
                {selectedCategory
                  ? // Product Grid
                    displayedProducts.map((product) => (
                      <button
                        key={product._id}
                        onClick={() => addToCart(product)}
                        className="bg-teal-600 hover:bg-teal-700 text-white p-4 rounded-lg text-center transition transform hover:scale-105 flex flex-col items-center justify-center h-28"
                      >
                        <p className="font-semibold text-sm mb-1 line-clamp-2">
                          {product.name}
                        </p>
                        <p className="text-xs text-teal-100">
                          ₦{(product.salePriceIncTax || 0).toFixed(2)}
                        </p>
                      </button>
                    ))
                  : // Category Grid
                    categories.map((cat, i) => (
                      <button
                        key={i}
                        onClick={() => setSelectedCategory(cat.name)}
                        className={`${cat.color} hover:opacity-90 text-white font-bold p-6 rounded-lg text-center transition h-32 uppercase text-sm tracking-wide`}
                      >
                        {cat.name}
                      </button>
                    ))}
              </div>
            </div>
          </div>
        )}

        {/* RIGHT CART PANEL - Always Visible */}
        <div className="w-96 bg-gray-300 flex flex-col border-l border-gray-400 shadow-lg overflow-hidden">
          {/* CART HEADER */}
          <div className="bg-gray-400 p-4 border-b border-gray-500 flex items-center justify-between flex-shrink-0">
            <h2 className="font-bold text-gray-800">Bill</h2>
            <div className="text-xs text-gray-700">
              <p>Staff: {staff?.name}</p>
              <p>Till: {staff?.locationName}</p>
            </div>
          </div>

          {/* CART ITEMS */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {cart.length === 0 ? (
              <div className="flex items-center justify-center h-full text-gray-500">
                <p className="text-center">
                  Add a Dish or Drink
                  <br />
                  Tap a product to add to the bill
                </p>
              </div>
            ) : (
              cart.map((item) => (
                <div
                  key={item._id}
                  className="bg-white p-3 rounded-lg flex justify-between items-center"
                >
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-gray-800">
                      {item.name}
                    </p>
                    <p className="text-xs text-gray-600">
                      ₦{(item.salePriceIncTax || 0).toFixed(2)} x{item.quantity}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() =>
                        updateQuantity(item._id, (item.quantity || 1) - 1)
                      }
                      className="p-1 hover:bg-gray-200 rounded"
                    >
                      <FontAwesomeIcon
                        icon={faMinus}
                        className="w-3 text-gray-600"
                      />
                    </button>
                    <span className="text-xs font-semibold w-4 text-center">
                      {item.quantity}
                    </span>
                    <button
                      onClick={() =>
                        updateQuantity(item._id, (item.quantity || 1) + 1)
                      }
                      className="p-1 hover:bg-gray-200 rounded"
                    >
                      <FontAwesomeIcon
                        icon={faPlus}
                        className="w-3 text-gray-600"
                      />
                    </button>
                    <button
                      onClick={() => updateQuantity(item._id, 0)}
                      className="p-1 hover:bg-red-200 rounded"
                    >
                      <FontAwesomeIcon
                        icon={faTrash}
                        className="w-3 text-red-600"
                      />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* TOTALS */}
          <div className="bg-white p-4 border-t border-gray-400 space-y-2 flex-shrink-0">
            <div className="flex justify-between text-sm">
              <span className="text-gray-700">Items:</span>
              <span className="font-semibold">{cart.length}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-700">Total Discount:</span>
              <span className="font-semibold text-red-600">
                ₦{discount.toFixed(2)}
              </span>
            </div>
            <div className="border-t pt-2 mt-2 flex justify-between font-bold text-lg">
              <span>Total:</span>
              <span>₦{total.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm text-gray-600">
              <span>Tax:</span>
              <span>₦{tax}</span>
            </div>
            <div className="border-t pt-2 flex justify-between font-bold text-lg text-teal-600">
              <span>Due:</span>
              <span>₦{due}</span>
            </div>
          </div>

          {/* DISCOUNT INPUT */}
          <div className="bg-gray-400 p-3 border-t border-gray-500 flex-shrink-0">
            <div className="flex gap-2 mb-2">
              <input
                type="number"
                placeholder="Discount %"
                value={discountPercent}
                onChange={(e) =>
                  setDiscountPercent(Math.max(0, parseFloat(e.target.value) || 0))
                }
                className="flex-1 px-2 py-1 text-sm rounded border border-gray-500"
              />
              <input
                type="number"
                placeholder="₦ Amount"
                value={discountAmount}
                onChange={(e) =>
                  setDiscountAmount(Math.max(0, parseFloat(e.target.value) || 0))
                }
                className="flex-1 px-2 py-1 text-sm rounded border border-gray-500"
              />
            </div>
          </div>

          {/* ACTION BUTTONS */}
          <div className="grid grid-cols-3 gap-2 p-3 bg-gray-400 border-t border-gray-500 flex-shrink-0">
            {[
              { icon: faPlusCircle, label: "MISC\nPRODUCT" },
              { icon: faPrint, label: "PRINT" },
              { icon: faBan, label: "NO SALE" },
            ].map((btn, i) => (
              <button
                key={i}
                className="flex flex-col items-center gap-1 px-2 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded text-xs"
              >
                <FontAwesomeIcon icon={btn.icon} className="w-4" />
                <span className="whitespace-pre-wrap text-[10px] text-center">
                  {btn.label}
                </span>
              </button>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-2 p-3 bg-gray-400 border-t border-gray-500 flex-shrink-0">
            {[
              { icon: faCoins, label: "PETTY\nCASH" },
              { icon: faExchangeAlt, label: "ADJUST\nFLOAT" },
              { icon: null, label: "" },
            ].map((btn, i) =>
              btn.label ? (
                <button
                  key={i}
                  className="flex flex-col items-center gap-1 px-2 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded text-xs"
                >
                  {btn.icon && (
                    <FontAwesomeIcon icon={btn.icon} className="w-4" />
                  )}
                  <span className="whitespace-pre-wrap text-[10px] text-center">
                    {btn.label}
                  </span>
                </button>
              ) : (
                <div key={i} />
              )
            )}
          </div>

          {/* MAIN ACTION BUTTONS */}
          <div className="grid grid-cols-3 gap-2 p-3 bg-gray-400 border-t border-gray-500 flex-shrink-0">
            <button className="bg-red-600 hover:bg-red-700 text-white font-bold py-3 rounded transition">
              DELETE
            </button>
            <button className="bg-teal-600 hover:bg-teal-700 text-white font-bold py-3 rounded transition">
              HOLD
            </button>
            <button className="bg-green-600 hover:bg-green-700 text-white font-bold py-3 rounded transition">
              PAY
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
