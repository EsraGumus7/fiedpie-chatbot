const { queryDb } = require("../db/sql");
const { buildSingleTeamScopedContext } = require("./scopeContextService");

const MEMBER_DISPLAY_LIMIT = 15;
const MEMBER_QUERY_CONCURRENCY = 8;

const DISTRIBUTION_INTENTS = new Set([
  "visitsByState",
  "visitsByCompletionStatus",
  "visitsByType",
]);

async function getTeamMembers({
  teamId,
  allowedUserIds = [],
  dbQuery = queryDb,
} = {}) {
  const numericTeamId = Number(teamId);
  if (!numericTeamId) {
    return [];
  }

  const allowedSet = new Set(
    (allowedUserIds || []).map((id) => Number(id)).filter((id) => Number.isFinite(id))
  );

  const result = await dbQuery({
    query: `
      SELECT
        u.Id AS userId,
        COALESCE(NULLIF(LTRIM(RTRIM(u.Name)), ''), CONCAT('Kullanici ', u.Id)) AS userName
      FROM dbo.UserTeam ut
      INNER JOIN dbo.[User] u
        ON u.Id = ut.UserId
       AND u.Deleted = 0
      WHERE ut.Deleted = 0
        AND ut.TeamId = @teamId
      ORDER BY userName ASC, u.Id ASC;
    `,
    bind: { teamId: numericTeamId },
  });

  return (result.recordset || [])
    .map((row) => ({
      userId: Number(row.userId),
      userName: String(row.userName || `Kullanici ${row.userId}`).trim(),
    }))
    .filter((member) => !allowedSet.size || allowedSet.has(member.userId));
}

async function fetchUsersByIds(userIds = [], dbQuery = queryDb) {
  const ids = Array.from(
    new Set(
      (userIds || [])
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id > 0)
    )
  );

  if (!ids.length) {
    return [];
  }

  const bind = {};
  const placeholders = ids.map((id, index) => {
    const key = `memberUser${index}`;
    bind[key] = id;
    return `@${key}`;
  });

  const result = await dbQuery({
    query: `
      SELECT
        u.Id AS userId,
        COALESCE(NULLIF(LTRIM(RTRIM(u.Name)), ''), CONCAT('Kullanici ', u.Id)) AS userName
      FROM dbo.[User] u
      WHERE u.Deleted = 0
        AND u.Id IN (${placeholders.join(", ")})
      ORDER BY userName ASC, u.Id ASC;
    `,
    bind,
  });

  return (result.recordset || []).map((row) => ({
    userId: Number(row.userId),
    userName: String(row.userName || `Kullanici ${row.userId}`).trim(),
  }));
}

async function resolveTeamMemberCandidates({
  teamId,
  allowedUserIds = [],
  viewerUserId,
  dbQuery = queryDb,
} = {}) {
  const allowedIds = Array.from(
    new Set(
      (allowedUserIds || [])
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id > 0)
    )
  );

  const teamMembers = await getTeamMembers({
    teamId,
    allowedUserIds: allowedIds,
    dbQuery,
  });
  const memberIdSet = new Set(teamMembers.map((member) => member.userId));
  const extraIds = allowedIds.filter((id) => !memberIdSet.has(id));

  if (!extraIds.length) {
    return teamMembers;
  }

  const extraMembers = await fetchUsersByIds(extraIds, dbQuery);
  const viewerId = Number(viewerUserId);
  const merged = [...teamMembers];

  extraMembers.forEach((member) => {
    merged.push({
      userId: member.userId,
      userName:
        Number(member.userId) === viewerId
          ? `Kendim (${member.userName})`
          : member.userName,
    });
  });

  return merged.sort((left, right) =>
    String(left.userName || "").localeCompare(String(right.userName || ""), "tr")
  );
}

function buildMemberScopedContext(teamContext = {}, member = {}) {
  const userId = Number(member.userId);
  return {
    ...teamContext,
    allowedUserIds: Number.isFinite(userId) ? [userId] : [],
    operationalScopeLabel: member.userName || teamContext.operationalScopeLabel,
  };
}

function extractPrimaryMetricValue(intent, rows = []) {
  if (!rows.length) {
    return null;
  }

  const first = rows[0] || {};

  if (intent === "avgVisitDuration") {
    const sec = first.avgDurationSec;
    return sec != null ? `${(Number(sec) / 60).toFixed(1)} dk` : null;
  }

  if (intent === "totalInvoiceBalance") {
    return first.totalBalance ?? null;
  }

  const amountIntents = new Set([
    "totalClientDealAmount",
    "totalPurchaseOrderAmount",
    "totalInvoiceAmount",
    "totalInvoicePayments",
    "totalCosts",
    "totalCommissions",
    "totalPayments",
  ]);

  if (amountIntents.has(intent)) {
    return first.totalAmount ?? null;
  }

  if (intent === "userRecentLogins") {
    return rows.length;
  }

  return first.total ?? first.totalUsers ?? first.responseCount ?? null;
}

const MONEY_INTENTS = new Set([
  "totalPurchaseOrderAmount",
  "totalInvoiceAmount",
  "totalInvoiceBalance",
  "totalInvoicePayments",
  "totalPayments",
  "totalCosts",
  "totalCommissions",
]);

function isMoneyIntent(intent = "") {
  return MONEY_INTENTS.has(String(intent || "").trim());
}

function formatMoney(value, currencySymbol = "$") {
  if (value == null || value === "" || Number.isNaN(Number(value))) return "-";

  return `${currencySymbol}${new Intl.NumberFormat("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value))}`;
}

function formatMemberMetricValue(intent = "", value) {
  return isMoneyIntent(intent) ? formatMoney(value) : value;
}

function formatMemberDisplayValue(intent, rows = []) {
  if (intent === "visitsByCompletionStatus") {
    const tam = rows.find((row) => row.visitState === "Tamamlanan")?.total ?? 0;
    const bek = rows.find((row) => row.visitState === "Bekleyen")?.total ?? 0;
    return `Tamamlanan: ${tam} | Bekleyen: ${bek}`;
  }

  if (DISTRIBUTION_INTENTS.has(intent) && rows.length > 1) {
    return rows
      .slice(0, 4)
      .map((row) => {
        const label =
          row.visitState || row.visitType || row.stateName || row.statusName || "Diger";
        return `${label}: ${row.total ?? 0}`;
      })
      .join(" | ");
  }

  if (rows.length > 1) {
    return `${rows.length} kayit`;
  }

  const value = extractPrimaryMetricValue(intent, rows);
  if (value === null || value === undefined || value === "") {
    return "-";
  }

  return formatMemberMetricValue(intent, value);
}

async function mapWithConcurrency(items = [], limit = MEMBER_QUERY_CONCURRENCY, mapper) {
  const results = [];

  for (let index = 0; index < items.length; index += limit) {
    const chunk = items.slice(index, index + limit);
    const chunkResults = await Promise.all(chunk.map(mapper));
    results.push(...chunkResults);
  }

  return results;
}

async function executeTeamMemberBreakdown({
  intent,
  params,
  userContext,
  teamId,
  teamContext,
  metric,
  executeIntent,
  normalizeRows = (value) => value,
  dbQuery = queryDb,
} = {}) {
  const allowedUserIds = teamContext?.allowedUserIds || userContext?.allowedUserIds || [];
  const members = await resolveTeamMemberCandidates({
    teamId,
    allowedUserIds,
    viewerUserId: userContext?.userId,
    dbQuery,
  });

  if (!members.length) {
    return {
      members: [],
      memberTotalCount: 0,
      displayLimit: MEMBER_DISPLAY_LIMIT,
      hasMore: false,
    };
  }

  const memberResults = await mapWithConcurrency(
    members,
    MEMBER_QUERY_CONCURRENCY,
    async (member) => {
      const memberContext = buildMemberScopedContext(teamContext, member);
      const memberResult = await executeIntent(intent, params, {
        userContext: memberContext,
        metric,
      });
      const rows = normalizeRows(memberResult.recordset || []);

      return {
        userId: member.userId,
        userName: member.userName,
        displayLabel: member.userName,
        rows,
        displayValue: formatMemberDisplayValue(intent, rows),
      };
    }
  );

  return {
    members: memberResults,
    memberTotalCount: memberResults.length,
    displayLimit: MEMBER_DISPLAY_LIMIT,
    hasMore: memberResults.length > MEMBER_DISPLAY_LIMIT,
  };
}

module.exports = {
  MEMBER_DISPLAY_LIMIT,
  getTeamMembers,
  fetchUsersByIds,
  resolveTeamMemberCandidates,
  buildMemberScopedContext,
  formatMemberDisplayValue,
  executeTeamMemberBreakdown,
};
