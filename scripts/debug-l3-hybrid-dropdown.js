require("dotenv").config();

const { queryDb } = require("../src/db/sql");
const { buildUserContext } = require("../src/services/userContextService");

async function inspectUser(userId, label = "") {
  const ctx = await buildUserContext(userId);
  const tb = ctx.scopeToolbar;
  console.log(`\n${label || userId} (#${userId})`);
  console.log({
    email: ctx.email,
    operationalLevel: ctx.operationalLevel,
    hierarchyLevel: ctx.hierarchyLevel,
    isHybridScopeUser: ctx.isHybridScopeUser,
    companyCapable: ctx.companyCapable,
    managedTeamIds: ctx.managedTeamIds,
    subscriptionTeamCount: (ctx.subscriptionTeams || []).length,
    operationalTeams: (tb.operationalTeams || []).map((t) => t.teamName),
    companyTeams: (tb.companyTeams || []).map((t) => t.teamName),
    teamsLocked: tb.teamsButton?.locked,
    companyLocked: tb.companyButton?.locked,
    allowDual: tb.allowDualScopeSelect,
    defaultSelection: tb.defaultSelection,
  });
}

async function findL3HybridUsers() {
  const result = await queryDb({
    query: `
      WITH AdminRoleUsers AS (
        SELECT
          ur.UserId,
          MAX(CASE WHEN r.DefaultAdmin = 1 THEN 1 ELSE 0 END) AS hasDefaultAdminRole,
          MAX(CASE WHEN r.TestingCompanyAdmin = 1 THEN 1 ELSE 0 END) AS hasTestingCompanyAdminRole
        FROM dbo.UserRole ur
        INNER JOIN dbo.Role r ON r.Id = ur.RoleId AND r.Deleted = 0
        WHERE ur.Deleted = 0
        GROUP BY ur.UserId
      ),
      UserStats AS (
        SELECT
          u.Id,
          u.Email,
          u.SubscriptionId,
          COUNT(DISTINCT CASE WHEN ut.Manager = 1 THEN ut.TeamId END) AS managedTeamCount
        FROM dbo.[User] u
        LEFT JOIN dbo.UserTeam ut ON ut.UserId = u.Id AND ut.Deleted = 0
        WHERE u.Deleted = 0
        GROUP BY u.Id, u.Email, u.SubscriptionId
      )
      SELECT TOP 10
        s.Id,
        s.Email,
        s.SubscriptionId,
        s.managedTeamCount
      FROM UserStats s
      LEFT JOIN AdminRoleUsers a ON a.UserId = s.Id
      WHERE s.managedTeamCount >= 2
        AND (
          ISNULL(a.hasDefaultAdminRole, 0) = 1
          OR ISNULL(a.hasTestingCompanyAdmin, 0) = 1
        )
      ORDER BY s.managedTeamCount DESC;
    `,
    bind: {},
  });

  return result.recordset;
}

async function main() {
  const known = [
    [12497, "Amer L3 (test)"],
    [14074, "Esra L2 hibrit"],
  ];

  for (const [id, label] of known) {
    try {
      await inspectUser(id, label);
    } catch (err) {
      console.log(`\n${label}: ${err.message}`);
    }
  }

  console.log("\n--- L3+ admin role users ---");
  const users = await findL3HybridUsers();
  for (const row of users) {
    try {
      await inspectUser(row.Id, `${row.Email} (${row.managedTeamCount} managed)`);
    } catch (err) {
      console.log(`\n${row.Email}: ${err.message}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
