const { queryDb } = require("../src/db/sql");
const { buildUserContext } = require("../src/services/userContextService");
const { resolveScopePlan } = require("../src/services/scopeContextService");

async function main() {
  const users = await queryDb({
    query: `
      SELECT u.Id, u.Name, u.Email
      FROM dbo.[User] u
      WHERE u.SubscriptionId = 1517 AND u.Deleted = 0 AND u.Email IS NOT NULL
      ORDER BY u.Id;
    `,
    bind: {},
  });

  for (const row of users.recordset) {
    const ctx = await buildUserContext(row.Id);
    const plan = resolveScopePlan(ctx, "musterilere gore kullanici dagilimi", "usersByClient");
    console.log(
      row.Id,
      row.Name,
      row.Email,
      "| L",
      ctx.hierarchyLevel,
      "| plan:",
      plan.mode,
      "| managed:",
      (ctx.managedTeamIds || []).length,
      "| sub teams:",
      (ctx.subscriptionTeams || []).length
    );
  }

  const teams = await queryDb({
    query: `
      SELECT t.Id, t.Name, COUNT(DISTINCT ut.UserId) AS members
      FROM dbo.Team t
      LEFT JOIN dbo.UserTeam ut ON ut.TeamId = t.Id AND ut.Deleted = 0
      WHERE t.SubscriptionId = 1517 AND t.Deleted = 0
      GROUP BY t.Id, t.Name
      ORDER BY t.Name;
    `,
    bind: {},
  });
  console.log("\nChatbot teams:");
  teams.recordset.forEach((t) => console.log(` - ${t.Name}: ${t.members} members`));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
