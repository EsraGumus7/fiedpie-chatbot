const { queryDb } = require("../db/sql");
//const { listResolvedIntentCandidates } = require("../planner/metricRegistry");
const { buildUserContext } = require("./userContextService");
const { appendFileLog, listFileLogs } = require("./auditLogStore");
const {
  getUserIntents,
  saveUserIntents,
  isMissingTableError,
} = require("./userPermissionStore");

const {
  getMetricByIntent,
  listResolvedIntentCandidates,
} = require("../planner/metricRegistry");

let auditTableExistsCache = null;

async function hasAuditTable() {
  if (auditTableExistsCache !== null) return auditTableExistsCache;
  try {
    const result = await queryDb({
      query: "SELECT OBJECT_ID('dbo.AiAuditLog', 'U') AS tableId",
      bind: {},
    });
    auditTableExistsCache = !!result.recordset[0]?.tableId;
  } catch (_err) {
    auditTableExistsCache = false;
  }
  return auditTableExistsCache;
}

function buildAuditSummary(action, afterJson) {
  try {
    const after =
      typeof afterJson === "string" && afterJson ? JSON.parse(afterJson) : afterJson || {};
    if (action === "role.permissions.update") {
      return `Intent: ${(after.allowedIntents || []).length} adet`;
    }
    if (action === "user.roles.update") {
      return `Rol: ${(after.roleIds || []).length} adet`;
    }
    if (action === "user.permissions.update") {
      return `Kullanici intent: ${(after.allowedIntents || []).length} adet`;
    }
    if (action === "user.scopes.update") {
      const parts = [];
      if (after.allowedCountryIds?.length) parts.push(`ülke ${after.allowedCountryIds.length}`);
      if (after.allowedTeamIds?.length) parts.push(`ekip ${after.allowedTeamIds.length}`);
      if (after.allowedBrandIds?.length) parts.push(`marka ${after.allowedBrandIds.length}`);
      if (after.allowedClientIds?.length) parts.push(`müşteri ${after.allowedClientIds.length}`);
      if (after.allowedSubscriptionIds?.length) parts.push(`company ${after.allowedSubscriptionIds.length}`);
      return parts.length ? parts.join(", ") : "Scope temizlendi / boş";
    }
  } catch (_e) {
    /* noop */
  }
  return action;
}

async function writeAuditLog({
  actorUserId = "system",
  action,
  targetType,
  targetId,
  before,
  after,
}) {
  const afterJson = JSON.stringify(after ?? null);
  const beforeJson = JSON.stringify(before ?? null);

  appendFileLog({
    id: Date.now(),
    createdAt: new Date().toISOString(),
    actorUserId: String(actorUserId),
    action,
    targetType,
    targetId: String(targetId),
    beforeJson,
    afterJson,
    summary: buildAuditSummary(action, after),
    source: "file",
  });

  if (!(await hasAuditTable())) {
    return { file: true, db: false };
  }

  try {
    await queryDb({
      query: `
        INSERT INTO dbo.AiAuditLog
        (ActorUserId, Action, TargetType, TargetId, BeforeJson, AfterJson, UpdatedBy)
        VALUES
        (@actorUserId, @action, @targetType, @targetId, @beforeJson, @afterJson, @actorUserId)
      `,
      bind: {
        actorUserId: String(actorUserId),
        action,
        targetType,
        targetId: String(targetId),
        beforeJson,
        afterJson,
      },
    });
    return { file: true, db: true };
  } catch (err) {
    console.warn("[audit] DB yazilamadi (dosyaya yazildi):", err.message);
    return { file: true, db: false };
  }
}

function detectDomain(intent, metricId = "") {
  const text = `${intent || ""} ${metricId || ""}`.toLowerCase();
  if (text.includes("visit") || text.includes("dynamic")) return "visit";
  if (text.includes("user")) return "users";
  if (text.includes("client") || text.includes("distributor") || text.includes("consumer")) return "client";
  if (text.includes("invoice") || text.includes("purchase") || text.includes("campaign") || text.includes("payment"))
    return "sales";
  return "other";
}

async function getCatalog() {
  const intents = listResolvedIntentCandidates().map((m) => ({
    intent: m.intent,
    metric_id: m.metric_id,
    description_tr: m.description_tr || "",
    domain: detectDomain(m.intent, m.metric_id),
  }));

  return { intents };
}

async function getSubscriptions(search) {
  const result = await queryDb({
    query: `
      SELECT TOP 100 Id AS id, CompanyName AS label
      FROM dbo.Subscription
      WHERE Deleted = 0
        AND (@search IS NULL OR CompanyName LIKE '%' + @search + '%')
      ORDER BY CompanyName
    `,
    bind: { search: search || null },
  });

  return { items: result.recordset };
}

async function getTeams({ subscriptionId, search }) {
  const result = await queryDb({
    query: `
      SELECT TOP 200 Id AS id, Name AS label, SubscriptionId AS subscriptionId
      FROM dbo.Team
      WHERE Deleted = 0
        AND (@subscriptionId IS NULL OR SubscriptionId = @subscriptionId)
        AND (@search IS NULL OR Name LIKE '%' + @search + '%')
      ORDER BY Name
    `,
    bind: {
      subscriptionId: subscriptionId ? Number(subscriptionId) : null,
      search: search || null,
    },
  });

  return { items: result.recordset };
}

async function getBrands({ subscriptionId, search }) {
  const result = await queryDb({
    query: `
      SELECT TOP 100 Id AS id, Name AS label, SubscriptionId AS subscriptionId
      FROM dbo.Brand
      WHERE Deleted = 0
        AND (@subscriptionId IS NULL OR SubscriptionId = @subscriptionId)
        AND (@search IS NULL OR Name LIKE '%' + @search + '%')
      ORDER BY Name
    `,
    bind: {
      subscriptionId: subscriptionId ? Number(subscriptionId) : null,
      search: search || null,
    },
  });

  return { items: result.recordset };
}

function parsePositiveIds(value) {
  if (!value) return [];
  return String(value)
    .split(",")
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

async function getCountries({ search, limit }) {
  const result = await queryDb({
    query: `
      SELECT TOP (@limit) Id AS id, Name AS label
      FROM dbo.Country
      WHERE Deleted = 0
        AND (@search IS NULL OR Name LIKE '%' + @search + '%')
      ORDER BY Name
    `,
    bind: {
      search: search || null,
      limit: Number(limit) || 200,
    },
  });

  return { items: result.recordset };
}

async function getRegions({ subscriptionId, search, limit }) {
  const result = await queryDb({
    query: `
      SELECT TOP (@limit)
        Id AS id,
        Name AS label,
        SubscriptionId AS subscriptionId
      FROM dbo.Region
      WHERE Deleted = 0
        AND (@subscriptionId IS NULL OR SubscriptionId = @subscriptionId)
        AND (@search IS NULL OR Name LIKE '%' + @search + '%')
      ORDER BY Name
    `,
    bind: {
      subscriptionId: subscriptionId ? Number(subscriptionId) : null,
      search: search || null,
      limit: Number(limit) || 200,
    },
  });

  return { items: result.recordset };
}

async function getCities({ subscriptionId, search, limit }) {
  const result = await queryDb({
    query: `
      SELECT TOP (@limit)
        c.Id AS id,
        c.Name AS label,
        c.SubscriptionId AS subscriptionId,
        (
          SELECT COUNT(*)
          FROM dbo.District d
          WHERE d.CityId = c.Id AND d.Deleted = 0
        ) AS districtCount
      FROM dbo.City c
      WHERE c.Deleted = 0
        AND (@subscriptionId IS NULL OR c.SubscriptionId = @subscriptionId)
        AND (@search IS NULL OR c.Name LIKE '%' + @search + '%')
      ORDER BY districtCount DESC, c.Name
    `,
    bind: {
      subscriptionId: subscriptionId ? Number(subscriptionId) : null,
      search: search || null,
      limit: Number(limit) || 200,
    },
  });

  return { items: result.recordset };
}

async function getDistricts({ cityId, cityIds, search, limit, all }) {
  const ids = parsePositiveIds(cityIds);
  if (cityId) ids.push(Number(cityId));
  const uniqueIds = [...new Set(ids)];

  if (all === "true" || all === true || !uniqueIds.length) {
    const result = await queryDb({
      query: `
        SELECT TOP (@limit)
          d.Id AS id,
          CAST(d.Name AS NVARCHAR(250)) AS label,
          d.CityId AS cityId,
          c.Name AS cityName
        FROM dbo.District d
        LEFT JOIN dbo.City c ON c.Id = d.CityId AND c.Deleted = 0
        WHERE d.Deleted = 0
          AND (@search IS NULL OR CAST(d.Name AS NVARCHAR(250)) LIKE '%' + @search + '%')
        ORDER BY d.Name
      `,
      bind: {
        search: search || null,
        limit: Number(limit) || 300,
      },
    });

    const items = result.recordset.map((row) => ({
      id: row.id,
      cityId: row.cityId,
      cityName: row.cityName,
      label: row.cityName
        ? `${row.label} — ${row.cityName} (#${row.cityId})`
        : `${row.label} — CityId #${row.cityId}`,
    }));

    return { items };
  }

  const inList = uniqueIds.join(",");
  const result = await queryDb({
    query: `
      SELECT TOP (@limit)
        d.Id AS id,
        CAST(d.Name AS NVARCHAR(250)) AS label,
        d.CityId AS cityId,
        c.Name AS cityName
      FROM dbo.District d
      LEFT JOIN dbo.City c ON c.Id = d.CityId AND c.Deleted = 0
      WHERE d.Deleted = 0
        AND d.CityId IN (${inList})
        AND (@search IS NULL OR CAST(d.Name AS NVARCHAR(250)) LIKE '%' + @search + '%')
      ORDER BY d.Name
    `,
    bind: {
      search: search || null,
      limit: Number(limit) || 300,
    },
  });

  const items = result.recordset.map((row) => ({
    id: row.id,
    cityId: row.cityId,
    cityName: row.cityName,
    label: row.cityName ? `${row.label} — ${row.cityName}` : `${row.label} (#${row.cityId})`,
  }));

  return { items };
}

async function getClients({ subscriptionId, search, limit }) {
  const result = await queryDb({
    query: `
      SELECT TOP (@limit)
        Id AS id,
        Name AS label,
        SubscriptionId AS subscriptionId
      FROM dbo.Client
      WHERE Deleted = 0
        AND (@subscriptionId IS NULL OR SubscriptionId = @subscriptionId)
        AND (@search IS NULL OR Name LIKE '%' + @search + '%')
      ORDER BY Name
    `,
    bind: {
      subscriptionId: subscriptionId ? Number(subscriptionId) : null,
      search: search || null,
      limit: Number(limit) || 100,
    },
  });

  return { items: result.recordset };
}

async function getUsers({ search, limit }) {
  const result = await queryDb({
    query: `
      SELECT TOP (@limit)
        Id AS id,
        Name AS name,
        Email AS email,
        SubscriptionId AS subscriptionId,
        Blocked AS blocked
      FROM dbo.[User]
      WHERE Deleted = 0
        AND (@search IS NULL OR Name LIKE '%' + @search + '%' OR Email LIKE '%' + @search + '%')
      ORDER BY Id DESC
    `,
    bind: {
      search: search || null,
      limit: Number(limit) || 50,
    },
  });

  return { items: result.recordset };
}

async function getRoles({ subscriptionId }) {
  const result = await queryDb({
    query: `
      SELECT
        Id AS id,
        Name AS name,
        Code AS code,
        SubscriptionId AS subscriptionId,
        DefaultAdmin AS defaultAdmin
      FROM dbo.Role
      WHERE Deleted = 0
        AND (@subscriptionId IS NULL OR SubscriptionId = @subscriptionId)
      ORDER BY Name
    `,
    bind: {
      subscriptionId: subscriptionId ? Number(subscriptionId) : null,
    },
  });

  return { items: result.recordset };
}

async function getRolePermissions(roleId) {
  const result = await queryDb({
    query: `
      SELECT Intent
      FROM dbo.AiRolePermission
      WHERE Deleted = 0
        AND RoleId = @roleId
      ORDER BY Intent
    `,
    bind: { roleId: Number(roleId) },
  });

  return {
    allowedIntents: result.recordset.map((x) => x.Intent),
  };
}

async function saveRolePermissions(roleId, allowedIntents = [], actorUserId = "system") {
  const beforePerms = await getRolePermissions(roleId).catch(() => ({ allowedIntents: [] }));

  await queryDb({
    query: `
      UPDATE dbo.AiRolePermission
      SET Deleted = 1, UpdateTime = GETDATE(), UpdatedBy = @actorUserId
      WHERE RoleId = @roleId AND Deleted = 0
    `,
    bind: {
      roleId: Number(roleId),
      actorUserId: String(actorUserId),
    },
  });

  for (const intent of allowedIntents) {
    await queryDb({
      query: `
        INSERT INTO dbo.AiRolePermission (RoleId, Intent, UpdatedBy)
        VALUES (@roleId, @intent, @actorUserId)
      `,
      bind: {
        roleId: Number(roleId),
        intent,
        actorUserId: String(actorUserId),
      },
    });
  }

  await writeAuditLog({
    actorUserId,
    action: "role.permissions.update",
    targetType: "role",
    targetId: roleId,
    before: { allowedIntents: beforePerms.allowedIntents },
    after: { allowedIntents },
  });

  return { ok: true };
}

async function getUserPermissions(userId) {
  const uid = Number(userId);
  const fileIntents = getUserIntents(uid);

  try {
    const result = await queryDb({
      query: `
        SELECT Intent
        FROM dbo.AiUserPermission
        WHERE Deleted = 0
          AND UserId = @userId
        ORDER BY Intent
      `,
      bind: { userId: uid },
    });

    const dbIntents = result.recordset.map((x) => x.Intent);
    const merged = [...new Set([...dbIntents, ...fileIntents])];

    return {
      allowedIntents: merged,
      source:
        dbIntents.length && fileIntents.length
          ? "db+file"
          : dbIntents.length
            ? "db"
            : fileIntents.length
              ? "file"
              : "none",
    };
  } catch (err) {
    if (isMissingTableError(err)) {
      return { allowedIntents: fileIntents, source: fileIntents.length ? "file" : "none" };
    }
    return { allowedIntents: fileIntents, source: fileIntents.length ? "file" : "none" };
  }
}

async function saveUserPermissions(userId, allowedIntents = [], actorUserId = "system") {
  const beforePerms = await getUserPermissions(userId);

  try {
    await queryDb({
      query: `
        UPDATE dbo.AiUserPermission
        SET Deleted = 1, UpdateTime = GETDATE(), UpdatedBy = @actorUserId
        WHERE UserId = @userId AND Deleted = 0
      `,
      bind: {
        userId: Number(userId),
        actorUserId: String(actorUserId),
      },
    });

    for (const intent of allowedIntents) {
      await queryDb({
        query: `
          INSERT INTO dbo.AiUserPermission (UserId, Intent, UpdatedBy)
          VALUES (@userId, @intent, @actorUserId)
        `,
        bind: {
          userId: Number(userId),
          intent,
          actorUserId: String(actorUserId),
        },
      });
    }
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
  }

  // DB tablosu olsa da olmasa da dosya yedegi (gelistirme / tablo gecisi icin).
  saveUserIntents(userId, allowedIntents);

  await writeAuditLog({
    actorUserId,
    action: "user.permissions.update",
    targetType: "user",
    targetId: userId,
    before: { allowedIntents: beforePerms.allowedIntents },
    after: { allowedIntents },
  });

  return { ok: true };
}

async function getUserRoles(userId) {
  const result = await queryDb({
    query: `
      SELECT RoleId
      FROM dbo.UserRole
      WHERE Deleted = 0
        AND UserId = @userId
    `,
    bind: { userId: Number(userId) },
  });

  return {
    roleIds: result.recordset.map((x) => x.RoleId),
  };
}

async function saveUserRoles(userId, roleIds = [], actorUserId = "system") {
  const beforeRoles = await getUserRoles(userId).catch(() => ({ roleIds: [] }));

  await queryDb({
    query: `
      UPDATE dbo.UserRole
      SET Deleted = 1, UpdateTime = GETDATE(), UpdatedBy = @actorUserId
      WHERE UserId = @userId AND Deleted = 0
    `,
    bind: {
      userId: Number(userId),
      actorUserId: String(actorUserId),
    },
  });

  for (const roleId of roleIds) {
    await queryDb({
      query: `
        INSERT INTO dbo.UserRole
        (CreateTime, UpdateTime, UpdatedBy, Deleted, UserId, RoleId)
        VALUES
        (GETDATE(), GETDATE(), @actorUserId, 0, @userId, @roleId)
      `,
      bind: {
        userId: Number(userId),
        roleId: Number(roleId),
        actorUserId: String(actorUserId),
      },
    });
  }

  await writeAuditLog({
    actorUserId,
    action: "user.roles.update",
    targetType: "user",
    targetId: userId,
    before: { roleIds: beforeRoles.roleIds },
    after: { roleIds },
  });

  return { ok: true };
}

function uniquePositiveIds(values = []) {
  return [...new Set(values.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0))];
}

async function deriveUserScopesFromDb(userId) {
  const uid = Number(userId);

  const userRes = await queryDb({
    query: `
      SELECT TOP 1
        u.Id,
        u.SubscriptionId,
        u.InformationForTeamId
      FROM dbo.[User] u
      WHERE u.Id = @userId
        AND u.Deleted = 0
    `,
    bind: { userId: uid },
  });

  const user = userRes.recordset[0];
  if (!user) {
    throw new Error("Kullanici bulunamadi.");
  }

  const subscriptionId = user.SubscriptionId ? Number(user.SubscriptionId) : null;
  const allowedSubscriptionIds = subscriptionId ? [subscriptionId] : [];

  const teamsRes = await queryDb({
    query: `
      SELECT DISTINCT TeamId AS id
      FROM (
        SELECT ut.TeamId
        FROM dbo.UserTeam ut
        INNER JOIN dbo.Team t ON t.Id = ut.TeamId AND t.Deleted = 0
        WHERE ut.UserId = @userId AND ut.Deleted = 0
        UNION
        SELECT c.TeamId
        FROM dbo.ClientUser cu
        INNER JOIN dbo.Client c ON c.Id = cu.ClientId AND c.Deleted = 0
        WHERE cu.UserId = @userId AND cu.Deleted = 0 AND c.TeamId IS NOT NULL
        UNION
        SELECT @informationForTeamId AS TeamId
        WHERE @informationForTeamId IS NOT NULL
      ) x
      WHERE TeamId IS NOT NULL
    `,
    bind: {
      userId: uid,
      informationForTeamId: user.InformationForTeamId || null,
    },
  });
  const allowedTeamIds = uniquePositiveIds(teamsRes.recordset.map((r) => r.id));

  const brandsRes = await queryDb({
    query: `
      SELECT DISTINCT BrandId AS id
      FROM (
        SELECT ub.BrandId
        FROM dbo.UserBrand ub
        WHERE ub.UserId = @userId AND ub.Deleted = 0
        UNION
        SELECT v.BrandId
        FROM dbo.Visit v
        WHERE v.UserId = @userId AND v.Deleted = 0 AND v.BrandId IS NOT NULL
      ) x
      WHERE BrandId IS NOT NULL
    `,
    bind: { userId: uid },
  });
  const allowedBrandIds = uniquePositiveIds(brandsRes.recordset.map((r) => r.id));

  const countriesRes = await queryDb({
    query: `
      SELECT DISTINCT CountryId AS id
      FROM (
        SELECT c.CountryId
        FROM dbo.ClientUser cu
        INNER JOIN dbo.Client c ON c.Id = cu.ClientId AND c.Deleted = 0
        WHERE cu.UserId = @userId AND cu.Deleted = 0 AND c.CountryId IS NOT NULL
        UNION
        SELECT c.CountryId
        FROM dbo.Visit v
        INNER JOIN dbo.Client c ON c.Id = v.ClientId AND c.Deleted = 0
        WHERE v.UserId = @userId AND v.Deleted = 0 AND c.CountryId IS NOT NULL
        UNION
        SELECT c.CountryId
        FROM dbo.UserTeam ut
        INNER JOIN dbo.Client c ON c.TeamId = ut.TeamId AND c.Deleted = 0
        WHERE ut.UserId = @userId AND ut.Deleted = 0 AND c.CountryId IS NOT NULL
      ) x
      WHERE CountryId IS NOT NULL
    `,
    bind: {
      userId: uid,
    },
  });
  let allowedCountryIds = uniquePositiveIds(countriesRes.recordset.map((r) => r.id));

  if (!allowedCountryIds.length && subscriptionId) {
    const subCountriesRes = await queryDb({
      query: `
        SELECT DISTINCT c.CountryId AS id
        FROM dbo.Client c
        WHERE c.SubscriptionId = @subscriptionId
          AND c.Deleted = 0
          AND c.CountryId IS NOT NULL
      `,
      bind: { subscriptionId },
    });
    allowedCountryIds = uniquePositiveIds(subCountriesRes.recordset.map((r) => r.id));
  }

  return {
    allowedSubscriptionIds: allowedSubscriptionIds.length ? allowedSubscriptionIds : null,
    allowedCountryIds: allowedCountryIds.length ? allowedCountryIds : null,
    allowedTeamIds: allowedTeamIds.length ? allowedTeamIds : null,
    allowedBrandIds: allowedBrandIds.length ? allowedBrandIds : null,
  };
}

async function resolveDerivedScopeLabels(scopes) {
  const labels = {
    companies: [],
    countries: [],
    teams: [],
    brands: [],
  };

  const subIds = scopes.allowedSubscriptionIds || [];
  if (subIds.length) {
    const inList = subIds.join(",");
    const result = await queryDb({
      query: `
        SELECT Id AS id, CompanyName AS label
        FROM dbo.Subscription
        WHERE Deleted = 0 AND Id IN (${inList})
        ORDER BY CompanyName
      `,
      bind: {},
    });
    labels.companies = result.recordset;
  }

  const countryIds = scopes.allowedCountryIds || [];
  if (countryIds.length) {
    const inList = countryIds.join(",");
    const result = await queryDb({
      query: `
        SELECT Id AS id, Name AS label
        FROM dbo.Country
        WHERE Deleted = 0 AND Id IN (${inList})
        ORDER BY Name
      `,
      bind: {},
    });
    labels.countries = result.recordset;
  }

  const teamIds = scopes.allowedTeamIds || [];
  if (teamIds.length) {
    const inList = teamIds.join(",");
    const result = await queryDb({
      query: `
        SELECT Id AS id, Name AS label
        FROM dbo.Team
        WHERE Deleted = 0 AND Id IN (${inList})
        ORDER BY Name
      `,
      bind: {},
    });
    labels.teams = result.recordset;
  }

  const brandIds = scopes.allowedBrandIds || [];
  if (brandIds.length) {
    const inList = brandIds.join(",");
    const result = await queryDb({
      query: `
        SELECT Id AS id, Name AS label
        FROM dbo.Brand
        WHERE Deleted = 0 AND Id IN (${inList})
        ORDER BY Name
      `,
      bind: {},
    });
    labels.brands = result.recordset;
  }

  return labels;
}

async function getUserDerivedScopes(userId) {
  const scopes = await deriveUserScopesFromDb(userId);
  const labels = await resolveDerivedScopeLabels(scopes);

  return {
    ...scopes,
    labels,
    source: "database",
  };
}

async function getUserScopes(userId) {
  const result = await queryDb({
    query: `
      SELECT ScopeType, ScopeValue
      FROM dbo.AiUserScope
      WHERE Deleted = 0
        AND UserId = @userId
    `,
    bind: { userId: Number(userId) },
  });

  const scopes = {
    allowedSubscriptionIds: null,
    allowedCompanyIds: null,
    allowedBrandIds: null,
    allowedCountryIds: null,
    allowedTeamIds: null,
  };

  for (const row of result.recordset) {
    const key = row.ScopeType;
    const value = Number(row.ScopeValue);

    if (key === "subscription" || key === "company") {
      scopes.allowedSubscriptionIds ||= [];
      scopes.allowedCompanyIds ||= [];
      scopes.allowedSubscriptionIds.push(value);
      scopes.allowedCompanyIds.push(value);
    }

    if (key === "brand") {
      scopes.allowedBrandIds ||= [];
      scopes.allowedBrandIds.push(value);
    }

    if (key === "country") {
      scopes.allowedCountryIds ||= [];
      scopes.allowedCountryIds.push(value);
    }

    if (key === "team") {
      scopes.allowedTeamIds ||= [];
      scopes.allowedTeamIds.push(value);
    }
  }

  return scopes;
}

async function saveUserScopes(userId, scopes = {}, actorUserId = "system") {
  const beforeScopes = await getUserScopes(userId).catch(() => ({}));

  await queryDb({
    query: `
      UPDATE dbo.AiUserScope
      SET Deleted = 1, UpdateTime = GETDATE(), UpdatedBy = @actorUserId
      WHERE UserId = @userId AND Deleted = 0
    `,
    bind: {
      userId: Number(userId),
      actorUserId: String(actorUserId),
    },
  });

  const items = [
    ["subscription", scopes.allowedSubscriptionIds || scopes.allowedCompanyIds],
    ["brand", scopes.allowedBrandIds],
    ["country", scopes.allowedCountryIds],
    ["team", scopes.allowedTeamIds],
  ];

  for (const [scopeType, values] of items) {
    for (const value of values || []) {
      await queryDb({
        query: `
          INSERT INTO dbo.AiUserScope
          (UserId, ScopeType, ScopeValue, UpdatedBy)
          VALUES
          (@userId, @scopeType, @scopeValue, @actorUserId)
        `,
        bind: {
          userId: Number(userId),
          scopeType,
          scopeValue: String(value),
          actorUserId: String(actorUserId),
        },
      });
    }
  }

  await writeAuditLog({
    actorUserId,
    action: "user.scopes.update",
    targetType: "user",
    targetId: userId,
    before: beforeScopes,
    after: scopes,
  });

  return { ok: true };
}

async function getEffectivePermissions(userId) {
  const context = await buildUserContext(userId);
  const roleIds = context.roleIds || [];

  let isSuperAdmin = !!context.flags?.admin;
  const allowedIntentSet = new Set();

  for (const roleId of roleIds) {
    const perms = await getRolePermissions(roleId).catch(() => ({ allowedIntents: [] }));
    for (const intent of perms.allowedIntents) {
      if (intent === "*") isSuperAdmin = true;
      allowedIntentSet.add(intent);
    }
  }

  const userPerms = await getUserPermissions(userId);
  for (const intent of userPerms.allowedIntents) {
    if (intent === "*") isSuperAdmin = true;
    allowedIntentSet.add(intent);
  }

  const allowedMetricSet = new Set();
  const allowedTableSet = new Set();

  for (const intent of allowedIntentSet) {
    if (intent === "*") continue;

    const metric = getMetricByIntent(intent);
    if (!metric) continue;

    if (metric.metric_id) {
      allowedMetricSet.add(metric.metric_id);
    }

    for (const table of metric.source_tables || []) {
      allowedTableSet.add(table);
    }
  }

  const customScopes = await getUserScopes(userId).catch(() => ({}));
  const hasCustomScopes =
    (customScopes.allowedSubscriptionIds || []).length > 0 ||
    (customScopes.allowedCountryIds || []).length > 0 ||
    (customScopes.allowedTeamIds || []).length > 0 ||
    (customScopes.allowedBrandIds || []).length > 0;

  const effectiveScopes = hasCustomScopes
    ? customScopes
    : await deriveUserScopesFromDb(userId).catch(() => customScopes);

  return {
    userId: Number(userId),
    subscriptionId: context.subscriptionId,
    tenantId: context.tenantId,

    roleIds,
    roles: context.roles || [],

    isSuperAdmin,
    isAdmin: isSuperAdmin,
    isClientUser: context.isClientUser,
    manageAll: context.manageAll,

    allowedIntents: isSuperAdmin ? ["*"] : [...allowedIntentSet].filter((x) => x !== "*"),
    directAllowedIntents: userPerms.allowedIntents || [],
    allowedMetrics: isSuperAdmin ? ["*"] : [...allowedMetricSet],
    allowedTables: isSuperAdmin ? ["*"] : [...allowedTableSet],

    allowedColumns: context.allowedColumns || [],
    maskedColumns: context.maskedColumns || [],
    blockedColumns: context.blockedColumns || [],

    allowedUserIds: context.allowedUserIds || [Number(userId)],
    assignedClientIds: context.assignedClientIds || [],
    effectiveClientIds: context.effectiveClientIds ?? [],

    clientTagIds: context.clientTagIds || [],
    managedTeamIds: context.managedTeamIds || [],

    allowedCompanyIds:
      effectiveScopes.allowedSubscriptionIds ?? context.allowedCompanyIds ?? [],
    allowedSubscriptionIds:
      effectiveScopes.allowedSubscriptionIds ?? context.allowedSubscriptionIds ?? [],

    allowedBrandIds: effectiveScopes.allowedBrandIds ?? context.allowedBrandIds ?? [],
    allowedTeamIds: effectiveScopes.allowedTeamIds ?? [],
    allowedCountryIds: effectiveScopes.allowedCountryIds ?? context.allowedCountryIds ?? [],

    allowedDistributorIds: context.allowedDistributorIds || [],
    allowedClientGroupIds: context.allowedClientGroupIds || [],

    allowedDynamicFieldIds: context.allowedDynamicFieldIds || [],
    blockedDynamicFieldIds: context.blockedDynamicFieldIds || [],
    maskedDynamicFieldIds: context.maskedDynamicFieldIds || [],

    allowedFinancialMetrics: isSuperAdmin ? ["*"] : context.allowedFinancialMetrics || [],
  };
}

async function getAuditLogs(limit = 50) {
  const max = Number(limit) || 50;

  if (!(await hasAuditTable())) {
    return {
      items: listFileLogs(max).map((row) => ({
        ...row,
        summary: row.summary || buildAuditSummary(row.action, row.afterJson),
      })),
    };
  }

  let dbItems = [];

  try {
    const result = await queryDb({
      query: `
        SELECT TOP (@limit)
          Id AS id,
          CreateTime AS createdAt,
          ActorUserId AS actorUserId,
          Action AS action,
          TargetType AS targetType,
          TargetId AS targetId,
          BeforeJson AS beforeJson,
          AfterJson AS afterJson
        FROM dbo.AiAuditLog
        WHERE Deleted = 0
        ORDER BY CreateTime DESC
      `,
      bind: { limit: max },
    });

    dbItems = result.recordset.map((row) => ({
      ...row,
      summary: buildAuditSummary(row.action, row.afterJson),
      source: "db",
    }));
  } catch (_err) {
    dbItems = [];
  }

  if (dbItems.length) {
    return { items: dbItems };
  }

  return {
    items: listFileLogs(max).map((row) => ({
      ...row,
      summary: row.summary || buildAuditSummary(row.action, row.afterJson),
    })),
  };
}

module.exports = {
  getCatalog,
  getSubscriptions,
  getCountries,
  getRegions,
  getCities,
  getDistricts,
  getBrands,
  getTeams,
  getClients,
  getUsers,
  getRoles,
  getRolePermissions,
  saveRolePermissions,
  getUserRoles,
  saveUserRoles,
  getUserPermissions,
  saveUserPermissions,
  getUserScopes,
  getUserDerivedScopes,
  deriveUserScopesFromDb,
  saveUserScopes,
  getEffectivePermissions,
  getAuditLogs,
};
