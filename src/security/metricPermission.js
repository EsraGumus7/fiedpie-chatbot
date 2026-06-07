function hasWildcardPermission(permissions = []) {
    return permissions.includes("*");
}

function assertMetricAllowed(metricId, userContext = {}) {
    if (!metricId || typeof metricId !== "string") {
        throw new Error("Metric permission denied: invalid metric.");
    }

    const allowedMetrics = userContext.allowedMetrics || [];

    if (!Array.isArray(allowedMetrics)) {
        throw new Error("Metric permission denied: allowedMetrics must be an array.");
    }

    if (hasWildcardPermission(allowedMetrics)) {
        return true;
    }

    if (!allowedMetrics.includes(metricId)) {
        throw new Error(`Metric permission denied: ${metricId} is not allowed.`);
    }

    return true;
}

module.exports = {
    assertMetricAllowed,
};