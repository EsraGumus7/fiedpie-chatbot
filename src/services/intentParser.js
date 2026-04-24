function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ş/g, "s")
    .replace(/ç/g, "c")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
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

  const hit = aliases.find((item) => item.patterns.some((p) => val.includes(p)));
  return hit ? hit.canonical : rawValue;
}

function parseQuestion(question, filters = {}) {
  const normalized = normalizeText(question);
  const relativeRange = getRelativeDateRange(normalized);
  const baseFilters = {
    startDate: filters.startDate || relativeRange?.startDate || null,
    endDate: filters.endDate || relativeRange?.endDate || null,
  };

  if (/(trend|gunluk|zaman|haftalik|aylik|line)/.test(normalized)) {
    return { intent: "visitTrend", params: baseFilters };
  }

  if (/(ortalama|süre|sure|duration)/.test(normalized)) {
    return { intent: "avgVisitDuration", params: baseFilters };
  }

  if (/(durum|state|statü|statu)/.test(normalized)) {
    return { intent: "visitsByState", params: baseFilters };
  }

  if (/(tip|type|ziyaret tipi)/.test(normalized)) {
    return { intent: "visitsByType", params: baseFilters };
  }

  if (/(form|alan|field|dynamic|anket|raf)/.test(normalized)) {
    const match = normalized.match(/["']([^"']+)["']/);
    const fieldIdMatch = normalized.match(/field[-\s]?(\d{3,})/);
    const rawField = match?.[1] || filters.fieldName || "Raf";
    const fieldName = resolveFieldName(rawField);
    const dynamicRange =
      baseFilters.startDate || baseFilters.endDate ? baseFilters : getLastNDaysRange(30);
    return {
      intent: "dynamicFieldSummary",
      params: { ...dynamicRange, fieldName, fieldId: filters.fieldId || fieldIdMatch?.[1] || null },
    };
  }

  return { intent: "visitCountRealized", params: baseFilters };
}

module.exports = { parseQuestion, resolveFieldName };
