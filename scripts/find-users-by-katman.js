require("dotenv").config();

const { queryDb } = require("../src/db/sql");

const subscriptionId = process.argv[2] ? Number(process.argv[2]) : null;
const katman = process.argv[3] ? Number(process.argv[3]) : 1;
const limit = process.argv[4] ? Number(process.argv[4]) : 20;

async function main() {
  const subFilter = subscriptionId
    ? "AND u.SubscriptionId = @subscriptionId"
    : "";

  const result = await queryDb({
    query: `
      WITH UserStats AS (
        SELECT
          u.Id,
          u.Name,
          u.Email,
          u.SubscriptionId,
          s.CompanyName,
          u.Admin,
          u.ManagerOfAllTeams,
          MAX(CASE WHEN ut.Manager = 1 THEN 1 ELSE 0 END) AS isTeamManager,
          COUNT(DISTINCT CASE WHEN ut.Manager = 1 THEN ut.TeamId END) AS managedTeamCount
        FROM dbo.[User] u
        LEFT JOIN dbo.Subscription s ON s.Id = u.SubscriptionId
        LEFT JOIN dbo.UserTeam ut ON ut.UserId = u.Id AND ut.Deleted = 0
        WHERE u.Deleted = 0
          ${subFilter}
        GROUP BY u.Id, u.Name, u.Email, u.SubscriptionId, s.CompanyName, u.Admin, u.ManagerOfAllTeams
      ),
      UserKatman AS (
        SELECT
          *,
          CASE
            WHEN Admin = 1 OR ManagerOfAllTeams = 1 THEN 4
            WHEN managedTeamCount > 1 THEN 3
            WHEN isTeamManager = 1 THEN 2
            ELSE 1
          END AS katman
        FROM UserStats
      )
      SELECT TOP (${limit})
        Id,
        Name,
        Email,
        SubscriptionId,
        CompanyName,
        katman,
        managedTeamCount,
        isTeamManager,
        Admin,
        ManagerOfAllTeams
      FROM UserKatman
      WHERE katman = @katman
        AND Email IS NOT NULL
        AND LTRIM(RTRIM(Email)) <> ''
      ORDER BY SubscriptionId, Name;
    `,
    bind: {
      katman,
      ...(subscriptionId ? { subscriptionId } : {}),
    },
  });

  console.log(
    JSON.stringify(
      {
        filter: { subscriptionId, katman, limit },
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
