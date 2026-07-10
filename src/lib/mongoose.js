import mongoose from "mongoose";

// Global connection state
let isConnected = false;

export async function mongooseConnect() {
  // If already connected, return immediately
  if (isConnected && mongoose.connection.readyState === 1) {
    return mongoose.connection.asPromise();
  }

  // If we have a ready connection, use it
  if (mongoose.connection.readyState === 1) {
    isConnected = true;
    return mongoose.connection.asPromise();
  }

  try {
    const uri = process.env.MONGODB_URI;
    
    if (!uri) {
      console.error("❌ MONGODB_URI environment variable is not set");
      throw new Error("MONGODB_URI is not configured");
    }

    console.log("🔗 Attempting MongoDB connection...", uri.substring(0, 30) + "...");
    
    const result = await mongoose.connect(uri, {
      maxPoolSize: 10,
      minPoolSize: 5,
      maxIdleTimeMS: 45000,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      connectTimeoutMS: 10000,
      retryWrites: true,
      family: 4 // Use IPv4, skip IPv6
    });

    isConnected = true;
    console.log("✅ MongoDB connected successfully");
    return result.connection.asPromise();
  } catch (error) {
    isConnected = false;
    console.error("❌ MongoDB connection failed:", {
      message: error.message,
      code: error.code,
      name: error.name,
    });
    throw error;
  }
}

// Default export for compatibility
export default mongooseConnect;
