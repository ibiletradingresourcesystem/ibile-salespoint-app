export default function Product({ product, addToSidebar, selectedCategory }) {
  const filteredProducts = Array.isArray(product)
    ? product.filter((p) =>
        selectedCategory && selectedCategory !== "" ? p.category === selectedCategory : true
      )
    : [];

  return (
    <div className="product-list grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8 mt-6">
      {filteredProducts.length > 0 ? (
        filteredProducts.map((p) => (
          <div
            key={p._id}
            className="cursor-pointer bg-gray-200 shadow-lg rounded-lg overflow-hidden hover:shadow-xl transition duration-300"
            onClick={() => addToSidebar(p)} // Send product data to the sidebar
          >
            <div className="p-6">
              <h3 className="text-lg font-semibold text-gray-800">{p.name}</h3>
              <p className="mt-2 text-gray-600">{p.description}</p>
              <div className="mt-4 text-xl font-semibold text-gray-900">
                ₦{p.salePriceIncTax.toLocaleString()}
              </div>
            </div>
          </div>
        ))
      ) : (
        <div className="col-span-3 text-center text-gray-500">
          No products match your search.
        </div>
      )}
    </div>
  );
}
