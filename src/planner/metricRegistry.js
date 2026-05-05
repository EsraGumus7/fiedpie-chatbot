const visitMetricDefinitions = require("../metrics/visit.metrics.json");
const userMetricDefinitions = require("../metrics/users.metrics.json");
const clientMetricDefinitions = require("../metrics/client.metrics.json");
const salesMetricDefinitions = require("../metrics/sales.metrics.json");

const visitIntentDefinitions = require("../intents/visit.intents.json");
const userIntentDefinitions = require("../intents/users.intents.json");
const clientIntentDefinitions = require("../intents/client.intents.json");
const salesIntentDefinitions = require("../intents/sales.intents.json");

const ALL_METRICS = [
  ...visitMetricDefinitions.metrics,
  ...userMetricDefinitions.metrics,
  ...clientMetricDefinitions.metrics,
  ...salesMetricDefinitions.metrics,
];

const ALL_INTENTS = [
  ...visitIntentDefinitions.intents,
  ...userIntentDefinitions.intents,
  ...clientIntentDefinitions.intents,
  ...salesIntentDefinitions.intents,
];

const METRIC_BY_INTENT = Object.fromEntries(
  ALL_METRICS.map((item) => [item.intent, item])
);

const INTENT_BY_NAME = Object.fromEntries(
  ALL_INTENTS.map((item) => [item.intent, item])
);

function getMetricByIntent(intent) {
  return METRIC_BY_INTENT[intent] || null;
}

function getIntentDefinition(intent) {
  return INTENT_BY_NAME[intent] || null;
}

function listMetrics() {
  return ALL_METRICS;
}

function listIntentDefinitions() {
  return ALL_INTENTS;
}

function listResolvedIntentCandidates() {
  return ALL_INTENTS.map((intentDefinition) => {
    const metric = getMetricByIntent(intentDefinition.intent);

    return {
      intent: intentDefinition.intent,
      metric_id: intentDefinition.metric_id || metric?.metric_id || null,
      domain: intentDefinition.domain || null,

      description_tr:
        intentDefinition.description_tr || metric?.description_tr || "",

      keywords: intentDefinition.keywords || [],
      aliases: intentDefinition.aliases || [],
      negative_keywords: intentDefinition.negative_keywords || [],
      priority: intentDefinition.priority || 0,

      metric_description_tr: metric?.description_tr || "",
      source_tables: metric?.source_tables || [],
      aggregation: metric?.aggregation || null,
      security_scope: metric?.security_scope || null,
      default_filters: metric?.default_filters || [],

      metric,
      intent_definition: intentDefinition,
    };
  });
}

module.exports = {
  getMetricByIntent,
  getIntentDefinition,
  listMetrics,
  listIntentDefinitions,
  listResolvedIntentCandidates,
};