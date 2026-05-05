const { listResolvedIntentCandidates } = require("../planner/metricRegistry");
const { parseQuestion } = require("./intentParser");

function normalizeText(text) {
    return String(text || "")
        .toLowerCase()
        .replace(/ı/g, "i")
        .replace(/ğ/g, "g")
        .replace(/ş/g, "s")
        .replace(/ç/g, "c")
        .replace(/ö/g, "o")
        .replace(/ü/g, "u")
        .replace(/[^\w\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function toIsoDate(date) {
    return date.toISOString().slice(0, 10);
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

function tokenize(text) {
    const normalized = normalizeText(text);
    if (!normalized) return [];

    return normalized
        .split(" ")
        .map((token) => token.trim())
        .filter((token) => token.length >= 2);
}

function normalizeList(values = []) {
    return values.map((item) => normalizeText(item)).filter(Boolean);
}

function containsPhrase(normalizedQuestion, phrase) {
    const normalizedPhrase = normalizeText(phrase);
    if (!normalizedPhrase) return false;
    return normalizedQuestion.includes(normalizedPhrase);
}

function buildCandidateText(candidate) {
    return normalizeText(
        [
            candidate.intent,
            candidate.description_tr,
            candidate.metric_description_tr,
            candidate.aggregation,
            ...(candidate.keywords || []),
            ...(candidate.aliases || []),
            ...(candidate.source_tables || []),
        ].join(" ")
    );
}

function scoreCandidate(question, candidate) {
    const normalizedQuestion = normalizeText(question);
    const questionTokens = tokenize(question);

    const keywords = normalizeList(candidate.keywords || []);
    const aliases = normalizeList(candidate.aliases || []);
    const negativeKeywords = normalizeList(candidate.negative_keywords || []);
    const candidateText = buildCandidateText(candidate);
    const candidateTokens = tokenize(candidateText);

    let score = 0;

    const matched = {
        aliases: [],
        keywords: [],
        descriptionTokens: [],
        negativeKeywords: [],
    };

    for (const alias of aliases) {
        if (containsPhrase(normalizedQuestion, alias)) {
            score += 40;
            matched.aliases.push(alias);
        }
    }

    for (const keyword of keywords) {
        if (containsPhrase(normalizedQuestion, keyword)) {
            score += 10;
            matched.keywords.push(keyword);
        }
    }

    for (const token of questionTokens) {
        if (candidateTokens.includes(token)) {
            score += 3;
            matched.descriptionTokens.push(token);
        }
    }

    score += Number(candidate.priority || 0) / 10;

    for (const negativeKeyword of negativeKeywords) {
        if (containsPhrase(normalizedQuestion, negativeKeyword)) {
            score -= 15;
            matched.negativeKeywords.push(negativeKeyword);
        }
    }

    return {
        intent: candidate.intent,
        metric_id: candidate.metric_id,
        description_tr: candidate.description_tr,
        score,
        matched,
        candidate,
    };
}

function isStrongLegacyFallbackQuestion(normalizedQuestion) {
    return /(ziyaret|visit|saha|raf|stok|form|anket|aktivite)/.test(normalizedQuestion);
}

function buildClarification(candidates, reason) {
    const options = candidates.slice(0, 4).map((item) => ({
        intent: item.intent,
        metric_id: item.metric_id,
        label: item.description_tr || item.intent,
        score: item.score,
    }));

    return {
        needsClarification: true,
        reason,
        message:
            "Bu soru birden fazla alanla ilişkili veya yeterince net değil. Hangisini kastettiniz?",
        options,
        candidates: candidates.slice(0, 5).map((item) => ({
            intent: item.intent,
            metric_id: item.metric_id,
            score: item.score,
            description_tr: item.description_tr,
            matched: item.matched,
        })),
    };
}

function buildBaseFilters(normalizedQuestion, filters = {}) {
    const relativeRange = getRelativeDateRange(normalizedQuestion);

    return {
        startDate: filters.startDate || relativeRange?.startDate || null,
        endDate: filters.endDate || relativeRange?.endDate || null,
        limit: filters.limit ? Number(filters.limit) : null,
        fieldName: filters.fieldName || null,
        fieldId: filters.fieldId || null,
    };
}

function resolveIntent(question, filters = {}) {
    const normalizedQuestion = normalizeText(question);
    const baseFilters = buildBaseFilters(normalizedQuestion, filters);

    const allCandidates = listResolvedIntentCandidates().filter(
        (candidate) => candidate.intent && candidate.metric_id
    );

    // UI seçimi veya direkt intent/metric_id gelirse skorlama yapmadan direkt yakala
    const exactCandidate = allCandidates.find(
        (candidate) =>
            candidate.intent === question ||
            candidate.metric_id === question ||
            normalizeText(candidate.intent) === normalizedQuestion ||
            normalizeText(candidate.metric_id) === normalizedQuestion
    );

    if (exactCandidate) {
        return {
            intent: exactCandidate.intent,
            params: baseFilters,
            confidence: 1,
            score: 999,
            source: "exactIntentMatch",
            candidates: [
                {
                    intent: exactCandidate.intent,
                    metric_id: exactCandidate.metric_id,
                    score: 999,
                    description_tr: exactCandidate.description_tr,
                    matched: {
                        exact: true,
                    },
                },
            ],
        };
    }

    const candidates = allCandidates
        .map((candidate) => scoreCandidate(question, candidate))
        .sort((a, b) => b.score - a.score);

    const best = candidates[0] || null;
    const second = candidates[1] || null;

    const MIN_SCORE = 10;
    const AMBIGUITY_MARGIN = 5;

    if (!best) {
        if (isStrongLegacyFallbackQuestion(normalizedQuestion)) {
            const legacy = parseQuestion(question, filters);
            return {
                ...legacy,
                params: { ...baseFilters, ...(legacy.params || {}) },
                confidence: 0.4,
                score: 0,
                source: "legacyFallback",
                candidates: [],
            };
        }

        return buildClarification([], "NO_CANDIDATE");
    }

    if (best.score < MIN_SCORE) {
        if (isStrongLegacyFallbackQuestion(normalizedQuestion)) {
            const legacy = parseQuestion(question, filters);
            return {
                ...legacy,
                params: { ...baseFilters, ...(legacy.params || {}) },
                confidence: 0.4,
                score: best.score,
                source: "legacyFallback",
                candidates: candidates.slice(0, 5).map((item) => ({
                    intent: item.intent,
                    metric_id: item.metric_id,
                    score: item.score,
                    description_tr: item.description_tr,
                    matched: item.matched,
                })),
            };
        }

        return buildClarification(candidates, "LOW_SCORE");
    }

    if (second && best.score - second.score < AMBIGUITY_MARGIN) {
        return buildClarification(candidates, "AMBIGUOUS_SCORE");
    }

    const confidence = Math.min(0.99, Number((best.score / 50).toFixed(2)));

    return {
        intent: best.intent,
        params: baseFilters,
        confidence,
        score: best.score,
        source: "metricResolver",
        candidates: candidates.slice(0, 5).map((item) => ({
            intent: item.intent,
            metric_id: item.metric_id,
            score: item.score,
            description_tr: item.description_tr,
            matched: item.matched,
        })),
    };
}

module.exports = {
    normalizeText,
    tokenize,
    scoreCandidate,
    resolveIntent,
};
