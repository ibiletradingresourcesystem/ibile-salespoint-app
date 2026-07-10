// pages/api/till/close.js
import { mongooseConnect } from "@/src/lib/mongoose";
import Till from "@/src/models/Till";
import { Transaction } from "@/src/models/Transactions";
import EndOfDayReport from "@/src/models/EndOfDayReport";
import Tender from "@/src/models/Tender";
import Store from "@/src/models/Store";
import mongoose from "mongoose";
import { sanitizeBody } from '@/src/lib/apiValidation';

/**
 * Bulletproof Mongoose Map → plain object extraction.
 * Tries toJSON(), forEach(), then Object.entries() as fallbacks.
 */
function extractMapToObject(mapField, toObjectFallback) {
  const result = {};
  if (!mapField) return result;

  // Strategy 1: toJSON (most reliable for Mongoose Maps)
  if (typeof mapField.toJSON === 'function') {
    try {
      const json = mapField.toJSON();
      if (json && typeof json === 'object' && !Array.isArray(json)) {
        Object.assign(result, json);
        if (Object.keys(result).length > 0) return result;
      }
    } catch (e) { /* continue */ }
  }

  // Strategy 2: forEach (works on native Map and Mongoose Map)
  if (typeof mapField.forEach === 'function') {
    try {
      mapField.forEach((value, key) => { result[key] = value; });
      if (Object.keys(result).length > 0) return result;
    } catch (e) { /* continue */ }
  }

  // Strategy 3: use the toObject() version (already converted by Mongoose)
  if (toObjectFallback && typeof toObjectFallback === 'object') {
    Object.entries(toObjectFallback).forEach(([key, value]) => {
      if (!key.startsWith('$') && !key.startsWith('_')) {
        result[key] = value;
      }
    });
    if (Object.keys(result).length > 0) return result;
  }

  // Strategy 4: direct Object.entries on the field itself
  if (typeof mapField === 'object' && !Array.isArray(mapField)) {
    try {
      Object.entries(mapField).forEach(([key, value]) => {
        if (!key.startsWith('$') && !key.startsWith('_')) {
          result[key] = value;
        }
      });
    } catch (e) { /* continue */ }
  }

  return result;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  req.body = sanitizeBody(req.body);

  try {
    await mongooseConnect();

    const { tillId, tenderCounts, closingNotes } = req.body;
    const safeTenderCounts = tenderCounts && typeof tenderCounts === "object" ? tenderCounts : {};

    console.log("================================================================================");
    console.log("📋 TILL CLOSE REQUEST");
    console.log("================================================================================");
    console.log("Till ID:", tillId);
    console.log("Till ID type:", typeof tillId);
    console.log("Tender counts keys:", Object.keys(safeTenderCounts));

    if (!tillId) {
      console.error("❌ No till ID provided");
      return res.status(400).json({ message: "Till ID is required" });
    }

    // Till lookup - use findById which handles ObjectId automatically
    console.log("🔍 Looking up till:", tillId);
    const till = await Till.findById(tillId).exec();
    
    if (!till) {
      console.error("❌ Till not found by ID:", tillId);
      return res.status(404).json({ 
        message: "Till not found",
        searchedId: tillId
      });
    }

    console.log("✅ Till found:", till._id.toString(), "- Staff:", till.staffName);

    if (till.status !== "OPEN") {
      console.warn("⚠️ Till already closed, status:", till.status);

      // Avoid duplicate EndOfDay reports if already closed
      const existingReport = await EndOfDayReport.findOne({ tillId: till._id });

      const tillResponse = till.toObject();
      tillResponse.tenderBreakdown = extractMapToObject(till.tenderBreakdown, tillResponse.tenderBreakdown);
      tillResponse.tenderVariances = extractMapToObject(till.tenderVariances, tillResponse.tenderVariances);

      return res.status(200).json({
        message: "Till already closed",
        till: tillResponse,
        reportId: existingReport?._id || null,
      });
    }

    // Get all transactions for this till since it was opened
    const transactions = await Transaction.find({
      _id: { $in: till.transactions },
    }).exec();

    console.log(`📊 Till ${tillId} has ${transactions.length} transactions linked`);
    console.log(`📊 Till opening balance: ${till.openingBalance}`);

    // **BEST METHOD: Use MongoDB aggregation to calculate tender breakdown**
    // This ensures accuracy and consistency with the GET endpoint
    // Handles both legacy tenderType (single tender) and new tenderPayments (split payments)
    const tenderAggregation = await Transaction.aggregate([
      {
        $match: {
          _id: { $in: (till.transactions || []).map(id => {
            if (id && id._id) return id._id; // populated doc
            if (typeof id === 'string') return new mongoose.Types.ObjectId(id);
            return id; // already ObjectId
          }) },
          // IMPORTANT: Only include actual sales transactions (amount > 0)
          // This prevents open-till operations or void transactions from being counted
          total: { $gt: 0 }
        }
      },
      // Normalize both payment methods to a common format
      {
        $addFields: {
          normalizedPayments: {
            $cond: [
              { $gt: [{ $size: { $ifNull: ["$tenderPayments", []] } }, 0] },
              "$tenderPayments", // If tenderPayments exists, use it
              [{ tenderName: { $ifNull: ["$tenderType", "CASH"] }, amount: "$total" }] // Otherwise convert tenderType
            ]
          }
        }
      },
      // Unwind the payments array so each payment becomes a separate document
      {
        $unwind: "$normalizedPayments"
      },
      // Group by tender name and sum amounts
      // IMPORTANT: Count unique transactions, not payment entries (split payments should count as 1 transaction)
      {
        $group: {
          _id: "$normalizedPayments.tenderName",
          totalAmount: { $sum: "$normalizedPayments.amount" },
          // Collect unique transaction IDs to count actual transactions, not split payments
          uniqueTransactions: { $addToSet: "$_id" }
        }
      },
      // Add transaction count from unique transactions
      {
        $addFields: {
          transactionCount: { $size: "$uniqueTransactions" }
        }
      },
      {
        $sort: { _id: 1 }
      }
    ]);

    console.log(`\n💰 TENDER BREAKDOWN BY AGGREGATION (supports split payments):`);
    
    // Calculate totals by tender type
    let totalSales = 0;
    const tenderBreakdown = {}; // Use object for collecting by tender name
    const tenderVariances = {}; // Variance per tender

    tenderAggregation.forEach((group) => {
      const tenderType = group._id || "CASH";
      const amount = group.totalAmount || 0;
      const count = group.transactionCount || 0;
      
      tenderBreakdown[tenderType] = amount;
      totalSales += amount;
      
      console.log(`   💳 ${tenderType}: ₦${amount.toLocaleString('en-NG')} (${count} payment${count !== 1 ? 's' : ''})`);
    });

    console.log(`\n✅ Total Sales Calculated: ₦${totalSales.toLocaleString('en-NG')}`);

    // If aggregation returned nothing, fall back to stored tenderBreakdown
    if (Object.keys(tenderBreakdown).length === 0 && till.tenderBreakdown) {
      console.log('🔄 Aggregation empty, using stored tenderBreakdown as fallback');
      const storedBreakdown = extractMapToObject(till.tenderBreakdown);
      Object.entries(storedBreakdown).forEach(([key, value]) => {
        if (typeof value === 'number') {
          tenderBreakdown[key] = value;
          totalSales += value;
        }
      });
    }
    // If still nothing but we have stored totalSales, use that
    if (totalSales === 0 && till.totalSales > 0) {
      totalSales = till.totalSales;
    }

    // Get tender mapping (ID to name)
    const tenderDocs = await Tender.find();
    const tenderMap = {}; // Map tender ID to name
    const tenderNameMap = {}; // Map tender name to ID (for reverse lookup)
    tenderDocs.forEach(t => {
      tenderMap[t._id.toString()] = t.name;
      tenderNameMap[t.name] = t._id.toString();
    });

    console.log("📋 Tender mapping:", tenderMap);
    console.log("📋 Tender counts keys:", Object.keys(safeTenderCounts));

    let totalCountedAmount = 0;
    let totalVariance = 0;

    // Process tender counts (keyed by tender ID)
    for (const [tenderId, countedAmount] of Object.entries(safeTenderCounts)) {
      const tenderName = tenderMap[tenderId];
      
      if (!tenderName) {
        console.warn(`⚠️ Unknown tender ID: ${tenderId}`);
        continue;
      }
      
      const processedAmount = tenderBreakdown[tenderName] || 0;
      const variance = parseFloat(countedAmount) - processedAmount;
      
      tenderVariances[tenderName] = {
        processed: processedAmount,
        counted: parseFloat(countedAmount),
        variance: variance
      };
      
      totalCountedAmount += parseFloat(countedAmount);
      totalVariance += variance;

      console.log(`  📊 ${tenderName} - Processed: ${processedAmount}, Counted: ${parseFloat(countedAmount)}, Variance: ${variance}`);
    }

    // Calculate expected closing balance
    const expectedClosingBalance = till.openingBalance + totalSales;

    // Calculate overall variance
    const variancePercentage = expectedClosingBalance > 0 
      ? (totalVariance / expectedClosingBalance) * 100 
      : 0;

    // Update till with closing details (idempotent)
    console.log(`🔄 Updating till ${till._id} with closing details...`);
    const updatePayload = {
      status: "CLOSED",
      closedAt: new Date(),
      physicalCount: totalCountedAmount,
      expectedClosingBalance: expectedClosingBalance,
      variance: totalVariance,
      totalSales: totalSales,
      transactionCount: transactions.length,
      tenderBreakdown: tenderBreakdown,
      tenderVariances: tenderVariances,
      closingNotes: closingNotes || "",
    };

    const updateResult = await Till.updateOne(
      { _id: till._id, status: "OPEN" },
      { $set: updatePayload }
    );

    if (updateResult.matchedCount === 0) {
      console.warn("⚠️ Till was already closed by another request.");
      const existingReport = await EndOfDayReport.findOne({ tillId: till._id });
      const latestTill = await Till.findById(till._id).lean();
      return res.status(200).json({
        message: "Till already closed",
        till: latestTill || till,
        reportId: existingReport?._id || null,
      });
    }

    const updatedTill = await Till.findById(till._id);
    console.log(`✅ Till saved successfully!`);

    // Create EndOfDayReport for inventory manager access
    try {
      // Fetch actual location name from Store
      let locationName = "Unknown";
      if (till.storeId && till.locationId) {
        const store = await Store.findById(till.storeId);
        if (store && store.locations) {
          const location = store.locations.find(
            (loc) => loc._id.toString() === till.locationId.toString()
          );
          if (location) {
            locationName = location.name;
          }
        }
      }
      console.log(`📍 Location Name: ${locationName}`);

      const existingReport = await EndOfDayReport.findOne({ tillId: till._id });
      if (existingReport) {
        console.log(`📊 EndOfDayReport already exists - ID: ${existingReport._id}`);
      } else {
        // Build tenderActual map (physical counted amounts per tender)
        const tenderActualMap = {};
        for (const [tenderId, countedAmount] of Object.entries(safeTenderCounts)) {
          const tenderName = tenderMap[tenderId];
          if (tenderName) {
            tenderActualMap[tenderName] = parseFloat(countedAmount) || 0;
          }
        }

        const report = new EndOfDayReport({
        storeId: updatedTill.storeId,
        locationId: updatedTill.locationId,
        locationName: locationName,
        tillId: updatedTill._id,
        staffId: updatedTill.staffId,
        staffName: updatedTill.staffName,
        closedBy: updatedTill.staffId,
        openedAt: updatedTill.openedAt,
        openingBalance: updatedTill.openingBalance,
        closedAt: new Date(),
        physicalCount: totalCountedAmount,
        expectedClosingBalance: expectedClosingBalance,
        variance: totalVariance,
        variancePercentage: variancePercentage,
        totalSales: totalSales,
        transactionCount: transactions.length,
        tenderBreakdown: new Map(Object.entries(tenderBreakdown)),
        tenderActual: new Map(Object.entries(tenderActualMap)),
        tenderVariances: new Map(Object.entries(tenderVariances)),
        closingNotes: closingNotes || "",
        status: Math.abs(totalVariance) < 0.01 ? "RECONCILED" : "VARIANCE_NOTED",
        date: new Date().setHours(0, 0, 0, 0),
        });

        try {
          await report.save();
          console.log(`📊 EndOfDayReport created - ID: ${report._id}`);
        } catch (err) {
          if (err?.code === 11000) {
            console.warn("⚠️ EndOfDayReport duplicate prevented by unique index.");
          } else {
            throw err;
          }
        }
      }
    } catch (reportErr) {
      console.warn("⚠️ Warning: Failed to create EndOfDayReport:", reportErr.message);
      // Continue anyway - till is closed, just missing the report
    }

    console.log(`✅ Till closed - Total Variance: ${totalVariance}`);

    // Convert Maps to objects for JSON serialization
    const sourceTill = updatedTill || till;
    const tillResponse = sourceTill.toObject();
    
    const tenderBreakdownObj = extractMapToObject(sourceTill.tenderBreakdown, tillResponse.tenderBreakdown);
    const tenderVariancesObj = extractMapToObject(sourceTill.tenderVariances, tillResponse.tenderVariances);
    
    tillResponse.tenderBreakdown = tenderBreakdownObj;
    tillResponse.tenderVariances = tenderVariancesObj;

    return res.status(200).json({
      message: "Till closed successfully",
      till: tillResponse,
      summary: {
        openingBalance: till.openingBalance,
        totalSales: totalSales,
        expectedClosingBalance: expectedClosingBalance,
        totalCountedAmount: totalCountedAmount,
        totalVariance: totalVariance,
        transactionCount: transactions.length,
        tenderBreakdown: tenderBreakdownObj,
        tenderVariances: tenderVariancesObj, // Detailed variance per tender
      },
    });
  } catch (error) {
    console.error("❌ Error closing till:", error.message);
    console.error("❌ Error stack:", error.stack);
    return res.status(500).json({
      message: "Failed to close till",
      error: error.message,
    });
  }
}
