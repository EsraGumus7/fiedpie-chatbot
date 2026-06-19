const express = require("express");
const { queryDb } = require("../db/sql");
const templates = require("../services/queryTemplates");
const { executeSecureIntent } = require("../services/secureIntentExecutor");
const { authMiddleware } = require("../middleware/authMiddleware");
const { getEffectivePermissions } = require("../services/adminPermissionService");
const { resolveFieldName } = require("../services/intentParser");
const { resolveIntent } = require("../services/metricResolver");
const { summarizeWithGemini } = require("../services/gemini");
const { buildQueryPlan } = require("../planner/queryPlanner");
const { listMetrics, getMetricByIntent } = require("../planner/metricRegistry");
const { evaluateScopeRequirements } = require("../security/scopeFilter");
const { mergeSqlScope } = require("../security/sqlScopeBuilder");
const { optionalAuthMiddleware } = require("../middleware/authMiddleware");
const {
  buildScopedUserContext,
  resolveScopePlan,
  resolveManagedTeams,
  resolveScopeTeams,
  resolveSubscriptionTeams,
  buildSingleTeamScopedContext,
  buildSelectedTeamsCombinedContext,
  formatOperationalDisplayLabel,
  formatCompanyDisplayLabel,
  buildScopeAnswerPrefix,
  prefixScopeAnswer,
  TEAM_DISPLAY_LIMIT,
} = require("../services/scopeContextService");
const {
  resolveScopePlanFromSelection,
  resolveBreakdownTeamList,
  buildScopeToolbarConfig,
} = require("../services/scopeSelectionService");
const { getTeamUserIds } = require("../services/hierarchyService");
const salesMetricDefinitions = require("../metrics/sales.metrics.json");
const {
  parseQuestionFilters,
  resolveVisitIntentOverride,
  buildTeamClarificationAnswer,
  buildOutOfScopeTeamAnswer,
  buildRangeLabel,
  buildVisitStatusLabel,
} = require("../services/questionFilterService");
const {
  executeTeamMemberBreakdown,
  MEMBER_DISPLAY_LIMIT,
  formatMemberDisplayValue,
} = require("../services/teamMemberBreakdownService");

const {
  executeSalesFinanceCustomerBreakdown,
  formatSalesFinanceCustomerBreakdown,
  isSalesFinanceCustomerBreakdownIntent,
} = require("../services/salesFinanceCustomerBreakdownService");

const router = express.Router();

const CUSTOMER_BREAKDOWN_INTENTS = new Set([
  "totalInvoices",
  "totalInvoiceAmount",
  "totalInvoiceBalance",
  "totalPurchaseOrders",
  "totalPurchaseOrderAmount",
  "totalInvoicePayments",
]);

const MULTI_TEAM_QUERY_CONCURRENCY = 8;

const COMPANY_TEAM_TOTAL_OVERLAP_NOTICE =
  "Not: Takim kartlari ortak uyeler nedeniyle ayni ziyareti birden fazla takimda gosterebilir. Toplam satirinda tekrarlanan ziyaretler 1 kez sayilmistir.";

const MULTI_TEAM_TOTAL_OVERLAP_NOTICE =
  "Not: Takim kartlari ortak uyeler nedeniyle ayni ziyareti birden fazla takimda gosterebilir. Toplam satirinda tekrarlanan ziyaretler 1 kez sayilmistir.";

const SALES_INTENTS = new Set(
  (salesMetricDefinitions.metrics || [])
    .map((metric) => metric.intent)
    .filter(Boolean)
);

function shouldUseSalesTeamMembersOnly(intent, userContext = {}) {
  return SALES_INTENTS.has(intent) && !!userContext.companyCapable;
}

async function buildIntentSingleTeamScopedContext(intent, userContext, teamId) {
  const context = await buildSingleTeamScopedContext(userContext, teamId);

  if (!shouldUseSalesTeamMembersOnly(intent, userContext)) {
    return context;
  }

  const numericTeamId = Number(teamId);
  const teamUserIds = await getTeamUserIds([numericTeamId]);

  return {
    ...context,
    allowedUserIds: teamUserIds.length ? teamUserIds : [-1],
  };
}

async function buildIntentSelectedTeamsCombinedContext(
  intent,
  userContext,
  teamIds = []
) {
  const context = await buildSelectedTeamsCombinedContext(userContext, teamIds);

  if (!shouldUseSalesTeamMembersOnly(intent, userContext)) {
    return context;
  }

  const numericTeamIds = Array.from(
    new Set(
      (teamIds || [])
        .map((teamId) => Number(teamId))
        .filter((teamId) => Number.isFinite(teamId) && teamId > 0)
    )
  );
  const teamUserIds = await getTeamUserIds(numericTeamIds);

  return {
    ...context,
    allowedUserIds: teamUserIds.length ? teamUserIds : [-1],
  };
}

function appendTeamTotalOverlapNote(lines, notice) {
  if (!notice) {
    return;
  }
  lines.push("");
  lines.push(notice);
}

function shouldUseCustomerBreakdown(intent = "") {
  const normalized = String(intent || "").trim();

  return (
    CUSTOMER_BREAKDOWN_INTENTS.has(normalized) &&
    isSalesFinanceCustomerBreakdownIntent(normalized)
  );
}

function getTeamTotalNotice(intent = "", fallbackNotice = "") {
  if (!fallbackNotice) {
    return null;
  }

  if (!shouldUseCustomerBreakdown(intent)) {
    return fallbackNotice;
  }

  return "Not: Şirket geneli / toplam satırı şirket kapsamındaki tüm ilgili kayıtları içerir. Takım kartları yalnızca ilgili takım üyelerine ait kayıtları gösterir. Takım kartlarına dahil olmayan kayıtlar Diğer şirket kayıtları altında gösterilir. Ortak üyeler varsa aynı kayıt birden fazla takım kartında görünebilir, toplam satırında tekilleştirilir.";
}

function formatCustomerBreakdownTitle(title = "") {
  const rawTitle = String(title || "").trim();

  const baseTitle = rawTitle
    .replace(/\s*musteri\s*\/\s*kullanici\s*kirilimi\s*$/i, "")
    .replace(/\s*musteri\s*kirilimi\s*$/i, "")
    .replace(/\s*musteri\s*bazli\s*dagilim[ıi]?\s*$/i, "")
    .replace(/\s*müşteri\s*\/\s*kullanıcı\s*kırılımı\s*$/i, "")
    .replace(/\s*müşteri\s*kırılımı\s*$/i, "")
    .replace(/\s*müşteri\s*bazlı\s*dağılım[ıi]?\s*$/i, "")
    .trim();

  return baseTitle
    ? `${baseTitle} müşteri bazlı dağılımı`
    : "Müşteri bazlı dağılım";
}

function appendCustomerBreakdownLines(
  lines,
  intent,
  rows = [],
  title = "Müşteri bazlı dağılım"
) {
  if (!shouldUseCustomerBreakdown(intent)) {
    return;
  }

  const normalizedTitle = formatCustomerBreakdownTitle(title);
  const text = formatSalesFinanceCustomerBreakdown(intent, rows, normalizedTitle);
  if (!text) {
    return;
  }

  lines.push("");
  lines.push(text);
}

function normalizeAnswerTurkishText(text = "") {
  return String(text || "")
    .replaceAll("Sirket", "Şirket")
    .replaceAll("Takim", "Takım")
    .replaceAll("Secili takimlar toplami", "Seçili takımlar toplamı")
    .replaceAll("Tum donem", "Tüm dönem")

    .replaceAll("fatura tutari", "fatura tutarı")
    .replaceAll("siparis tutari", "sipariş tutarı")
    .replaceAll("sipariş tutari", "sipariş tutarı")
    .replaceAll("fatura tahsilat tutari", "fatura tahsilatı")
    .replaceAll("fatura tahsilat tutarı", "fatura tahsilatı")
    .replaceAll("tahsilat tutari", "tahsilat tutarı")
    .replaceAll("araliginda", "aralığında")
    .replaceAll("tutari", "tutarı")

    .replaceAll("odenmemis", "ödenmemiş")
    .replaceAll("musteri", "müşteri")
    .replaceAll("kullanici", "kullanıcı")
    .replaceAll("siparis", "sipariş")
    .replaceAll("satinalma", "satın alma");
}

async function buildCustomerBreakdownForContext(intent, params, userContext, metric) {
  if (!shouldUseCustomerBreakdown(intent) || !userContext || !metric) {
    return [];
  }

  try {
    const breakdownResult = await executeSalesFinanceCustomerBreakdown({
      intent,
      params,
      userContext,
      metric,
    });

    return breakdownResult.recordset || [];
  } catch (error) {
    console.warn(
      `[salesFinanceCustomerBreakdown] ${intent} kirilimi alinamadi: ${error.message}`
    );
    return [];
  }
}

async function buildCustomerBreakdownForMainRows(
  intent,
  params,
  mainRows,
  userContext,
  metric
) {
  if (!shouldUseCustomerBreakdown(intent)) {
    return [];
  }

  const mainValue = extractPrimaryMetricValue(intent, mainRows || []);
  if (mainValue == null || Number(mainValue) <= 0) {
    return [];
  }

  return buildCustomerBreakdownForContext(intent, params, userContext, metric);
}

function getCustomerBreakdownNumericValue(intent = "", row = {}) {
  if (intent === "totalInvoiceBalance") {
    return Number(row.totalBalance || 0);
  }

  if (isMoneyIntent(intent)) {
    return Number(row.totalAmount || 0);
  }

  return Number(row.total || 0);
}

function setCustomerBreakdownNumericValue(intent = "", row = {}, value = 0) {
  if (intent === "totalInvoiceBalance") {
    return { ...row, totalBalance: value };
  }

  if (isMoneyIntent(intent)) {
    return { ...row, totalAmount: value };
  }

  return { ...row, total: value };
}

function getCustomerBreakdownKey(row = {}) {
  return `${row.clientName || "Müşteri bilgisi yok"}|||${row.userName || "Kullanıcı bilgisi yok"}`;
}

function buildOtherCompanyCustomerBreakdown(intent = "", companyRows = [], teamRows = []) {
  if (!shouldUseCustomerBreakdown(intent)) {
    return [];
  }

  const companyMap = new Map();

  (companyRows || []).forEach((row) => {
    const key = getCustomerBreakdownKey(row);
    const current = companyMap.get(key) || {
      row,
      value: 0,
    };

    current.value += getCustomerBreakdownNumericValue(intent, row);
    companyMap.set(key, current);
  });

  const teamMap = new Map();

  (teamRows || []).forEach((row) => {
    const key = getCustomerBreakdownKey(row);
    const value = getCustomerBreakdownNumericValue(intent, row);

    /*
      Aynı kullanıcı birden fazla takımda yer alabiliyorsa aynı kayıt birden
      fazla takım kartında görünebilir. Bu yüzden burada SUM yerine MAX almak
      daha güvenli: şirket toplamından aynı kaydı iki kez düşmemiş oluruz.
    */
    teamMap.set(key, Math.max(teamMap.get(key) || 0, value));
  });

  const epsilon = 0.0001;

  return Array.from(companyMap.entries())
    .map(([key, item]) => {
      const remainingValue = item.value - (teamMap.get(key) || 0);
      return {
        key,
        row: setCustomerBreakdownNumericValue(intent, item.row, remainingValue),
        value: remainingValue,
      };
    })
    .filter((item) => item.value > epsilon)
    .sort((a, b) => {
      if (b.value !== a.value) {
        return b.value - a.value;
      }

      return String(a.row.clientName || "").localeCompare(
        String(b.row.clientName || ""),
        "tr"
      );
    })
    .map((item) => item.row);
}

function sumCustomerBreakdownRows(intent = "", rows = []) {
  return (rows || []).reduce(
    (sum, row) => sum + getCustomerBreakdownNumericValue(intent, row),
    0
  );
}

async function mapTeamsWithConcurrency(teams, mapper, concurrency = MULTI_TEAM_QUERY_CONCURRENCY) {
  const results = [];
  for (let i = 0; i < teams.length; i += concurrency) {
    const slice = teams.slice(i, i + concurrency);
    results.push(...(await Promise.all(slice.map(mapper))));
  }
  return results;
}

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function getDefaultRecentRange(days = 30) {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  start.setDate(start.getDate() - days);
  return { startDate: toIsoDate(start), endDate: toIsoDate(today) };
}

function parseFilters(input = {}) {
  return {
    startDate: input.startDate || null,
    endDate: input.endDate || null,
    fieldName: input.fieldName || null,
    fieldId: input.fieldId || null,
    limit: input.limit ? Number(input.limit) : null,
  };
}

function getRouteErrorStatus(error) {
  if (error.statusCode) return error.statusCode;

  const message = String(error.message || "").toLowerCase();
  if (message.includes("permission denied")) return 403;

  return 500;
}

function buildScopePreview(userContext, metric, scopeDecision) {
  if (!userContext) {
    return {
      loggedIn: false,
      message: "Giris yapilmadi — scope bilgisi yok (sorgu scope'suz calisir).",
    };
  }

  return {
    loggedIn: true,
    userId: userContext.userId,
    subscriptionId: userContext.subscriptionId ?? null,
    isAdmin: !!(userContext.isAdmin || userContext.isSuperAdmin),
    manageAll: !!userContext.manageAll,
    roleIds: userContext.roleIds || [],
    allowedIntents: userContext.allowedIntents || [],
    metricSecurityScope: metric?.security_scope || null,
    scopeCheck: scopeDecision
      ? {
        allowed: scopeDecision.allowed,
        reason: scopeDecision.reason || null,
        warnings: scopeDecision.warnings || [],
      }
      : null,
    hierarchyLevel: userContext.hierarchyLevel ?? null,
    hierarchyLabel: userContext.hierarchyLabel ?? null,
    isHybridScopeUser: !!userContext.isHybridScopeUser,
    isPureCompanyScopeUser: !!userContext.isPureCompanyScopeUser,
    managedTeamCount: (userContext.managedTeamIds || []).length,
    subscriptionTeamCount: (userContext.subscriptionTeams || []).length,
    subscriptionTeamNames: (userContext.subscriptionTeams || [])
      .slice(0, 8)
      .map((team) => team.teamName),
    activeScopeMode: userContext.activeScopeMode || userContext.defaultScopeMode || null,
    allowedUserIds: userContext.allowedUserIds || [userContext.userId],
    filters: {
      company: userContext.allowedSubscriptionIds || userContext.allowedCompanyIds || null,
      country: userContext.allowedCountryIds || null,
      team: userContext.allowedTeamIds || null,
      brand: userContext.allowedBrandIds || null,
    },
  };
}

function buildSqlPreview(intent, params, options = {}) {
  const templateBuilder = templates[intent];
  if (!templateBuilder) return null;

  const built = templateBuilder(params || {});
  if (!built?.query) return null;

  const scoped =
    options.userContext && options.metric
      ? mergeSqlScope(built, options.userContext, options.metric)
      : built;

  return {
    query: String(scoped.query).trim(),
    bind: scoped.bind || {},
    scopeApplied: scoped.scopeApplied || [],
    scopeSkipped: scoped.scopeSkipped || null,
  };
}

async function buildAuthIntentOptions(req, intent) {
  const authUserId = req.authUser?.userId;
  if (!authUserId) return {};

  const userContext = await getEffectivePermissions(authUserId);
  return {
    userContext,
    metric: getMetricByIntent(intent),
  };
}

async function executeIntent(intent, params, options = {}) {
  if (options.userContext) {
    return executeSecureIntent({
      intent,
      params,
      userContext: options.userContext,
      metric: options.metric,
      queryExecutor: options.queryExecutor,
      templateSource: options.templateSource,
      metricResolver: options.metricResolver,
    });
  }

  const templateBuilder = templates[intent];
  if (!templateBuilder) {
    throw new Error(`Intent bulunamadi: ${intent}`);
  }

  return queryDb(templateBuilder(params || {}));
}

function formatNumber(value) {
  if (value == null || Number.isNaN(Number(value))) return "-";
  return new Intl.NumberFormat("tr-TR").format(Number(value));
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

function formatMetricValue(intent = "", value) {
  return isMoneyIntent(intent) ? formatMoney(value) : formatNumber(value);
}

function formatDateTime(value) {
  if (!value) return "-";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value).slice(0, 16);
  }

  return new Intl.DateTimeFormat("tr-TR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function summarizeVisitTrendRows(rows = [], filters = {}) {
  if (!rows.length) {
    return "Secilen filtrede trend verisi bulunamadi.";
  }

  const rangeInfo = buildRangeLabel(filters);
  const total = rows.reduce((sum, item) => sum + Number(item.total || 0), 0);
  const avg = rows.length ? (total / rows.length).toFixed(2) : "0";
  const maxRow = rows.reduce((max, item) =>
    Number(item.total || 0) > Number(max.total || 0) ? item : max
  );
  const maxDate = String(maxRow.visitDate || "").slice(0, 10);
  const dayLines = rows
    .slice(-5)
    .map((row) => {
      const day = String(row.visitDate || "").slice(0, 10);
      return `${day}: ${formatNumber(row.total ?? 0)}`;
    })
    .join(", ");

  return `${rangeInfo} araliginda ${rows.length} gun veri var. Toplam ${formatNumber(
    total
  )} gerceklesen ziyaret, gunluk ortalama ${avg}. En yuksek gun ${maxDate} (${formatNumber(
    maxRow.total
  )} ziyaret). Gunluk: ${dayLines}.`;
}

function isTrendIntent(intent = "") {
  return [
    "visitTrend",
    "purchaseOrderTrend",
    "invoiceTrend",
    "invoicePaymentTrend",
    "clientTrend",
    "distributorTrend",
    "consumerTrend",
    "dataChangeTrend",
  ].includes(String(intent || "").trim());
}

function getTrendUnitLabel(intent = "") {
  const labels = {
    visitTrend: "gerceklesen ziyaret",
    purchaseOrderTrend: "siparis",
    invoiceTrend: "fatura",
    invoicePaymentTrend: "tahsilat",
    clientTrend: "firma kaydi",
    distributorTrend: "distributor kaydi",
    consumerTrend: "consumer kaydi",
    dataChangeTrend: "veri degisikligi",
  };

  return labels[intent] || "kayit/islem";
}

function pickTrendDateValue(row = {}) {
  return (
    row.visitDate ||
    row.createDate ||
    row.paymentDate ||
    row.date ||
    row.day ||
    row.trendDate ||
    ""
  );
}

function summarizeGenericTrendRows(intent, rows = [], filters = {}) {
  if (!rows.length) {
    return "Secilen filtrede trend verisi bulunamadi.";
  }

  const rangeInfo = buildRangeLabel(filters);
  const unitLabel = getTrendUnitLabel(intent);
  const total = rows.reduce((sum, item) => sum + Number(item.total || 0), 0);
  const avg = rows.length ? (total / rows.length).toFixed(2) : "0";

  const maxRow = rows.reduce((max, item) =>
    Number(item.total || 0) > Number(max.total || 0) ? item : max
  );

  const maxDate = String(pickTrendDateValue(maxRow)).slice(0, 10) || "-";
  const dayLines = rows
    .slice(-5)
    .map((row) => {
      const day = String(pickTrendDateValue(row)).slice(0, 10) || "-";
      return `${day}: ${formatNumber(row.total ?? 0)}`;
    })
    .join(", ");

  return `${rangeInfo} araliginda ${rows.length} gun veri var. Toplam ${formatNumber(
    total
  )} ${unitLabel}, gunluk ortalama ${avg}. En yuksek gun ${maxDate} (${formatNumber(
    maxRow.total
  )}). Gunluk: ${dayLines}.`;
}

function summarizeTrendRows(intent, rows = [], filters = {}) {
  if (intent === "visitTrend") {
    return summarizeVisitTrendRows(rows, filters);
  }

  return summarizeGenericTrendRows(intent, rows, filters);
}

function extractPrimaryMetricValue(intent, rows = []) {
  if (!rows.length) return null;
  const first = rows[0] || {};

  if (isTrendIntent(intent)) {
    return rows.reduce((sum, item) => sum + Number(item.total || 0), 0);
  }

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
function getScopedMetricLabel(intent, filters = {}) {
  const labels = {
    visitCountRealized: buildVisitStatusLabel(filters),
    totalPurchaseOrders: "sipariş",
    clientCountActive: "aktif firma",
    totalInvoices: "fatura",
    totalInvoiceAmount: "fatura tutarı",
    totalInvoiceBalance: "ödenmemiş fatura bakiyesi",
    totalInvoicePayments: "fatura tahsilatı",
    totalPurchaseOrderAmount: "sipariş tutarı",
    totalPurchaseOrderDetails: "sipariş kalemi",
  };

  return labels[intent] || "kayit";
}

const USER_DISTRIBUTION_INTENTS = new Set([
  "usersByRole",
  "usersByTeam",
  "usersByBrand",
  "usersByClient",
  "userLoginSuccessSummary",
  "userSavedViewSummary",
  "userStepSummary",
  "userVisitSummary",
]);

function formatScopedDistributionParts(intent, rows = [], limit = 4) {
  return (rows || [])
    .slice(0, limit)
    .map((row) => {
      if (intent === "usersByRole") {
        return `${row.roleName}: ${formatNumber(row.totalUsers)} kullanici`;
      }
      if (intent === "usersByTeam") {
        return `${row.teamName}: ${formatNumber(row.totalUsers)} kullanici`;
      }
      if (intent === "usersByBrand") {
        return `${row.brandName}: ${formatNumber(row.totalUsers)} kullanici`;
      }
      if (intent === "usersByClient") {
        return `${row.clientName}: ${formatNumber(row.totalUsers)} kullanici`;
      }
      if (intent === "userLoginSuccessSummary") {
        const status = row.loginStatus || "Bilinmeyen";
        const app = row.app || "App";
        return `${status} / ${app}: ${formatNumber(row.totalLogins)} login`;
      }
      if (intent === "userSavedViewSummary") {
        return `${row.moduleName}: ${formatNumber(row.savedViewCount)} gorunum`;
      }
      if (intent === "userStepSummary") {
        return `${row.userName}: ${formatNumber(row.totalSteps)} adim`;
      }
      if (intent === "userVisitSummary") {
        return `${row.userName}: ${formatNumber(row.totalVisits)} ziyaret`;
      }
      if (intent === "visitsByCompletionStatus" || intent === "visitsByState") {
        return `${row.visitState}: ${formatNumber(row.total)} ziyaret`;
      }
      if (intent === "visitsByType") {
        return `${row.visitType}: ${formatNumber(row.total)} ziyaret`;
      }
      if (intent === "invoicesByStatus") {
        const status = row.statusName || row.stateName || row.groupName || "Bilinmeyen Durum";
        return `${status}: ${formatNumber(row.total)} fatura`;
      }
      const label =
        row.visitState ||
        row.visitType ||
        row.statusName ||
        row.stateName ||
        row.groupName ||
        "Diger";
      return `${label}: ${formatNumber(row.total ?? row.totalUsers ?? 0)}`;
    })
    .join(", ");
}

function summarizeDistributionBullets(intent, rows = []) {
  if (!rows.length) {
    return "- Veri yok";
  }

  if (intent === "visitsByState" || intent === "visitsByCompletionStatus") {
    return rows
      .map((row) => `- ${row.visitState}: ${formatNumber(row.total)} ziyaret`)
      .join("\n");
  }

  if (intent === "visitsByType") {
    return rows
      .slice(0, 5)
      .map((row) => `- ${row.visitType}: ${formatNumber(row.total)} ziyaret`)
      .join("\n");
  }

  if (intent === "invoicesByStatus") {
    return rows
      .map((row) => {
        const status = row.statusName || row.stateName || row.groupName || "Bilinmeyen Durum";
        return `- ${status}: ${formatNumber(row.total)} fatura`;
      })
      .join("\n");
  }
  if (intent === "purchaseOrdersByStatus") {
    return rows
      .map((row) => {
        const status = row.statusName || row.stateName || row.groupName || "Bilinmeyen Durum";
        return `- ${status}: ${formatNumber(row.total)} siparis`;
      })
      .join("\n");
  }

  if (intent === "paymentsByState") {
    return rows
      .map((row) => {
        const status = row.statusName || row.stateName || row.groupName || "Bilinmeyen Durum";
        return `- ${status}: ${formatNumber(row.total)} odeme`;
      })
      .join("\n");
  }

  if (intent === "costsByCategory") {
    return rows
      .map((row) => {
        const category = row.categoryName || row.groupName || row.name || "Bilinmeyen Kategori";
        return `- ${category}: ${formatNumber(row.total)} maliyet`;
      })
      .join("\n");
  }

  if (intent === "iyzicoTransactionsByStatus") {
    return rows
      .map((row) => {
        const status = row.statusName || row.stateName || row.groupName || "Bilinmeyen Durum";
        return `- ${status}: ${formatNumber(row.total)} islem`;
      })
      .join("\n");
  }

  if (USER_DISTRIBUTION_INTENTS.has(intent)) {
    return rows
      .slice(0, 5)
      .map((row) => {
        const part = formatScopedDistributionParts(intent, [row], 1);
        return `- ${part}`;
      })
      .join("\n");
  }

  return summarizeRows(intent, rows, {});
}

function summarizeDualScope(intent, dualScope = {}, filters = {}) {
  const rangeInfo =
    filters.startDate || filters.endDate
      ? `${filters.startDate || "-"} - ${filters.endDate || "-"}`
      : "Tum donem";

  const operational = dualScope.operational || {};
  const company = dualScope.company || {};
  const opTitle =
    operational.displayLabel || formatOperationalDisplayLabel(operational.label);
  const coTitle =
    company.displayLabel || formatCompanyDisplayLabel(company.label);

  if (isDistributionIntent(intent)) {
    return [
      `${opTitle} (${rangeInfo}):`,
      summarizeDistributionBullets(intent, operational.rows || []),
      "",
      `${coTitle} (${rangeInfo}):`,
      summarizeDistributionBullets(intent, company.rows || []),
    ].join("\n");
  }

  const opValue = extractPrimaryMetricValue(intent, operational.rows || []);
  const companyValue = extractPrimaryMetricValue(intent, company.rows || []);

  const metricLabel = getScopedMetricLabel(intent, filters);

  const lines = [];

  if (intent === "avgVisitDuration") {
    lines.push(`${opTitle} (${rangeInfo}): ${formatNumber(opValue ?? "-")}`);
    lines.push(`${coTitle} (${rangeInfo}): ${formatNumber(companyValue ?? "-")}`);
    return lines.join("\n");
  }

  lines.push(
    `${opTitle} (${rangeInfo}): ${formatMetricValue(intent, opValue ?? 0)} ${metricLabel}`
  );
  appendCustomerBreakdownLines(
    lines,
    intent,
    operational.customerBreakdown || [],
    `${opTitle} musteri kirilimi`
  );

  lines.push(
    `${coTitle} (${rangeInfo}): ${formatMetricValue(intent, companyValue ?? 0)} ${metricLabel}`
  );
  appendCustomerBreakdownLines(
    lines,
    intent,
    company.customerBreakdown || [],
    `${coTitle} musteri kirilimi`
  );

  return lines.join("\n");
}

function summarizeCompanyTeamScope(intent, companyTeamScope = {}, filters = {}) {
  const rangeInfo = buildRangeLabel(filters);
  const companyTitle =
    companyTeamScope.company?.displayLabel ||
    formatCompanyDisplayLabel(companyTeamScope.company?.label);
  const selectedLabel = companyTeamScope.selectedCombined?.label || "Secili takimlar toplami";
  const metricLabel = getScopedMetricLabel(intent, filters);

  const companyBody = isDistributionIntent(intent)
    ? summarizeDistributionBullets(intent, companyTeamScope.company?.rows || [])
    : `${formatMetricValue(
      intent,
      extractPrimaryMetricValue(intent, companyTeamScope.company?.rows || []) ?? 0
    )} ${metricLabel}`;

  const lines = [`${companyTitle} (${rangeInfo}):`, companyBody];

  lines.push("");

  (companyTeamScope.teams || []).forEach((team) => {
    const title = team.displayLabel || formatOperationalDisplayLabel(team.teamName);

    if (isDistributionIntent(intent)) {
      lines.push(`${title} (${rangeInfo}):`);
      lines.push(summarizeDistributionBullets(intent, team.rows || []));
    } else {
      const value = extractPrimaryMetricValue(intent, team.rows || []);
      lines.push(
        `${title} (${rangeInfo}): ${formatMetricValue(intent, value ?? 0)} ${metricLabel}`
      );
    }

    appendCustomerBreakdownLines(
      lines,
      intent,
      team.customerBreakdown || [],
      `${title} musteri kirilimi`
    );

    lines.push("");
  });

  const allTeamCustomerBreakdownRows = (companyTeamScope.teams || []).flatMap(
    (team) => team.customerBreakdown || []
  );

  const otherCompanyCustomerBreakdown = buildOtherCompanyCustomerBreakdown(
    intent,
    companyTeamScope.company?.customerBreakdown || [],
    allTeamCustomerBreakdownRows
  );

  if (
    shouldUseCustomerBreakdown(intent) &&
    (companyTeamScope.teams || []).length > 1 &&
    otherCompanyCustomerBreakdown.length
  ) {
    const otherCompanyValue = sumCustomerBreakdownRows(
      intent,
      otherCompanyCustomerBreakdown
    );

    lines.push(
      `Diğer şirket kayıtları (${rangeInfo}): ${formatMetricValue(
        intent,
        otherCompanyValue
      )} ${metricLabel}`
    );

    appendCustomerBreakdownLines(
      lines,
      intent,
      otherCompanyCustomerBreakdown,
      "Diğer şirket kayıtları"
    );

    lines.push("");
  }

  if (companyTeamScope.includeMemberBreakdown) {
    appendMemberSummaryLines(lines, companyTeamScope, intent);
    lines.push("");
  }

  const selectedRows = companyTeamScope.selectedCombined?.rows || [];
  const selectedTeamCount = (companyTeamScope.teams || []).length;
  const selectedCombinedLabel = String(selectedLabel || "").toLocaleLowerCase("tr-TR");

  const shouldShowSelectedCombined =
    selectedTeamCount > 1 &&
    !selectedCombinedLabel.includes("şirket geneli toplam") &&
    !selectedCombinedLabel.includes("sirket geneli toplam");

  if (shouldShowSelectedCombined) {
    if (isDistributionIntent(intent)) {
      lines.push(`${selectedLabel} (${rangeInfo}):`);
      lines.push(summarizeDistributionBullets(intent, selectedRows));
    } else {
      const selectedValue = extractPrimaryMetricValue(intent, selectedRows);
      lines.push(
        `${selectedLabel} (${rangeInfo}): ${formatMetricValue(
          intent,
          selectedValue ?? 0
        )} ${metricLabel}`
      );
    }

    appendCustomerBreakdownLines(
      lines,
      intent,
      companyTeamScope.selectedCombined?.customerBreakdown || [],
      `${selectedLabel} müşteri bazlı dağılım`
    );
  }

  if ((companyTeamScope.teams || []).length > 1) {
    appendTeamTotalOverlapNote(
      lines,
      getTeamTotalNotice(intent, COMPANY_TEAM_TOTAL_OVERLAP_NOTICE)
    );
  }

  return lines.join("\n").trim();
}

function summarizeSingleTeamScope(intent, singleTeamScope = {}, filters = {}) {
  const rangeInfo = buildRangeLabel(filters);
  const title =
    singleTeamScope.displayLabel ||
    formatOperationalDisplayLabel(singleTeamScope.teamName);

  if (isDistributionIntent(intent)) {
    const body = summarizeRows(intent, singleTeamScope.rows || [], filters);
    const lines = [`${title} (${rangeInfo})`, body];
    appendMemberSummaryLines(lines, singleTeamScope, intent);
    return lines.join("\n");
  }

  const value = extractPrimaryMetricValue(intent, singleTeamScope.rows || []);

  if (intent === "avgVisitDuration") {
    const lines = [`${title} (${rangeInfo}): ${formatNumber(value ?? "-")}`];
    appendMemberSummaryLines(lines, singleTeamScope, intent);
    return lines.join("\n");
  }

  const metricLabel = getScopedMetricLabel(intent, filters);
  const lines = [
    `${title} (${rangeInfo}): ${formatMetricValue(intent, value ?? 0)} ${metricLabel}`,
  ];

  appendCustomerBreakdownLines(
    lines,
    intent,
    singleTeamScope.customerBreakdown || [],
    `${title} musteri kirilimi`
  );

  appendMemberSummaryLines(lines, singleTeamScope, intent);
  return lines.join("\n");
}

function appendMemberSummaryLines(lines, singleTeamScope = {}, intent = "") {
  if (shouldUseCustomerBreakdown(intent)) {
    return;
  }

  const members = singleTeamScope.members || [];
  if (!members.length) {
    return;
  }

  lines.push("Uyeler:");
  members.slice(0, MEMBER_DISPLAY_LIMIT).forEach((member) => {
    const value =
      member.displayValue ??
      formatMemberDisplayValue(intent, member.rows || []);
    lines.push(`- ${member.displayLabel || member.userName}: ${value}`);
  });

  if (singleTeamScope.hasMoreMembers) {
    const hiddenCount = Math.max(
      0,
      (singleTeamScope.memberTotalCount || members.length) - MEMBER_DISPLAY_LIMIT
    );
    lines.push(`(${hiddenCount} kisi daha — arayuzde "Tumunu goster")`);
  }
}

function summarizeMultiTeamScope(intent, multiTeamScope = {}, filters = {}) {
  const rangeInfo = buildRangeLabel(filters);
  const combinedLabel =
    multiTeamScope.scopeSource === "subscription"
      ? formatCompanyDisplayLabel("Sirket geneli")
      : multiTeamScope.scopeSource === "selected"
        ? multiTeamScope.combined?.label || "Secili takimlar toplami"
        : "Toplam";

  if (isDistributionIntent(intent)) {
    const lines = (multiTeamScope.teams || []).map((team) => {
      const rows = team.rows || [];
      const title = team.displayLabel || formatOperationalDisplayLabel(team.teamName);

      if (intent === "visitsByCompletionStatus") {
        const tam = rows.find((row) => row.visitState === "Tamamlanan")?.total ?? 0;
        const bek = rows.find((row) => row.visitState === "Bekleyen")?.total ?? 0;
        return `${title} (${rangeInfo}): Tamamlanan ${formatNumber(tam)}, Bekleyen ${formatNumber(bek)}`;
      }

      const parts = formatScopedDistributionParts(intent, rows);
      return `${title} (${rangeInfo}): ${parts || "veri yok"}`;
    });

    const combinedRows = multiTeamScope.combined?.rows || [];
    if (intent === "visitsByCompletionStatus") {
      const tam = combinedRows.find((row) => row.visitState === "Tamamlanan")?.total ?? 0;
      const bek = combinedRows.find((row) => row.visitState === "Bekleyen")?.total ?? 0;
      lines.push(
        `${combinedLabel} (${rangeInfo}): Tamamlanan ${formatNumber(tam)}, Bekleyen ${formatNumber(bek)}`
      );
    } else if (combinedRows.length) {
      const parts = formatScopedDistributionParts(intent, combinedRows);
      lines.push(`${combinedLabel} (${rangeInfo}): ${parts}`);
    }

    if ((multiTeamScope.teams || []).length > 1) {
      appendTeamTotalOverlapNote(
        lines,
        getTeamTotalNotice(intent, MULTI_TEAM_TOTAL_OVERLAP_NOTICE)
      );
    }

    return lines.join("\n");
  }

  if (isTrendIntent(intent)) {
    const lines = (multiTeamScope.teams || []).map((team) => {
      const title = team.displayLabel || formatOperationalDisplayLabel(team.teamName);
      return `${title}:\n${summarizeTrendRows(intent, team.rows || [], filters)}`;
    });

    const combinedRows = multiTeamScope.combined?.rows || [];
    if (combinedRows.length) {
      lines.push(
        `${combinedLabel}:\n${summarizeTrendRows(intent, combinedRows, filters)}`
      );
    }

    if ((multiTeamScope.teams || []).length > 1) {
      appendTeamTotalOverlapNote(
        lines,
        getTeamTotalNotice(intent, MULTI_TEAM_TOTAL_OVERLAP_NOTICE)
      );
    }

    return lines.join("\n\n");
  }

  const metricLabel = getScopedMetricLabel(intent, filters);

  const lines = [];

  (multiTeamScope.teams || []).forEach((team) => {
    const value = extractPrimaryMetricValue(intent, team.rows || []);
    const title = team.displayLabel || formatOperationalDisplayLabel(team.teamName);

    if (intent === "avgVisitDuration") {
      lines.push(`${title} (${rangeInfo}): ${formatNumber(value ?? "-")}`);
    } else {
      lines.push(
        `${title} (${rangeInfo}): ${formatMetricValue(intent, value ?? 0)} ${metricLabel}`
      );
    }

    appendCustomerBreakdownLines(
      lines,
      intent,
      team.customerBreakdown || [],
      `${title} musteri kirilimi`
    );
  });

  const combinedValue = extractPrimaryMetricValue(
    intent,
    multiTeamScope.combined?.rows || []
  );

  if (combinedValue != null) {
    if (intent === "avgVisitDuration") {
      lines.push(`${combinedLabel} (${rangeInfo}): ${formatNumber(combinedValue ?? "-")}`);
    } else {
      lines.push(
        `${combinedLabel} (${rangeInfo}): ${formatMetricValue(
          intent,
          combinedValue ?? 0
        )} ${metricLabel}`
      );
    }

    appendCustomerBreakdownLines(
      lines,
      intent,
      multiTeamScope.combined?.customerBreakdown || [],
      `${combinedLabel} musteri kirilimi`
    );
  }

  if ((multiTeamScope.teams || []).length > 1) {
    appendTeamTotalOverlapNote(
      lines,
      getTeamTotalNotice(intent, MULTI_TEAM_TOTAL_OVERLAP_NOTICE)
    );
  }

  return lines.join("\n");
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

function applyIntentRowNormalization(intent, rows = []) {
  if (String(intent).trim() === "visitsByCompletionStatus") {
    return normalizeCompletionStatusRows(rows);
  }
  return rows;
}

function isDistributionIntent(intent = "") {
  const normalized = String(intent || "").trim();

  return [
    "visitsByState",
    "visitsByCompletionStatus",
    "visitsByType",
    "invoicesByStatus",
    "purchaseOrdersByStatus",
    "paymentsByState",
    "costsByCategory",
    "iyzicoTransactionsByStatus",
    ...USER_DISTRIBUTION_INTENTS,
  ].includes(normalized);
}

function renderScopeAnswer(intent, params, scopePayload = {}) {
  const {
    dualScope,
    singleTeamScope,
    multiTeamScope,
    companyTeamScope,
    rows = [],
    customerBreakdown = [],
  } = scopePayload;

  if (companyTeamScope) {
    return summarizeCompanyTeamScope(intent, companyTeamScope, params);
  }

  if (dualScope) {
    return summarizeDualScope(intent, dualScope, params);
  }

  if (multiTeamScope) {
    return summarizeMultiTeamScope(intent, multiTeamScope, params);
  }

  if (singleTeamScope && isDistributionIntent(intent)) {
    const teamTitle =
      singleTeamScope.displayLabel ||
      formatOperationalDisplayLabel(singleTeamScope.teamName);
    const body = summarizeRows(intent, singleTeamScope.rows || rows, params);
    return `${teamTitle}\n${body}`;
  }

  if (singleTeamScope) {
    return summarizeSingleTeamScope(intent, singleTeamScope, params);
  }

  const lines = [summarizeRows(intent, rows, params)];

  appendCustomerBreakdownLines(
    lines,
    intent,
    customerBreakdown,
    "Müşteri bazlı dağılım"
  );

  return lines.join("\n");
}

function summarizeRows(intent, rows, filters = {}) {
  if (!rows || rows.length === 0) {
    return "Secilen filtrede veri bulunamadi.";
  }

  const rangeInfo =
    filters.startDate || filters.endDate
      ? `${filters.startDate || "-"} - ${filters.endDate || "-"}`
      : "Tum donem";

  // ==========================================
  // YENİ MODÜLLER İÇİN DİNAMİK ÖZETLEYİCİLER
  // ==========================================

  // 1. Genel Sayım (Count) İşlemleri
  const countIntents = [
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
    "totalInvoices",
    "activeCampaigns",
    "totalCampaigns",
    "totalIyzicoTransactions",
    "totalPurchaseOrderDetails",
    "invoice_detail_count",
    "totalCampaignProducts",
    "totalClientProductPrices",
    "totalTrackedOrders",
    "totalBipPromotions",
    "totalDistributorCommercials"
  ];
  if (countIntents.includes(intent)) {
    const total = rows[0]?.total ?? rows[0]?.responseCount ?? 0;

    const countLabels = {
      clientCountActive: "aktif firma",
      clientCountTotal: "firma",
      distributorCountActive: "aktif distributor",
      distributorCountTotal: "distributor",
      branchCountActive: "aktif sube",
      branchCountTotal: "sube",
      totalInvoices: "kesilen fatura",
      totalSalesOrders: "satis siparisi",
      totalPurchaseOrders: "satinalma siparisi",
      totalPayments: "odeme kaydi",
      totalCollections: "tahsilat kaydi",
      activeCampaigns: "aktif kampanya",
    };

    const label = countLabels[intent] || "kayit";

    return `${rangeInfo} araliginda toplam ${formatNumber(total)} ${label} bulundu.`;
  }

  // 2. Genel Tutar (Sum/Amount) İşlemleri
  const amountIntents = [
    "totalClientDealAmount",

    "totalPurchaseOrderAmount",
    "totalInvoiceAmount",
    "totalInvoicePayments",
    "totalCosts",
    "totalCommissions",
    "totalPayments"
  ];
  if (amountIntents.includes(intent)) {
    const total = rows[0]?.totalAmount ?? 0;
    const amountLabels = {
      totalInvoiceAmount: "toplam fatura tutari",
      totalInvoicePayments: "faturalardan yapilan toplam tahsilat",
      totalPurchaseOrderAmount: "toplam satinalma siparisi tutari",
    };
    const label = amountLabels[intent] || "islem goren toplam tutar";
    return `${rangeInfo} araliginda ${label}: ${formatMoney(total)}.`;
  }

  // 3. Bakiye İşlemleri (Özel)
  if (intent === "totalInvoiceBalance") {
    const total = rows[0]?.totalBalance ?? 0;
    return `${rangeInfo} itibariyla odenmemis toplam fatura bakiyesi: ${formatMoney(total)}.`;
  }

  // 4. Dağılım ve Gruplama (Group By) İşlemleri
  const groupIntents = [
    "clientsByGroup",
    "clientsByState",
    "clientsByCountry",
    "clientsByProgramType",
    "clientsByCity",

    "distributorsByRegion",
    "distributorsByGroup",
    "distributorsByType",
    "distributorsByStatus",

    "consumersBySegment",
    "dataChangesByType",

    "purchaseOrdersByStatus",
    "invoicesByStatus",
    "costsByCategory",
    "iyzicoTransactionsByStatus",
    "paymentsByState"
  ];
  if (groupIntents.includes(intent)) {
    const top = rows.slice(0, 5);
    const isInvoiceStatus = intent === "invoicesByStatus";
    const bullets = top.map((r) => {
      const name = r.groupName || r.regionName || r.statusName || "Bilinmeyen Dagilim";
      const unit = isInvoiceStatus ? "fatura" : "kayit";
      return `- ${name}: ${formatNumber(r.total)} ${unit}`;
    }).join("\n");
    const title = isInvoiceStatus ? "fatura durum dagilimi" : "dagilim ozeti";
    return `${rangeInfo} ${title}:\n${bullets}`;
  }

  // 5. Trend (Zaman Serisi) İşlemleri
  const trendIntents = [
    "clientTrend",
    "distributorTrend",
    "consumerTrend",
    "dataChangeTrend",

    // SALES TREND
    "purchaseOrderTrend",
    "invoiceTrend",
    "invoicePaymentTrend"
  ];
  if (trendIntents.includes(intent)) {
    const total = rows.reduce((sum, item) => sum + Number(item.total || 0), 0);
    return `${rangeInfo} araliginda toplam ${formatNumber(total)} kayit/islem gerceklesti.`;
  }

  // ==========================================
  // ESKİ VİSİT VE USER MODÜLÜ ÖZETLEYİCİLERİ (Değiştirilmedi)
  // ==========================================
  if (intent === "visitCountRealized") {
    const total = rows[0]?.total ?? 0;
    return `${rangeInfo} araliginda toplam ${formatNumber(total)} gerceklesen ziyaret var.`;
  }

  if (intent === "avgVisitDuration") {
    const sec = rows[0]?.avgDurationSec;
    const minutes = sec != null ? (Number(sec) / 60).toFixed(1) : null;
    return minutes
      ? `${rangeInfo} araliginda ortalama ziyaret suresi ${minutes} dakika.`
      : `${rangeInfo} araliginda ortalama sure hesaplanamadi.`;
  }

  if (intent === "visitTrend") {
    return summarizeVisitTrendRows(rows, filters);
  }

  if (intent === "visitsByType") {
    const top = rows.slice(0, 3);
    const bullets = top
      .map((r) => `- ${r.visitType}: ${formatNumber(r.total)} ziyaret`)
      .join("\n");
    return `${rangeInfo} araliginda ziyaret tip dagilimi:\n${bullets}`;
  }

  if (intent === "visitsByState" || intent === "visitsByCompletionStatus") {
    const title =
      intent === "visitsByCompletionStatus"
        ? "Ziyaret durumu (tamamlanan / bekleyen)"
        : "Ziyaret durum dagilimi";
    const bullets = rows
      .map((r) => `- ${r.visitState}: ${formatNumber(r.total)} ziyaret`)
      .join("\n");
    return `${rangeInfo} araliginda ${title}:\n${bullets}`;
  }

  if (intent === "dynamicFieldSummary") {
    const row = rows[0];
    return `${rangeInfo} araliginda ${row.fieldName} alani ${formatNumber(
      row.responseCount
    )} kayitta dolu.`;
  }

  if (intent === "dynamicTopFields") {
    const top = rows.slice(0, 5);
    const bullets = top
      .map((r) => `- Field-${r.fieldId}: ${formatNumber(r.responseCount)} cevap`)
      .join("\n");
    return `${rangeInfo} araliginda en cok doldurulan dynamic fieldlar:\n${bullets}`;
  }

  if (intent === "userTotalCount") {
    const total = rows[0]?.totalUsers ?? 0;
    return `${rangeInfo} icin toplam ${formatNumber(total)} silinmemis kullanici var.`;
  }

  if (intent === "userStatusSummary") {
    const row = rows[0];
    return `${rangeInfo} kullanici ozeti: toplam ${formatNumber(
      row.totalUsers
    )}, aktif ${formatNumber(row.activeUsers)}, bloke ${formatNumber(
      row.blockedUsers
    )}, silme talebi olan ${formatNumber(row.deleteRequestUsers)} kullanici var.`;
  }

  if (intent === "userAdminSummary") {
    const row = rows[0];
    return `${rangeInfo} yetki ozeti: admin ${formatNumber(
      row.adminUsers
    )}, API user ${formatNumber(row.apiUsers)}, client user ${formatNumber(
      row.clientUsers
    )}, contractor ${formatNumber(row.contractorUsers)} kullanici var.`;
  }

  if (intent === "usersByRole") {
    const top = rows.slice(0, 5);
    const bullets = top
      .map((r) => `- ${r.roleName}: ${formatNumber(r.totalUsers)} kullanici`)
      .join("\n");
    return `${rangeInfo} rollere gore kullanici dagilimi:\n${bullets}`;
  }

  if (intent === "usersByTeam") {
    const top = rows.slice(0, 5);
    const bullets = top
      .map(
        (r) =>
          `- ${r.teamName}: ${formatNumber(r.totalUsers)} kullanici, ${formatNumber(
            r.managerCount
          )} manager, ${formatNumber(r.memberCount)} member`
      )
      .join("\n");
    return `${rangeInfo} takimlara gore kullanici dagilimi:\n${bullets}`;
  }

  if (intent === "usersByBrand") {
    const top = rows.slice(0, 5);
    const bullets = top
      .map((r) => `- ${r.brandName}: ${formatNumber(r.totalUsers)} kullanici`)
      .join("\n");
    return `${rangeInfo} markalara gore kullanici dagilimi:\n${bullets}`;
  }

  if (intent === "usersByClient") {
    const top = rows.slice(0, 5);
    const bullets = top
      .map((r) => `- ${r.clientName}: ${formatNumber(r.totalUsers)} kullanici`)
      .join("\n");
    return `${rangeInfo} clientlara gore kullanici dagilimi:\n${bullets}`;
  }

  if (intent === "userRecentLogins") {
    const top = rows.slice(0, 5);
    const bullets = top
      .map(
        (r) =>
          `- ${formatDateTime(r.loginDate)} / ${r.userName}: ${r.loginSuccess ? "Basarili" : "Basarisiz"
          }`
      )
      .join("\n");

    return `${rangeInfo} son login kayitlari:\n${bullets}`;
  }

  if (intent === "userLoginSuccessSummary") {
    const top = rows.slice(0, 5);
    const bullets = top
      .map(
        (r) =>
          `- ${r.loginStatus} / ${r.app} / ${r.domain}: ${formatNumber(
            r.totalLogins
          )} login`
      )
      .join("\n");
    return `${rangeInfo} login basari ozeti:\n${bullets}`;
  }

  if (intent === "userDeviceSummary") {
    const row = rows[0];
    return `${rangeInfo} cihaz ozeti: toplam ${formatNumber(
      row.totalDeviceRecords
    )} cihaz kaydi, ${formatNumber(row.usersWithDevice)} cihazli kullanici, ${formatNumber(
      row.activeDeviceRecords
    )} aktif cihaz kaydi var.`;
  }

  if (intent === "userSavedViewSummary") {
    const top = rows.slice(0, 5);
    const bullets = top
      .map(
        (r) =>
          `- ${r.moduleName}: ${formatNumber(r.savedViewCount)} kayitli gorunum, ${formatNumber(
            r.userCount
          )} kullanici`
      )
      .join("\n");
    return `${rangeInfo} modullere gore kayitli gorunum ozeti:\n${bullets}`;
  }

  if (intent === "userStepSummary") {
    const top = rows.slice(0, 5);
    const bullets = top
      .map(
        (r) =>
          `- ${r.userName}: ${formatNumber(r.totalSteps)} toplam adim, ortalama ${Number(
            r.avgSteps || 0
          ).toFixed(1)}`
      )
      .join("\n");
    return `${rangeInfo} kullanici adim ozeti:\n${bullets}`;
  }

  if (intent === "userVisitSummary") {
    const top = rows.slice(0, 5);
    const bullets = top
      .map(
        (r) =>
          `- ${r.userName}: ${formatNumber(r.totalVisits)} ziyaret, ${formatNumber(
            r.realizedVisits
          )} gerceklesen`
      )
      .join("\n");
    return `${rangeInfo} kullanici bazli ziyaret ozeti:\n${bullets}`;
  }

  return `${rangeInfo} araliginda ${formatNumber(rows.length)} satir sonuc bulundu.`;
}

// ==========================================
// CORE & CHAT ROUTES
// ==========================================

router.get("/health", (_req, res) => {
  res.json({ ok: true, service: "db-chatbot-backend" });
});

router.get("/planner/metrics", (_req, res) => {
  res.json({ domain: "fieldpie_chatbot", metrics: listMetrics() });
});

router.post("/planner/plan", (req, res) => {
  try {
    const question = req.body?.question;
    if (!question) {
      return res.status(400).json({ error: "question zorunludur." });
    }

    const filters = parseFilters(req.body?.filters || {});
    const userContext = req.body?.userContext || {};
    const plan = buildQueryPlan(question, filters, userContext);
    return res.json({ plan });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.post("/planner/query", authMiddleware, async (req, res) => {
  try {
    const question = req.body?.question;
    if (!question) {
      return res.status(400).json({ error: "question zorunludur." });
    }

    const filters = parseFilters(req.body?.filters || {});
    const authUserId = req.authUser?.userId;

    if (!authUserId) {
      return res.status(401).json({ error: "Kimlik dogrulama bilgisi bulunamadi." });
    }

    const userContext = await getEffectivePermissions(authUserId);
    const plan = buildQueryPlan(question, filters, userContext);
    const result = await executeIntent(plan.intent, plan.params, { userContext });

    return res.json({
      plan,
      rows: result.recordset,
      security: result.security,
    });
  } catch (error) {
    return res.status(getRouteErrorStatus(error)).json({ error: error.message });
  }
});

router.post("/chat/query", optionalAuthMiddleware, async (req, res) => {
  try {
    const question = req.body?.question;
    if (!question) {
      return res.status(400).json({ error: "question zorunludur." });
    }

    const filters = parseFilters(req.body?.filters || {});
    const resolved = resolveIntent(question, filters);
    const authUserId = req.authUser?.userId;
    let userContext = null;

    if (authUserId) {
      userContext = await getEffectivePermissions(authUserId);
    }

    if (resolved.needsClarification) {
      const optionText = (resolved.options || [])
        .map((option) => `- ${option.label || option.intent}`)
        .join("\n");

      const clarificationAnswer = optionText
        ? `${resolved.message}\n${optionText}`
        : resolved.message;

      return res.json({
        question,
        needsClarification: true,
        message: resolved.message,
        options: resolved.options,
        candidates: resolved.candidates,
        answer: clarificationAnswer,
        scope: buildScopePreview(userContext, null, null),
      });
    }

    const { intent: resolvedIntent, params: resolvedParams } = resolved;
    const intent = resolveVisitIntentOverride(question, resolvedIntent) || resolvedIntent;
    const params = parseQuestionFilters(question, intent, resolvedParams);
    const metric = getMetricByIntent(intent);

    if (authUserId && !metric) {
      return res.status(400).json({
        error: `Bu soru icin metric kaydi bulunamadi: ${intent}`,
        intent,
      });
    }

    const scopePlan = userContext
      ? req.body?.scopeSelection
        ? resolveScopePlanFromSelection(userContext, req.body.scopeSelection, intent)
        : resolveScopePlan(userContext, question, intent)
      : { mode: "self", display: "single", scopePreference: "dual", teamMatch: null, teamIds: [] };

    if (scopePlan.mode === "denied") {
      const answer =
        scopePlan.denyReason === "team_out_of_operational_scope"
          ? buildOutOfScopeTeamAnswer(scopePlan.teamMatch)
          : "Sirket geneli veri yalnizca admin veya tum takimlari yoneten kullanicilara aciktir. Yonetilen takimlariniz icin \"ziyaret sayisi\" sorabilirsiniz.";

      return res.json({
        question,
        intent,
        confidence: resolved.confidence,
        score: resolved.score,
        source: resolved.source,
        filters: params,
        scopePreference: scopePlan.scopePreference,
        scopePlan,
        scope: buildScopePreview(userContext, metric, null),
        answer,
        candidates: resolved.candidates,
      });
    }

    if (scopePlan.mode === "scope_pick_required") {
      return res.json({
        question,
        intent,
        confidence: resolved.confidence,
        score: resolved.score,
        source: resolved.source,
        filters: params,
        scopePreference: scopePlan.scopePreference,
        scopePlan,
        scope: buildScopePreview(userContext, metric, null),
        answer: scopePlan.answer,
        candidates: resolved.candidates,
      });
    }

    if (scopePlan.mode === "clarify") {
      return res.json({
        question,
        intent,
        confidence: resolved.confidence,
        score: resolved.score,
        source: resolved.source,
        filters: params,
        scopePreference: scopePlan.scopePreference,
        scopePlan,
        needsClarification: true,
        scope: buildScopePreview(userContext, metric, null),
        answer: buildTeamClarificationAnswer(scopePlan.teamMatch),
        candidates: resolved.candidates,
      });
    }

    if (scopePlan.teamMatch?.teamId) {
      params.teamId = scopePlan.teamMatch.teamId;
    }

    const runDualScope = scopePlan.mode === "dual";
    const runSingleTeamScope = scopePlan.mode === "single_team";
    const runMultiTeamScope = scopePlan.mode === "multi_team";
    const runCompanyTeamScope = scopePlan.mode === "company_team_breakdown";
    const scopePreference = scopePlan.scopePreference;

    let userContextForQuery = userContext;
    if (scopePlan.mode === "company" && userContext?.companyCapable) {
      userContextForQuery = buildScopedUserContext(userContext, "company");
    }

    const scopeDecision = userContextForQuery
      ? evaluateScopeRequirements({ metric, userContext: userContextForQuery })
      : null;
    const sql = buildSqlPreview(
      intent,
      params,
      userContextForQuery ? { userContext: userContextForQuery, metric } : {}
    );

    let result;
    let dualScope = null;
    let multiTeamScope = null;
    let singleTeamScope = null;
    let companyTeamScope = null;

    if (runCompanyTeamScope) {
      const toolbarConfig = buildScopeToolbarConfig(userContext);
      const companyContext = buildScopedUserContext(userContext, "company");
      const breakdownTeams = resolveBreakdownTeamList(
        userContext,
        toolbarConfig,
        scopePlan.teamIds
      );
      const companyResult = await executeIntent(intent, params, {
        userContext: companyContext,
        metric,
      });
      const normalizedCompanyRows = applyIntentRowNormalization(
        intent,
        companyResult.recordset
      );
      const companyCustomerBreakdown = await buildCustomerBreakdownForMainRows(
        intent,
        params,
        normalizedCompanyRows,
        companyContext,
        metric
      );

      const teamResults = await mapTeamsWithConcurrency(breakdownTeams, async (team) => {
        const teamContext = await buildIntentSingleTeamScopedContext(
          intent,
          userContext,
          team.teamId
        );
        const teamResult = await executeIntent(intent, params, {
          userContext: teamContext,
          metric,
        });
        const normalizedTeamRows = applyIntentRowNormalization(
          intent,
          teamResult.recordset
        );
        const teamCustomerBreakdown = await buildCustomerBreakdownForMainRows(
          intent,
          params,
          normalizedTeamRows,
          teamContext,
          metric
        );

        return {
          teamId: team.teamId,
          teamName: team.teamName,
          displayLabel: formatOperationalDisplayLabel(team.teamName),
          rows: normalizedTeamRows,
          customerBreakdown: teamCustomerBreakdown,
          allowedUserIdsCount: teamContext.allowedUserIds?.length || 0,
        };
      });

      let selectedCombinedRows;
      let selectedCustomerBreakdown = [];
      let selectedAllowedUserIdsCount;
      const useCompanyScopeForCombinedTotal = !!scopePlan.useCompanyScopeForCombinedTotal;

      if (useCompanyScopeForCombinedTotal) {
        selectedCombinedRows = normalizedCompanyRows;
        selectedCustomerBreakdown = companyCustomerBreakdown;
        selectedAllowedUserIdsCount = companyContext.allowedUserIds?.length || 0;
      } else {
        const selectedContext = await buildIntentSelectedTeamsCombinedContext(
          intent,
          userContext,
          breakdownTeams.map((team) => team.teamId)
        );
        const selectedCombinedResult = await executeIntent(intent, params, {
          userContext: selectedContext,
          metric,
        });
        selectedCombinedRows = applyIntentRowNormalization(
          intent,
          selectedCombinedResult.recordset
        );
        selectedCustomerBreakdown = await buildCustomerBreakdownForMainRows(
          intent,
          params,
          selectedCombinedRows,
          selectedContext,
          metric
        );
        selectedAllowedUserIdsCount = selectedContext.allowedUserIds?.length || 0;
      }

      let memberBreakdown = null;
      if (scopePlan.includeMemberBreakdown && breakdownTeams.length === 1) {
        const singleTeam = breakdownTeams[0];
        const teamContext = await buildIntentSingleTeamScopedContext(intent, userContext, singleTeam.teamId);
        memberBreakdown = await executeTeamMemberBreakdown({
          intent,
          params,
          userContext,
          teamId: singleTeam.teamId,
          teamContext,
          metric,
          executeIntent,
          normalizeRows: (rows) => applyIntentRowNormalization(intent, rows),
        });
      }

      companyTeamScope = {
        mode: "company_team_breakdown",
        company: {
          label: userContext.companyScopeLabel || "Sirket geneli",
          displayLabel: formatCompanyDisplayLabel(userContext.companyScopeLabel),
          rows: normalizedCompanyRows,
          customerBreakdown: companyCustomerBreakdown,
          allowedUserIdsCount: companyContext.allowedUserIds?.length || 0,
        },
        teams: teamResults,
        selectedCombined: {
          label: useCompanyScopeForCombinedTotal
            ? "Sirket geneli toplam"
            : scopePlan.combinedLabel || "Secili takimlar toplami",
          rows: selectedCombinedRows,
          customerBreakdown: selectedCustomerBreakdown,
          allowedUserIdsCount: selectedAllowedUserIdsCount,
        },
        displayLimit: TEAM_DISPLAY_LIMIT,
        teamTotalCount: breakdownTeams.length,
        hasMoreTeams: breakdownTeams.length > TEAM_DISPLAY_LIMIT,
        includeMemberBreakdown: !!memberBreakdown?.members?.length,
        members: memberBreakdown?.members || [],
        memberTotalCount: memberBreakdown?.memberTotalCount || 0,
        memberDisplayLimit: memberBreakdown?.displayLimit || MEMBER_DISPLAY_LIMIT,
        hasMoreMembers: memberBreakdown?.hasMore || false,
        overlapNotice:
          teamResults.length > 1
            ? getTeamTotalNotice(intent, COMPANY_TEAM_TOTAL_OVERLAP_NOTICE)
            : null,
      };
      result = companyResult;
      userContextForQuery = companyContext;
    } else if (runDualScope) {
      const operationalContext = buildScopedUserContext(userContext, "operational");
      const companyContext = buildScopedUserContext(userContext, "company");
      const [operationalResult, companyResult] = await Promise.all([
        executeIntent(intent, params, { userContext: operationalContext, metric }),
        executeIntent(intent, params, { userContext: companyContext, metric }),
      ]);

      const normalizedOperationalRows = applyIntentRowNormalization(
        intent,
        operationalResult.recordset
      );
      const normalizedCompanyRows = applyIntentRowNormalization(
        intent,
        companyResult.recordset
      );

      const operationalCustomerBreakdown = await buildCustomerBreakdownForMainRows(
        intent,
        params,
        normalizedOperationalRows,
        operationalContext,
        metric
      );
      const companyCustomerBreakdown = await buildCustomerBreakdownForMainRows(
        intent,
        params,
        normalizedCompanyRows,
        companyContext,
        metric
      );

      const operationalLabel = userContext.operationalScopeLabel || "Takim";
      const companyLabel = userContext.companyScopeLabel || "Sirket geneli";
      dualScope = {
        operational: {
          mode: "operational",
          label: operationalLabel,
          displayLabel: formatOperationalDisplayLabel(operationalLabel),
          rows: normalizedOperationalRows,
          customerBreakdown: operationalCustomerBreakdown,
          allowedUserIdsCount: operationalContext.allowedUserIds?.length || 0,
        },
        company: {
          mode: "company",
          label: companyLabel,
          displayLabel: formatCompanyDisplayLabel(companyLabel),
          rows: normalizedCompanyRows,
          customerBreakdown: companyCustomerBreakdown,
          allowedUserIdsCount: companyContext.allowedUserIds?.length || 0,
        },
      };
      result = operationalResult;
    } else if (runSingleTeamScope && scopePlan.teamMatch?.teamId) {
      const teamContext = await buildIntentSingleTeamScopedContext(
        intent,
        userContext,
        scopePlan.teamMatch.teamId
      );
      const teamResult = await executeIntent(intent, params, {
        userContext: teamContext,
        metric,
      });
      const normalizedTeamRows = applyIntentRowNormalization(intent, teamResult.recordset);
      const teamCustomerBreakdown = await buildCustomerBreakdownForMainRows(
        intent,
        params,
        normalizedTeamRows,
        teamContext,
        metric
      );

      const memberBreakdown = await executeTeamMemberBreakdown({
        intent,
        params,
        userContext,
        teamId: scopePlan.teamMatch.teamId,
        teamContext,
        metric,
        executeIntent,
        normalizeRows: (rows) => applyIntentRowNormalization(intent, rows),
      });
      singleTeamScope = {
        mode: "single_team",
        teamId: scopePlan.teamMatch.teamId,
        teamName: scopePlan.teamMatch.teamName,
        displayLabel: formatOperationalDisplayLabel(scopePlan.teamMatch.teamName),
        rows: normalizedTeamRows,
        customerBreakdown: teamCustomerBreakdown,
        allowedUserIdsCount: teamContext.allowedUserIds?.length || 0,
        members: memberBreakdown.members,
        memberTotalCount: memberBreakdown.memberTotalCount,
        displayLimit: memberBreakdown.displayLimit || MEMBER_DISPLAY_LIMIT,
        hasMoreMembers: memberBreakdown.hasMore,
      };
      result = {
        ...teamResult,
        recordset: singleTeamScope.rows,
      };
      userContextForQuery = teamContext;
    } else if (runMultiTeamScope) {
      const toolbarConfig =
        scopePlan.source === "toolbar" ? buildScopeToolbarConfig(userContext) : null;
      const breakdownTeams =
        scopePlan.scopeSource === "selected"
          ? resolveBreakdownTeamList(userContext, toolbarConfig, scopePlan.teamIds)
          : scopePlan.scopeSource === "subscription"
            ? resolveSubscriptionTeams(userContext).length
              ? resolveSubscriptionTeams(userContext)
              : resolveScopeTeams(userContext)
            : userContext.companyCapable && toolbarConfig?.operationalTeams?.length
              ? toolbarConfig.operationalTeams
              : resolveManagedTeams(userContext);
      const teamResults = await mapTeamsWithConcurrency(breakdownTeams, async (team) => {
        const teamContext = await buildIntentSingleTeamScopedContext(
          intent,
          userContext,
          team.teamId
        );
        const teamResult = await executeIntent(intent, params, {
          userContext: teamContext,
          metric,
        });
        const normalizedTeamRows = applyIntentRowNormalization(
          intent,
          teamResult.recordset
        );
        const teamCustomerBreakdown = await buildCustomerBreakdownForMainRows(
          intent,
          params,
          normalizedTeamRows,
          teamContext,
          metric
        );

        return {
          teamId: team.teamId,
          teamName: team.teamName,
          displayLabel: formatOperationalDisplayLabel(team.teamName),
          rows: normalizedTeamRows,
          customerBreakdown: teamCustomerBreakdown,
          allowedUserIdsCount: teamContext.allowedUserIds?.length || 0,
        };
      });
      let combinedContext = null;
      let combinedRows = [];
      let combinedCustomerBreakdown = [];
      let combinedResult;

      if (
        scopePlan.scopeSource === "selected" ||
        scopePlan.scopeSource === "managed"
      ) {
        combinedContext = await buildIntentSelectedTeamsCombinedContext(
          intent,
          userContext,
          breakdownTeams.map((team) => team.teamId)
        );
        combinedResult = await executeIntent(intent, params, {
          userContext: combinedContext,
          metric,
        });
        combinedRows = applyIntentRowNormalization(intent, combinedResult.recordset);
      } else if (scopePlan.scopeSource === "subscription") {
        combinedContext = buildScopedUserContext(userContext, "company");
        combinedResult = await executeIntent(intent, params, {
          userContext: combinedContext,
          metric,
        });
        combinedRows = applyIntentRowNormalization(intent, combinedResult.recordset);
      } else {
        combinedContext = userContext;
        combinedResult = await executeIntent(intent, params, {
          userContext: combinedContext,
          metric,
        });
        combinedRows = applyIntentRowNormalization(intent, combinedResult.recordset);
      }

      combinedCustomerBreakdown = await buildCustomerBreakdownForMainRows(
        intent,
        params,
        combinedRows,
        combinedContext,
        metric
      );

      multiTeamScope = {
        mode: "multi_team",
        scopeSource: scopePlan.scopeSource || "managed",
        label: `${breakdownTeams.length} takim`,
        combinedLabel: scopePlan.combinedLabel || null,
        teams: teamResults,
        combined: {
          label: scopePlan.combinedLabel || null,
          rows: combinedRows,
          customerBreakdown: combinedCustomerBreakdown,
          allowedUserIdsCount: combinedContext?.allowedUserIds?.length || 0,
        },
        displayLimit: TEAM_DISPLAY_LIMIT,
        teamTotalCount: breakdownTeams.length,
        hasMoreTeams: breakdownTeams.length > TEAM_DISPLAY_LIMIT,
        overlapNotice:
          teamResults.length > 1
            ? getTeamTotalNotice(intent, MULTI_TEAM_TOTAL_OVERLAP_NOTICE)
            : null,
      };
      result = combinedResult;
    } else if (userContextForQuery) {
      result = await executeIntent(intent, params, {
        userContext: userContextForQuery,
        metric,
      });
    } else {
      result = await executeIntent(intent, params);
    }

    result.recordset = applyIntentRowNormalization(intent, result.recordset);
    if (singleTeamScope) {
      singleTeamScope.rows = result.recordset;
    }

    const rows = result.recordset;
    const hasStructuredScope = !!(
      dualScope ||
      singleTeamScope ||
      multiTeamScope ||
      companyTeamScope
    );

    const customerBreakdown = !hasStructuredScope
      ? await buildCustomerBreakdownForMainRows(
        intent,
        params,
        rows,
        userContextForQuery || userContext,
        metric
      )
      : [];

    let llmSummary = null;
    try {
      llmSummary = await summarizeWithGemini({
        question,
        intent,
        data: dualScope
          ? {
            operational: dualScope.operational.rows,
            company: dualScope.company.rows,
          }
          : multiTeamScope
            ? {
              teams: multiTeamScope.teams.map((team) => ({
                teamName: team.teamName,
                rows: team.rows,
              })),
              combined: multiTeamScope.combined.rows,
            }
            : singleTeamScope
              ? { teamName: singleTeamScope.teamName, rows: singleTeamScope.rows }
              : rows,
      });
    } catch (_err) {
      llmSummary = null;
    }
    const scopePayload = {
      dualScope,
      singleTeamScope,
      multiTeamScope,
      companyTeamScope,
      rows,
      customerBreakdown,
    };
    const fallbackSummary = renderScopeAnswer(intent, params, scopePayload);
    const structuredScopeAnswer = hasStructuredScope;
    const rawAnswer =
      structuredScopeAnswer || shouldUseCustomerBreakdown(intent)
        ? fallbackSummary
        : llmSummary || fallbackSummary;
    const answer = normalizeAnswerTurkishText(
      prefixScopeAnswer(
        buildScopeAnswerPrefix(userContext, scopePlan, scopePayload),
        rawAnswer
      )
    );

    return res.json({
      question,
      intent,
      confidence: resolved.confidence,
      score: resolved.score,
      source: resolved.source,
      filters: params,
      sql,
      scopePreference,
      scopePlan,
      dualScope,
      singleTeamScope,
      multiTeamScope,
      companyTeamScope,
      scope: buildScopePreview(userContextForQuery || userContext, metric, scopeDecision),
      security: result.security || null,
      rows,
      answer,
      candidates: resolved.candidates,
    });
  } catch (error) {
    return res.status(getRouteErrorStatus(error)).json({ error: error.message });
  }
});

// ==========================================
// USER ROUTES (Orijinal)
// ==========================================
router.get("/users/count", async (req, res) => {
  try {
    const filters = parseFilters(req.query);
    const result = await executeIntent("userTotalCount", filters);
    res.json({ intent: "userTotalCount", rows: result.recordset });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/users/status-summary", async (req, res) => {
  try {
    const filters = parseFilters(req.query);
    const result = await executeIntent("userStatusSummary", filters);
    res.json({ intent: "userStatusSummary", rows: result.recordset });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/users/admin-summary", async (req, res) => {
  try {
    const filters = parseFilters(req.query);
    const result = await executeIntent("userAdminSummary", filters);
    res.json({ intent: "userAdminSummary", rows: result.recordset });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/users/by-role", async (req, res) => {
  try {
    const filters = parseFilters(req.query);
    const result = await executeIntent("usersByRole", filters);
    res.json({ intent: "usersByRole", rows: result.recordset });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/users/by-team", async (req, res) => {
  try {
    const filters = parseFilters(req.query);
    const result = await executeIntent("usersByTeam", filters);
    res.json({ intent: "usersByTeam", rows: result.recordset });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/users/by-brand", async (req, res) => {
  try {
    const filters = parseFilters(req.query);
    const result = await executeIntent("usersByBrand", filters);
    res.json({ intent: "usersByBrand", rows: result.recordset });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/users/by-client", async (req, res) => {
  try {
    const filters = parseFilters(req.query);
    const result = await executeIntent("usersByClient", { ...filters, limit: filters.limit || 20 });
    res.json({ intent: "usersByClient", rows: result.recordset });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/users/recent-logins", async (req, res) => {
  try {
    const filters = parseFilters(req.query);
    const result = await executeIntent("userRecentLogins", { ...filters, limit: filters.limit || 20 });
    res.json({ intent: "userRecentLogins", rows: result.recordset });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/users/login-summary", async (req, res) => {
  try {
    const filters = parseFilters(req.query);
    const result = await executeIntent("userLoginSuccessSummary", filters);
    res.json({ intent: "userLoginSuccessSummary", rows: result.recordset });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/users/device-summary", async (req, res) => {
  try {
    const filters = parseFilters(req.query);
    const result = await executeIntent("userDeviceSummary", filters);
    res.json({ intent: "userDeviceSummary", rows: result.recordset });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/users/saved-view-summary", async (req, res) => {
  try {
    const filters = parseFilters(req.query);
    const result = await executeIntent("userSavedViewSummary", filters);
    res.json({ intent: "userSavedViewSummary", rows: result.recordset });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/users/step-summary", async (req, res) => {
  try {
    const filters = parseFilters(req.query);
    const result = await executeIntent("userStepSummary", { ...filters, limit: filters.limit || 20 });
    res.json({ intent: "userStepSummary", rows: result.recordset });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/users/visit-summary", async (req, res) => {
  try {
    const filters = parseFilters(req.query);
    const result = await executeIntent("userVisitSummary", { ...filters, limit: filters.limit || 20 });
    res.json({ intent: "userVisitSummary", rows: result.recordset });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// VISIT ROUTES (Orijinal)
// ==========================================
router.get("/visit/count", optionalAuthMiddleware, async (req, res) => {
  try {
    const filters = parseFilters(req.query);
    const options = await buildAuthIntentOptions(req, "visitCountRealized");
    const result = await executeIntent("visitCountRealized", filters, options);
    res.json({ intent: "visitCountRealized", rows: result.recordset, security: result.security || null });
  } catch (error) {
    res.status(getRouteErrorStatus(error)).json({ error: error.message });
  }
});

router.get("/visit/duration/avg", optionalAuthMiddleware, async (req, res) => {
  try {
    const filters = parseFilters(req.query);
    const options = await buildAuthIntentOptions(req, "avgVisitDuration");
    const result = await executeIntent("avgVisitDuration", filters, options);
    res.json({ intent: "avgVisitDuration", rows: result.recordset, security: result.security || null });
  } catch (error) {
    res.status(getRouteErrorStatus(error)).json({ error: error.message });
  }
});

router.get("/visit/by-state", optionalAuthMiddleware, async (req, res) => {
  try {
    const filters = parseFilters(req.query);
    const options = await buildAuthIntentOptions(req, "visitsByState");
    const result = await executeIntent("visitsByState", filters, options);
    res.json({ intent: "visitsByState", rows: result.recordset, security: result.security || null });
  } catch (error) {
    res.status(getRouteErrorStatus(error)).json({ error: error.message });
  }
});

router.get("/visit/trend", optionalAuthMiddleware, async (req, res) => {
  try {
    const filters = parseFilters(req.query);
    const options = await buildAuthIntentOptions(req, "visitTrend");
    const result = await executeIntent("visitTrend", filters, options);
    res.json({ intent: "visitTrend", rows: result.recordset, security: result.security || null });
  } catch (error) {
    res.status(getRouteErrorStatus(error)).json({ error: error.message });
  }
});

router.get("/visit/by-type", optionalAuthMiddleware, async (req, res) => {
  try {
    const filters = parseFilters(req.query);
    const options = await buildAuthIntentOptions(req, "visitsByType");
    const result = await executeIntent("visitsByType", filters, options);
    res.json({ intent: "visitsByType", rows: result.recordset, security: result.security || null });
  } catch (error) {
    res.status(getRouteErrorStatus(error)).json({ error: error.message });
  }
});

router.get("/dynamic-data/field-summary", async (req, res) => {
  try {
    const filters = parseFilters(req.query);
    const recentRange = filters.startDate || filters.endDate ? filters : getDefaultRecentRange(30);
    const resolvedField = resolveFieldName(filters.fieldName || "Raf");
    const result = await executeIntent("dynamicFieldSummary", {
      ...recentRange,
      fieldName: resolvedField,
      fieldId: filters.fieldId || null,
    });
    res.json({
      intent: "dynamicFieldSummary",
      fieldName: resolvedField,
      fieldId: filters.fieldId || null,
      filters: recentRange,
      rows: result.recordset,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/dynamic-data/top-fields", async (req, res) => {
  try {
    const filters = parseFilters(req.query);
    const recentRange = filters.startDate || filters.endDate ? filters : getDefaultRecentRange(30);
    const result = await executeIntent("dynamicTopFields", {
      ...recentRange,
      limit: filters.limit || 20,
    });
    res.json({
      intent: "dynamicTopFields",
      filters: recentRange,
      rows: result.recordset,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// CLIENT (MÜŞTERİ BİLGİLERİ) ROUTES (YENİ)
// ==========================================
router.get("/clients/active", async (req, res) => {
  try {
    const filters = parseFilters(req.query);
    const result = await executeIntent("clientCountActive", filters);
    res.json({ intent: "clientCountActive", rows: result.recordset });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/clients/total", async (req, res) => {
  try {
    const filters = parseFilters(req.query);
    const result = await executeIntent("clientCountTotal", filters);
    res.json({ intent: "clientCountTotal", rows: result.recordset });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/clients/by-group", async (req, res) => {
  try {
    const filters = parseFilters(req.query);
    const result = await executeIntent("clientsByGroup", filters);
    res.json({ intent: "clientsByGroup", rows: result.recordset });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/clients/trend", async (req, res) => {
  try {
    const filters = parseFilters(req.query);
    const result = await executeIntent("clientTrend", filters);
    res.json({ intent: "clientTrend", rows: result.recordset });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/distributors/total", async (req, res) => {
  try {
    const filters = parseFilters(req.query);
    const result = await executeIntent("totalDistributors", filters);
    res.json({ intent: "totalDistributors", rows: result.recordset });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/distributors/by-region", async (req, res) => {
  try {
    const filters = parseFilters(req.query);
    const result = await executeIntent("distributorsByRegion", filters);
    res.json({ intent: "distributorsByRegion", rows: result.recordset });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/consumers/total", async (req, res) => {
  try {
    const filters = parseFilters(req.query);
    const result = await executeIntent("consumerCountTotal", filters);
    res.json({ intent: "consumerCountTotal", rows: result.recordset });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// ==========================================
// SALES & FINANCE (SATIŞ VE FİNANS) ROUTES (YENİ)
// ==========================================
router.get("/sales/purchase-orders/total", async (req, res) => {
  try {
    const filters = parseFilters(req.query);
    const result = await executeIntent("totalPurchaseOrders", filters);
    res.json({ intent: "totalPurchaseOrders", rows: result.recordset });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/sales/purchase-orders/amount", async (req, res) => {
  try {
    const filters = parseFilters(req.query);
    const result = await executeIntent("totalPurchaseOrderAmount", filters);
    res.json({ intent: "totalPurchaseOrderAmount", rows: result.recordset });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/sales/purchase-orders/by-status", async (req, res) => {
  try {
    const filters = parseFilters(req.query);
    const result = await executeIntent("purchaseOrdersByStatus", filters);
    res.json({ intent: "purchaseOrdersByStatus", rows: result.recordset });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/sales/invoices/total", async (req, res) => {
  try {
    const filters = parseFilters(req.query);
    const result = await executeIntent("totalInvoices", filters);
    res.json({ intent: "totalInvoices", rows: result.recordset });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/sales/invoices/amount", async (req, res) => {
  try {
    const filters = parseFilters(req.query);
    const result = await executeIntent("totalInvoiceAmount", filters);
    res.json({ intent: "totalInvoiceAmount", rows: result.recordset });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/sales/invoices/balance", async (req, res) => {
  try {
    const filters = parseFilters(req.query);
    const result = await executeIntent("totalInvoiceBalance", filters);
    res.json({ intent: "totalInvoiceBalance", rows: result.recordset });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/sales/invoices/by-status", async (req, res) => {
  try {
    const filters = parseFilters(req.query);
    const result = await executeIntent("invoicesByStatus", filters);
    res.json({ intent: "invoicesByStatus", rows: result.recordset });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/sales/payments/total", async (req, res) => {
  try {
    const filters = parseFilters(req.query);
    const result = await executeIntent("totalInvoicePayments", filters);
    res.json({ intent: "totalInvoicePayments", rows: result.recordset });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/sales/campaigns/active", async (req, res) => {
  try {
    const filters = parseFilters(req.query);
    const result = await executeIntent("activeCampaigns", filters);
    res.json({ intent: "activeCampaigns", rows: result.recordset });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/sales/campaigns/total", async (req, res) => {
  try {
    const filters = parseFilters(req.query);
    const result = await executeIntent("totalCampaigns", filters);
    res.json({ intent: "totalCampaigns", rows: result.recordset });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/sales/costs/total", async (req, res) => {
  try {
    const filters = parseFilters(req.query);
    const result = await executeIntent("totalCosts", filters);
    res.json({ intent: "totalCosts", rows: result.recordset });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/sales/commissions/total", async (req, res) => {
  try {
    const filters = parseFilters(req.query);
    const result = await executeIntent("totalCommissions", filters);
    res.json({ intent: "totalCommissions", rows: result.recordset });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/sales/iyzico/total", async (req, res) => {
  try {
    const filters = parseFilters(req.query);
    const result = await executeIntent("totalIyzicoTransactions", filters);
    res.json({ intent: "totalIyzicoTransactions", rows: result.recordset });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
