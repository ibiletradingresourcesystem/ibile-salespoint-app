/**
 * Diagnostic endpoint to troubleshoot MongoDB connection and data issues
 * GET /api/admin/diagnostics
 */

import { mongooseConnect } from "@/src/lib/mongoose";
import Store from "@/src/models/Store";
import mongoose from "mongoose";

export default async function handler(req, res) {
  // Block in production — this endpoint exposes database internals
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' });
  }

  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    console.log("\n🔍 DIAGNOSTIC START\n");

    // Check environment
    console.log("📋 ENVIRONMENT CHECKS:");
    console.log(`   MONGODB_URI set: ${!!process.env.MONGODB_URI}`);
    if (process.env.MONGODB_URI) {
      const parts = process.env.MONGODB_URI.split("@");
      const mask = parts[0] + "@" + (parts[1] || "").substring(0, 20) + "...";
      console.log(`   Connection string: ${mask}`);
    }

    // Attempt connection
    console.log("\n🔗 CONNECTION ATTEMPT:");
    console.log(`   Pre-connection state: ${mongoose.connection.readyState}`);
    
    await mongooseConnect();
    
    console.log(`   Post-connection state: ${mongoose.connection.readyState}`);
    console.log(`   Connected to: ${mongoose.connection.host}:${mongoose.connection.port}`);
    console.log(`   Database: ${mongoose.connection.db?.databaseName || "UNKNOWN"}`);

    // List all collections
    console.log("\n📦 DATABASE COLLECTIONS:");
    const collections = await mongoose.connection.db.listCollections().toArray();
    console.log(`   Total collections: ${collections.length}`);
    collections.forEach(col => {
      console.log(`   - ${col.name}`);
    });

    // Check stores collection
    console.log("\n🏪 STORES COLLECTION:");
    const storeCount = await Store.countDocuments();
    console.log(`   Document count: ${storeCount}`);

    // Try to find store
    console.log("\n🔍 QUERY TEST:");
    const store = await Store.findOne().exec();
    
    if (store) {
      console.log(`   ✅ Store found!`);
      console.log(`   Store ID: ${store._id}`);
      console.log(`   Store name: ${store.storeName}`);
      console.log(`   Locations count: ${store.locations?.length || 0}`);
      if (store.locations && store.locations.length > 0) {
        console.log(`   Location details:`);
        store.locations.forEach((loc, idx) => {
          console.log(`     [${idx}] ${loc.name} (${loc._id})`);
        });
      }
    } else {
      console.log(`   ❌ No store found`);
      console.log(`   Attempting raw collection query...`);
      const collection = mongoose.connection.collection("stores");
      const docs = await collection.find({}).toArray();
      console.log(`   Raw query returned ${docs.length} documents`);
      if (docs.length > 0) {
        console.log(`   First document: ${JSON.stringify(docs[0], null, 2).substring(0, 200)}...`);
      }
    }

    console.log("\n✅ DIAGNOSTIC COMPLETE\n");

    return res.status(200).json({
      success: true,
      diagnostics: {
        mongodbUriSet: !!process.env.MONGODB_URI,
        connectionState: mongoose.connection.readyState,
        database: mongoose.connection.db?.databaseName,
        host: mongoose.connection.host,
        port: mongoose.connection.port,
        collectionCount: collections.length,
        collections: collections.map(c => c.name),
        storeCount,
        storeFound: !!store,
        storeData: store ? {
          id: store._id.toString(),
          name: store.storeName,
          locationsCount: store.locations?.length,
          locations: store.locations?.map(l => ({
            id: l._id.toString(),
            name: l.name,
            address: l.address,
            isActive: l.isActive,
          })),
        } : null,
      },
      message: store ? "✅ All systems operational" : "❌ Store not found in collection",
    });
  } catch (error) {
    console.error("\n❌ DIAGNOSTIC ERROR:", error);
    console.error("Stack:", error.stack);
    
    return res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack,
      message: "Diagnostic failed - see error details",
    });
  }
}
