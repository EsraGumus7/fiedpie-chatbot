const { queryDb } = require("../src/db/sql");

async function main() {
  const brandUsers = await queryDb({
    query: `
      SELECT u.Id, u.Name, u.Email, b.Name AS brandName
      FROM dbo.UserBrand ub
      INNER JOIN dbo.[User] u ON u.Id = ub.UserId AND u.Deleted = 0
      INNER JOIN dbo.Brand b ON b.Id = ub.BrandId AND b.Deleted = 0 AND b.SubscriptionId = 1515
      WHERE ub.Deleted = 0;
    `,
    bind: {},
  });
  console.log("Brand users on Intern Demo (1515):");
  for (const row of brandUsers.recordset) {
    console.log(` - ${row.Id} ${row.Name} | ${row.brandName}`);
    const teams = await queryDb({
      query: `
        SELECT t.Id, t.Name
        FROM dbo.UserTeam ut
        INNER JOIN dbo.Team t ON t.Id = ut.TeamId AND t.Deleted = 0
        WHERE ut.UserId = @uid AND ut.Deleted = 0;
      `,
      bind: { uid: row.Id },
    });
    console.log(
      `   teams: ${teams.recordset.length ? teams.recordset.map((t) => t.Name).join(", ") : "(none)"}`
    );
  }

  const teamCounts = await queryDb({
    query: `
      SELECT t.Name AS teamName, COUNT(DISTINCT ut.UserId) AS memberCount,
        COUNT(DISTINCT CASE WHEN ub.UserId IS NOT NULL THEN ut.UserId END) AS membersWithBrand
      FROM dbo.Team t
      INNER JOIN dbo.UserTeam ut ON ut.TeamId = t.Id AND ut.Deleted = 0
      INNER JOIN dbo.[User] u ON u.Id = ut.UserId AND u.Deleted = 0
      LEFT JOIN dbo.UserBrand ub ON ub.UserId = u.Id AND ub.Deleted = 0
      LEFT JOIN dbo.Brand b ON b.Id = ub.BrandId AND b.Deleted = 0 AND b.SubscriptionId = 1515
      WHERE t.SubscriptionId = 1515 AND t.Deleted = 0
      GROUP BY t.Name
      ORDER BY memberCount DESC;
    `,
    bind: {},
  });
  console.log("\nAll teams: members vs members-with-brand");
  for (const row of teamCounts.recordset) {
    console.log(
      ` - ${row.teamName}: ${row.memberCount} members, ${row.membersWithBrand} with brand`
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
