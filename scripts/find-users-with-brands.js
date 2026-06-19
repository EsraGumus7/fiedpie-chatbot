const { queryDb } = require("../src/db/sql");

async function main() {
  const rows = await queryDb({
    query: `
      SELECT TOP 30
        u.Id AS userId,
        u.Name AS userName,
        u.Email AS email,
        s.Id AS subscriptionId,
        s.CompanyName AS companyName,
        b.Name AS brandName,
        COUNT(*) OVER (PARTITION BY u.Id) AS brandCountForUser
      FROM dbo.UserBrand ub
      INNER JOIN dbo.[User] u ON u.Id = ub.UserId AND u.Deleted = 0
      INNER JOIN dbo.Brand b ON b.Id = ub.BrandId AND b.Deleted = 0
      INNER JOIN dbo.Subscription s ON s.Id = b.SubscriptionId AND s.Deleted = 0
      WHERE ub.Deleted = 0
        AND u.Email IS NOT NULL
        AND LTRIM(RTRIM(u.Email)) <> ''
      ORDER BY s.Id, b.Name, u.Name;
    `,
    bind: {},
  });

  console.log("Users with brand assignment (login candidates):\n");
  const seen = new Set();
  for (const row of rows.recordset) {
    const key = `${row.subscriptionId}:${row.userId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    console.log(
      [
        `sub ${row.subscriptionId} (${row.companyName?.trim()})`,
        `user ${row.userId} ${row.userName}`,
        row.email,
        `brand: ${row.brandName}`,
        `(${row.brandCountForUser} brand link)`,
      ].join(" | ")
    );
  }

  const internDemo = await queryDb({
    query: `
      SELECT
        u.Id, u.Name, u.Email,
        STRING_AGG(b.Name, ', ') AS brands
      FROM dbo.[User] u
      INNER JOIN dbo.UserBrand ub ON ub.UserId = u.Id AND ub.Deleted = 0
      INNER JOIN dbo.Brand b ON b.Id = ub.BrandId AND b.Deleted = 0 AND b.SubscriptionId = 1515
      WHERE u.Deleted = 0 AND u.Email IS NOT NULL
      GROUP BY u.Id, u.Name, u.Email
      ORDER BY u.Name;
    `,
    bind: {},
  });

  console.log("\n--- Intern Demo (1515) - best for brand test ---");
  if (!internDemo.recordset.length) {
    console.log("(no users with brand on 1515)");
  } else {
    for (const u of internDemo.recordset) {
      console.log(`- ${u.Name} | ${u.Email} | brands: ${u.brands}`);
    }
  }

  const mehmet = await queryDb({
    query: `
      SELECT u.Id, u.Name, u.Email, s.Id AS subscriptionId, s.CompanyName,
        (SELECT COUNT(1) FROM dbo.UserBrand ub WHERE ub.UserId = u.Id AND ub.Deleted = 0) AS brandLinks
      FROM dbo.[User] u
      INNER JOIN dbo.Subscription s ON s.Id = u.SubscriptionId
      WHERE u.Email = @email AND u.Deleted = 0;
    `,
    bind: { email: "mehmetkordon09@gmail.com" },
  });
  console.log("\nCurrent test user (mehmet):", mehmet.recordset[0] || "not found");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
