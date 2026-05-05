const visitMetricDefinitions = require("../metrics/visit.metrics.json");
const userMetricDefinitions = require("../metrics/users.metrics.json");
// Yeni Eklenen Modüller
const clientMetricDefinitions = require("../metrics/client.metrics.json");
const salesMetricDefinitions = require("../metrics/sales.metrics.json");

const ALL_METRICS = [
  ...visitMetricDefinitions.metrics,
  ...userMetricDefinitions.metrics,
  ...clientMetricDefinitions.metrics,
  ...salesMetricDefinitions.metrics,
];

const METRIC_BY_INTENT = Object.fromEntries(
  ALL_METRICS.map((item) => [item.intent, item])
);

function getMetricByIntent(intent) {
  return METRIC_BY_INTENT[intent] || null;
}

function listMetrics() {
  return ALL_METRICS;
}

module.exports = { getMetricByIntent, listMetrics };