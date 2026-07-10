/**
 * Store Initialization API
 * 
 * GET /api/store/init
 * Returns store and location configuration from database
 * 
 * Response:
 * {
 *   name: string,        // Store name
 *   location: string,    // Location name
 *   address: string,     // Location address
 *   phone: string,       // Location phone
 *   currency: string,    // Currency code (e.g., "NGN")
 *   taxRate: number      // Tax rate (e.g., 0.1 for 10%)
 * }
 */

import { mongooseConnect } from "@/src/lib/mongoose";
import Store from "@/src/models/Store";

export default async function handler(req, res) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    await mongooseConnect();

    // Fetch store from database
    const store = await Store.findOne().lean();

    if (!store) {
      // Return default values if no store found
      return res.status(200).json({
        name: 'STORE NAME',
        location: 'STORE LOCATION',
        address: '',
        phone: '',
        currency: 'NGN',
        taxRate: 0.1,
      });
    }

    // Get first location or use default
    const location = store.locations?.[0] || { name: 'Main Store', address: '' };

    const storeData = {
      name: store.storeName || store.companyName || 'STORE NAME',
      logo: store.logo || '',
      location: location.name || 'STORE LOCATION',
      address: location.address || '',
      phone: location.phone || store.storePhone || '',
      currency: store.currency || 'NGN',
      taxRate: store.taxRates?.[0]?.percentage || 0.1,
    };

    res.status(200).json(storeData);
  } catch (error) {
    console.error('Error fetching store data:', error);
    res.status(500).json({ error: 'Failed to fetch store configuration' });
  }
}
