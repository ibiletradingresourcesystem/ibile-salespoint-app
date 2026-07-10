/**
 * API Endpoint: /api/promotions
 * 
 * GET - Fetch all active promotions
 * POST - Create a new promotion
 */

import { mongooseConnect } from '@/src/lib/mongoose';
import Promotion from '@/src/models/Promotion';
import { sanitizeBody } from '@/src/lib/apiValidation';

export default async function handler(req, res) {
  await mongooseConnect();

  if (req.method === 'GET') {
    try {
      // Fetch all active promotions
      const promotions = await Promotion.find({ active: true })
        .sort({ priority: -1, createdAt: -1 })
        .lean();

      // Filter promotions that are within date range or indefinite
      const now = new Date();
      const validPromotions = promotions.filter(promo => {
        if (promo.indefinite) return true;
        
        const startDate = new Date(promo.startDate);
        const endDate = new Date(promo.endDate);
        
        return now >= startDate && now <= endDate;
      });

      console.log(`📢 Found ${validPromotions.length} active promotions`);
      
      return res.status(200).json({
        success: true,
        data: validPromotions,
      });
    } catch (error) {
      console.error('❌ Error fetching promotions:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch promotions',
        message: error.message,
      });
    }
  }

  if (req.method === 'POST') {
    req.body = sanitizeBody(req.body);
    try {
      const promotionData = req.body;

      // Validate required fields
      if (!promotionData.name || !promotionData.discountValue || !promotionData.applicationType) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: name, discountValue, applicationType',
        });
      }

      const promotion = new Promotion(promotionData);
      await promotion.save();

      console.log('✅ Promotion created:', promotion.name);

      return res.status(201).json({
        success: true,
        data: promotion,
      });
    } catch (error) {
      console.error('❌ Error creating promotion:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to create promotion',
        message: error.message,
      });
    }
  }

  return res.status(405).json({
    success: false,
    error: 'Method not allowed',
  });
}
