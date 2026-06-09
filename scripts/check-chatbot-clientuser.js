const { queryDb } = require("../src/db/sql");

async function main() {
  const summary = await queryDb({
    query: `
      SELECT COUNT(DISTINCT cu.UserId) AS users, COUNT(DISTINCT cu.ClientId) AS clients
      FROM dbo.ClientUser cu
      INNER JOIN dbo.[User] u ON u.Id = cu.UserId AND u.Deleted = 0 AND u.SubscriptionId = 1517
      WHERE cu.Deleted = 0;
    `,
    bind: {},
  });
  console.log("Chatbot (1517) ClientUser links:", summary.recordset[0]);

  const scoped = await queryDb({
    query: `
      SELECT TOP 5
        COALESCE(c.Name, CONCAT('Client-', cu.ClientId)) AS clientName,
        COUNT(DISTINCT u.Id) AS totalUsers
      FROM dbo.[User] u
      INNER JOIN dbo.ClientUser cu ON cu.UserId = u.Id AND cu.Deleted = 0
      LEFT JOIN dbo.Client c ON c.Id = cu.ClientId AND c.Deleted = 0
      WHERE u.Deleted = 0 AND u.SubscriptionId = 1517
      GROUP BY COALESCE(c.Name, CONCAT('Client-', cu.ClientId))
      ORDER BY totalUsers DESC;
    `,
    bind: {},
  });
  console.log("\nScoped to 1517:");
  scoped.recordset.forEach((r) => console.log(`  ${r.clientName}: ${r.totalUsers}`));

  const unscoped = await queryDb({
    query: `
      SELECT TOP 3
        COALESCE(c.Name, CONCAT('Client-', cu.ClientId)) AS clientName,
        COUNT(DISTINCT u.Id) AS totalUsers
      FROM dbo.[User] u
      INNER JOIN dbo.ClientUser cu ON cu.UserId = u.Id AND cu.Deleted = 0
      LEFT JOIN dbo.Client c ON c.Id = cu.ClientId AND c.Deleted = 0
      WHERE u.Deleted = 0
      GROUP BY COALESCE(c.Name, CONCAT('Client-', cu.ClientId))
      ORDER BY totalUsers DESC;
    `,
    bind: {},
  });
  console.log("\nUnscoped (old bug showed this):");
  unscoped.recordset.forEach((r) => console.log(`  ${r.clientName}: ${r.totalUsers}`));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
