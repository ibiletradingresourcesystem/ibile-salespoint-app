/**
 * API: PUT /api/till/[tillId]/adjust-float
 * 
 * Adjusts (tops up) the opening balance of an active till.
 * Adds additional cash to the starting float without creating a transaction.
 */

import Till from "@/src/models/Till";
import { mongooseConnect } from "@/src/lib/mongoose";
import { sanitizeBody } from '@/src/lib/apiValidation';

export default async function handler(req, res) {
  // Only allow PUT requests
  if (req.method !== "PUT") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  req.body = sanitizeBody(req.body);

  try {
    await mongooseConnect();

    const { tillId } = req.query;
    const { adjustmentAmount, reason } = req.body;

    // Validate input
    if (!adjustmentAmount || isNaN(adjustmentAmount) || adjustmentAmount <= 0) {
      return res.status(400).json({ 
        message: "Invalid adjustment amount - must be a positive number" 
      });
    }

    // Find the till
    const till = await Till.findById(tillId);
    if (!till) {
      return res.status(404).json({ message: "Till not found" });
    }

    // Check till is still open
    if (till.status !== "OPEN") {
      return res.status(400).json({ 
        message: "Cannot adjust float on a closed till" 
      });
    }

    // Update opening balance by adding the adjustment amount
    const previousBalance = till.openingBalance;
    till.openingBalance += parseFloat(adjustmentAmount);

    // Log the adjustment (optional: could add to a separate audit log)
    console.log(
      `✅ Float adjusted for till ${tillId}:` +
      `\n   Previous balance: ₦${previousBalance}` +
      `\n   Adjustment: ₦${parseFloat(adjustmentAmount)}` +
      `\n   New balance: ₦${till.openingBalance}` +
      `\n   Reason: ${reason}`
    );

    // Save the updated till
    await till.save();

    return res.status(200).json({
      message: "Float adjusted successfully",
      till: {
        _id: till._id,
        openingBalance: till.openingBalance,
        previousBalance,
        adjustmentAmount: parseFloat(adjustmentAmount),
      },
    });
  } catch (error) {
    console.error("Error adjusting float:", error);
    return res.status(500).json({ 
      message: "Failed to adjust float",
      error: error.message 
    });
  }
}
