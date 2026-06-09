const { queryDb } = require("../src/db/sql");

async function main() {
  const subs = await queryDb({
    query: `
      SELECT TOP 10 s.Id, s.CompanyName
      FROM dbo.Subscription s
      WHERE s.Deleted = 0
        AND (s.CompanyName LIKE '%Chatbot%' OR s.CompanyName LIKE '%chatbot%')
      ORDER BY s.Id;
    `,
    bind: {},
  });
  console.log("Chatbot subscriptions:", subs.recordset);

  const brands = await queryDb({
    query: `
      SELECT TOP 20
        b.Id,
        b.Name,
        b.SubscriptionId,
        s.CompanyName,
        (
          SELECT COUNT(DISTINCT ub.UserId)
          FROM dbo.UserBrand ub
          WHERE ub.BrandId = b.Id AND ub.Deleted = 0
        ) AS userCount,
        (
          SELECT COUNT(DISTINCT cb.ClientId)
          FROM dbo.ClientBrand cb
          WHERE cb.BrandId = b.Id AND cb.Deleted = 0
        ) AS clientCount
      FROM dbo.Brand b
      LEFT JOIN dbo.Subscription s ON s.Id = b.SubscriptionId
      WHERE b.Deleted = 0
      ORDER BY userCount DESC, b.Id DESC;
    `,
    bind: {},
  });
  console.log("\nBrands (top 20 by linked users):");
  for (const row of brands.recordset) {
    console.log(
      ` - [${row.Id}] ${row.Name} | sub ${row.SubscriptionId} (${row.CompanyName || "-"}) | users: ${row.userCount} | clients: ${row.clientCount}`
    );
  }

  for (const sub of subs.recordset) {
    const subBrands = await queryDb({
      query: `
        SELECT b.Id, b.Name, COUNT(DISTINCT ub.UserId) AS linkedUsers
        FROM dbo.Brand b
        LEFT JOIN dbo.UserBrand ub ON ub.BrandId = b.Id AND ub.Deleted = 0
        WHERE b.Deleted = 0 AND b.SubscriptionId = @subId
        GROUP BY b.Id, b.Name
        ORDER BY linkedUsers DESC, b.Name;
      `,
      bind: { subId: sub.Id },
    });
    console.log(`\nSubscription ${sub.Id} (${sub.CompanyName}) brands:`);
    if (!subBrands.recordset.length) {
      console.log("  (no brands defined)");
      continue;
    }
    for (const row of subBrands.recordset) {
      console.log(`  - ${row.Name}: ${row.linkedUsers} user(s)`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
