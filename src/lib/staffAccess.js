/**
 * Who is signed in to the till, as they stand now.
 *
 * The session cookie lasts 30 days and only says who logged in, and the middleware that checks it
 * cannot read the database. What a person may do was only checked by which buttons the page showed.
 * The routes that move money or stock check here instead. Staff are read at most once a minute per
 * server (a few dozen short records), so a check costs no database trip of its own.
 */
import mongoose from "mongoose";
import { mongooseConnect } from "@/src/lib/mongoose";
import { Staff } from "@/src/models/Staff";
import { hasPosPermission } from "@/src/lib/posPermissions";

const REFRESH_MS = 60 * 1000;
const STAFF_FIELDS = "name role posPermissions isActive";

const state =
  globalThis.__ibilePosStaffAccess ||
  (globalThis.__ibilePosStaffAccess = { byId: null, loadedAt: 0, loading: null });
// Ids looked up alone and not found, until the next full read
state.missed ||= new Set();

function load() {
  if (!state.loading) {
    state.loading = (async () => {
      await mongooseConnect();
      const staff = await Staff.find({}, STAFF_FIELDS).lean();
      state.byId = new Map(staff.map((member) => [String(member._id), member]));
      state.missed = new Set();
      state.loadedAt = Date.now();
    })().finally(() => {
      state.loading = null;
    });
  }
  return state.loading;
}

async function findStaff(staffId) {
  if (!state.byId || Date.now() - state.loadedAt > REFRESH_MS) await load();
  const found = state.byId.get(staffId);
  if (found) return found;
  // Someone added since the list was read: fetch just them. Reloading the whole list was skipped
  // within 5 seconds of the last read, which told a brand-new person to log in again.
  if (state.missed.has(staffId) || !mongoose.isValidObjectId(staffId)) return null;
  const member = await Staff.findById(staffId, STAFF_FIELDS).lean();
  if (member) state.byId.set(staffId, member);
  else state.missed.add(staffId);
  return member || null;
}

/** The signed-in staff member, or null after answering 401. */
export async function requireActiveStaff(req, res) {
  const staffId = String(req.headers["x-auth-staff-id"] || "");
  const member = staffId ? await findStaff(staffId) : null;
  if (!member || member.isActive === false) {
    res.status(401).json({ success: false, code: "AUTH_REQUIRED", message: "Please log in again." });
    return null;
  }
  return member;
}

/** The signed-in staff member if they hold this POS permission, or null after answering. */
export async function requirePosPermission(req, res, key) {
  const member = await requireActiveStaff(req, res);
  if (!member) return null;
  if (!hasPosPermission(member, key)) {
    res.status(403).json({ success: false, code: "NOT_PERMITTED", message: "You do not have permission to do this." });
    return null;
  }
  return member;
}
