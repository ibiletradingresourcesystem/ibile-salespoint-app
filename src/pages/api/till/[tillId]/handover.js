// pages/api/till/[tillId]/handover.js
// Several terminals at one location share the location's till.
// POST: a terminal sends its sales to the cloud and steps off the till, so another terminal can close it.
// GET:  the till's status and hand-overs, polled by terminals still selling (TillHandoverWatcher).
import mongoose from "mongoose";
import { mongooseConnect } from "@/src/lib/mongoose";
import Till from "@/src/models/Till";
import { Transaction } from "@/src/models/Transactions";
import { sanitizeBody } from "@/src/lib/apiValidation";
import { summarizeTillTransactions } from "@/src/lib/tillReconciliation";

const tillState = (till) => ({
  _id: till._id,
  status: till.status,
  closedAt: till.closedAt || null,
  closedByDeviceId: till.closedByDeviceId || "",
  closedByDeviceName: till.closedByDeviceName || "",
  closedByStaffName: till.closedByStaffName || "",
  handovers: till.handovers || [],
});

export default async function handler(req, res) {
  const { tillId } = req.query;
  if (!tillId || !mongoose.Types.ObjectId.isValid(String(tillId))) {
    return res.status(400).json({ success: false, message: "A valid till ID is required" });
  }

  try {
    await mongooseConnect();

    if (req.method === "GET") {
      const till = await Till.findById(tillId)
        .select("status closedAt closedByDeviceId closedByDeviceName closedByStaffName handovers")
        .lean();
      if (!till) return res.status(404).json({ success: false, message: "Till not found" });
      return res.status(200).json({ success: true, till: tillState(till) });
    }

    if (req.method !== "POST") {
      return res.status(405).json({ success: false, message: "Method not allowed" });
    }

    const { deviceId, deviceName, staffId: bodyStaffId, staffName } = sanitizeBody(req.body || {});
    // Prefer the staff id from the verified session (set by middleware)
    const staffId = req.headers["x-auth-staff-id"] || bodyStaffId;
    if (!deviceId) {
      return res.status(400).json({ success: false, message: "deviceId is required" });
    }

    const till = await Till.findById(tillId);
    if (!till) return res.status(404).json({ success: false, message: "Till not found" });
    if (till.status !== "OPEN") {
      return res.status(409).json({ success: false, message: "This till has already been closed", till: tillState(till.toObject()) });
    }

    // Work the figures out from what the cloud holds for this terminal, not from what the terminal says
    const deviceTransactions = await Transaction.find({ tillId: till._id, deviceId: String(deviceId) })
      .select("status subStatus total tenderType tenderPayments")
      .lean();
    const figures = summarizeTillTransactions(deviceTransactions);

    // Keep one hand-over per terminal: a new one replaces an earlier pending one
    till.handovers = (till.handovers || []).filter(
      (handover) => !(handover.deviceId === String(deviceId) && handover.status === "pending")
    );
    till.handovers.push({
      deviceId: String(deviceId),
      deviceName: String(deviceName || ""),
      staffId: mongoose.Types.ObjectId.isValid(String(staffId || "")) ? staffId : null,
      staffName: String(staffName || ""),
      transactionCount: figures.transactionCount,
      totalSales: figures.totalSales,
      tenderBreakdown: figures.tenderBreakdown,
      sentAt: new Date(),
      status: "pending",
    });
    await till.save();

    const handover = till.handovers[till.handovers.length - 1];
    return res.status(200).json({ success: true, handover, till: tillState(till.toObject()) });
  } catch (error) {
    console.error("❌ Till hand-over error:", error);
    return res.status(500).json({ success: false, message: "Failed to hand over the till" });
  }
}
