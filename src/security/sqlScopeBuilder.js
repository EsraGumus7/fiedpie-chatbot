/**
 * Template SQL'e kullanici/tenant scope filtreleri ekler.
 * MVP scope: Company, Country, Team, Brand (+ kullanici filtresi).
 */

function isNonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
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
  return (
    userContext.isSuperAdmin === true ||
    (userContext.allowedIntents || []).includes("*")
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
  if (canBypassAllScope(userContext)) {
    return { clauses: [], bind: {}, skipped: "super_admin", notes: [] };
  }

  const clauses = [];
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

  if (!canBypassUserScope(userContext)) {
    const userIds = isNonEmptyArray(userContext.allowedUserIds)
      ? userContext.allowedUserIds
      : [userContext.userId];
    const userIn = buildInList(userIds.filter((x) => x != null), "scopeUser", bind);
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

  const teamIds = isNonEmptyArray(userContext.allowedTeamIds)
    ? userContext.allowedTeamIds
    : [];

  if (teamIds.length) {
    const teamIn = buildInList(teamIds, "scopeTeam", bind);
    clauses.push(`
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
