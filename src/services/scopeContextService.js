const { HIERARCHY_LEVEL, buildAllowedUserIds, getHierarchyLabel } = require("./hierarchyService");
const { queryDb } = require("../db/sql");
const {
  detectTeamFromQuestion,
} = require("./questionFilterService");

const DUAL_SCOPE_SUMMARY_INTENTS = new Set([
  "visitCountRealized",
  "avgVisitDuration",
  "clientCountActive",
  "clientCountTotal",
  "clientCountPassive",
  "clientCountArchived",
  "totalDistributors",
  "consumerCountTotal",
  "totalClientInfoUpdates",
  "totalRniDevices",
  "totalClientFiles",
  "totalPurchaseOrders",
  "totalPurchaseOrderAmount",
  "totalPurchaseOrderDetails",
  "totalInvoices",
  "totalInvoiceAmount",
  "totalInvoiceBalance",
  "totalInvoicePayments",
  "activeCampaigns",
  "totalCampaigns",
  "totalCampaignProducts",
  "totalClientProductPrices",
  "totalTrackedOrders",
  "totalBipPromotions",
  "totalDistributorCommercials",
  "totalCosts",
  "totalCommissions",
  "totalPayments",
  "totalIyzicoTransactions",
  "userTotalCount",
]);

const SCOPED_DISTRIBUTION_INTENTS = new Set([
  "visitsByState",
  "visitsByCompletionStatus",
  "visitsByType",
]);

function isMultiTeamBreakdownIntent(intent) {
  const key = String(intent || "").trim();
  return isDualScopeSummaryIntent(key) || SCOPED_DISTRIBUTION_INTENTS.has(key);
}

function isScopedQueryIntent(intent) {
  const key = String(intent || "").trim();
  return isDualScopeSummaryIntent(key) || SCOPED_DISTRIBUTION_INTENTS.has(key);
}

const TEAM_SCOPE_PATTERN =
  /\b(takim|takım|ekip|ekibim|ekibin|team|stark)\b/i;
const COMPANY_SCOPE_PATTERN =
  /\b(sirket|şirket|genel|tum|tüm|butun|bütün|company|subscription|firma geneli|sirket geneli|şirket geneli)\b/i;

const TEAM_SCOPE_KEYWORDS = [
  "takim",
  "takım",
  "ekip",
  "ekibim",
  "ekibin",
  "team",
  "stark",
];
const COMPANY_SCOPE_KEYWORDS = [
  "sirket",
  "şirket",
  "genel",
  "tum",
  "tüm",
  "butun",
  "bütün",
  "company",
  "subscription",
  "firma geneli",
  "sirket geneli",
  "şirket geneli",
];

const TEAM_BREAKDOWN_PATTERN =
  /\b(takim\s+bazinda|takimlara\s+gore|takimlara\s+dagil|her\s+takim|tum\s+takimlar|ekip\s+ekip)\b/i;

const TEAM_BREAKDOWN_KEYWORDS = [
  "takim bazinda",
  "takım bazında",
  "takimlara gore",
  "takımlara göre",
  "takimlara dagil",
  "takımlara dağılım",
  "her takim",
  "her takım",
  "tum takimlar",
  "tüm takımlar",
  "ekip ekip",
];

const TEAM_DISPLAY_LIMIT = 15;

function normalizeScopeQuestion(question = "") {
  return String(question || "")
    .toLowerCase()
    .replace(/ı/g, "i")
    .replace(/İ/g, "i")
    .replace(/ş/g, "s")
    .replace(/Ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/Ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/Ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/Ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/Ç/g, "c");
}

function includesScopeKeyword(text = "", keywords = []) {
  const normalized = normalizeScopeQuestion(text);
  return keywords.some(
    (keyword) =>
      normalized.includes(normalizeScopeQuestion(keyword)) ||
      String(text || "").toLowerCase().includes(keyword.toLowerCase())
  );
}

function isDualScopeSummaryIntent(intent) {
  return DUAL_SCOPE_SUMMARY_INTENTS.has(String(intent || "").trim());
}

function isHybridDualScopeIntent(intent) {
  const key = String(intent || "").trim();
  return isDualScopeSummaryIntent(key) || SCOPED_DISTRIBUTION_INTENTS.has(key);
}

function detectTeamBreakdownFromQuestion(question = "") {
  const text = String(question || "").toLowerCase();
  if (TEAM_BREAKDOWN_PATTERN.test(text)) {
    return true;
  }
  return includesScopeKeyword(text, TEAM_BREAKDOWN_KEYWORDS);
}

function detectScopePreferenceFromQuestion(question = "") {
  const text = String(question || "").toLowerCase();
  const wantsBreakdown = detectTeamBreakdownFromQuestion(question);
  const wantsCompany =
    COMPANY_SCOPE_PATTERN.test(text) ||
    includesScopeKeyword(text, COMPANY_SCOPE_KEYWORDS);
  const wantsTeam =
    !wantsBreakdown &&
    (TEAM_SCOPE_PATTERN.test(text) ||
      includesScopeKeyword(text, TEAM_SCOPE_KEYWORDS));

  if (wantsBreakdown && wantsCompany) {
    return "company";
  }
  if (wantsTeam && !wantsCompany) {
    return "operational";
  }
  if (wantsCompany && !wantsTeam) {
    return "company";
  }
  return "dual";
}

function buildScopedUserContext(userContext = {}, scopeMode = "operational") {
  const mode =
    scopeMode === "company" && userContext.companyCapable ? "company" : "operational";

  if (mode === "company") {
    return {
      ...userContext,
      activeScopeMode: "company",
      scopeMode: "company",
      hierarchyLevel: userContext.companyLevel || HIERARCHY_LEVEL.COMPANY,
      hierarchyLabel: "COMPANY",
      hierarchyBypassUserFilter: true,
      allowedUserIds:
        userContext.companyAllowedUserIds || userContext.allowedUserIds || [],
    };
  }

  return {
    ...userContext,
    activeScopeMode: "operational",
    scopeMode: "operational",
    hierarchyLevel: userContext.operationalLevel ?? userContext.hierarchyLevel,
    hierarchyLabel: userContext.operationalLabel ?? userContext.hierarchyLabel,
    hierarchyBypassUserFilter: false,
    allowedUserIds:
      userContext.operationalAllowedUserIds || userContext.allowedUserIds || [],
  };
}

function shouldRunDualScopeQuery(userContext = {}, intent, question = "") {
  const plan = resolveScopePlan(userContext, question, intent);
  return plan.mode === "dual";
}

function getMembersForTeam(userContext = {}, teamId) {
  return (userContext.teamMembers || [])
    .filter((member) => Number(member.teamId) === Number(teamId))
    .map((member) => ({
      userId: Number(member.userId),
      userName: member.userName || `Kullanici ${member.userId}`,
      email: member.email || null,
      manager: !!member.Manager,
      member: !!member.Member,
    }));
}

function getMembersForTeam(userContext = {}, teamId) {
  return (userContext.teamMembers || [])
    .filter((member) => Number(member.teamId) === Number(teamId))
    .map((member) => ({
      userId: Number(member.userId),
      userName: member.userName || `Kullanici ${member.userId}`,
      email: member.email || null,
      manager: !!member.Manager,
      member: !!member.Member,
    }));
}


function resolveManagedTeams(userContext = {}) {
  const managedIds = new Set(
    (userContext.managedTeamIds || []).map((id) => Number(id)).filter(Boolean)
  );

  if (!managedIds.size) {
    return [];
  }

  const mapManagedTeam = (team) => ({
    teamId: Number(team.teamId),
    teamName: team.teamName || `Takim ${team.teamId}`,
    members: getMembersForTeam(userContext, team.teamId),
  });

  const pickManagedFromPool = (pool = []) =>
    pool
      .filter((team) => managedIds.has(Number(team.teamId)))
      .map(mapManagedTeam);

  const fromManagedTeams = pickManagedFromPool(userContext.managedTeams);
  if (fromManagedTeams.length) {
    return fromManagedTeams;
  }

  const fromUserTeams = pickManagedFromPool(userContext.teams);
  if (fromUserTeams.length) {
    return fromUserTeams;
  }

  const nameById = new Map();

  (userContext.subscriptionTeams || []).forEach((team) => {
    if (team?.teamId) {
      nameById.set(Number(team.teamId), team.teamName || `Takim ${team.teamId}`);
    }
  });

  (userContext.teams || []).forEach((team) => {
    if (team?.teamId && !nameById.has(Number(team.teamId))) {
      nameById.set(Number(team.teamId), team.teamName || `Takim ${team.teamId}`);
    }
  });

  return [...managedIds].map((teamId) => ({
    teamId,
    teamName: nameById.get(Number(teamId)) || `Takim ${teamId}`,
    members: getMembersForTeam(userContext, teamId),
  }));
}

function resolveSubscriptionTeams(userContext = {}) {
  return (userContext.subscriptionTeams || []).map((team) => ({
    teamId: Number(team.teamId),
    teamName: team.teamName || `Takim ${team.teamId}`,
    members: getMembersForTeam(userContext, team.teamId),
  }));
}

/** L4 admin: subscription takimlari; L2/L3: yonetilen takimlar. */
function resolveScopeTeams(userContext = {}) {
  if (userContext.companyCapable) {
    return resolveSubscriptionTeams(userContext);
  }

  return resolveManagedTeams(userContext);
}

function resolveSubscriptionTeams(userContext = {}) {
  return (userContext.subscriptionTeams || []).map((team) => ({
    teamId: Number(team.teamId),
    teamName: team.teamName || `Takim ${team.teamId}`,
    members: getMembersForTeam(userContext, team.teamId),
  }));
}

function canUseCompanySubscriptionBreakdown(userContext = {}) {
  return !!userContext.companyCapable;
}

function buildSubscriptionMultiTeamPlan(plan, teams = []) {
  if (!teams.length) {
    return null;
  }

  return {
    ...plan,
    mode: "multi_team",
    display: "breakdown",
    scopeSource: "subscription",
    teamIds: teams.map((team) => team.teamId),
  };
}

function shouldRunMultiTeamScopeQuery(userContext = {}, intent, question = "") {
  const plan = resolveScopePlan(userContext, question, intent);
  return plan.mode === "multi_team";
}

function shouldRunSingleTeamScopeQuery(userContext = {}, intent, question = "") {
  const plan = resolveScopePlan(userContext, question, intent);
  return plan.mode === "single_team";
}

function resolveScopePlan(userContext = null, question = "", intent = "") {
  const scopePreference = userContext
    ? detectScopePreferenceFromQuestion(question)
    : "dual";
  const managedTeams = userContext ? resolveManagedTeams(userContext) : [];
  const scopeTeams = userContext ? resolveScopeTeams(userContext) : [];
  const subscriptionTeams = userContext?.companyCapable
    ? resolveSubscriptionTeams(userContext)
    : [];
  const teamMatch = userContext
    ? detectTeamFromQuestion(question, scopeTeams)
    : null;
  const subscriptionTeamMatch =
    userContext?.companyCapable && subscriptionTeams.length
      ? detectTeamFromQuestion(question, subscriptionTeams)
      : null;

  const plan = {
    mode: "self",
    display: "single",
    scopePreference,
    teamMatch,
    teamIds: [],
    allowedUserIds: userContext?.allowedUserIds || [],
  };

  if (!userContext) {
    return plan;
  }

  if (teamMatch?.ambiguous) {
    return {
      ...plan,
      mode: "clarify",
      display: "message",
    };
  }

  if (scopePreference === "company" && !userContext.companyCapable) {
    return {
      ...plan,
      mode: "denied",
      display: "message",
      denyReason: "company_not_capable",
    };
  }

  if (teamMatch?.teamId && scopePreference !== "company") {
    const scopeTeamIds = new Set(scopeTeams.map((team) => Number(team.teamId)));
    if (scopeTeamIds.has(Number(teamMatch.teamId))) {
      return {
        ...plan,
        mode: "single_team",
        display: "team_detail",
        includeMemberBreakdown: true,
        teamIds: [teamMatch.teamId],
      };
    }
  }

  if (
    userContext.companyCapable &&
    subscriptionTeamMatch?.teamId &&
    !subscriptionTeamMatch?.ambiguous &&
    scopePreference !== "company"
  ) {
    const managedIds = new Set(managedTeams.map((team) => Number(team.teamId)));
    if (!managedIds.has(Number(subscriptionTeamMatch.teamId))) {
      return {
        ...plan,
        mode: "single_team",
        display: "team_detail",
        includeMemberBreakdown: true,
        teamIds: [subscriptionTeamMatch.teamId],
        teamMatch: subscriptionTeamMatch,
      };
    }
  }

  if (
    isMultiTeamBreakdownIntent(intent) &&
    canUseCompanySubscriptionBreakdown(userContext) &&
    detectTeamBreakdownFromQuestion(question) &&
    scopePreference === "company" &&
    !teamMatch?.teamId &&
    !subscriptionTeamMatch?.teamId
  ) {
    const breakdownPlan = buildSubscriptionMultiTeamPlan(plan, subscriptionTeams);
    if (breakdownPlan) {
      return breakdownPlan;
    }
  }

  if (
    isMultiTeamBreakdownIntent(intent) &&
    canUseCompanySubscriptionBreakdown(userContext) &&
    detectTeamBreakdownFromQuestion(question) &&
    scopePreference !== "company" &&
    !teamMatch?.teamId &&
    !subscriptionTeamMatch?.teamId
  ) {
    const breakdownPlan = buildSubscriptionMultiTeamPlan(plan, subscriptionTeams);
    if (breakdownPlan) {
      return breakdownPlan;
    }
  }

  if (
    isMultiTeamBreakdownIntent(intent) &&
    !userContext.companyCapable &&
    managedTeams.length > 1 &&
    scopePreference !== "company" &&
    !teamMatch?.teamId
  ) {
    return {
      ...plan,
      mode: "multi_team",
      display: "breakdown",
      teamIds: managedTeams.map((team) => team.teamId),
    };
  }

  if (scopePreference === "company" && userContext.companyCapable) {
    return {
      ...plan,
      mode: "company",
      display: "single",
    };
  }

  if (userContext.companyCapable && scopePreference !== "company") {
    return {
      ...plan,
      mode: "company",
      display: "single",
    };
  }

  return plan;
}

async function buildSingleTeamScopedContext(userContext = {}, teamId, dbQuery = queryDb) {
  const numericTeamId = Number(teamId);
  const teamMeta = resolveScopeTeams(userContext).find(
    (team) => team.teamId === numericTeamId
  );
  const allowedUserIds = await buildAllowedUserIds({
    userId: userContext.userId,
    hierarchyLevel: HIERARCHY_LEVEL.TEAM,
    managedTeamIds: [numericTeamId],
    subscriptionId: userContext.subscriptionId,
    dbQuery,
  });

  return {
    ...userContext,
    activeScopeMode: "operational",
    scopeMode: "operational",
    hierarchyLevel: HIERARCHY_LEVEL.TEAM,
    hierarchyLabel: "TEAM",
    hierarchyBypassUserFilter: false,
    managedTeamIds: [numericTeamId],
    allowedUserIds,
    operationalScopeLabel: teamMeta?.teamName || `Takim ${numericTeamId}`,
    allowedCountryIds: [],
    allowedBrandIds: [],
  };
}

async function buildSelectedTeamsCombinedContext(
  userContext = {},
  teamIds = [],
  dbQuery = queryDb
) {
  const numericTeamIds = Array.from(
    new Set(
      (teamIds || [])
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id > 0)
    )
  );

  if (!numericTeamIds.length) {
    return userContext;
  }

  const hierarchyLevel =
    numericTeamIds.length > 1 ? HIERARCHY_LEVEL.MULTI_TEAM : HIERARCHY_LEVEL.TEAM;

  const allowedUserIds = await buildAllowedUserIds({
    userId: userContext.userId,
    hierarchyLevel,
    managedTeamIds: numericTeamIds,
    subscriptionId: userContext.subscriptionId,
    dbQuery,
  });

  return {
    ...userContext,
    activeScopeMode: "operational",
    scopeMode: "operational",
    hierarchyLevel,
    hierarchyLabel: getHierarchyLabel(hierarchyLevel),
    hierarchyBypassUserFilter: false,
    managedTeamIds: numericTeamIds,
    allowedUserIds,
    operationalScopeLabel:
      numericTeamIds.length > 1
        ? `${numericTeamIds.length} takim`
        : `Takim ${numericTeamIds[0]}`,
    allowedCountryIds: [],
    allowedBrandIds: [],
  };
}

function extractNumericMetricValue(intent, rows = []) {
  if (!rows?.length) {
    return 0;
  }

  const first = rows[0] || {};
  const normalizedIntent = String(intent || "").trim();

  if (normalizedIntent === "avgVisitDuration") {
    return Number(first.avgDurationSec) || 0;
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

  if (amountIntents.has(normalizedIntent)) {
    return Number(first.totalAmount) || 0;
  }

  return Number(first.total ?? first.totalUsers ?? first.responseCount) || 0;
}

function normalizeCompletionStatusRows(rows = []) {
  const map = new Map(
    (rows || []).map((row) => [String(row.visitState || "").trim(), Number(row.total) || 0])
  );

  return [
    { visitState: "Tamamlanan", total: map.get("Tamamlanan") ?? 0 },
    { visitState: "Bekleyen", total: map.get("Bekleyen") ?? 0 },
  ];
}

/**
 * Secili takim kartlarinin toplam satiri: kart degerlerinin aritmetik toplami.
 * Ortak kullanicilar tek sorguda dedupe edildiginde dusuk cikabilecegi icin
 * birlestirilmis user-scope sorgusu yerine kullanilir.
 */
function sumTeamBreakdownMetricRows(intent, teamResults = []) {
  const teams = teamResults || [];
  if (!teams.length) {
    return [];
  }

  const normalizedIntent = String(intent || "").trim();

  if (normalizedIntent === "avgVisitDuration") {
    return null;
  }

  if (normalizedIntent === "visitsByCompletionStatus") {
    let tamamlanan = 0;
    let bekleyen = 0;
    teams.forEach((team) => {
      const rows = normalizeCompletionStatusRows(team.rows || []);
      tamamlanan += Number(rows.find((row) => row.visitState === "Tamamlanan")?.total) || 0;
      bekleyen += Number(rows.find((row) => row.visitState === "Bekleyen")?.total) || 0;
    });
    return normalizeCompletionStatusRows([
      { visitState: "Tamamlanan", total: tamamlanan },
      { visitState: "Bekleyen", total: bekleyen },
    ]);
  }

  if (["visitsByState", "visitsByType"].includes(normalizedIntent)) {
    const merged = new Map();
    teams.forEach((team) => {
      (team.rows || []).forEach((row) => {
        const key = row.visitState || row.visitType || "Diger";
        merged.set(key, (merged.get(key) || 0) + (Number(row.total) || 0));
      });
    });

    if (normalizedIntent === "visitsByType") {
      return Array.from(merged.entries()).map(([visitType, total]) => ({ visitType, total }));
    }

    return Array.from(merged.entries()).map(([visitState, total]) => ({ visitState, total }));
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

  const sum = teams.reduce(
    (acc, team) => acc + extractNumericMetricValue(normalizedIntent, team.rows || []),
    0
  );

  if (amountIntents.has(normalizedIntent)) {
    return [{ totalAmount: sum }];
  }

  return [{ total: sum }];
}

function formatOperationalDisplayLabel(scopeLabel = "Takim") {
  const name = String(scopeLabel || "Takim").trim() || "Takim";
  return `Takim (${name})`;
}

function formatCompanyDisplayLabel(scopeLabel = "Sirket geneli") {
  const name = String(scopeLabel || "Sirket geneli").trim() || "Sirket geneli";
  return `Sirket geneli (${name})`;
}

function shouldUseScopeAnswerPrefix(userContext = null, scopePlan = {}, scopePayload = {}) {
  if (!userContext || userContext.isPureCompanyScopeUser) {
    return false;
  }

  const level = Number(userContext.operationalLevel ?? userContext.hierarchyLevel);
  if (level !== 2 && level !== 3) {
    return false;
  }

  if (scopePayload.companyTeamScope) {
    return false;
  }

  if (scopePayload.dualScope || scopePayload.singleTeamScope) {
    return false;
  }

  if (scopePlan?.source === "toolbar") {
    return false;
  }

  const mode = String(scopePlan?.mode || "");
  if (mode === "denied" || mode === "clarify" || mode === "message") {
    return false;
  }

  return true;
}

function buildScopeAnswerPrefix(userContext = null, scopePlan = {}, scopePayload = {}) {
  if (!shouldUseScopeAnswerPrefix(userContext, scopePlan, scopePayload)) {
    return "";
  }

  const mode = String(scopePlan?.mode || "");
  const scopePreference = scopePlan?.scopePreference;
  const activeMode = userContext.activeScopeMode || userContext.scopeMode;

  if (
    mode === "company" ||
    scopePreference === "company" ||
    activeMode === "company"
  ) {
    return `${formatCompanyDisplayLabel(userContext.companyScopeLabel)} icin:`;
  }

  if (scopePayload.multiTeamScope) {
    if (scopePayload.multiTeamScope.scopeSource === "subscription") {
      return `${formatCompanyDisplayLabel(userContext.companyScopeLabel || "Sirket geneli")} icin:`;
    }

    const teamCount =
      scopePayload.multiTeamScope.teamTotalCount ||
      scopePayload.multiTeamScope.teams?.length ||
      0;
    if (teamCount > 1) {
      return `Yonettiginiz ${teamCount} takim icin:`;
    }
  }

  return `${formatOperationalDisplayLabel(userContext.operationalScopeLabel)} icin:`;
}

function prefixScopeAnswer(prefix = "", body = "") {
  const text = String(body || "").trim();
  const header = String(prefix || "").trim();
  if (!header || !text) {
    return text;
  }
  if (text.startsWith(header)) {
    return text;
  }
  return `${header}\n${text}`;
}

module.exports = {
  DUAL_SCOPE_SUMMARY_INTENTS,
  isDualScopeSummaryIntent,
  isHybridDualScopeIntent,
  isMultiTeamBreakdownIntent,
  isScopedQueryIntent,
  SCOPED_DISTRIBUTION_INTENTS,
  detectScopePreferenceFromQuestion,
  detectTeamBreakdownFromQuestion,
  buildScopedUserContext,
  shouldRunDualScopeQuery,
  shouldRunMultiTeamScopeQuery,
  shouldRunSingleTeamScopeQuery,
  resolveScopePlan,
  resolveManagedTeams,
  resolveScopeTeams,
  resolveSubscriptionTeams,
  buildSingleTeamScopedContext,
  buildSelectedTeamsCombinedContext,
  sumTeamBreakdownMetricRows,
  formatOperationalDisplayLabel,
  formatCompanyDisplayLabel,
  shouldUseScopeAnswerPrefix,
  buildScopeAnswerPrefix,
  prefixScopeAnswer,
  TEAM_DISPLAY_LIMIT,
};
