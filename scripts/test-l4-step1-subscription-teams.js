require("dotenv").config();

const { getEffectivePermissions } = require("../src/services/adminPermissionService");
const { resolveScopeTeams } = require("../src/services/scopeContextService");
const { shouldLoadSubscriptionTeams, HIERARCHY_LEVEL } = require("../src/services/hierarchyService");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function checkUser(label, userId, expectations = {}) {
  const ctx = await getEffectivePermissions(userId);
  const scopeTeams = resolveScopeTeams(ctx);

  console.log(`\n${label} (#${userId})`);
  console.log({
    hierarchyLevel: ctx.hierarchyLevel,
    operationalLevel: ctx.operationalLevel,
    isPureCompanyScopeUser: ctx.isPureCompanyScopeUser,
    managedTeamCount: (ctx.managedTeamIds || []).length,
    subscriptionTeamCount: (ctx.subscriptionTeams || []).length,
    scopeTeamCount: scopeTeams.length,
  });

  if (expectations.isPureCompanyScopeUser !== undefined) {
    assert(
      ctx.isPureCompanyScopeUser === expectations.isPureCompanyScopeUser,
      `${label}: isPureCompanyScopeUser expected ${expectations.isPureCompanyScopeUser}, got ${ctx.isPureCompanyScopeUser}`
    );
  }

  if (expectations.minSubscriptionTeams !== undefined) {
    assert(
      (ctx.subscriptionTeams || []).length >= expectations.minSubscriptionTeams,
      `${label}: expected at least ${expectations.minSubscriptionTeams} subscription teams, got ${(ctx.subscriptionTeams || []).length}`
    );
  }

  if (expectations.maxSubscriptionTeams !== undefined) {
    assert(
      (ctx.subscriptionTeams || []).length <= expectations.maxSubscriptionTeams,
      `${label}: expected at most ${expectations.maxSubscriptionTeams} subscription teams, got ${(ctx.subscriptionTeams || []).length}`
    );
  }

  if (expectations.scopeTeamSource === "subscription") {
    assert(
      scopeTeams.length === (ctx.subscriptionTeams || []).length,
      `${label}: resolveScopeTeams should return subscription teams for L4`
    );
  }

  if (expectations.scopeTeamSource === "managed") {
    assert(
      scopeTeams.length === (ctx.managedTeamIds || []).length,
      `${label}: resolveScopeTeams should match managed teams`
    );
  }

  if ((ctx.subscriptionTeams || []).length) {
    console.log(
      "  Ornek takimlar:",
      ctx.subscriptionTeams.slice(0, 3).map((t) => t.teamName).join(", ")
    );
  }
}

async function main() {
  console.log("L4 Adim 1: subscriptionTeams yukleme testi\n");

  assert(
    shouldLoadSubscriptionTeams({ companyCapable: true }),
    "shouldLoadSubscriptionTeams: L4 admin true olmali"
  );

  assert(
    !shouldLoadSubscriptionTeams({ companyCapable: false }),
    "shouldLoadSubscriptionTeams: L2/L3 false olmali"
  );

  await checkUser("L4 saf admin (Mireille)", 12942, {
    isPureCompanyScopeUser: true,
    minSubscriptionTeams: 1,
    scopeTeamSource: "subscription",
  });

  await checkUser("L3 supervisor (Amer)", 12497, {
    isPureCompanyScopeUser: false,
    maxSubscriptionTeams: 0,
    scopeTeamSource: "managed",
  });

  console.log("\nL4 Adim 1: OK");
}

main().catch((err) => {
  console.error("\nFAILED:", err.message);
  process.exit(1);
});
