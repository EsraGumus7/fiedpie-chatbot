const FORBIDDEN_SQL_PATTERNS = [
    /\bUPDATE\b/i,
    /\bDELETE\b/i,
    /\bINSERT\b/i,
    /\bDROP\b/i,
    /\bALTER\b/i,
    /\bTRUNCATE\b/i,
    /\bEXEC\b/i,
    /\bEXECUTE\b/i,
    /\bMERGE\b/i,
    /\bCREATE\b/i,
];

const LIMIT_REQUIRED_RESULT_TYPES = ["list", "detail"];

const SQL_IDENTIFIER_PATTERN = String.raw`(?:\[[^\]]+\]|[a-zA-Z_][a-zA-Z0-9_]*)`;
const SQL_PARAMETER_PATTERN = String.raw`@[a-zA-Z_][a-zA-Z0-9_]*`;
const TOP_VALUE_PATTERN = String.raw`(?:\(\s*(?:\d+|${SQL_PARAMETER_PATTERN})\s*\)|\d+)`;

function normalizeSql(sqlQuery = "") {
    return String(sqlQuery || "").trim();
}

function getMetricFromOptions(options = {}) {
    if (options && typeof options.metric === "object" && options.metric !== null) {
        return options.metric;
    }

    return {};
}

function getOptionValue(options = {}, snakeCaseKey, camelCaseKey) {
    const metric = getMetricFromOptions(options);

    if (options[snakeCaseKey] !== undefined) {
        return options[snakeCaseKey];
    }

    if (options[camelCaseKey] !== undefined) {
        return options[camelCaseKey];
    }

    if (metric[snakeCaseKey] !== undefined) {
        return metric[snakeCaseKey];
    }

    if (metric[camelCaseKey] !== undefined) {
        return metric[camelCaseKey];
    }

    return undefined;
}

function getResultType(options = {}) {
    const resultType = getOptionValue(options, "result_type", "resultType");

    if (typeof resultType !== "string") {
        return null;
    }

    return resultType.trim().toLowerCase();
}

function getRequiresLimit(options = {}) {
    return getOptionValue(options, "requires_limit", "requiresLimit") === true;
}

function getMaxRows(options = {}) {
    const maxRows = getOptionValue(options, "max_rows", "maxRows");

    if (maxRows === undefined || maxRows === null) {
        return null;
    }

    if (typeof maxRows !== "number" || Number.isNaN(maxRows) || maxRows <= 0) {
        throw new Error("SQL validation failed: max_rows must be a positive number.");
    }

    return maxRows;
}

function requiresLimit(options = {}) {
    const resultType = getResultType(options);

    return (
        getRequiresLimit(options) ||
        LIMIT_REQUIRED_RESULT_TYPES.includes(resultType)
    );
}

function hasTopLimit(sqlQuery = "") {
    const topLimitPattern = new RegExp(
        String.raw`\bSELECT\s+(?:DISTINCT\s+)?TOP\s*${TOP_VALUE_PATTERN}(?=\s)`,
        "i"
    );

    return topLimitPattern.test(sqlQuery);
}

function hasTopPercent(sqlQuery = "") {
    const topPercentPattern = new RegExp(
        String.raw`\bSELECT\s+(?:DISTINCT\s+)?TOP\s*${TOP_VALUE_PATTERN}\s+PERCENT\b`,
        "i"
    );

    return topPercentPattern.test(sqlQuery);
}

function hasOffsetFetchLimit(sqlQuery = "") {
    return /\bOFFSET\b[\s\S]+\bROWS\b[\s\S]+\bFETCH\s+NEXT\b[\s\S]+\bROWS\s+ONLY\b/i.test(
        sqlQuery
    );
}

function hasSqlServerLimit(sqlQuery = "") {
    return hasTopLimit(sqlQuery) || hasOffsetFetchLimit(sqlQuery);
}

function getTopLiteralValue(sqlQuery = "") {
    const match = sqlQuery.match(/\bTOP\s*(?:\(\s*(\d+)\s*\)|(\d+))/i);

    if (!match) {
        return null;
    }

    return Number(match[1] || match[2]);
}

function getFetchNextLiteralValue(sqlQuery = "") {
    const match = sqlQuery.match(/\bFETCH\s+NEXT\s+(\d+)\s+ROWS\s+ONLY\b/i);

    if (!match) {
        return null;
    }

    return Number(match[1]);
}

function stripSelectPrefix(normalizedQuery = "") {
    const topPrefixPattern = new RegExp(
        String.raw`^TOP\s*${TOP_VALUE_PATTERN}\s+`,
        "i"
    );

    return normalizedQuery
        .replace(/^SELECT\s+/i, "")
        .replace(/^DISTINCT\s+/i, "")
        .replace(topPrefixPattern, "");
}

function extractSelectList(normalizedQuery = "") {
    const queryAfterSelectPrefix = stripSelectPrefix(normalizedQuery);
    const fromMatch = queryAfterSelectPrefix.match(/\bFROM\b/i);

    if (!fromMatch) {
        return queryAfterSelectPrefix.trim();
    }

    return queryAfterSelectPrefix.slice(0, fromMatch.index).trim();
}

function containsSelectWildcard(selectList = "") {
    const standaloneWildcardPattern = /(^|,)\s*\*(?=\s*(,|$))/;

    const qualifiedWildcardPattern = new RegExp(
        String.raw`(^|,)\s*${SQL_IDENTIFIER_PATTERN}(?:\s*\.\s*${SQL_IDENTIFIER_PATTERN})*\s*\.\s*\*(?=\s*(,|$))`,
        "i"
    );

    return (
        standaloneWildcardPattern.test(selectList) ||
        qualifiedWildcardPattern.test(selectList)
    );
}

function assertStartsWithSelect(normalizedQuery) {
    if (!normalizedQuery.match(/^SELECT/i)) {
        throw new Error("SQL validation failed: only SELECT queries are allowed.");
    }
}

function assertNoForbiddenKeywords(normalizedQuery) {
    for (const pattern of FORBIDDEN_SQL_PATTERNS) {
        if (pattern.test(normalizedQuery)) {
            throw new Error(
                `SQL validation failed: forbidden SQL keyword detected (${pattern}).`
            );
        }
    }
}

function assertNoTopPercent(normalizedQuery) {
    if (hasTopPercent(normalizedQuery)) {
        throw new Error("SQL validation failed: TOP PERCENT is not allowed.");
    }
}

function assertNoSelectStar(normalizedQuery) {
    const selectList = extractSelectList(normalizedQuery);

    if (containsSelectWildcard(selectList)) {
        throw new Error("SQL validation failed: SELECT * is not allowed.");
    }
}

function assertSingleStatement(normalizedQuery) {
    const queryWithoutSingleTrailingSemicolon = normalizedQuery.replace(/;\s*$/, "");

    if (queryWithoutSingleTrailingSemicolon.includes(";")) {
        throw new Error(
            "SQL validation failed: multiple SQL statements are not allowed."
        );
    }
}

function assertLimitIfRequired(normalizedQuery, options = {}) {
    if (!requiresLimit(options)) {
        return;
    }

    if (!hasSqlServerLimit(normalizedQuery)) {
        throw new Error(
            "SQL validation failed: list/detail queries must include TOP (...) or TOP N or OFFSET ... FETCH NEXT ... ROWS ONLY."
        );
    }

    const maxRows = getMaxRows(options);

    if (!maxRows) {
        return;
    }

    const topLiteralValue = getTopLiteralValue(normalizedQuery);

    if (topLiteralValue !== null && topLiteralValue > maxRows) {
        throw new Error(
            `SQL validation failed: TOP (${topLiteralValue}) exceeds max_rows (${maxRows}).`
        );
    }

    const fetchNextLiteralValue = getFetchNextLiteralValue(normalizedQuery);

    if (fetchNextLiteralValue !== null && fetchNextLiteralValue > maxRows) {
        throw new Error(
            `SQL validation failed: FETCH NEXT ${fetchNextLiteralValue} ROWS exceeds max_rows (${maxRows}).`
        );
    }
}

function assertSafeSql(sqlQuery = "", options = {}) {
    if (!sqlQuery || typeof sqlQuery !== "string") {
        throw new Error("SQL validation failed: invalid SQL query.");
    }

    const normalizedQuery = normalizeSql(sqlQuery);

    assertStartsWithSelect(normalizedQuery);
    assertNoForbiddenKeywords(normalizedQuery);
    assertNoTopPercent(normalizedQuery);
    assertNoSelectStar(normalizedQuery);
    assertSingleStatement(normalizedQuery);
    assertLimitIfRequired(normalizedQuery, options);

    return true;
}

module.exports = {
    assertSafeSql,

    normalizeSql,

    getResultType,
    getRequiresLimit,
    getMaxRows,
    requiresLimit,

    hasTopLimit,
    hasTopPercent,
    hasOffsetFetchLimit,
    hasSqlServerLimit,

    getTopLiteralValue,
    getFetchNextLiteralValue,

    stripSelectPrefix,
    extractSelectList,
    containsSelectWildcard,
};