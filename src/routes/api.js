const express = require("express");
const { queryDb } = require("../db/sql");
const templates = require("../services/queryTemplates");
const { parseQuestion, resolveFieldName } = require("../services/intentParser");
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
  };
}

async function executeIntent(intent, params) {
  const templateBuilder = templates[intent];
  if (!templateBuilder) {
    throw new Error("Intent bulunamadi.");
  }
  return queryDb(templateBuilder(params));
}

function formatNumber(value) {
  if (value == null || Number.isNaN(Number(value))) return "-";
  return new Intl.NumberFormat("tr-TR").format(Number(value));
}

function summarizeRows(intent, rows, filters = {}) {
  if (!rows || rows.length === 0) {
    return "Secilen filtrede veri bulunamadi.";
  }

  const rangeInfo =
    filters.startDate || filters.endDate
      ? `${filters.startDate || "-"} - ${filters.endDate || "-"}`
      : "Tum donem";

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
    const bullets = top.map((r) => `- ${r.visitType}: ${formatNumber(r.total)} ziyaret`).join("\n");
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

  return `${rangeInfo} araliginda ${formatNumber(rows.length)} satir sonuc bulundu.`;
}

router.get("/health", (_req, res) => {
  res.json({ ok: true, service: "db-chatbot-backend" });
});

router.get("/planner/metrics", (_req, res) => {
  res.json({ domain: "saha_operasyonlari", metrics: listMetrics() });
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
    const result = await executeIntent(plan.intent, plan.params);

    return res.json({
      plan,
      rows: result.recordset,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

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
    const recentRange =
      filters.startDate || filters.endDate ? filters : getDefaultRecentRange(30);
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
    const recentRange =
      filters.startDate || filters.endDate ? filters : getDefaultRecentRange(30);
    const limit = Number(req.query?.limit || 20);
    const result = await executeIntent("dynamicTopFields", {
      ...recentRange,
      limit,
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

router.post("/chat/query", async (req, res) => {
  try {
    const question = req.body?.question;
    if (!question) {
      return res.status(400).json({ error: "question zorunludur." });
    }

    const filters = parseFilters(req.body?.filters || {});
    const { intent, params } = parseQuestion(question, filters);
    const result = await executeIntent(intent, params);

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
      filters: params,
      rows,
      answer: llmSummary || fallbackSummary,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
