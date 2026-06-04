const { queryDb } = require("../db/sql");

const { normalizeUserContext } = require("./userContextValidator");
const { assertIntentAllowed } = require("./intentPermission");
const { assertMetricAllowed } = require("./metricPermission");
const { assertTablesAllowed } = require("./tablePermission");
const { assertScopeRequirements } = require("./scopeFilter");
const { assertSafeSql } = require("./sqlValidator");
const { applyColumnSecurity } = require("./columnMasking");
const { logSecurityEvent } = require("./auditLogger");

function extractRows(queryResult) {
    if (Array.isArray(queryResult)) {
        return queryResult;
    }

    if (Array.isArray(queryResult?.recordset)) {
        return queryResult.recordset;
    }

    if (
        Array.isArray(queryResult?.recordsets) &&
        Array.isArray(queryResult.recordsets[0])
    ) {
        return queryResult.recordsets[0];
    }

    return [];
}

function getReturnedColumns(rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
        return [];
    }

    return Object.keys(rows[0]);
}

function safeContextValue(normalizedUserContext, rawUserContext, key, aliases = []) {
    if (normalizedUserContext && normalizedUserContext[key] !== undefined) {
        return normalizedUserContext[key];
    }

    if (rawUserContext && rawUserContext[key] !== undefined) {
        return rawUserContext[key];
    }

    for (const alias of aliases) {
        if (rawUserContext && rawUserContext[alias] !== undefined) {
            return rawUserContext[alias];
        }
    }

    return null;
}

async function executeSecureQuery({
    queryBuilder,
    intent,
    metric,
    userContext,
    queryExecutor = queryDb,
}) {
    const startedAt = Date.now();
    let normalizedUserContext = null;

    try {
        normalizedUserContext = normalizeUserContext(userContext);

        if (!metric || typeof metric !== "object") {
            throw new Error("Metric validation failed: metric is required.");
        }

        if (typeof queryBuilder !== "function") {
            throw new Error(
                "Query validation failed: queryBuilder must be a function."
            );
        }

        assertIntentAllowed(intent, normalizedUserContext);
        assertMetricAllowed(metric.metric_id, normalizedUserContext);
        assertTablesAllowed(metric.source_tables || [], normalizedUserContext);

        const scopeDecision = assertScopeRequirements(
            metric,
            normalizedUserContext
        );

        const builtQuery = queryBuilder();

        if (!builtQuery || typeof builtQuery !== "object") {
            throw new Error(
                "Query validation failed: queryBuilder must return an object."
            );
        }

        assertSafeSql(builtQuery.query, { metric });

        const queryResult = await queryExecutor(builtQuery);
        const rows = extractRows(queryResult);

        const securedRows = applyColumnSecurity(rows, normalizedUserContext);

        logSecurityEvent({
            userId: normalizedUserContext.userId,
            subscriptionId: normalizedUserContext.subscriptionId,
            intent,
            metricId: metric.metric_id,
            action: "EXECUTE_QUERY",
            status: "ALLOWED",
            metadata: {
                sourceTables: metric.source_tables || [],
                securityScope:
                    metric.security_scope || metric.securityScope || null,
                scopeWarnings: scopeDecision.warnings || [],
                rowCount: securedRows.length,
                rawColumns: getReturnedColumns(rows),
                returnedColumns: getReturnedColumns(securedRows),
                maskedColumns: normalizedUserContext.maskedColumns || [],
                blockedColumns: normalizedUserContext.blockedColumns || [],
                executionTimeMs: Date.now() - startedAt,
            },
        });

        return securedRows;
    } catch (error) {
        logSecurityEvent({
            userId: safeContextValue(normalizedUserContext, userContext, "userId"),
            subscriptionId: safeContextValue(
                normalizedUserContext,
                userContext,
                "subscriptionId",
                ["tenantId"]
            ),
            intent,
            metricId: metric?.metric_id || null,
            action: "EXECUTE_QUERY",
            status: "DENIED",
            reason: error.message,
            metadata: {
                sourceTables: metric?.source_tables || [],
                securityScope:
                    metric?.security_scope || metric?.securityScope || null,
                executionTimeMs: Date.now() - startedAt,
            },
        });

        throw error;
    }
}

module.exports = {
    executeSecureQuery,
    extractRows,
    getReturnedColumns,
    safeContextValue,
};