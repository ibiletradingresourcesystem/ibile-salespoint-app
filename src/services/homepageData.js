import { mongooseConnect } from "@/src/lib/mongoose";
import  Product  from "@/src/models/Product";
import { Category } from "@/src/models/Category";

export async function fetchHomepageData() {
  await mongooseConnect();
  const products = await Product.find({}, null, { sort: { updatedAt: -1 } });
  const categories = await Category.find({});
  return {
    products: JSON.parse(JSON.stringify(products)),
    categories: JSON.parse(JSON.stringify(categories)),
  };
}
