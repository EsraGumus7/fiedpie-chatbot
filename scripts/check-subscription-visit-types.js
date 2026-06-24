const { queryDb } = require("../src/db/sql");

async function main() {
  const cols = await queryDb({
    query: `
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'VisitType'
      ORDER BY ORDINAL_POSITION
    `,
    bind: {},
  });
  console.log("VisitType columns:", cols.recordset.map((r) => r.COLUMN_NAME).join(", "));

  const demoUsers = await queryDb({
    query: `
      SELECT TOP 5 u.Id, u.Email, u.SubscriptionId, s.CompanyName
      FROM dbo.[User] u
      LEFT JOIN dbo.Subscription s ON s.Id = u.SubscriptionId
      WHERE u.Email IN ('mehmetkordon09@gmail.com', 'ali@evatro.com')
         OR u.Name LIKE '%Nilay%'
    `,
    bind: {},
  });
  console.log("Demo users:", demoUsers.recordset);

  const subIds = demoUsers.recordset.map((r) => r.SubscriptionId).filter(Boolean);
  if (!subIds.length) return;

  const { sql, bind } = (() => {
    const parts = [];
    const b = {};
    subIds.forEach((id, i) => {
      b[`sub${i}`] = Number(id);
      parts.push(`@${`sub${i}`}`);
    });
    return { sql: parts.join(", "), bind: b };
  })();

  const visitTypesForSub = await queryDb({
    query: `
      SELECT vt.Id, vt.Name, vt.Deleted, vt.SubscriptionId
      FROM dbo.VisitType vt
      WHERE vt.Deleted = 0
        AND vt.SubscriptionId IN (${sql})
      ORDER BY vt.Name
    `,
    bind,
  });
  console.log("Visit types for demo subscription(s):", visitTypesForSub.recordset);

  const clientDefaults = await queryDb({
    query: `
      SELECT TOP 10 c.Id, c.Name, c.DefaultVisitTypeId, c.SubscriptionId
      FROM dbo.Client c
      WHERE c.Deleted = 0
        AND c.SubscriptionId IN (${sql})
      ORDER BY c.Id DESC
    `,
    bind,
  });
  console.log("Client default visit types:", clientDefaults.recordset);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
