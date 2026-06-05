/**
 * Scope Filter MVP / Scope Guard
 *
 * IMPORTANT:
 * This module does NOT modify SQL strings.
 * It does NOT append filters like:
 *   sql += " AND ClientId IN (...)"
 *
 * First MVP responsibility:
 * - Check whether the metric's security_scope has enough UserContext data.
 * - Fail fast if required scope data is missing.
 * - Prepare a safe guard layer before real template/queryBuilder-level scope filters.
 *
 * Real SQL scope filtering should be added later at template/queryBuilder level,
 * once table aliases, joins and domain mappings are confirmed.
 */

const { normalizeUserContext } = require("./userContextValidator");

function isNonEmptyArray(value) {
    return Array.isArray(value) && value.length > 0;
}

function listAllows(list = [], value) {
    if (!Array.isArray(list)) {
        return false;
    }

    return list.includes("*") || list.includes(value);
}

function getMetricId(metric = {}) {
    return metric.metric_id || metric.metricId || metric.id || null;
}

function getSecurityScope(metric = {}) {
    return metric.security_scope || metric.securityScope || null;
}

/**
 * Base user scope:
 * Valid UserContext already has userId.
 * This is acceptable for tenant_user_scope only as a guard-level check.
 *
 * WARNING:
 * This does not mean SQL is filtered by current user.
 * SQL/template-level UserId filtering must be added later.
 */
function hasBaseUserScope(userContext = {}) {
    return (
        typeof userContext.userId === "number" ||
        isNonEmptyArray(userContext.allowedUserIds)
    );
}

/**
 * Explicit user activity scope:
 * Sensitive activity metrics should not pass only because userId exists.
 * They need a clear allowed user/team scope, unless manageAll is true.
 */
function hasExplicitUserActivityScope(userContext = {}) {
    return (
        isNonEmptyArray(userContext.allowedUserIds) ||
        isNonEmptyArray(userContext.managedTeamIds)
    );
}

function hasTeamScope(userContext = {}) {
    return isNonEmptyArray(userContext.managedTeamIds);
}

function hasClientScope(userContext = {}) {
    return (
        isNonEmptyArray(userContext.effectiveClientIds) ||
        isNonEmptyArray(userContext.assignedClientIds)
    );
}

function hasBrandScope(userContext = {}) {
    return isNonEmptyArray(userContext.allowedBrandIds);
}

function hasCompanyScope(userContext = {}) {
    return isNonEmptyArray(userContext.allowedCompanyIds);
}

function hasRegionScope(userContext = {}) {
    return (
        isNonEmptyArray(userContext.allowedRegionIds) ||
        isNonEmptyArray(userContext.allowedCountryIds) ||
        isNonEmptyArray(userContext.allowedCityIds) ||
        isNonEmptyArray(userContext.allowedDistrictIds)
    );
}

function hasDistributorScope(userContext = {}) {
    return isNonEmptyArray(userContext.allowedDistributorIds);
}

function hasSalesScope(userContext = {}) {
    return (
        hasClientScope(userContext) ||
        hasBrandScope(userContext) ||
        hasRegionScope(userContext) ||
        hasDistributorScope(userContext) ||
        hasCompanyScope(userContext)
    );
}

function hasVisitScope(userContext = {}) {
    return (
        hasBaseUserScope(userContext) ||
        hasTeamScope(userContext) ||
        hasClientScope(userContext)
    );
}

function hasDynamicParentScope(userContext = {}) {
    return (
        hasBaseUserScope(userContext) ||
        hasTeamScope(userContext) ||
        hasClientScope(userContext)
    );
}

function hasFinancialMetricPermission(metric = {}, userContext = {}) {
    const metricId = getMetricId(metric);

    if (!metricId) {
        return false;
    }

    return (
        listAllows(userContext.allowedFinancialMetrics, metricId) ||
        listAllows(userContext.allowedMetrics, metricId)
    );
}

function createAllowedDecision(metric, userContext, warnings = []) {
    return {
        allowed: true,
        reason: null,
        metricId: getMetricId(metric),
        securityScope: getSecurityScope(metric),
        manageAll: userContext.manageAll,
        warnings,
    };
}

function createDeniedDecision(metric, userContext, reason, requiredFields = []) {
    return {
        allowed: false,
        reason,
        metricId: getMetricId(metric),
        securityScope: getSecurityScope(metric),
        manageAll: userContext?.manageAll ?? null,
        requiredFields,
        warnings: [],
    };
}

/**
 * Evaluates whether a metric has enough UserContext scope data.
 *
 * This is a guard/checker only.
 * It does not apply SQL filters.
 */
function evaluateScopeRequirements({ metric, userContext }) {
    const normalizedUserContext = normalizeUserContext(userContext);

    if (!metric || typeof metric !== "object") {
        return createDeniedDecision(
            metric,
            normalizedUserContext,
            "metric_required",
            ["metric"]
        );
    }

    const metricId = getMetricId(metric);
    const securityScope = getSecurityScope(metric);

    if (!metricId) {
        return createDeniedDecision(
            metric,
            normalizedUserContext,
            "metric_id_required",
            ["metric.metric_id"]
        );
    }

    if (!securityScope) {
        return createDeniedDecision(
            metric,
            normalizedUserContext,
            "security_scope_required",
            ["metric.security_scope"]
        );
    }

    if (typeof normalizedUserContext.subscriptionId !== "number") {
        return createDeniedDecision(
            metric,
            normalizedUserContext,
            "subscription_id_required",
            ["subscriptionId"]
        );
    }

    const manageAll = normalizedUserContext.manageAll === true;

    switch (securityScope) {
        case "tenant_only":
            return createAllowedDecision(metric, normalizedUserContext);

        case "tenant_user_scope":
            if (manageAll || hasBaseUserScope(normalizedUserContext)) {
                return createAllowedDecision(metric, normalizedUserContext);
            }

            return createDeniedDecision(
                metric,
                normalizedUserContext,
                "missing_user_scope",
                ["userId", "allowedUserIds"]
            );

        case "sensitive_user_activity_scope":
            if (manageAll || hasExplicitUserActivityScope(normalizedUserContext)) {
                return createAllowedDecision(metric, normalizedUserContext);
            }

            return createDeniedDecision(
                metric,
                normalizedUserContext,
                "missing_sensitive_user_activity_scope",
                ["allowedUserIds", "managedTeamIds"]
            );

        case "tenant_team_scope":
            if (manageAll || hasTeamScope(normalizedUserContext)) {
                return createAllowedDecision(metric, normalizedUserContext);
            }

            return createDeniedDecision(
                metric,
                normalizedUserContext,
                "missing_team_scope",
                ["managedTeamIds"]
            );

        case "tenant_client_scope":
            if (manageAll || hasClientScope(normalizedUserContext)) {
                return createAllowedDecision(metric, normalizedUserContext);
            }

            return createDeniedDecision(
                metric,
                normalizedUserContext,
                "missing_client_scope",
                ["effectiveClientIds", "assignedClientIds"]
            );

        case "tenant_brand_scope":
            if (manageAll || hasBrandScope(normalizedUserContext)) {
                return createAllowedDecision(metric, normalizedUserContext);
            }

            return createDeniedDecision(
                metric,
                normalizedUserContext,
                "missing_brand_scope",
                ["allowedBrandIds"]
            );

        case "tenant_region_scope":
            if (manageAll || hasRegionScope(normalizedUserContext)) {
                return createAllowedDecision(metric, normalizedUserContext);
            }

            return createDeniedDecision(
                metric,
                normalizedUserContext,
                "missing_region_scope",
                [
                    "allowedRegionIds",
                    "allowedCountryIds",
                    "allowedCityIds",
                    "allowedDistrictIds",
                ]
            );

        case "tenant_company_scope":
            if (manageAll || hasCompanyScope(normalizedUserContext)) {
                return createAllowedDecision(metric, normalizedUserContext);
            }

            return createDeniedDecision(
                metric,
                normalizedUserContext,
                "missing_company_scope",
                ["allowedCompanyIds"]
            );

        case "tenant_visit_scope":
            if (manageAll || hasVisitScope(normalizedUserContext)) {
                return createAllowedDecision(metric, normalizedUserContext);
            }

            return createDeniedDecision(
                metric,
                normalizedUserContext,
                "missing_visit_scope",
                [
                    "userId",
                    "allowedUserIds",
                    "managedTeamIds",
                    "effectiveClientIds",
                    "assignedClientIds",
                ]
            );

        case "tenant_sales_scope":
            if (manageAll || hasSalesScope(normalizedUserContext)) {
                return createAllowedDecision(metric, normalizedUserContext);
            }

            return createDeniedDecision(
                metric,
                normalizedUserContext,
                "missing_sales_scope",
                [
                    "effectiveClientIds",
                    "assignedClientIds",
                    "allowedBrandIds",
                    "allowedRegionIds",
                    "allowedDistributorIds",
                    "allowedCompanyIds",
                ]
            );

        case "sensitive_business_scope":
            if (
                manageAll ||
                hasSalesScope(normalizedUserContext) ||
                hasClientScope(normalizedUserContext)
            ) {
                return createAllowedDecision(metric, normalizedUserContext);
            }

            return createDeniedDecision(
                metric,
                normalizedUserContext,
                "missing_sensitive_business_scope",
                [
                    "effectiveClientIds",
                    "assignedClientIds",
                    "allowedBrandIds",
                    "allowedRegionIds",
                    "allowedCompanyIds",
                ]
            );

        case "sensitive_financial_scope":
            if (!hasFinancialMetricPermission(metric, normalizedUserContext)) {
                return createDeniedDecision(
                    metric,
                    normalizedUserContext,
                    "missing_financial_metric_permission",
                    ["allowedFinancialMetrics", "allowedMetrics"]
                );
            }

            if (manageAll || hasSalesScope(normalizedUserContext)) {
                return createAllowedDecision(metric, normalizedUserContext);
            }

            return createDeniedDecision(
                metric,
                normalizedUserContext,
                "missing_financial_scope",
                [
                    "effectiveClientIds",
                    "assignedClientIds",
                    "allowedBrandIds",
                    "allowedRegionIds",
                    "allowedDistributorIds",
                    "allowedCompanyIds",
                ]
            );

        case "tenant_dynamic_scope":
            if (manageAll || hasDynamicParentScope(normalizedUserContext)) {
                return createAllowedDecision(metric, normalizedUserContext, [
                    "Dynamic field-level permission is not fully enforced in MVP. Parent scope guard is applied only.",
                ]);
            }

            return createDeniedDecision(
                metric,
                normalizedUserContext,
                "missing_dynamic_parent_scope",
                [
                    "userId",
                    "allowedUserIds",
                    "managedTeamIds",
                    "effectiveClientIds",
                    "assignedClientIds",
                ]
            );

        default:
            return createDeniedDecision(
                metric,
                normalizedUserContext,
                "unsupported_security_scope",
                ["metric.security_scope"]
            );
    }
}

/**
 * Throws when scope requirements are not satisfied.
 *
 * This is useful for secureQueryExecutor integration later,
 * but it is not connected to api.js in this MVP step.
 */
function assertScopeRequirements(metric, userContext) {
    const decision = evaluateScopeRequirements({ metric, userContext });

    if (!decision.allowed) {
        throw new Error(`Scope validation failed: ${decision.reason}`);
    }

    return decision;
}

module.exports = {
    assertScopeRequirements,
    evaluateScopeRequirements,

    isNonEmptyArray,
    listAllows,

    getMetricId,
    getSecurityScope,

    hasBaseUserScope,
    hasExplicitUserActivityScope,
    hasTeamScope,
    hasClientScope,
    hasBrandScope,
    hasCompanyScope,
    hasRegionScope,
    hasDistributorScope,
    hasSalesScope,
    hasVisitScope,
    hasDynamicParentScope,
    hasFinancialMetricPermission,
};