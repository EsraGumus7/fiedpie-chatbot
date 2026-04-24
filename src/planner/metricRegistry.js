const metricDefinitions = require("../metrics/visit.metrics.json");

const METRIC_BY_INTENT = Object.fromEntries(
  metricDefinitions.metrics.map((item) => [item.intent, item])
);

function getMetricByIntent(intent) {
  return METRIC_BY_INTENT[intent] || null;
}

function listMetrics() {
  return metricDefinitions.metrics;
}

module.exports = { getMetricByIntent, listMetrics };
