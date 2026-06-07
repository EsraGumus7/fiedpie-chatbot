const visitIntents = require("../intents/visit.intents.json");
const clientIntents = require("../intents/client.intents.json");
const salesIntents = require("../intents/sales.intents.json");
const usersIntents = require("../intents/users.intents.json");
const { HIERARCHY_LEVEL } = require("./hierarchyService");

function intentNames(definitions = []) {
  return (definitions.intents || []).map((item) => item.intent).filter(Boolean);
}

const VISIT_INTENTS = intentNames(visitIntents);
const CLIENT_INTENTS = intentNames(clientIntents);
const SALES_INTENTS = intentNames(salesIntents);
const USERS_INTENTS = intentNames(usersIntents);

const SALES_FIELD_EXCLUDED = new Set([
  "totalInvoices",
  "totalInvoiceAmount",
  "totalInvoiceBalance",
  "invoicesByStatus",
  "invoiceTrend",
  "totalInvoiceDetails",
  "totalInvoicePayments",
  "invoicePaymentTrend",
  "totalPayments",
  "paymentsByState",
  "totalIyzicoTransactions",
  "iyzicoTransactionsByStatus",
]);

const USERS_MANAGER_INCLUDED = new Set([
  "userVisitSummary",
  "usersByTeam",
  "userStatusSummary",
  "userStepSummary",
  "userDeviceSummary",
  "userSavedViewSummary",
  "userLoginSuccessSummary",
]);

const USERS_FIELD_INCLUDED = new Set(["userVisitSummary"]);

const SALES_FIELD_INTENTS = SALES_INTENTS.filter((intent) => !SALES_FIELD_EXCLUDED.has(intent));
const USERS_MANAGER_INTENTS = USERS_INTENTS.filter((intent) => USERS_MANAGER_INCLUDED.has(intent));
const USERS_FIELD_INTENTS = USERS_INTENTS.filter((intent) => USERS_FIELD_INCLUDED.has(intent));

const PKG_FIELD = uniqueIntents([
  ...VISIT_INTENTS,
  ...CLIENT_INTENTS,
  ...SALES_FIELD_INTENTS,
  ...USERS_FIELD_INTENTS,
]);

const PKG_MANAGER = uniqueIntents([
  ...VISIT_INTENTS,
  ...CLIENT_INTENTS,
  ...SALES_INTENTS,
  ...USERS_MANAGER_INTENTS,
]);

function uniqueIntents(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function resolveDefaultIntents(context = {}) {
  const hierarchyLevel = Number(context.hierarchyLevel) || HIERARCHY_LEVEL.SELF;
  const managedTeamCount = (context.managedTeamIds || []).length;
  const isCompanyLevel =
    hierarchyLevel === HIERARCHY_LEVEL.COMPANY ||
    !!context.flags?.admin ||
    !!context.manageAll;

  if (isCompanyLevel) {
    return ["*"];
  }

  if (managedTeamCount >= 1 || hierarchyLevel >= HIERARCHY_LEVEL.TEAM) {
    return [...PKG_MANAGER];
  }

  if (context.flags?.fieldForce || hierarchyLevel === HIERARCHY_LEVEL.SELF) {
    return [...PKG_FIELD];
  }

  return [];
}

module.exports = {
  VISIT_INTENTS,
  CLIENT_INTENTS,
  SALES_INTENTS,
  USERS_INTENTS,
  PKG_FIELD,
  PKG_MANAGER,
  resolveDefaultIntents,
};
