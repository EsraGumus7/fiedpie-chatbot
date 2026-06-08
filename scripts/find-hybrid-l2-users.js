require("dotenv").config();

const { queryDb } = require("../src/db/sql");

const subscriptionId = process.argv[2] ? Number(process.argv[2]) : 1515;

async function main() {
  const result = await queryDb({
    query: `
      DECLARE @SubId BIGINT = @subscriptionId;

      WITH AdminRoleUsers AS (
        SELECT
          ur.UserId,
          MAX(CASE WHEN r.DefaultAdmin = 1 THEN 1 ELSE 0 END) AS hasDefaultAdminRole,
          MAX(CASE WHEN r.TestingCompanyAdmin = 1 THEN 1 ELSE 0 END) AS hasTestingCompanyAdminRole,
          STRING_AGG(r.Name, ', ') AS roleNames
        FROM dbo.UserRole ur
        INNER JOIN dbo.Role r ON r.Id = ur.RoleId AND r.Deleted = 0
        WHERE ur.Deleted = 0
        GROUP BY ur.UserId
      ),
      UserStats AS (
        SELECT
          u.Id,
          u.Name,
          u.Email,
          u.Admin,
          u.ManagerOfAllTeams,
          COUNT(DISTINCT CASE WHEN ut.Manager = 1 THEN ut.TeamId END) AS managedTeamCount
        FROM dbo.[User] u
        LEFT JOIN dbo.UserTeam ut ON ut.UserId = u.Id AND ut.Deleted = 0
        WHERE u.Deleted = 0
          AND u.SubscriptionId = @SubId
        GROUP BY u.Id, u.Name, u.Email, u.Admin, u.ManagerOfAllTeams
      ),
      ManagedTeams AS (
        SELECT
          ut.UserId,
          STRING_AGG(t.Name, ', ') AS managedTeamNames
        FROM dbo.UserTeam ut
        INNER JOIN dbo.Team t ON t.Id = ut.TeamId AND t.Deleted = 0
        WHERE ut.Deleted = 0 AND ut.Manager = 1
        GROUP BY ut.UserId
      )
      SELECT
        s.Id,
        s.Name,
        s.Email,
        s.managedTeamCount,
        m.managedTeamNames,
        s.Admin,
        ISNULL(a.hasDefaultAdminRole, 0) AS hasDefaultAdminRole,
        ISNULL(a.hasTestingCompanyAdminRole, 0) AS hasTestingCompanyAdminRole,
        a.roleNames
      FROM UserStats s
      LEFT JOIN AdminRoleUsers a ON a.UserId = s.Id
      LEFT JOIN ManagedTeams m ON m.UserId = s.Id
      WHERE s.managedTeamCount = 1
        AND s.ManagerOfAllTeams = 0
        AND s.Email IS NOT NULL
        AND LTRIM(RTRIM(s.Email)) <> ''
        AND (
          s.Admin = 1
          OR ISNULL(a.hasDefaultAdminRole, 0) = 1
          OR ISNULL(a.hasTestingCompanyAdminRole, 0) = 1
        )
      ORDER BY s.Name;
    `,
    bind: { subscriptionId },
  });

  console.log(
    JSON.stringify(
      {
        subscriptionId,
        count: result.recordset.length,
        users: result.recordset,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
