const visitMetricDefinitions = require("../metrics/visit.metrics.json");
const userMetricDefinitions = require("../metrics/users.metrics.json");
const clientMetricDefinitions = require("../metrics/client.metrics.json");
const salesMetricDefinitions = require("../metrics/sales.metrics.json");

const visitIntentDefinitions = require("../intents/visit.intents.json");
const userIntentDefinitions = require("../intents/users.intents.json");
const clientIntentDefinitions = require("../intents/client.intents.json");
const salesIntentDefinitions = require("../intents/sales.intents.json");

const ALL_METRICS = [
  ...(visitMetricDefinitions.metrics || []),
  ...(userMetricDefinitions.metrics || []),
  ...(clientMetricDefinitions.metrics || []),
  ...(salesMetricDefinitions.metrics || []),
];

const ALL_INTENTS = [
  ...(visitIntentDefinitions.intents || []),
  ...(userIntentDefinitions.intents || []),
  ...(clientIntentDefinitions.intents || []),
  ...(salesIntentDefinitions.intents || []),
];

// EŞLEŞTİRME SİSTEMİ: Niyet ismini anahtar yaparak metrikleri bir sözlüğe alıyoruz.
const METRIC_BY_INTENT = {};
ALL_METRICS.forEach((m) => {
  if (m.intent) {
    METRIC_BY_INTENT[m.intent] = m;
  }
});

const INTENT_BY_NAME = {};
ALL_INTENTS.forEach((i) => {
  if (i.intent) {
    INTENT_BY_NAME[i.intent] = i;
  }
});

function getMetricByIntent(intent) {
  // Hem sözlükten bak hem de emin olmak için diziyi manuel tara
  return METRIC_BY_INTENT[intent] || ALL_METRICS.find(m => m.intent === intent) || null;
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
    // ÖNEMLİ: Niyet ismine göre metrik dosyasındaki tanımı bul
    const metric = getMetricByIntent(intentDefinition.intent);

    return {
      intent: intentDefinition.intent,
      // KRİTİK DÜZELTME: Seçim sonrası SQL'in tetiklenmesi için METRİK dosyasındaki metric_id öncelikli olmalı!
      metric_id: metric?.metric_id || intentDefinition.metric_id || null,
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
