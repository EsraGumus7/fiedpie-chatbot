const { resolveIntent } = require("../services/metricResolver");
const { getMetricByIntent } = require("./metricRegistry");

function buildQueryPlan(question, filters = {}, userContext = {}) {
  const resolved = resolveIntent(question, filters);

  if (resolved.needsClarification) {
    return {
      question,
      needsClarification: true,
      message: resolved.message,
      options: resolved.options,
      candidates: resolved.candidates,
      user_scope: {
        subscriptionId: userContext.subscriptionId || userContext.tenantId || null,
        userId: userContext.userId || null,
        roles: userContext.roles || (userContext.role ? [userContext.role] : ["viewer"]),
        manageAll: Boolean(userContext.manageAll || userContext.managerOfAllTeams),
      },
    };
  }

  const { intent, params } = resolved;
  const metric = getMetricByIntent(intent);

  if (!metric) {
    throw new Error("Bu soru icin metric kaydi bulunamadi.");
  }

  return {
    question,
    intent,
    metric_id: metric.metric_id,
    description_tr: metric.description_tr,
    source_tables: metric.source_tables,
    aggregation: metric.aggregation,
    security_scope: metric.security_scope,
    default_filters: metric.default_filters,
    params,
    resolver: {
      confidence: resolved.confidence,
      score: resolved.score,
      source: resolved.source,
      candidates: resolved.candidates,
    },
    user_scope: {
      subscriptionId: userContext.subscriptionId || userContext.tenantId || null,
      userId: userContext.userId || null,
      roles: userContext.roles || (userContext.role ? [userContext.role] : ["viewer"]),
      manageAll: Boolean(userContext.manageAll || userContext.managerOfAllTeams),
      assignedClientIds: userContext.assignedClientIds || [],
      clientTagIds: userContext.clientTagIds || [],
      managedTeamIds: userContext.managedTeamIds || [],
    },
  };
}

module.exports = { buildQueryPlan };