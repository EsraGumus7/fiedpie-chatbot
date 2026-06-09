const { queryDb } = require("../src/db/sql");
const { executeSecureIntent } = require("../src/services/secureIntentExecutor");
const { buildUserContext } = require("../src/services/userContextService");
const {
  buildScopedUserContext,
  buildSingleTeamScopedContext,
  resolveScopePlan,
} = require("../src/services/scopeContextService");

async function login(email) {
  const res = await fetch("http://localhost:3000/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "1463" }),
  });
  const data = await res.json();
  if (!data.token) throw new Error(`Login failed for ${email}: ${JSON.stringify(data)}`);
  return data;
}

async function compareScope(email) {
  const loginData = await login(email);
  const userContext = await buildUserContext(loginData.user.id);
  const intent = "usersByClient";
  const params = {};
  const plan = resolveScopePlan(userContext, "musterilere gore kullanici dagilimi", intent);

  console.log("\n===", email, "===");
  console.log("userId:", loginData.user.id, "| sub:", userContext.subscriptionId, userContext.companyScopeLabel);
  console.log("hierarchy:", userContext.hierarchyLevel, userContext.hierarchyLabel, "| plan:", plan.mode);
  console.log("managed teams:", (userContext.managedTeamIds || []).length);

  const companyContext = buildScopedUserContext(userContext, "company");
    const companyResult = await executeSecureIntent({
      intent,
      params,
      userContext: companyContext,
    });
  console.log("\nCOMPANY rows (top 3):");
  (companyResult.rows || []).slice(0, 3).forEach((r) =>
    console.log(`  ${r.clientName}: ${r.totalUsers}`)
  );

  const teams = await queryDb({
    query: `
      SELECT TOP 5 t.Id, t.Name
      FROM dbo.Team t
      WHERE t.SubscriptionId = @subId AND t.Deleted = 0
      ORDER BY t.Name;
    `,
    bind: { subId: userContext.subscriptionId },
  });

  for (const team of teams.recordset) {
    const teamContext = await buildSingleTeamScopedContext(userContext, team.Id);
    const teamResult = await executeSecureIntent({
      intent,
      params,
      userContext: teamContext,
    });
    console.log(`\nTEAM ${team.Name} (allowedUsers: ${teamContext.allowedUserIds?.length || 0}) rows (top 3):`);
    (teamResult.rows || []).slice(0, 3).forEach((r) =>
      console.log(`  ${r.clientName}: ${r.totalUsers}`)
    );
    if (!(teamResult.rows || []).length) {
      console.log("  (empty)");
    }
  }
}

async function main() {
  const emails = [
    "mehmetkordon09@gmail.com",
    "1nilufer@napco.com",
  ];

  const chatbotUsers = await queryDb({
    query: `
      SELECT TOP 5 u.Email, u.Name, u.Id
      FROM dbo.[User] u
      WHERE u.SubscriptionId = 1517 AND u.Deleted = 0 AND u.Email IS NOT NULL
      ORDER BY u.Id;
    `,
    bind: {},
  });
  console.log("Chatbot users sample:", chatbotUsers.recordset);

  for (const email of emails) {
    try {
      await compareScope(email);
    } catch (err) {
      console.log("skip", email, err.message);
    }
  }

  for (const row of chatbotUsers.recordset.slice(0, 2)) {
    try {
      await compareScope(row.Email.trim());
    } catch (err) {
      console.log("skip", row.Email, err.message);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
