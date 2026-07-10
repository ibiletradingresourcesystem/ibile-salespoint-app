import dbConnect from '@/src/lib/mongoose';
import Staff from '@/src/models/Staff';
import { sanitizeBody } from '@/src/lib/apiValidation';

export default async function handler(req, res) {
  await dbConnect();

  if (req.method === 'POST') {
    req.body = sanitizeBody(req.body);
    const { staffId, type, locationId, locationName, notes } = req.body;

    if (!staffId || !type) {
      return res.status(400).json({ success: false, message: 'staffId and type (in/out) are required' });
    }

    if (!['in', 'out'].includes(type)) {
      return res.status(400).json({ success: false, message: 'type must be "in" or "out"' });
    }

    try {
      const staff = await Staff.findById(staffId);
      if (!staff) {
        return res.status(404).json({ success: false, message: 'Staff not found' });
      }

      // Check current clock state
      const lastRecord = staff.clockRecords?.length > 0
        ? staff.clockRecords[staff.clockRecords.length - 1]
        : null;

      if (type === 'in' && lastRecord?.type === 'in') {
        return res.status(400).json({
          success: false,
          message: 'Staff is already clocked in',
          lastClockIn: lastRecord.timestamp,
        });
      }

      if (type === 'out' && (!lastRecord || lastRecord.type === 'out')) {
        return res.status(400).json({
          success: false,
          message: 'Staff is not clocked in',
        });
      }

      const record = {
        type,
        timestamp: new Date(),
        locationId: locationId || undefined,
        locationName: locationName || undefined,
        notes: notes || undefined,
      };

      staff.clockRecords.push(record);
      await staff.save();

      return res.status(200).json({
        success: true,
        message: `Successfully clocked ${type}`,
        record: staff.clockRecords[staff.clockRecords.length - 1],
        staffName: staff.name,
      });
    } catch (error) {
      console.error('Clock in/out error:', error);
      return res.status(500).json({ success: false, message: 'Server error' });
    }
  }

  if (req.method === 'GET') {
    const { staffId, date } = req.query;

    if (!staffId) {
      return res.status(400).json({ success: false, message: 'staffId is required' });
    }

    try {
      const staff = await Staff.findById(staffId).select('name clockRecords');
      if (!staff) {
        return res.status(404).json({ success: false, message: 'Staff not found' });
      }

      let records = staff.clockRecords || [];

      // Filter by date if provided
      if (date) {
        const filterDate = new Date(date);
        const startOfDay = new Date(filterDate.setHours(0, 0, 0, 0));
        const endOfDay = new Date(filterDate.setHours(23, 59, 59, 999));
        records = records.filter((r) => {
          const ts = new Date(r.timestamp);
          return ts >= startOfDay && ts <= endOfDay;
        });
      }

      // Get last record to determine current state
      const lastRecord = staff.clockRecords?.length > 0
        ? staff.clockRecords[staff.clockRecords.length - 1]
        : null;

      return res.status(200).json({
        success: true,
        staffName: staff.name,
        isClockedIn: lastRecord?.type === 'in',
        lastRecord,
        records: records.slice(-20), // Last 20 records
      });
    } catch (error) {
      console.error('Get clock records error:', error);
      return res.status(500).json({ success: false, message: 'Server error' });
    }
  }

  return res.status(405).json({ success: false, message: 'Method not allowed' });
}
