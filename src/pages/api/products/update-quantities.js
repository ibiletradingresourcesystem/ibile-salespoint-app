/**
 * API: Update Product Quantity After Transaction
 * 
 * Decrements product quantities based on transaction items
 * Called after transaction is saved to reduce inventory
 */

import { mongooseConnect } from '@/src/lib/mongoose';
import { default as Product } from '@/src/models/Product';
import { updateInventoryForSale } from '@/src/lib/syncPackQty';
import { sanitizeBody } from '@/src/lib/apiValidation';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  req.body = sanitizeBody(req.body);

  try {
    const { items } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Items array required' });
    }

    await mongooseConnect();

    await updateInventoryForSale(items);

    return res.status(200).json({
      success: true,
      message: `Updated ${items.length} products`,
    });
  } catch (error) {
    console.error('❌ Error updating product quantities:', error);
    return res.status(500).json({
      error: 'Failed to update product quantities',
      message: error.message,
    });
  }
}
