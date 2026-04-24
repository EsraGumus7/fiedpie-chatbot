const { parseQuestion } = require("../services/intentParser");
const { getMetricByIntent } = require("./metricRegistry");

function buildQueryPlan(question, filters = {}, userContext = {}) {
  const { intent, params } = parseQuestion(question, filters);
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
    user_scope: {
      tenantId: userContext.tenantId || null,
      userId: userContext.userId || null,
      role: userContext.role || "viewer",
    },
  };
}

module.exports = { buildQueryPlan };
