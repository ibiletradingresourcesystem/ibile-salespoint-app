// Simple endpoint to check environment configuration
export default function handler(req, res) {
  // Block in production — this endpoint exposes sensitive configuration
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' });
  }

  console.log("\n\n========== ENV DEBUG ==========");
  
  const envInfo = {
    NODE_ENV: process.env.NODE_ENV,
    MONGODB_URI_SET: !!process.env.MONGODB_URI,
    NEXTAUTH_URL: process.env.NEXTAUTH_URL,
  };
  
  console.log("Environment:", envInfo);
  
  return res.status(200).json(envInfo);
}
