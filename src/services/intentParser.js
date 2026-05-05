const { listResolvedIntentCandidates } = require("../planner/metricRegistry");
function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ş/g, "s")
    .replace(/ç/g, "c")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/â/g, "a")
    .replace(/î/g, "i")
    .replace(/û/g, "u")
    .trim();
}

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function getLastNDaysRange(days) {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  start.setDate(start.getDate() - days);
  return { startDate: toIsoDate(start), endDate: toIsoDate(today) };
}

function getRelativeDateRange(normalizedQuestion) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (/(bugun|today)/.test(normalizedQuestion)) {
    return { startDate: toIsoDate(today), endDate: toIsoDate(today) };
  }

  if (/(dun|yesterday)/.test(normalizedQuestion)) {
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    return { startDate: toIsoDate(yesterday), endDate: toIsoDate(yesterday) };
  }

  if (/(bu hafta|this week)/.test(normalizedQuestion)) {
    const start = new Date(today);
    const day = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - day);
    return { startDate: toIsoDate(start), endDate: toIsoDate(today) };
  }

  if (/(gecen hafta|last week)/.test(normalizedQuestion)) {
    const start = new Date(today);
    const day = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - day - 7);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return { startDate: toIsoDate(start), endDate: toIsoDate(end) };
  }

  if (/(bu ay|this month)/.test(normalizedQuestion)) {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    return { startDate: toIsoDate(start), endDate: toIsoDate(today) };
  }

  if (/(gecen ay|last month)/.test(normalizedQuestion)) {
    const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const end = new Date(today.getFullYear(), today.getMonth(), 0);
    return { startDate: toIsoDate(start), endDate: toIsoDate(end) };
  }

  return null;
}

function resolveFieldName(rawValue = "") {
  const val = normalizeText(rawValue);

  const aliases = [
    { canonical: "Raf Sayisi", patterns: ["raf sayisi", "raf", "raf adet"] },
    { canonical: "Stok", patterns: ["stok", "stock"] },
    { canonical: "Siparis", patterns: ["siparis", "order"] },
    { canonical: "Promosyon", patterns: ["promosyon", "kampanya"] },
  ];

  const hit = aliases.find((item) =>
    item.patterns.some((p) => val.includes(normalizeText(p)))
  );

  return hit ? hit.canonical : rawValue;
}

function scoreIntent(question, candidate) {
  const normalizedQuestion = normalizeText(question);

  const keywords = candidate.keywords || [];
  const aliases = candidate.aliases || [];
  const negativeKeywords = candidate.negative_keywords || [];

  let score = candidate.priority || 0;

  for (const alias of aliases) {
    const normalizedAlias = normalizeText(alias);

    if (normalizedQuestion === normalizedAlias) {
      score += 100;
    } else if (normalizedQuestion.includes(normalizedAlias)) {
      score += 60;
    }
  }

  for (const keyword of keywords) {
    const normalizedKeyword = normalizeText(keyword);

    if (!normalizedKeyword) continue;

    if (normalizedQuestion.includes(normalizedKeyword)) {
      score += 10;
    }
  }

  for (const negative of negativeKeywords) {
    const normalizedNegative = normalizeText(negative);

    if (!normalizedNegative) continue;

    if (normalizedQuestion.includes(normalizedNegative)) {
      score -= 25;
    }
  }

  return score;
}

function extractDynamicFieldParams(normalizedQuestion, filters, baseFilters) {
  const match = normalizedQuestion.match(/["']([^"']+)["']/);
  const fieldIdMatch = normalizedQuestion.match(/field[-\s]?(\d{3,})/);

  const rawField = match?.[1] || filters.fieldName || "Raf";
  const fieldName = resolveFieldName(rawField);

  const dynamicRange =
    baseFilters.startDate || baseFilters.endDate
      ? baseFilters
      : getLastNDaysRange(30);

  return {
    ...dynamicRange,
    fieldName,
    fieldId: filters.fieldId || fieldIdMatch?.[1] || null,
  };
}

function parseQuestion(question, filters = {}) {
  const normalized = normalizeText(question);

  const relativeRange = getRelativeDateRange(normalized);

  const baseFilters = {
    startDate: filters.startDate || relativeRange?.startDate || null,
    endDate: filters.endDate || relativeRange?.endDate || null,
  };

  const candidates = listResolvedIntentCandidates();

  const scoredCandidates = candidates
    .map((candidate) => ({
      ...candidate,
      score: scoreIntent(question, candidate),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score);

  const best = scoredCandidates[0];

  if (!best) {
    return {
      intent: null,
      metric_id: null,
      params: baseFilters,
      error: "Intent bulunamadi",
    };
  }

  let params = baseFilters;

  if (best.intent === "dynamicFieldSummary") {
    params = extractDynamicFieldParams(normalized, filters, baseFilters);
  }

  return {
    intent: best.intent,
    metric_id: best.metric_id,
    domain: best.domain || null,
    score: best.score,
    params,
  };
}

module.exports = {
  parseQuestion,
  resolveFieldName,
  normalizeText,
};
