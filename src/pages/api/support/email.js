import nodemailer from 'nodemailer';
import { sanitizeBody } from '@/src/lib/apiValidation';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  req.body = sanitizeBody(req.body);

  const { message, storeName, locationName, staffName } = req.body;

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ error: 'Message is required' });
  }

  // Sanitize inputs
  const safeMessage = message.slice(0, 5000);
  const safeStoreName = String(storeName || 'Unknown Store').slice(0, 200);
  const safeLocationName = String(locationName || 'Unknown Location').slice(0, 200);
  const safeStaffName = String(staffName || 'Unknown Staff').slice(0, 200);

  const to = process.env.SUPPORT_EMAIL || 'hello.ayoola@gmail.com';

  const subject = `POS Support - ${safeStoreName} | ${safeLocationName} | ${safeStaffName}`;
  const text = `${safeMessage}\n\n---\nSent from POS Support Chat\nStore: ${safeStoreName}\nLocation: ${safeLocationName}\nStaff: ${safeStaffName}\nDate: ${new Date().toLocaleString()}`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px;">
      <p style="white-space: pre-line;">${safeMessage.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))}</p>
      <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;" />
      <table style="font-size: 13px; color: #666;">
        <tr><td style="padding: 2px 10px 2px 0; font-weight: bold;">Store:</td><td>${safeStoreName.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))}</td></tr>
        <tr><td style="padding: 2px 10px 2px 0; font-weight: bold;">Location:</td><td>${safeLocationName.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))}</td></tr>
        <tr><td style="padding: 2px 10px 2px 0; font-weight: bold;">Staff:</td><td>${safeStaffName.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))}</td></tr>
        <tr><td style="padding: 2px 10px 2px 0; font-weight: bold;">Date:</td><td>${new Date().toLocaleString()}</td></tr>
      </table>
      <p style="font-size: 11px; color: #999; margin-top: 15px;">Sent from POS Support Chat</p>
    </div>
  `;

  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject,
      text,
      html,
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Email send error:', error.message);
    return res.status(500).json({ error: 'Failed to send email' });
  }
}
