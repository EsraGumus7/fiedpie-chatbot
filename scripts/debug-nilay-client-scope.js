const { buildUserContext } = require("../src/services/userContextService");
const { executeSecureIntent } = require("../src/services/secureIntentExecutor");
const {
  buildScopedUserContext,
  buildSingleTeamScopedContext,
  resolveScopePlan,
} = require("../src/services/scopeContextService");
const {
  resolveBreakdownTeamList,
  buildScopeToolbarConfig,
} = require("../src/services/scopeSelectionService");
const { queryDb } = require("../src/db/sql");

async function main() {
  const loginRes = await fetch("http://localhost:3000/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "nilaybsl@evatro.com", password: "1463" }),
  });
  const login = await loginRes.json();
  if (!login.token) {
    console.log("login fail", login);
    return;
  }

  const userContext = await buildUserContext(login.user.id);
  const intent = "usersByClient";
  const plan = resolveScopePlan(userContext, "musterilere gore kullanici dagilimi", intent);
  const toolbar = buildScopeToolbarConfig(userContext);
  const breakdownTeams = resolveBreakdownTeamList(userContext, toolbar, plan.teamIds);

  console.log("user", login.user.id, login.user.name);
  console.log("plan", plan.mode, plan.teamIds);
  console.log("breakdown teams", breakdownTeams);

  const companyContext = buildScopedUserContext(userContext, "company");
  console.log("\ncompany bypass?", companyContext.hierarchyBypassUserFilter, "allowed", companyContext.allowedUserIds?.length);

  const companyResult = await executeSecureIntent({
    intent,
    params: {},
    userContext: companyContext,
  });
  console.log("\nCOMPANY top 3:");
  companyResult.rows.slice(0, 3).forEach((r) => console.log(`  ${r.clientName}: ${r.totalUsers}`));

  for (const team of breakdownTeams) {
    const teamContext = await buildSingleTeamScopedContext(userContext, team.teamId);
    const teamResult = await executeSecureIntent({
      intent,
      params: {},
      userContext: teamContext,
    });
    console.log(`\nTEAM ${team.teamName} allowedUsers=${teamContext.allowedUserIds?.length} bypass=${teamContext.hierarchyBypassUserFilter}`);
    teamResult.rows.slice(0, 3).forEach((r) => console.log(`  ${r.clientName}: ${r.totalUsers}`));
    if (!teamResult.rows.length) console.log("  (empty)");
  }

  const subCheck = await queryDb({
    query: `
      SELECT TOP 5 c.Name, c.SubscriptionId, COUNT(DISTINCT cu.UserId) AS users
      FROM dbo.Client c
      INNER JOIN dbo.ClientUser cu ON cu.ClientId = c.Id AND cu.Deleted = 0
      INNER JOIN dbo.[User] u ON u.Id = cu.UserId AND u.Deleted = 0 AND u.SubscriptionId = 1517
      GROUP BY c.Name, c.SubscriptionId
      ORDER BY users DESC;
    `,
    bind: {},
  });
  console.log("\nClient subscription for Chatbot-linked users:");
  subCheck.recordset.forEach((r) => console.log(`  ${r.Name} sub=${r.SubscriptionId} users=${r.users}`));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
