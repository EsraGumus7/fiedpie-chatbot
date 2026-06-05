const express = require("express");
const { authMiddleware } = require("../middleware/authMiddleware");
const service = require("../services/adminPermissionService");

const router = express.Router();

function actor(req) {
  return req.authUser?.userId || "system";
}

router.get("/catalog", authMiddleware, async (req, res) => {
  try {
    res.json(await service.getCatalog());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/reference/subscriptions", authMiddleware, async (req, res) => {
  try {
    res.json(await service.getSubscriptions(req.query.search));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/reference/brands", authMiddleware, async (req, res) => {
  try {
    res.json(await service.getBrands(req.query));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/reference/teams", authMiddleware, async (req, res) => {
  try {
    res.json(await service.getTeams(req.query));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/reference/clients", authMiddleware, async (req, res) => {
  try {
    res.json(await service.getClients(req.query));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/reference/countries", authMiddleware, async (req, res) => {
  try {
    res.json(await service.getCountries(req.query));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/reference/regions", authMiddleware, async (req, res) => {
  try {
    res.json(await service.getRegions(req.query));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/reference/cities", authMiddleware, async (req, res) => {
  try {
    res.json(await service.getCities(req.query));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/reference/districts", authMiddleware, async (req, res) => {
  try {
    res.json(await service.getDistricts(req.query));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/users", authMiddleware, async (req, res) => {
  try {
    res.json(await service.getUsers(req.query));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/roles", authMiddleware, async (req, res) => {
  try {
    res.json(await service.getRoles(req.query));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/roles/:roleId/permissions", authMiddleware, async (req, res) => {
  try {
    res.json(await service.getRolePermissions(req.params.roleId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/roles/:roleId/permissions", authMiddleware, async (req, res) => {
  try {
    res.json(
      await service.saveRolePermissions(
        req.params.roleId,
        req.body.allowedIntents || [],
        actor(req)
      )
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/users/:userId/roles", authMiddleware, async (req, res) => {
  try {
    res.json(await service.getUserRoles(req.params.userId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/users/:userId/roles", authMiddleware, async (req, res) => {
  try {
    res.json(
      await service.saveUserRoles(req.params.userId, req.body.roleIds || [], actor(req))
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/users/:userId/permissions", authMiddleware, async (req, res) => {
  try {
    res.json(await service.getUserPermissions(req.params.userId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/users/:userId/permissions", authMiddleware, async (req, res) => {
  try {
    res.json(
      await service.saveUserPermissions(
        req.params.userId,
        req.body.allowedIntents || [],
        actor(req)
      )
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/users/:userId/scopes", authMiddleware, async (req, res) => {
  try {
    res.json(await service.getUserScopes(req.params.userId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/users/:userId/scopes/derived", authMiddleware, async (req, res) => {
  try {
    res.json(await service.getUserDerivedScopes(req.params.userId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/users/:userId/scopes", authMiddleware, async (req, res) => {
  try {
    res.json(await service.saveUserScopes(req.params.userId, req.body || {}, actor(req)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/users/:userId/effective-permissions", authMiddleware, async (req, res) => {
  try {
    res.json(await service.getEffectivePermissions(req.params.userId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/audit-logs", authMiddleware, async (req, res) => {
  try {
    res.json(await service.getAuditLogs(req.query.limit));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
