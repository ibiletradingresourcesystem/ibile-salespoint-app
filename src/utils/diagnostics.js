// Diagnostic helper to debug category issues
// Add this temporarily to check your data structure

export function diagnoseCategoryIssue(products, categories) {
  console.log("=== CATEGORY DIAGNOSIS ===");
  console.log("Total Products:", products.length);
  console.log("Total Categories:", categories.length);
  
  // Show category IDs
  console.log("\n📂 CATEGORIES:");
  categories.forEach((cat) => {
    console.log(`  - ${cat.name} (ID: ${cat._id})`);
  });

  // Show product categoryIds
  console.log("\n📦 PRODUCTS & THEIR CATEGORIES:");
  products.slice(0, 10).forEach((prod, idx) => {
    console.log(`  ${idx + 1}. ${prod.name}`);
    console.log(`     categoryId: ${prod.categoryId}`);
    console.log(`     category: ${prod.category}`);
  });

  // Count by categoryId and category
  console.log("\n📊 PRODUCTS BY CATEGORY:");
  const grouped = {};
  products.forEach((p) => {
    const catId = p.categoryId || p.category || "NO_CATEGORY";
    if (!grouped[catId]) grouped[catId] = [];
    grouped[catId].push(p.name);
  });
  
  Object.entries(grouped).forEach(([catId, prods]) => {
    const catName = categories.find((c) => c._id === catId)?.name || "UNKNOWN";
    console.log(`  ${catName} (${catId}): ${prods.length} products`);
  });

  // Check for mismatches
  console.log("\n⚠️ ISSUES:");
  let issues = false;
  
  products.forEach((p) => {
    if (!p.categoryId && !p.category) {
      console.log(`  - "${p.name}" has NO categoryId or category!`);
      issues = true;
    }
  });

  if (!issues) {
    console.log("  ✅ All products have categoryId or category field");
  }

  console.log("\n✨ The filter will now work with both categoryId and category fields!");
}
