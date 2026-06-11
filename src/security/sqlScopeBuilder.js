/**
 * Template SQL'e kullanici/tenant scope filtreleri ekler.
 * Hiyerarsi birincil: allowedUserIds + SubscriptionId.
 * Team checkbox (allowedTeamIds) SQL'de kullanilmaz.
 */

function isNonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function unique(values = []) {
  return Array.from(new Set(values.filter((x) => x !== null && x !== undefined)));
}

function buildInList(values = [], bindPrefix, bind = {}) {
  const parts = [];
  values.forEach((value, index) => {
    const key = `${bindPrefix}${index}`;
    bind[key] = value;
    parts.push(`@${key}`);
  });
  return { sql: parts.join(", "), bind };
}

function getSubscriptionIds(userContext = {}) {
  if (isNonEmptyArray(userContext.allowedSubscriptionIds)) {
    return userContext.allowedSubscriptionIds;
  }
  if (isNonEmptyArray(userContext.allowedCompanyIds)) {
    return userContext.allowedCompanyIds;
  }
  if (typeof userContext.subscriptionId === "number") {
    return [userContext.subscriptionId];
  }
  return [];
}

function canBypassAllScope(_userContext = {}) {
  // Intent admin (isSuperAdmin) must not disable tenant SQL scope.
  // Subscription + user boundaries come from hierarchy fields only.
  return false;
}

function shouldBypassHierarchyUserFilter(userContext = {}) {
  return (
    userContext.hierarchyBypassUserFilter === true ||
    Number(userContext.hierarchyLevel) >= 4
  );
}

function canBypassUserScope(userContext = {}) {
  return shouldBypassHierarchyUserFilter(userContext);
}

function getAllowedUserIds(userContext = {}) {
  if (isNonEmptyArray(userContext.allowedUserIds)) {
    return userContext.allowedUserIds.filter((x) => x != null);
  }
  if (typeof userContext.userId === "number") {
    return [userContext.userId];
  }
  return [];
}

const TABLE_ALIAS_STOP_WORDS = new Set([
  "WHERE",
  "INNER",
  "LEFT",
  "RIGHT",
  "OUTER",
  "JOIN",
  "GROUP",
  "ORDER",
  "HAVING",
  "UNION",
  "CROSS",
  "ON",
  "SET",
]);

function normalizeTableAlias(alias) {
  if (!alias) {
    return null;
  }

  if (TABLE_ALIAS_STOP_WORDS.has(String(alias).toUpperCase())) {
    return null;
  }

  return alias;
}

function detectVisitAlias(query = "") {
  const match = String(query).match(/FROM\s+dbo\.Visit\s+(\w+)/i);
  return normalizeTableAlias(match?.[1]) || "v";
}

function detectTableAlias(query = "", tablePattern = /FROM\s+dbo\.Client(?:\s+(\w+))?/i) {
  const match = String(query).match(tablePattern);
  if (!match) {
    return null;
  }

  return normalizeTableAlias(match[1]);
}

function tableRef(tableName, alias) {
  return alias || tableName;
}

function buildVisitScopeClauses(userContext = {}, visitAlias = "v") {
  if (canBypassAllScope(userContext)) {
    return { clauses: [], bind: {}, skipped: "super_admin", notes: [] };
  }

  const clauses = [];
  const bind = {};
  const alias = visitAlias;

  const subscriptionIds = getSubscriptionIds(userContext);
  if (subscriptionIds.length) {
    const subIn = buildInList(subscriptionIds, "scopeSub", bind);
    clauses.push(`${alias}.SubscriptionId IN (${subIn.sql})`);
  }

  if (!canBypassUserScope(userContext)) {
    const userIds = getAllowedUserIds(userContext);
    const userIn = buildInList(userIds, "scopeUser", bind);
    if (userIn.sql) {
      clauses.push(`${alias}.UserId IN (${userIn.sql})`);
    }
  }

  if (isNonEmptyArray(userContext.allowedCountryIds)) {
    const countryIn = buildInList(userContext.allowedCountryIds, "scopeCountry", bind);
    clauses.push(`
      EXISTS (
        SELECT 1
        FROM dbo.Client c_scope
        WHERE c_scope.Id = ${alias}.ClientId
          AND c_scope.Deleted = 0
          AND c_scope.CountryId IN (${countryIn.sql})
      )`);
  }

  if (isNonEmptyArray(userContext.allowedBrandIds)) {
    const brandIn = buildInList(userContext.allowedBrandIds, "scopeBrand", bind);
    clauses.push(`
      (
        ${alias}.BrandId IN (${brandIn.sql})
        OR EXISTS (
          SELECT 1
          FROM dbo.ClientBrand cb_scope
          WHERE cb_scope.ClientId = ${alias}.ClientId
            AND cb_scope.Deleted = 0
            AND cb_scope.BrandId IN (${brandIn.sql})
        )
      )`);
  }

  return { clauses, bind, skipped: null, notes: [] };
}

function buildClientScopeClauses(userContext = {}, query = "") {
  if (canBypassAllScope(userContext)) {
    return { clauses: [], bind: {}, skipped: "super_admin", notes: [] };
  }

  if (!/FROM\s+dbo\.Client\b/i.test(String(query))) {
    return { clauses: [], bind: {}, skipped: null, notes: [] };
  }

  const alias = detectTableAlias(query, /FROM\s+dbo\.Client(?:\s+(\w+))?/i);
  const ref = tableRef("dbo.Client", alias);
  const clauses = [];
  const bind = {};

  const subscriptionIds = getSubscriptionIds(userContext);
  if (subscriptionIds.length) {
    const subIn = buildInList(subscriptionIds, "scopeSub", bind);
    clauses.push(`${ref}.SubscriptionId IN (${subIn.sql})`);
  }

  if (!canBypassUserScope(userContext)) {
    const userIds = getAllowedUserIds(userContext);
    const userIn = buildInList(userIds, "scopeUser", bind);
    const teamIds = unique([
      ...(userContext.managedTeamIds || []),
      ...(userContext.teamIds || []),
    ]);
    const teamIn = teamIds.length ? buildInList(teamIds, "scopeTeam", bind) : null;
    const accessParts = [];

    if (userIn.sql) {
      accessParts.push(`
        EXISTS (
          SELECT 1
          FROM dbo.ClientUser cu_scope
          WHERE cu_scope.ClientId = ${ref}.Id
            AND cu_scope.Deleted = 0
            AND cu_scope.UserId IN (${userIn.sql})
        )`);
      accessParts.push(`${ref}.CustomerRepresentativeUserId IN (${userIn.sql})`);
    }

    if (teamIn?.sql) {
      accessParts.push(`${ref}.TeamId IN (${teamIn.sql})`);
    }

    if (accessParts.length) {
      clauses.push(`(${accessParts.join("\n        OR ")})`);
    }
  }

  return { clauses, bind, skipped: null, notes: [] };
}

function buildUserLinkedTableScopeClauses(
  userContext = {},
  query = "",
  tableName = "",
  userIdColumn = "UserId",
  bindPrefix = "scopeUserLink"
) {
  if (canBypassAllScope(userContext)) {
    return { clauses: [], bind: {}, skipped: "super_admin", notes: [] };
  }

  const { found, alias } = detectFromTableAlias(query, tableName);
  if (!found) {
    return { clauses: [], bind: {}, skipped: null, notes: [] };
  }

  const bind = {};
  const ref = tableRef(tableName, alias);
  const clauses = [];
  const subscriptionIds = getSubscriptionIds(userContext);

  if (subscriptionIds.length) {
    const subIn = buildInList(subscriptionIds, `${bindPrefix}Sub`, bind);
    clauses.push(`
      EXISTS (
        SELECT 1
        FROM dbo.[User] u_scope
        WHERE u_scope.Id = ${ref}.${userIdColumn}
          AND u_scope.Deleted = 0
          AND u_scope.SubscriptionId IN (${subIn.sql})
      )`);
  }

  if (!canBypassUserScope(userContext)) {
    const userIds = getAllowedUserIds(userContext);
    const userIn = buildInList(userIds, `${bindPrefix}User`, bind);
    if (userIn.sql) {
      clauses.push(`${ref}.${userIdColumn} IN (${userIn.sql})`);
    }
  }

  return { clauses, bind, skipped: null, notes: [] };
}

function buildUserLoginScopeClauses(userContext = {}, query = "") {
  return buildUserLinkedTableScopeClauses(userContext, query, "dbo.UserLogin", "UserId", "scopeUl");
}

function buildUserTableScopeClauses(userContext = {}, query = "") {
  if (canBypassAllScope(userContext)) {
    return { clauses: [], bind: {}, skipped: "super_admin", notes: [] };
  }

  const alias = detectTableAlias(query, /FROM\s+dbo\.\[User\]\s+(\w+)/i);
  if (!alias) {
    return { clauses: [], bind: {}, skipped: null, notes: [] };
  }

  const clauses = [];
  const bind = {};
  const subscriptionIds = getSubscriptionIds(userContext);

  if (subscriptionIds.length) {
    const subIn = buildInList(subscriptionIds, "scopeSub", bind);
    clauses.push(`${alias}.SubscriptionId IN (${subIn.sql})`);
  }

  if (!canBypassUserScope(userContext)) {
    const userIds = getAllowedUserIds(userContext);
    const userIn = buildInList(userIds, "scopeUser", bind);
    if (userIn.sql) {
      clauses.push(`${alias}.Id IN (${userIn.sql})`);
    }
  }

  return { clauses, bind, skipped: null, notes: [] };
}

function detectFromTableAlias(query = "", tableName = "") {
  const tablePattern = new RegExp(
    `FROM\\s+${escapeRegex(tableName)}(?:\\s+(\\w+))?(?:\\s|$|\\n)`,
    "i"
  );
  const match = String(query).match(tablePattern);
  if (!match) {
    return { found: false, alias: null };
  }

  return {
    found: true,
    alias: normalizeTableAlias(match[1]),
  };
}

function buildVisitScopeExistsClause(visitIdExpr, userContext = {}, bind = {}, bindPrefix = "scopeVisit") {
  const subscriptionIds = getSubscriptionIds(userContext);
  const lines = [
    "EXISTS (",
    "  SELECT 1",
    "  FROM dbo.Visit v_scope",
    `  WHERE v_scope.Id = ${visitIdExpr}`,
    "    AND v_scope.Deleted = 0",
  ];

  if (subscriptionIds.length) {
    const subIn = buildInList(subscriptionIds, `${bindPrefix}Sub`, bind);
    lines.push(`    AND v_scope.SubscriptionId IN (${subIn.sql})`);
  }

  if (!canBypassUserScope(userContext)) {
    const userIds = getAllowedUserIds(userContext);
    const userIn = buildInList(userIds, `${bindPrefix}User`, bind);
    if (userIn.sql) {
      lines.push(`    AND v_scope.UserId IN (${userIn.sql})`);
    }
  }

  lines.push(")");
  return lines.join("\n");
}

function buildClientPurchaseOrderScopeExistsClause(
  clientPurchaseOrderIdExpr,
  userContext = {},
  bind = {},
  bindPrefix = "scopeClientPurchaseOrder"
) {
  const subscriptionIds = getSubscriptionIds(userContext);
  const lines = [
    "EXISTS (",
    "  SELECT 1",
    "  FROM dbo.ClientPurchaseOrder cpo_scope",
    `  WHERE cpo_scope.Id = ${clientPurchaseOrderIdExpr}`,
    "    AND cpo_scope.Deleted = 0",
  ];

  if (subscriptionIds.length) {
    const subIn = buildInList(subscriptionIds, `${bindPrefix}Sub`, bind);
    lines.push(`    AND cpo_scope.SubscriptionId IN (${subIn.sql})`);
  }

  if (!canBypassUserScope(userContext)) {
    const userIds = getAllowedUserIds(userContext);
    const userIn = buildInList(userIds, `${bindPrefix}User`, bind);
    if (userIn.sql) {
      lines.push(`    AND cpo_scope.UserId IN (${userIn.sql})`);
    }
  }

  lines.push(")");
  return lines.join("\n");
}

function buildPurchaseOrderScopeExistsClause(
  purchaseOrderRef,
  userContext = {},
  bind = {},
  bindPrefix = "scopePurchaseOrder"
) {
  const visitScopeClause = buildVisitScopeExistsClause(
    `${purchaseOrderRef}.VisitId`,
    userContext,
    bind,
    `${bindPrefix}Visit`
  );

  const clientPurchaseOrderScopeClause =
    buildClientPurchaseOrderScopeExistsClause(
      `${purchaseOrderRef}.ClientPurchaseOrderId`,
      userContext,
      bind,
      `${bindPrefix}Client`
    );

  return `(
${visitScopeClause}
OR
${clientPurchaseOrderScopeClause}
)`;
}

function buildPurchaseOrderTableScopeClauses(
  userContext = {},
  query = "",
  tableName = "dbo.PurchaseOrder"
) {
  if (canBypassAllScope(userContext)) {
    return { clauses: [], bind: {}, skipped: "super_admin", notes: [] };
  }

  const { found, alias } = detectFromTableAlias(query, tableName);
  if (!found) {
    return { clauses: [], bind: {}, skipped: null, notes: [] };
  }

  const bind = {};
  const ref = tableRef(tableName, alias);
  const clause = buildPurchaseOrderScopeExistsClause(
    ref,
    userContext,
    bind,
    "scopePurchaseOrder"
  );

  return { clauses: [clause], bind, skipped: null, notes: [] };
}

function buildClientInvoiceScopeExistsClause(
  clientInvoiceIdExpr,
  userContext = {},
  bind = {},
  bindPrefix = "scopeClientInvoice"
) {
  const subscriptionIds = getSubscriptionIds(userContext);
  const lines = [
    "EXISTS (",
    "  SELECT 1",
    "  FROM dbo.ClientInvoice ci_scope",
    "  INNER JOIN dbo.Client c_scope",
    "    ON c_scope.Id = ci_scope.ClientId",
    "   AND c_scope.Deleted = 0",
    `  WHERE ci_scope.Id = ${clientInvoiceIdExpr}`,
    "    AND ci_scope.Deleted = 0",
  ];

  if (subscriptionIds.length) {
    const subIn = buildInList(subscriptionIds, `${bindPrefix}Sub`, bind);
    lines.push(`    AND c_scope.SubscriptionId IN (${subIn.sql})`);
  }

  if (!canBypassUserScope(userContext)) {
    const userIds = getAllowedUserIds(userContext);
    const userIn = buildInList(userIds, `${bindPrefix}User`, bind);
    if (userIn.sql) {
      lines.push(`    AND ci_scope.UserId IN (${userIn.sql})`);
    }
  }

  lines.push(")");
  return lines.join("\n");
}

function buildInvoiceScopeExistsClause(
  invoiceRef,
  userContext = {},
  bind = {},
  bindPrefix = "scopeInvoice"
) {
  const visitScopeClause = buildVisitScopeExistsClause(
    `${invoiceRef}.VisitId`,
    userContext,
    bind,
    `${bindPrefix}Visit`
  );

  const clientInvoiceScopeClause = buildClientInvoiceScopeExistsClause(
    `${invoiceRef}.ClientInvoiceId`,
    userContext,
    bind,
    `${bindPrefix}ClientInvoice`
  );

  return `(
${visitScopeClause}
OR
${clientInvoiceScopeClause}
)`;
}

function buildVisitLinkedTableScopeClauses(
  userContext = {},
  query = "",
  tableName = "",
  visitIdColumn = "VisitId"
) {
  if (canBypassAllScope(userContext)) {
    return { clauses: [], bind: {}, skipped: "super_admin", notes: [] };
  }

  const { found, alias } = detectFromTableAlias(query, tableName);
  if (!found) {
    return { clauses: [], bind: {}, skipped: null, notes: [] };
  }

  const bind = {};
  const ref = tableRef(tableName, alias);
  const clause = buildVisitScopeExistsClause(
    `${ref}.${visitIdColumn}`,
    userContext,
    bind,
    "scopeVisit"
  );

  return { clauses: [clause], bind, skipped: null, notes: [] };
}

function buildInvoiceTableScopeClauses(
  userContext = {},
  query = "",
  tableName = "dbo.Invoice"
) {
  if (canBypassAllScope(userContext)) {
    return { clauses: [], bind: {}, skipped: "super_admin", notes: [] };
  }

  const { found, alias } = detectFromTableAlias(query, tableName);
  if (!found) {
    return { clauses: [], bind: {}, skipped: null, notes: [] };
  }

  const bind = {};
  const ref = tableRef(tableName, alias);
  const clause = buildInvoiceScopeExistsClause(
    ref,
    userContext,
    bind,
    "scopeInvoice"
  );

  return { clauses: [clause], bind, skipped: null, notes: [] };
}

function buildPurchaseOrderChildScopeClauses(
  userContext = {},
  query = "",
  childTableName = "",
  foreignKeyColumn = "PurchaseOrderId"
) {
  if (canBypassAllScope(userContext)) {
    return { clauses: [], bind: {}, skipped: "super_admin", notes: [] };
  }

  const { found, alias } = detectFromTableAlias(query, childTableName);
  if (!found) {
    return { clauses: [], bind: {}, skipped: null, notes: [] };
  }

  const bind = {};
  const ref = tableRef(childTableName, alias);
  const purchaseOrderScopeClause = buildPurchaseOrderScopeExistsClause(
    "po_scope",
    userContext,
    bind,
    "scopePo"
  );
  const lines = [
    "EXISTS (",
    "  SELECT 1",
    "  FROM dbo.PurchaseOrder po_scope",
    `  WHERE po_scope.Id = ${ref}.${foreignKeyColumn}`,
    "    AND po_scope.Deleted = 0",
    `    AND ${purchaseOrderScopeClause.replace(/\n/g, "\n    ")}`,
    ")",
  ];

  return { clauses: [lines.join("\n")], bind, skipped: null, notes: [] };
}

function buildInvoiceChildScopeClauses(
  userContext = {},
  query = "",
  childTableName = "",
  foreignKeyColumn = "InvoiceId"
) {
  if (canBypassAllScope(userContext)) {
    return { clauses: [], bind: {}, skipped: "super_admin", notes: [] };
  }

  const { found, alias } = detectFromTableAlias(query, childTableName);
  if (!found) {
    return { clauses: [], bind: {}, skipped: null, notes: [] };
  }

  const bind = {};
  const ref = tableRef(childTableName, alias);
  const invoiceScopeClause = buildInvoiceScopeExistsClause(
    "i_scope",
    userContext,
    bind,
    "scopeInv"
  );

  const lines = [
    "EXISTS (",
    "  SELECT 1",
    "  FROM dbo.Invoice i_scope",
    `  WHERE i_scope.Id = ${ref}.${foreignKeyColumn}`,
    "    AND i_scope.Deleted = 0",
    `    AND ${invoiceScopeClause.replace(/\n/g, "\n    ")}`,
    ")",
  ];

  return { clauses: [lines.join("\n")], bind, skipped: null, notes: [] };
}

function buildSubscriptionScopedClauses(
  userContext = {},
  query = "",
  tableName = "",
  userColumn = null
) {
  if (canBypassAllScope(userContext)) {
    return { clauses: [], bind: {}, skipped: "super_admin", notes: [] };
  }

  const { found, alias } = detectFromTableAlias(query, tableName);
  if (!found) {
    return { clauses: [], bind: {}, skipped: null, notes: [] };
  }

  const bind = {};
  const ref = tableRef(tableName, alias);
  const clauses = [];
  const subscriptionIds = getSubscriptionIds(userContext);

  if (subscriptionIds.length) {
    const subIn = buildInList(subscriptionIds, "scopeSub", bind);
    clauses.push(`${ref}.SubscriptionId IN (${subIn.sql})`);
  }

  if (userColumn && !canBypassUserScope(userContext)) {
    const userIds = getAllowedUserIds(userContext);
    const userIn = buildInList(userIds, "scopeUser", bind);
    if (userIn.sql) {
      clauses.push(`${ref}.${userColumn} IN (${userIn.sql})`);
    }
  }

  return { clauses, bind, skipped: null, notes: [] };
}

function buildCampaignProductScopeClauses(userContext = {}, query = "") {
  if (canBypassAllScope(userContext)) {
    return { clauses: [], bind: {}, skipped: "super_admin", notes: [] };
  }

  const { found, alias } = detectFromTableAlias(query, "dbo.CampaignProduct");
  if (!found) {
    return { clauses: [], bind: {}, skipped: null, notes: [] };
  }

  const bind = {};
  const ref = tableRef("dbo.CampaignProduct", alias);
  const subscriptionIds = getSubscriptionIds(userContext);
  const lines = [
    "EXISTS (",
    "  SELECT 1",
    "  FROM dbo.Campaign c_scope",
    `  WHERE c_scope.Id = ${ref}.CampaignId`,
    "    AND c_scope.Deleted = 0",
  ];

  if (subscriptionIds.length) {
    const subIn = buildInList(subscriptionIds, "scopeCampSub", bind);
    lines.push(`    AND c_scope.SubscriptionId IN (${subIn.sql})`);
  }

  lines.push(")");
  return { clauses: [lines.join("\n")], bind, skipped: null, notes: [] };
}

function buildClientLinkedTableScopeClauses(
  userContext = {},
  query = "",
  tableName = "",
  clientIdColumn = "ClientId"
) {
  if (canBypassAllScope(userContext)) {
    return { clauses: [], bind: {}, skipped: "super_admin", notes: [] };
  }

  const { found, alias } = detectFromTableAlias(query, tableName);
  if (!found) {
    return { clauses: [], bind: {}, skipped: null, notes: [] };
  }

  const bind = {};
  const ref = tableRef(tableName, alias);
  const subscriptionIds = getSubscriptionIds(userContext);
  const lines = [
    "EXISTS (",
    "  SELECT 1",
    "  FROM dbo.Client c_scope",
    `  WHERE c_scope.Id = ${ref}.${clientIdColumn}`,
    "    AND c_scope.Deleted = 0",
  ];

  if (subscriptionIds.length) {
    const subIn = buildInList(subscriptionIds, "scopeCliSub", bind);
    lines.push(`    AND c_scope.SubscriptionId IN (${subIn.sql})`);
  }

  if (!canBypassUserScope(userContext)) {
    const userIds = getAllowedUserIds(userContext);
    const userIn = buildInList(userIds, "scopeCliUser", bind);
    const teamIds = unique([
      ...(userContext.managedTeamIds || []),
      ...(userContext.teamIds || []),
    ]);
    const teamIn = teamIds.length ? buildInList(teamIds, "scopeCliTeam", bind) : null;
    const accessParts = [];

    if (userIn.sql) {
      accessParts.push(`
        EXISTS (
          SELECT 1
          FROM dbo.ClientUser cu_scope
          WHERE cu_scope.ClientId = c_scope.Id
            AND cu_scope.UserId IN (${userIn.sql})
        )`);
      accessParts.push(`c_scope.CustomerRepresentativeUserId IN (${userIn.sql})`);
    }

    if (teamIn?.sql) {
      accessParts.push(`c_scope.TeamId IN (${teamIn.sql})`);
    }

    if (accessParts.length) {
      lines.push(`    AND (${accessParts.join("\n      OR ")})`);
    }
  }

  lines.push(")");
  return { clauses: [lines.join("\n")], bind, skipped: null, notes: [] };
}

const TABLE_SCOPE_ROUTES = [
  { table: "dbo.PurchaseOrder", builder: (ctx, q) => buildPurchaseOrderTableScopeClauses(ctx, q, "dbo.PurchaseOrder") },
  { table: "dbo.Invoice", builder: (ctx, q) => buildInvoiceTableScopeClauses(ctx, q, "dbo.Invoice") },
  {
    table: "dbo.PurchaseOrderDetail",
    builder: (ctx, q) => buildPurchaseOrderChildScopeClauses(ctx, q, "dbo.PurchaseOrderDetail"),
  },
  {
    table: "dbo.PurchaseOrderTracker",
    builder: (ctx, q) => buildPurchaseOrderChildScopeClauses(ctx, q, "dbo.PurchaseOrderTracker"),
  },
  {
    table: "dbo.IyzicoPaymentTransaction",
    builder: (ctx, q) => buildPurchaseOrderChildScopeClauses(ctx, q, "dbo.IyzicoPaymentTransaction"),
  },
  {
    table: "dbo.InvoiceDetail",
    builder: (ctx, q) => buildInvoiceChildScopeClauses(ctx, q, "dbo.InvoiceDetail"),
  },
  {
    table: "dbo.InvoicePayment",
    builder: (ctx, q) => buildInvoiceChildScopeClauses(ctx, q, "dbo.InvoicePayment"),
  },
  {
    table: "dbo.Commission",
    builder: (ctx, q) => buildInvoiceChildScopeClauses(ctx, q, "dbo.Commission"),
  },
  {
    table: "dbo.Campaign",
    builder: (ctx, q) => buildSubscriptionScopedClauses(ctx, q, "dbo.Campaign", "UserId"),
  },
  {
    table: "dbo.Payment",
    builder: (ctx, q) => buildSubscriptionScopedClauses(ctx, q, "dbo.Payment", "UserId"),
  },
  {
    table: "dbo.Cost",
    builder: (ctx, q) => buildSubscriptionScopedClauses(ctx, q, "dbo.Cost"),
  },
  {
    table: "dbo.BipPromotion",
    builder: (ctx, q) => buildSubscriptionScopedClauses(ctx, q, "dbo.BipPromotion"),
  },
  {
    table: "dbo.CampaignProduct",
    builder: (ctx, q) => buildCampaignProductScopeClauses(ctx, q),
  },
  {
    table: "dbo.ClientProductPrice",
    builder: (ctx, q) => buildClientLinkedTableScopeClauses(ctx, q, "dbo.ClientProductPrice"),
  },
  {
    table: "dbo.ClientDataChange",
    builder: (ctx, q) => buildSubscriptionScopedClauses(ctx, q, "dbo.ClientDataChange"),
  },
  {
    table: "dbo.ClientInfoUpdate",
    builder: (ctx, q) => buildSubscriptionScopedClauses(ctx, q, "dbo.ClientInfoUpdate"),
  },
  {
    table: "dbo.ClientFile",
    builder: (ctx, q) => buildClientLinkedTableScopeClauses(ctx, q, "dbo.ClientFile"),
  },
  {
    table: "dbo.Consumer",
    builder: (ctx, q) => buildSubscriptionScopedClauses(ctx, q, "dbo.Consumer"),
  },
  {
    table: "dbo.RniDevice",
    builder: (ctx, q) => buildSubscriptionScopedClauses(ctx, q, "dbo.RniDevice"),
  },
  {
    table: "dbo.Distributor",
    builder: (ctx, q) => buildSubscriptionScopedClauses(ctx, q, "dbo.Distributor"),
  },
  {
    table: "dbo.UserLogin",
    builder: (ctx, q) => buildUserLoginScopeClauses(ctx, q),
  },
  {
    table: "dbo.UserDevice",
    builder: (ctx, q) => buildUserLinkedTableScopeClauses(ctx, q, "dbo.UserDevice", "UserId", "scopeUd"),
  },
  {
    table: "dbo.UserSavedView",
    builder: (ctx, q) => buildUserLinkedTableScopeClauses(ctx, q, "dbo.UserSavedView", "UserId", "scopeUsv"),
  },
  {
    table: "dbo.UserStepHistory",
    builder: (ctx, q) => buildUserLinkedTableScopeClauses(ctx, q, "dbo.UserStepHistory", "UserId", "scopeUsh"),
  },
];

const USER_LINKED_SCOPE_TABLES = [
  { table: "dbo.UserLogin", column: "UserId", prefix: "scopeUl" },
  { table: "dbo.UserDevice", column: "UserId", prefix: "scopeUd" },
  { table: "dbo.UserSavedView", column: "UserId", prefix: "scopeUsv" },
  { table: "dbo.UserStepHistory", column: "UserId", prefix: "scopeUsh" },
];

function escapeRegex(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function appendClausesToQuery(query, clauses = []) {
  if (!clauses.length) {
    return query;
  }

  const trimmed = String(query).trim().replace(/;\s*$/, "");
  const fragment = clauses.map((clause) => `AND (${clause.trim()})`).join("\n        ");

  const boundaryMatch = trimmed.match(/\b(GROUP\s+BY|ORDER\s+BY|HAVING|UNION)\b/i);
  if (boundaryMatch && typeof boundaryMatch.index === "number") {
    const index = boundaryMatch.index;
    return `${trimmed.slice(0, index).trimEnd()}\n        ${fragment}\n${trimmed.slice(index)};`;
  }

  return `${trimmed}\n        ${fragment};`;
}

function pickScopeBuilder(sourceTables = [], query = "") {
  const sql = String(query);

  if (sourceTables.includes("dbo.Visit") && /FROM\s+dbo\.Visit\b/i.test(sql)) {
    return (userContext) => buildVisitScopeClauses(userContext, detectVisitAlias(sql));
  }

  for (const entry of USER_LINKED_SCOPE_TABLES) {
    if (
      sourceTables.includes(entry.table) &&
      new RegExp(`FROM\\s+${escapeRegex(entry.table)}\\b`, "i").test(sql)
    ) {
      return (userContext) =>
        buildUserLinkedTableScopeClauses(userContext, sql, entry.table, entry.column, entry.prefix);
    }
  }

  // User-rooted queries (usersByClient, usersByRole, ...) must scope on dbo.[User],
  // even when dbo.Client is also listed in metric source_tables.
  if (sourceTables.includes("dbo.[User]") && /FROM\s+dbo\.\[User\]/i.test(sql)) {
    return (userContext) => buildUserTableScopeClauses(userContext, sql);
  }

  if (sourceTables.includes("dbo.Client") && /FROM\s+dbo\.Client\b/i.test(sql)) {
    return (userContext) => buildClientScopeClauses(userContext, sql);
  }

  if (sourceTables.includes("dbo.[User]")) {
    return (userContext) => buildUserTableScopeClauses(userContext, sql);
  }

  for (const route of TABLE_SCOPE_ROUTES) {
    if (sourceTables.includes(route.table)) {
      return (userContext) => route.builder(userContext, query);
    }
  }

  return null;
}

function mergeSqlScope(builtQuery, userContext, metric = {}) {
  if (!builtQuery?.query || !userContext || !metric) {
    return builtQuery;
  }

  const sourceTables = metric.source_tables || [];
  const scopeBuilder = pickScopeBuilder(sourceTables, builtQuery.query);

  if (!scopeBuilder) {
    return builtQuery;
  }

  const { clauses, bind, skipped, notes } = scopeBuilder(userContext);

  if (skipped === "super_admin") {
    return {
      ...builtQuery,
      scopeApplied: [],
      scopeSkipped: skipped,
      scopeNotes: [],
    };
  }

  return {
    query: appendClausesToQuery(builtQuery.query, clauses),
    bind: { ...(builtQuery.bind || {}), ...bind },
    scopeApplied: clauses.map((c) => c.trim()),
    scopeSkipped: null,
    scopeNotes: notes || [],
  };
}

module.exports = {
  mergeSqlScope,
  buildVisitScopeClauses,
  buildClientScopeClauses,
  buildUserTableScopeClauses,
  buildVisitLinkedTableScopeClauses,
  buildPurchaseOrderChildScopeClauses,
  buildSubscriptionScopedClauses,
  canBypassUserScope,
  canBypassAllScope,
  shouldBypassHierarchyUserFilter,
  detectVisitAlias,
  buildClientInvoiceScopeExistsClause,
  buildInvoiceScopeExistsClause,
  buildInvoiceTableScopeClauses,
  buildInvoiceChildScopeClauses,
};
