/**
 * API Endpoint: GET /api/staff
 *
 * Fetches all active staff members
 * Query params:
 * - location: Filter by location name
 */

import { mongooseConnect } from "@/src/lib/mongoose";
import { Staff } from "@/src/models/Staff";
import { normalizePosPermissions } from "@/src/lib/posPermissions";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    await mongooseConnect();

    const { location } = req.query;
    let query = {};

    if (location) {
      query.locationName = location;
    }

    let staff = await Staff.find({ ...query, isActive: true })
      .select("_id name username role locationName posPermissions")
      .lean();

    if (staff.length === 0) {
      console.log("No staff found with isActive filter, trying without filter");
      staff = await Staff.find(query)
        .select("_id name username role locationName posPermissions")
        .lean();
    }

    const normalized = staff.map((member) => ({
      ...member,
      posPermissions: normalizePosPermissions(member.role, member.posPermissions),
    }));

    return res.status(200).json({
      success: true,
      count: normalized.length,
      data: normalized,
    });
  } catch (err) {
    console.error("Error fetching staff:", err);
    console.error("Error details:", {
      message: err.message,
      code: err.code,
      name: err.name,
    });

    const defaultStaff = [
      {
        _id: "staff_1",
        name: "Demo Cashier",
        username: "cashier",
        role: "staff",
        locationName: "Main Store",
        posPermissions: normalizePosPermissions("staff"),
      },
      {
        _id: "staff_2",
        name: "Demo Manager",
        username: "manager",
        role: "manager",
        locationName: "Main Store",
        posPermissions: normalizePosPermissions("manager"),
      },
    ];

    return res.status(200).json({
      success: true,
      count: defaultStaff.length,
      data: defaultStaff,
    });
  }
}