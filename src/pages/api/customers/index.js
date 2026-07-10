/**
 * API Endpoint: /api/customers
 * 
 * GET: Fetch all customers
 * POST: Create new customer
 */

import { mongooseConnect } from "@/src/lib/mongoose";
import Customer from "@/src/models/Customer";
import { sanitizeBody } from '@/src/lib/apiValidation';

export default async function handler(req, res) {
  if (req.method === "GET") {
    try {
      await mongooseConnect();
      
      const customers = await Customer.find({}).sort({ createdAt: -1 }).lean();
      
      return res.status(200).json(customers || []);
    } catch (error) {
      console.error("❌ Error fetching customers:", error);
      return res.status(500).json({ 
        success: false, 
        message: "Failed to fetch customers",
        error: error.message 
      });
    }
  } 
  
  if (req.method === "POST") {
    req.body = sanitizeBody(req.body);
    try {
      await mongooseConnect();
      
      const {
        name,
        email,
        phone,
        address,
        type = "REGULAR",
        isCreditCustomer,
        creditLimit,
        creditBalance,
        creditNotes,
      } = req.body;
      
      if (!name) {
        return res.status(400).json({ 
          success: false, 
          message: "Name is required" 
        });
      }
      
      // Check if email already exists
      if (email) {
        const existing = await Customer.findOne({ email });
        if (existing) {
          return res.status(400).json({ 
            success: false, 
            message: "Email already exists" 
          });
        }
      }
      
      const creditEnabled = Boolean(isCreditCustomer || type === "CREDIT");

      const customer = new Customer({
        name,
        email: email || undefined,
        phone,
        address,
        type: creditEnabled ? "CREDIT" : type,
        isCreditCustomer: creditEnabled,
        creditLimit: Number(creditLimit || 0),
        creditBalance: Number(creditBalance || 0),
        creditNotes: creditNotes || "",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      
      await customer.save();
      
      console.log(`✅ Customer created: ${name} (${phone})`);
      
      return res.status(201).json(customer.toObject());
    } catch (error) {
      console.error("❌ Error creating customer:", error);
      return res.status(500).json({ 
        success: false, 
        message: "Failed to create customer",
        error: error.message 
      });
    }
  }
  
  return res.status(405).json({ message: "Method not allowed" });
}
