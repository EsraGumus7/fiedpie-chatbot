/**
 * Template SQL'e kullanici/tenant scope filtreleri ekler.
 * MVP scope: Company, Country, Team, Brand (+ kullanici filtresi).
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

function canBypassAllScope(userContext = {}) {
  return userContext.isSuperAdmin === true;
}

function hasExplicitVisitScope(userContext = {}) {
  return (
    isNonEmptyArray(userContext.allowedSubscriptionIds) ||
    isNonEmptyArray(userContext.allowedCompanyIds) ||
    isNonEmptyArray(userContext.allowedCountryIds) ||
    isNonEmptyArray(userContext.allowedBrandIds) ||
    isNonEmptyArray(userContext.allowedTeamIds) ||
    isNonEmptyArray(userContext.allowedUserIds) ||
    isNonEmptyArray(userContext.effectiveClientIds) ||
    isNonEmptyArray(userContext.assignedClientIds)
  );
}

function canBypassUserScope(userContext = {}) {
  return (
    canBypassAllScope(userContext) ||
    userContext.manageAll === true ||
    userContext.isAdmin === true
  );
}

function detectVisitAlias(query = "") {
  const match = String(query).match(/FROM\s+dbo\.Visit\s+(\w+)/i);
  return match ? match[1] : "v";
}

function buildVisitScopeClauses(userContext = {}, visitAlias = "v") {
  if (canBypassAllScope(userContext) && !hasExplicitVisitScope(userContext)) {
    return { clauses: [], bind: {}, skipped: "super_admin", notes: [] };
  }

  const clauses = [];
  const accessClauses = [];
  const bind = {};
  const alias = visitAlias;

  const subscriptionIds = isNonEmptyArray(userContext.allowedSubscriptionIds)
    ? userContext.allowedSubscriptionIds
    : isNonEmptyArray(userContext.allowedCompanyIds)
      ? userContext.allowedCompanyIds
      : typeof userContext.subscriptionId === "number"
        ? [userContext.subscriptionId]
        : [];

  if (subscriptionIds.length) {
    const subIn = buildInList(subscriptionIds, "scopeSub", bind);
    clauses.push(`${alias}.SubscriptionId IN (${subIn.sql})`);
  }

  const teamIds = isNonEmptyArray(userContext.allowedTeamIds)
    ? userContext.allowedTeamIds
    : [];

  const hasTeamScope = teamIds.length > 0;

  if (!hasTeamScope && !canBypassUserScope(userContext)) {
    const userIds = isNonEmptyArray(userContext.allowedUserIds)
      ? userContext.allowedUserIds
      : [userContext.userId];
    const userIn = buildInList(userIds.filter((x) => x != null), "scopeUser", bind);
    if (userIn.sql) {
      accessClauses.push(`${alias}.UserId IN (${userIn.sql})`);
    }
  }

  if (!hasTeamScope && isNonEmptyArray(userContext.allowedCountryIds)) {
    const countryIn = buildInList(userContext.allowedCountryIds, "scopeCountry", bind);
    accessClauses.push(`
      EXISTS (
        SELECT 1
        FROM dbo.Client c_scope
        WHERE c_scope.Id = ${alias}.ClientId
          AND c_scope.Deleted = 0
          AND c_scope.CountryId IN (${countryIn.sql})
      )`);
  }

  if (!hasTeamScope && isNonEmptyArray(userContext.allowedBrandIds)) {
    const brandIn = buildInList(userContext.allowedBrandIds, "scopeBrand", bind);
    accessClauses.push(`
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

  if (!hasTeamScope) {
    const clientIds = unique([
      ...(Array.isArray(userContext.effectiveClientIds) ? userContext.effectiveClientIds : []),
      ...(Array.isArray(userContext.assignedClientIds) ? userContext.assignedClientIds : []),
    ]);

    if (clientIds.length) {
      const clientIn = buildInList(clientIds, "scopeClient", bind);
      accessClauses.push(`${alias}.ClientId IN (${clientIn.sql})`);
    }
  }

  if (teamIds.length) {
    const teamIn = buildInList(teamIds, "scopeTeam", bind);
    accessClauses.push(`
      (
        EXISTS (
          SELECT 1
          FROM dbo.Client c_scope
          WHERE c_scope.Id = ${alias}.ClientId
            AND c_scope.Deleted = 0
            AND c_scope.TeamId IN (${teamIn.sql})
        )
        OR EXISTS (
          SELECT 1
          FROM dbo.UserTeam ut_scope
          WHERE ut_scope.UserId = ${alias}.UserId
            AND ut_scope.Deleted = 0
            AND ut_scope.TeamId IN (${teamIn.sql})
        )
      )`);
  }

  if (accessClauses.length) {
    clauses.push(`(
      ${accessClauses.join("\n      OR ")}
    )`);
  }

  return { clauses, bind, skipped: null, notes: [] };
}

function appendClausesToQuery(query, clauses = []) {
  if (!clauses.length) {
    return query;
  }

  const fragment = clauses.map((clause) => `        AND (${clause.trim()})`).join("\n");
  const trimmed = String(query).trim().replace(/;\s*$/, "");
  return `${trimmed}\n${fragment};`;
}

function mergeSqlScope(builtQuery, userContext, metric = {}) {
  if (!builtQuery?.query || !userContext || !metric) {
    return builtQuery;
  }

  const sourceTables = metric.source_tables || [];
  if (!sourceTables.includes("dbo.Visit")) {
    return builtQuery;
  }

  const visitAlias = detectVisitAlias(builtQuery.query);
  const { clauses, bind, skipped, notes } = buildVisitScopeClauses(userContext, visitAlias);

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
  canBypassUserScope,
  canBypassAllScope,
  detectVisitAlias,
};
