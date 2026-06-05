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

  return first.total ?? first.totalUsers ?? first.responseCount ?? null;
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

  return value;
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
  const members = await getTeamMembers({
    teamId,
    allowedUserIds: teamContext?.allowedUserIds || userContext?.allowedUserIds || [],
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
  buildMemberScopedContext,
  formatMemberDisplayValue,
  executeTeamMemberBreakdown,
};
