const express = require("express");
const { login } = require("../services/authService");
const { authMiddleware } = require("../middleware/authMiddleware");
const { buildUserContext } = require("../services/userContextService");

const router = express.Router();

router.post("/login", async (req, res) => {
  try {
    const email = req.body?.email;
    const password = req.body?.password;

    if (!email || !password) {
      return res.status(400).json({ error: "Email ve sifre zorunludur." });
    }

    const result = await login(email, password);
    return res.json(result);
  } catch (error) {
    return res.status(401).json({ error: error.message });
  }
});

router.get("/me", authMiddleware, async (req, res) => {
  try {
    const userContext = await buildUserContext(req.authUser.userId);
    return res.json({
      user: req.authUser,
      context: userContext,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// Logout endpoint: sunucu tarafında JWT'yi kara listeye almıyoruz (stateless JWT).
// İstemci bu endpoint'e çağrı yaparak yerel token'ı temizleyebilir.
router.post("/logout", authMiddleware, async (_req, res) => {
  return res.json({ ok: true, message: "Cikis yapildi. Lutfen istemci token'i silsin." });
});

module.exports = router;
