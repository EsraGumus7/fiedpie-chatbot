const express = require("express");
const { queryDb } = require("../db/sql");
const templates = require("../services/queryTemplates");
const { resolveFieldName } = require("../services/intentParser");
const { resolveIntent } = require("../services/metricResolver");
const { summarizeWithGemini } = require("../services/gemini");
const { buildQueryPlan } = require("../planner/queryPlanner");
const { listMetrics } = require("../planner/metricRegistry");

const router = express.Router();

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
    // Users/RBAC hazırlığı: production akışında UserContext'ten gelmeli.
    // Geçiş döneminde GET endpointleri query param ile de test edilebilir.
    subscriptionId: input.subscriptionId ? Number(input.subscriptionId) : null,
  };
}


function mergeSecurityParams(params = {}, userContext = {}) {
  return {
    ...params,
    subscriptionId:
      userContext.subscriptionId || userContext.tenantId || params.subscriptionId || null,
    currentUserId: userContext.userId || params.currentUserId || null,
    manageAll: Boolean(userContext.manageAll || userContext.managerOfAllTeams),
    managedTeamIds: userContext.managedTeamIds || [],
    assignedClientIds: userContext.assignedClientIds || [],
    clientTagIds: userContext.clientTagIds || [],
  };
}


async function executeIntent(intent, params, userContext = {}) {
  const templateBuilder = templates[intent];
  if (!templateBuilder) {
    throw new Error(`Intent bulunamadi: ${intent}`);
  }
  return queryDb(templateBuilder(mergeSecurityParams(params || {}, userContext)));
}

function formatNumber(value) {
  if (value == null || Number.isNaN(Number(value))) return "-";
  return new Intl.NumberFormat("tr-TR").format(Number(value));
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
    return `${rangeInfo} araliginda islem goren toplam tutar: ${formatNumber(total)}.`;
  }

  // 3. Bakiye İşlemleri (Özel)
  if (intent === "totalInvoiceBalance") {
    const total = rows[0]?.totalBalance ?? 0;
    return `${rangeInfo} itibariyla odenmemis toplam fatura bakiyesi: ${formatNumber(total)}.`;
  }

  // 4. Dağılım ve Gruplama (Group By) İşlemleri
  const groupIntents = [
    "clientsByGroup",
    "clientsByState",
    "clientsByCountry",
    "clientsByProgramType",

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
    const bullets = top.map((r) => {
      const name = r.groupName || r.regionName || r.statusName || "Bilinmeyen Dağılım";
      return `- ${name}: ${formatNumber(r.total)} kayit`;
    }).join("\n");
    return `${rangeInfo} dagilim ozeti:\n${bullets}`;
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
    const total = rows.reduce((sum, item) => sum + Number(item.total || 0), 0);
    const avg = rows.length ? (total / rows.length).toFixed(2) : "0";
    const maxRow = rows.reduce((max, item) =>
      Number(item.total || 0) > Number(max.total || 0) ? item : max
    );
    const maxDate = String(maxRow.visitDate || "").slice(0, 10);
    return `${rangeInfo} araliginda ${rows.length} gun veri var. Toplam ${formatNumber(
      total
    )} ziyaret, gunluk ortalama ${avg}. En yuksek gun ${maxDate} (${formatNumber(
      maxRow.total
    )} ziyaret).`;
  }

  if (intent === "visitsByType") {
    const top = rows.slice(0, 3);
    const bullets = top
      .map((r) => `- ${r.visitType}: ${formatNumber(r.total)} ziyaret`)
      .join("\n");
    return `${rangeInfo} araliginda ziyaret tip dagilimi:\n${bullets}`;
  }

  if (intent === "visitsByState") {
    const top = rows.slice(0, 3);
    const bullets = top
      .map((r) => `- ${r.visitState}: ${formatNumber(r.total)} ziyaret`)
      .join("\n");
    return `${rangeInfo} araliginda ziyaret durum dagilimi:\n${bullets}`;
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

router.post("/planner/query", async (req, res) => {
  try {
    const question = req.body?.question;
    if (!question) {
      return res.status(400).json({ error: "question zorunludur." });
    }

    const filters = parseFilters(req.body?.filters || {});
    const userContext = req.body?.userContext || {};
    const plan = buildQueryPlan(question, filters, userContext);
    const result = await executeIntent(plan.intent, plan.params, userContext);

    return res.json({
      plan,
      rows: result.recordset,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.post("/chat/query", async (req, res) => {
  try {
    const question = req.body?.question;
    if (!question) {
      return res.status(400).json({ error: "question zorunludur." });
    }

    const filters = parseFilters(req.body?.filters || {});
    const resolved = resolveIntent(question, filters);

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
      });
    }

    const { intent, params } = resolved;
    const userContext = req.body?.userContext || {};
    const result = await executeIntent(intent, params, userContext);

    const rows = result.recordset;
    const llmSummary = await summarizeWithGemini({
      question,
      intent,
      data: rows,
    });
    const fallbackSummary = summarizeRows(intent, rows, params);

    return res.json({
      question,
      intent,
      confidence: resolved.confidence,
      score: resolved.score,
      source: resolved.source,
      filters: params,
      rows,
      answer: llmSummary || fallbackSummary,
      candidates: resolved.candidates,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
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
router.get("/visit/count", async (req, res) => {
  try {
    const filters = parseFilters(req.query);
    const result = await executeIntent("visitCountRealized", filters);
    res.json({ intent: "visitCountRealized", rows: result.recordset });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/visit/duration/avg", async (req, res) => {
  try {
    const filters = parseFilters(req.query);
    const result = await executeIntent("avgVisitDuration", filters);
    res.json({ intent: "avgVisitDuration", rows: result.recordset });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/visit/by-state", async (req, res) => {
  try {
    const filters = parseFilters(req.query);
    const result = await executeIntent("visitsByState", filters);
    res.json({ intent: "visitsByState", rows: result.recordset });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/visit/trend", async (req, res) => {
  try {
    const filters = parseFilters(req.query);
    const result = await executeIntent("visitTrend", filters);
    res.json({ intent: "visitTrend", rows: result.recordset });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/visit/by-type", async (req, res) => {
  try {
    const filters = parseFilters(req.query);
    const result = await executeIntent("visitsByType", filters);
    res.json({ intent: "visitsByType", rows: result.recordset });
  } catch (error) {
    res.status(500).json({ error: error.message });
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
