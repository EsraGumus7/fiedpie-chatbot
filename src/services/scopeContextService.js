const { HIERARCHY_LEVEL, buildAllowedUserIds } = require("./hierarchyService");
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

function detectScopePreferenceFromQuestion(question = "") {
  const text = String(question || "").toLowerCase();
  const wantsTeam =
    TEAM_SCOPE_PATTERN.test(text) ||
    includesScopeKeyword(text, TEAM_SCOPE_KEYWORDS);
  const wantsCompany =
    COMPANY_SCOPE_PATTERN.test(text) ||
    includesScopeKeyword(text, COMPANY_SCOPE_KEYWORDS);

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

function resolveManagedTeams(userContext = {}) {
  const managedIds = new Set(
    (userContext.managedTeamIds || []).map((id) => Number(id)).filter(Boolean)
  );

  if (!managedIds.size) {
    return [];
  }

  const fromContext = (userContext.managedTeams || [])
    .filter((team) => managedIds.has(Number(team.teamId)))
    .map((team) => ({
      teamId: Number(team.teamId),
      teamName: team.teamName || `Takim ${team.teamId}`,
    }));

  if (fromContext.length) {
    return fromContext;
  }

  return [...managedIds].map((teamId) => ({
    teamId,
    teamName: `Takim ${teamId}`,
  }));
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
  const teamMatch = userContext
    ? detectTeamFromQuestion(question, managedTeams)
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

  if (
    scopePreference === "company" &&
    !userContext.companyCapable &&
    !userContext.isHybridScopeUser
  ) {
    return {
      ...plan,
      mode: "denied",
      display: "message",
      denyReason: "company_not_capable",
    };
  }

  if (teamMatch?.teamId && scopePreference !== "company") {
    const managedTeamIds = new Set(managedTeams.map((team) => Number(team.teamId)));
    if (managedTeamIds.has(Number(teamMatch.teamId))) {
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
    isDualScopeSummaryIntent(intent) &&
    userContext.isHybridScopeUser &&
    scopePreference === "dual" &&
    !teamMatch?.teamId
  ) {
    return {
      ...plan,
      mode: "dual",
      display: "dual",
      teamIds: managedTeams.map((team) => team.teamId),
    };
  }

  if (
    isMultiTeamBreakdownIntent(intent) &&
    !userContext.isHybridScopeUser &&
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

  if (userContext.isHybridScopeUser) {
    return {
      ...plan,
      mode: scopePreference === "company" ? "company" : "operational",
      display: "single",
    };
  }

  return plan;
}

async function buildSingleTeamScopedContext(userContext = {}, teamId, dbQuery = queryDb) {
  const numericTeamId = Number(teamId);
  const teamMeta = resolveManagedTeams(userContext).find(
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

function formatOperationalDisplayLabel(scopeLabel = "Takim") {
  const name = String(scopeLabel || "Takim").trim() || "Takim";
  return `Takim (${name})`;
}

function formatCompanyDisplayLabel(scopeLabel = "Sirket geneli") {
  const name = String(scopeLabel || "Sirket geneli").trim() || "Sirket geneli";
  return `Sirket geneli (${name})`;
}

module.exports = {
  DUAL_SCOPE_SUMMARY_INTENTS,
  isDualScopeSummaryIntent,
  isMultiTeamBreakdownIntent,
  isScopedQueryIntent,
  SCOPED_DISTRIBUTION_INTENTS,
  detectScopePreferenceFromQuestion,
  buildScopedUserContext,
  shouldRunDualScopeQuery,
  shouldRunMultiTeamScopeQuery,
  shouldRunSingleTeamScopeQuery,
  resolveScopePlan,
  resolveManagedTeams,
  buildSingleTeamScopedContext,
  formatOperationalDisplayLabel,
  formatCompanyDisplayLabel,
};
