require("dotenv").config();

const { queryDb } = require("../src/db/sql");
const { buildUserContext } = require("../src/services/userContextService");

async function main() {
  const subscriptionId = process.argv[2] ? Number(process.argv[2]) : null;

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
          u.Admin,
          COUNT(DISTINCT CASE WHEN ut.Manager = 1 THEN ut.TeamId END) AS managedTeamCount
        FROM dbo.[User] u
        LEFT JOIN dbo.UserTeam ut ON ut.UserId = u.Id AND ut.Deleted = 0
        WHERE u.Deleted = 0
          AND (@subscriptionId IS NULL OR u.SubscriptionId = @subscriptionId)
        GROUP BY u.Id, u.Email, u.SubscriptionId, u.Admin
      )
      SELECT
        s.Id,
        s.Email,
        s.SubscriptionId,
        s.Admin,
        s.managedTeamCount,
        ISNULL(a.hasDefaultAdminRole, 0) AS hasDefaultAdminRole,
        ISNULL(a.hasTestingCompanyAdminRole, 0) AS hasTestingCompanyAdminRole
      FROM UserStats s
      LEFT JOIN AdminRoleUsers a ON a.UserId = s.Id
      WHERE s.managedTeamCount >= 2
        AND (
          s.Admin = 1
          OR ISNULL(a.hasDefaultAdminRole, 0) = 1
          OR ISNULL(a.hasTestingCompanyAdminRole, 0) = 1
        )
      ORDER BY s.managedTeamCount DESC;
    `,
    bind: { subscriptionId: subscriptionId || null },
  });

  console.log(`Found ${result.recordset.length} L3+ admin-capable users\n`);

  for (const row of result.recordset) {
    const ctx = await buildUserContext(row.Id);
    const tb = ctx.scopeToolbar;
    console.log({
      id: row.Id,
      email: row.Email,
      sub: row.SubscriptionId,
      managed: row.managedTeamCount,
      opLevel: ctx.operationalLevel,
      hybrid: ctx.isHybridScopeUser,
      subTeams: (ctx.subscriptionTeams || []).length,
      dropdownTeams: (tb.operationalTeams || []).length,
      dropdownNames: (tb.operationalTeams || []).map((t) => t.teamName),
      dual: tb.allowDualScopeSelect,
    });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
