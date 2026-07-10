import { mongooseConnect } from "@/src/lib/mongoose";
import Store from "@/src/models/Store";
import Tender from "@/src/models/Tender";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    await mongooseConnect();
    const { locationId } = req.query;

    console.log('\n📍 ='.repeat(40));
    console.log('📍 API: /api/location/tenders called');
    console.log('📍 Location ID:', locationId);

    if (!locationId) {
      console.warn('❌ API: Location ID is required');
      return res.status(400).json({ message: "Location ID is required" });
    }

    // Find store with this location
    console.log('🔍 Looking for store with location...');
    const store = await Store.findOne({
      "locations._id": locationId
    });

    console.log('📦 Store found:', !!store);
    if (!store) {
      console.warn('❌ API: No store found with this location');
      return res.status(404).json({ message: "Location not found" });
    }

    // Find the specific location
    const location = store.locations.find(loc => loc._id.toString() === locationId);
    if (!location) {
      console.warn('❌ API: Location not found in store locations array');
      return res.status(404).json({ message: "Location not found" });
    }

    console.log('✅ Location found:', location.name);
    console.log('📍 Location Object ID:', location._id.toString());
    
    // Get tender IDs from location
    const tenderIds = location.tenders || [];
    console.log(`📋 Tender IDs in location: ${tenderIds.length} items`);
    tenderIds.forEach((id, idx) => {
      console.log(`   [${idx}] ${id}`);
    });

    // If no tenders, return empty array
    if (tenderIds.length === 0) {
      console.log('⚠️ No tenders assigned to this location');
      return res.status(200).json({
        success: true,
        tenders: [],
      });
    }

    // Fetch full tender documents from database
    console.log('🔍 Fetching full tender documents from Tender collection...');
    const tenders = await Tender.find({ 
      _id: { $in: tenderIds } 
    });

    console.log(`✅ Found ${tenders.length} tender documents`);
    tenders.forEach((tender, idx) => {
      console.log(`   [${idx}] ${tender.name} (${tender.classification}) - Color: ${tender.buttonColor}`);
    });

    // Normalize and dedupe by tender name (case-insensitive)
    const normalizedTenders = tenders
      .filter(tender => tender && tender._id)
      .map(tender => ({
        id: tender._id.toString(),
        name: tender.name || 'Unnamed Tender',
        description: tender.description || '',
        buttonColor: tender.buttonColor || '#9dccebff',
        classification: tender.classification || 'Other',
        tillOrder: tender.tillOrder || 0,
        active: tender.active !== false,
      }));

    const seenNames = new Set();
    const dedupedTenders = normalizedTenders
      .sort((a, b) => (a.tillOrder || 0) - (b.tillOrder || 0))
      .filter((tender) => {
        const key = String(tender.name || '').trim().toLowerCase();
        if (!key) return false;
        if (seenNames.has(key)) return false;
        seenNames.add(key);
        return true;
      });

    console.log(`✅ Returning ${dedupedTenders.length} normalized tenders`);
    console.log('📍 ='.repeat(40) + '\n');

    return res.status(200).json({
      success: true,
      tenders: dedupedTenders,
    });
  } catch (error) {
    console.error("❌ Error fetching location tenders:", error.message);
    console.error("Stack:", error.stack);
    console.log('📍 ='.repeat(40) + '\n');
    return res.status(500).json({ 
      message: "Internal server error", 
      error: error.message 
    });
  }
}
