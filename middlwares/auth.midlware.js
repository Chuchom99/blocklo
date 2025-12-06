// middleware/auth.middleware.js
export const basicAuth = (req, res, next) => {
  const auth = req.headers.authorization;

  if (!auth || !auth.startsWith("Basic ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const base64Credentials = auth.split(" ")[1];
  const credentials = Buffer.from(base64Credentials, "base64").toString("ascii");
  const [username, password] = credentials.split(":");

  const expectedUsername = process.env.WEBHOOK_USERNAME || "blocklo_webhook";
  const expectedPassword = process.env.WEBHOOK_PASSWORD || "y5#K9mPx!2vN8qL"; // STRONG password

  if (username === expectedUsername && password === expectedPassword) {
    return next();
  }

  return res.status(401).json({ error: "Invalid credentials" });
};