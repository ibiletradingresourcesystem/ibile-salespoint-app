import mongoose from "mongoose";
import { mongooseConnect } from "@/src/lib/mongoose";
import Order from "@/src/models/Order";
import { Transaction } from "@/src/models/Transactions";

const ACTIVE_ORDER_STATUSES = [
  "Pending",
  "Processing",
  "Shipped",
  "Pending Payment",
  "Inventory Reserved",
];

const SITE_LABELS = {
  store: "Store",
  hotel: "Hotel",
};

const escapeRegex = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeSiteKey = (value) => String(value || "").trim().toLowerCase() === "hotel" ? "hotel" : "store";

const buildUnassignedSiteFilters = (siteKey) => {
  const normalizedSiteKey = normalizeSiteKey(siteKey);
  const siteLabel = SITE_LABELS[normalizedSiteKey] || "Store";
  const siteKeyClauses = normalizedSiteKey === "store"
    ? [
      { siteKey: normalizedSiteKey },
      { siteKey: { $exists: false } },
      { siteKey: null },
    ]
    : [{ siteKey: normalizedSiteKey }];

  return {
    $and: [
      {
        $or: [
          { locationId: null },
          { locationId: { $exists: false } },
          { locationName: "" },
          { locationName: { $exists: false } },
          { locationName: siteLabel },
        ],
      },
      {
        $or: siteKeyClauses,
      },
    ],
  };
};

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed",
    });
  }

  try {
    await mongooseConnect();

    const {
      locationId,
      locationName,
      siteKey = "store",
      includeUnassigned = "false",
      startDate,
      endDate,
      limit = 200,
      includeExpired = "false",
    } = req.query;

    const filters = {
      status: {
        $in: includeExpired === "true"
          ? [...ACTIVE_ORDER_STATUSES, "Reservation Expired"]
          : ACTIVE_ORDER_STATUSES,
      },
    };

    const locationClauses = [];

    if (locationId && mongoose.Types.ObjectId.isValid(String(locationId))) {
      locationClauses.push({ locationId });
    }

    if (locationName) {
      locationClauses.push({
        locationName: {
          $regex: `^${escapeRegex(locationName)}$`,
          $options: "i",
        },
      });
    }

    if (includeUnassigned === "true") {
      locationClauses.push(buildUnassignedSiteFilters(siteKey));
    }

    if (locationClauses.length === 1) {
      Object.assign(filters, locationClauses[0]);
    } else if (locationClauses.length > 1) {
      filters.$or = locationClauses;
    }

    if (startDate || endDate) {
      filters.createdAt = {};
      if (startDate) {
        filters.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        filters.createdAt.$lte = new Date(endDate);
      }
    }

    console.log("📋 Fetching online orders with filters:", filters);

    const orders = await Order.find(filters)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit, 10) || 200)
      .lean();

    const orderIds = orders.map((order) => String(order._id));
    const externalIds = orderIds.map((orderId) => `order:${orderId}`);
    const transactions = orderIds.length > 0
      ? await Transaction.find({
        $or: [
          { externalId: { $in: externalIds } },
          { sourceOrderId: { $in: orderIds } },
        ],
      })
        .select("_id externalId sourceOrderId createdAt salesChannel")
        .lean()
      : [];

    const transactionsByOrderId = new Map();
    transactions.forEach((transaction) => {
      const orderId = String(
        transaction?.sourceOrderId ||
        String(transaction?.externalId || "").replace(/^order:/, "")
      );

      if (orderId && !transactionsByOrderId.has(orderId)) {
        transactionsByOrderId.set(orderId, transaction);
      }
    });

    const formattedOrders = orders.map((order) => {
      const posTransaction = transactionsByOrderId.get(String(order._id));

      return {
      id: order._id?.toString(),
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      customerId: order.customer?.toString?.() || order.customer || null,
      siteKey: normalizeSiteKey(order.siteKey),
      customerName: order.shippingDetails?.name || order.customerSnapshot?.name || "Online Customer",
      customerSnapshot: order.customerSnapshot || null,
      shippingDetails: order.shippingDetails || order.customerSnapshot || null,
      items: order.items || [],
      cartProducts: order.cartProducts || [],
      subtotal: order.subtotal || 0,
      shippingCost: order.shippingCost || 0,
      total: order.total || 0,
      locationId: order.locationId?.toString?.() || order.locationId || null,
      locationName: order.locationName || "",
      paymentReference: order.paymentReference || "",
      paymentStatus: order.paymentStatus || "Pending",
      status: order.status || "Pending",
      paid: Boolean(order.paid),
      reservationStatus: order.reservationStatus || null,
      hasPosTransaction: Boolean(posTransaction),
      posTransactionId: posTransaction?._id?.toString?.() || posTransaction?._id || null,
      posTransactionCreatedAt: posTransaction?.createdAt || null,
      salesChannel: posTransaction?.salesChannel || null,
    };
    });

    return res.status(200).json({
      success: true,
      data: formattedOrders,
      count: formattedOrders.length,
    });
  } catch (error) {
    console.error("❌ Error fetching online orders:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch online orders",
    });
  }
}
