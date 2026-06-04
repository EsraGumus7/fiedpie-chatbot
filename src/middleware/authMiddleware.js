const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";

function authMiddleware(req, res, next) {
  if (process.env.ADMIN_AUTH_OPTIONAL === "true") {
    req.authUser = {
      userId: Number(process.env.ADMIN_DEV_USER_ID || 1),
      email: "dev@local",
      subscriptionId: null,
      admin: true,
      apiUser: false,
      clientUser: false,
    };
    return next();
  }

  const authHeader = req.headers.authorization || "";

  if (!authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Token bulunamadi. Once /auth/login ile giris yapin." });
  }

  const token = authHeader.replace("Bearer ", "").trim();

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    req.authUser = {
      userId: decoded.userId,
      email: decoded.email,
      subscriptionId: decoded.subscriptionId,
      admin: !!decoded.admin,
      apiUser: !!decoded.apiUser,
      clientUser: !!decoded.clientUser,
    };

    return next();
  } catch (_error) {
    return res.status(401).json({ error: "Token gecersiz veya suresi dolmus." });
  }
}

module.exports = { authMiddleware };
