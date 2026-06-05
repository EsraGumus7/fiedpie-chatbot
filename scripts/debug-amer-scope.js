require("dotenv").config();
const { queryDb } = require("../src/db/sql");
const { getEffectivePermissions } = require("../src/services/adminPermissionService");

async function main() {
  const ctx = await getEffectivePermissions(12497);
  console.log("allowedUserIds count:", ctx.allowedUserIds.length);
  console.log("allowedCountryIds:", ctx.allowedCountryIds);

  const userSql = await queryDb({
    query: `
      DECLARE @Email NVARCHAR(256) = N'1Amer.Haffar@napconational.com';
      WITH Manager AS (
        SELECT u.Id AS userId, u.SubscriptionId
        FROM dbo.[User] u
        WHERE u.Email = @Email AND u.Deleted = 0
      ),
      ManagedTeams AS (
        SELECT DISTINCT ut.TeamId
        FROM Manager m
        INNER JOIN dbo.UserTeam ut ON ut.UserId = m.userId AND ut.Manager = 1 AND ut.Deleted = 0
      ),
      OperationalUsers AS (
        SELECT m.userId AS UserId FROM Manager m
        UNION
        SELECT DISTINCT ut.UserId
        FROM ManagedTeams mt
        INNER JOIN dbo.UserTeam ut ON ut.TeamId = mt.TeamId AND ut.Deleted = 0
        INNER JOIN dbo.[User] u ON u.Id = ut.UserId AND u.Deleted = 0
        INNER JOIN Manager m ON u.SubscriptionId = m.SubscriptionId
      )
      SELECT
        (SELECT COUNT(DISTINCT UserId) FROM OperationalUsers) AS userCount,
        (
          SELECT COUNT(1)
          FROM dbo.Visit v
          INNER JOIN OperationalUsers ou ON ou.UserId = v.UserId
          INNER JOIN Manager m ON v.SubscriptionId = m.SubscriptionId
          WHERE v.Deleted = 0 AND v.Realized = 1
        ) AS visitCount;
    `,
    bind: {},
  });

  console.log("User SQL style:", userSql.recordset[0]);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
