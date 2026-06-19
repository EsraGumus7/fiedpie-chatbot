function buildAuditEntry({
    userId = null,
    subscriptionId = null,
    intent = null,
    metricId = null,
    action,
    status,
    reason = null,
    metadata = {},
}) {
    return {
        timestamp: new Date().toISOString(),
        userId,
        subscriptionId,
        intent,
        metricId,
        action,
        status,
        reason,
        metadata,
    };
}

function logSecurityEvent(eventData) {
    const event = buildAuditEntry(eventData);

    console.log("[AI-SECURITY-AUDIT]", JSON.stringify(event, null, 2));

    return event;
}

module.exports = {
    buildAuditEntry,
    logSecurityEvent,
};