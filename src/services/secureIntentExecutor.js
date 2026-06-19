const { queryDb } = require("../db/sql");
const templates = require("./queryTemplates");
const { getMetricByIntent } = require("../planner/metricRegistry");
const { executeSecureQuery } = require("../security/secureQueryExecutor");

/**
 * secureQueryExecutor normalde işlenmiş rows array döndürüyor.
 * Mevcut api.js tarafında ise çoğu endpoint result.recordset bekliyor.
 *
 * Bu adapter iki tarafı uyumlu hale getirir:
 * - recordset: mevcut api.js uyumu
 * - rows: yeni/temiz kullanım için kolay erişim
 * - security: debug/test için minimum metadata
 */
function toRecordsetResult(rows, { intent, metric } = {}) {
  const recordset = Array.isArray(rows)
    ? rows
    : Array.isArray(rows?.recordset)
      ? rows.recordset
      : Array.isArray(rows?.rows)
        ? rows.rows
        : [];

  return {
    recordset,
    rows: recordset,
    security: {
      intent,
      metricId: metric?.metric_id || null,
      sourceTables: metric?.source_tables || [],
      securityScope: metric?.security_scope || null,
    },
  };
}

function getTemplateBuilder(intent, templateSource = templates) {
  const templateBuilder = templateSource[intent];

  if (!templateBuilder) {
    throw new Error(`Intent bulunamadi: ${intent}`);
  }

  return templateBuilder;
}

function getMetricForIntent(intent, metricResolver = getMetricByIntent) {
  const metric = metricResolver(intent);

  if (!metric) {
    throw new Error(`Metric bulunamadi: ${intent}`);
  }

  return metric;
}

/**
 * Güvenli intent execution helper.
 *
 * Gerçek runtime:
 * executeSecureIntent({ intent, params, userContext })
 *
 * Mock test:
 * executeSecureIntent({
 *   intent,
 *   params,
 *   userContext,
 *   queryExecutor: async () => [...]
 * })
 */
async function executeSecureIntent({
  intent,
  params = {},
  userContext,
  metric,
  queryExecutor = queryDb,
  templateSource = templates,
  metricResolver = getMetricByIntent,
} = {}) {
  if (!intent) {
    throw new Error("intent zorunludur.");
  }

  if (!userContext) {
    throw new Error("userContext zorunludur.");
  }

  const templateBuilder = getTemplateBuilder(intent, templateSource);
  const resolvedMetric = metric || getMetricForIntent(intent, metricResolver);

  const rows = await executeSecureQuery({
    userContext,
    intent,
    metric: resolvedMetric,
    queryBuilder: () => templateBuilder(params || {}),
    queryExecutor,
  });

  return toRecordsetResult(rows, {
    intent,
    metric: resolvedMetric,
  });
}

module.exports = {
  executeSecureIntent,
  toRecordsetResult,
  getTemplateBuilder,
  getMetricForIntent,
};