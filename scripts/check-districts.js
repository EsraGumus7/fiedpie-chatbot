const { queryDb } = require("../src/db/sql");

async function main() {
  const city52 = await queryDb({
    query: `
      SELECT Id, Name, SubscriptionId, Deleted
      FROM dbo.City WHERE Id = 52
    `,
    bind: {},
  });
  console.log("City 52:", city52.recordset);

  const withDistricts = await queryDb({
    query: `
      SELECT TOP 15
        c.Id, c.Name, c.SubscriptionId,
        (SELECT COUNT(*) FROM dbo.District d WHERE d.CityId = c.Id AND d.Deleted = 0) AS districtCount
      FROM dbo.City c
      WHERE c.Deleted = 0
        AND EXISTS (
          SELECT 1 FROM dbo.District d
          WHERE d.CityId = c.Id AND d.Deleted = 0
        )
      ORDER BY districtCount DESC
    `,
    bind: {},
  });
  console.log("Cities with districts (Deleted=0):", withDistricts.recordset);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
