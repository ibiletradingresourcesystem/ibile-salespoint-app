import { useState, useEffect } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faSearch,
  faShoppingCart,
  faTimes,
  faPlus,
  faMinus,
  faTrash,
  faCreditCard,
  faBarcode,
} from "@fortawesome/free-solid-svg-icons";

export default function EpoNowPOS() {
  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [showPayment, setShowPayment] = useState(false);

  useEffect(() => {
    // Fetch categories and products
    const fetchData = async () => {
      try {
        const [catRes, prodRes] = await Promise.all([
          fetch("/api/categories"),
          fetch("/api/products"),
        ]);

        if (catRes.ok) {
          const catData = await catRes.json();
          setCategories(catData);
        }

        if (prodRes.ok) {
          const prodData = await prodRes.json();
          setProducts(prodData);
        }
      } catch (error) {
        console.error("Failed to fetch data:", error);
      }
    };

    fetchData();
  }, []);

  const filteredProducts = products.filter((p) => {
    const matchesCategory =
      !selectedCategory ||
      p.categoryId === selectedCategory ||
      p.category === selectedCategory;
    const matchesSearch =
      !searchQuery ||
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.sku?.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const addToCart = (product) => {
    const existingItem = cart.find((item) => item._id === product._id);
    if (existingItem) {
      updateQuantity(product._id, existingItem.qty + 1);
    } else {
      setCart([
        ...cart,
        {
          ...product,
          qty: 1,
          total: product.salePriceIncTax,
        },
      ]);
    }
  };

  const updateQuantity = (productId, qty) => {
    if (qty <= 0) {
      removeFromCart(productId);
      return;
    }
    setCart(
      cart.map((item) =>
        item._id === productId
          ? {
              ...item,
              qty,
              total: item.salePriceIncTax * qty,
            }
          : item
      )
    );
  };

  const removeFromCart = (productId) => {
    setCart(cart.filter((item) => item._id !== productId));
  };

  const total = cart.reduce((sum, item) => sum + item.total, 0);

  const formatCurrency = (value) =>
    new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: "NGN",
    }).format(value);

  return (
    <div className="flex h-full gap-6 bg-gray-100 p-6">
      {/* Left: Products */}
      <div className="flex-1 flex flex-col bg-white rounded-lg shadow-lg overflow-hidden">
        {/* Search & Categories */}
        <div className="p-4 border-b border-gray-200 space-y-4">
          {/* Search */}
          <div className="relative">
            <FontAwesomeIcon
              icon={faSearch}
              className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400"
            />
            <input
              type="text"
              placeholder="Search by name or barcode..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Categories */}
          <div className="flex gap-2 overflow-x-auto pb-2">
            <button
              onClick={() => setSelectedCategory(null)}
              className={`px-4 py-2 rounded-lg font-medium whitespace-nowrap transition ${
                selectedCategory === null
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              All
            </button>
            {categories.map((cat) => (
              <button
                key={cat._id}
                onClick={() => setSelectedCategory(cat._id)}
                className={`px-4 py-2 rounded-lg font-medium whitespace-nowrap transition ${
                  selectedCategory === cat._id
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                {cat.name}
              </button>
            ))}
          </div>
        </div>

        {/* Products Grid */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-4 gap-4">
            {filteredProducts.map((product) => (
              <button
                key={product._id}
                onClick={() => addToCart(product)}
                className="bg-gradient-to-br from-gray-50 to-white border-2 border-gray-200 rounded-lg p-4 hover:border-blue-500 hover:shadow-lg transition cursor-pointer text-left"
              >
                <div className="aspect-square bg-gray-100 rounded-lg mb-3 flex items-center justify-center">
                  <span className="text-3xl">📦</span>
                </div>
                <h3 className="font-semibold text-gray-800 line-clamp-2 text-sm mb-1">
                  {product.name}
                </h3>
                <p className="text-blue-600 font-bold text-lg">
                  {formatCurrency(product.salePriceIncTax)}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  Stock: {product.quantity || 0}
                </p>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Right: Cart & Payment */}
      <div className="w-80 bg-white rounded-lg shadow-lg flex flex-col overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white p-4 flex items-center gap-2">
          <FontAwesomeIcon icon={faShoppingCart} className="text-xl" />
          <h3 className="text-lg font-bold">Order</h3>
          <span className="ml-auto bg-white text-blue-600 px-2 py-1 rounded-full text-sm font-bold">
            {cart.length}
          </span>
        </div>

        {/* Cart Items */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
              <FontAwesomeIcon icon={faShoppingCart} className="text-4xl mb-2" />
              <p className="font-medium">No items in cart</p>
              <p className="text-xs">Add products to get started</p>
            </div>
          ) : (
            cart.map((item) => (
              <div
                key={item._id}
                className="bg-gray-50 rounded-lg p-3 border border-gray-200"
              >
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <p className="font-semibold text-gray-800 text-sm line-clamp-1">
                      {item.name}
                    </p>
                    <p className="text-blue-600 font-bold">
                      {formatCurrency(item.salePriceIncTax)}
                    </p>
                  </div>
                  <button
                    onClick={() => removeFromCart(item._id)}
                    className="text-red-500 hover:text-red-700 transition"
                  >
                    <FontAwesomeIcon icon={faTimes} />
                  </button>
                </div>

                {/* Quantity Controls */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 bg-white rounded-lg border border-gray-300">
                    <button
                      onClick={() => updateQuantity(item._id, item.qty - 1)}
                      className="p-1 hover:bg-gray-100"
                    >
                      <FontAwesomeIcon icon={faMinus} className="text-xs" />
                    </button>
                    <span className="w-8 text-center font-semibold">
                      {item.qty}
                    </span>
                    <button
                      onClick={() => updateQuantity(item._id, item.qty + 1)}
                      className="p-1 hover:bg-gray-100"
                    >
                      <FontAwesomeIcon icon={faPlus} className="text-xs" />
                    </button>
                  </div>
                  <p className="font-bold text-gray-800">
                    {formatCurrency(item.total)}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Summary */}
        {cart.length > 0 && (
          <div className="border-t border-gray-200 p-4 space-y-3">
            {/* Summary Items */}
            <div className="space-y-2 text-sm">
              <div className="flex justify-between text-gray-600">
                <span>Subtotal:</span>
                <span>{formatCurrency(total)}</span>
              </div>
              <div className="flex justify-between text-gray-600">
                <span>Discount:</span>
                <span>₦0.00</span>
              </div>
              <div className="flex justify-between text-gray-600 border-t pt-2">
                <span>Tax:</span>
                <span>₦0.00</span>
              </div>
            </div>

            {/* Total */}
            <div className="bg-gradient-to-r from-blue-50 to-cyan-50 rounded-lg p-3 border-2 border-blue-200">
              <p className="text-xs text-gray-600 font-semibold mb-1">TOTAL</p>
              <p className="text-3xl font-bold text-blue-600">
                {formatCurrency(total)}
              </p>
            </div>

            {/* Action Buttons */}
            <div className="grid grid-cols-2 gap-2">
              <button className="py-3 bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold rounded-lg transition text-sm">
                HOLD
              </button>
              <button
                onClick={() => setShowPayment(true)}
                className="py-3 bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white font-bold rounded-lg transition text-sm"
              >
                PAY
              </button>
            </div>

            <button className="w-full py-2 border-2 border-red-500 text-red-500 font-bold rounded-lg hover:bg-red-50 transition text-sm">
              CLEAR
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
