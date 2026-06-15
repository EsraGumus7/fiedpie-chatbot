const { queryDb } = require("../src/db/sql");

async function main() {
  const summary = await queryDb({
    query: `
      SELECT
        COUNT(1) AS totalVisits,
        SUM(CASE WHEN v.VisitTypeId IS NULL THEN 1 ELSE 0 END) AS nullTypeCount,
        SUM(CASE WHEN v.VisitTypeId IS NOT NULL THEN 1 ELSE 0 END) AS withTypeCount
      FROM dbo.Visit v
      WHERE v.Deleted = 0;
    `,
    bind: {},
  });
  console.log("Visit type doluluk:", summary.recordset[0]);

  const byStatus = await queryDb({
    query: `
      SELECT TOP 15
        COALESCE(vs.Name, CONCAT('State-', v.VisitStateId)) AS visitStatus,
        CASE WHEN v.VisitTypeId IS NULL THEN 'TIP YOK' ELSE COALESCE(vt.Name, CONCAT('Type-', v.VisitTypeId)) END AS visitType,
        COUNT(1) AS total
      FROM dbo.Visit v
      LEFT JOIN dbo.VisitState vs ON vs.Id = v.VisitStateId
      LEFT JOIN dbo.VisitType vt ON vt.Id = v.VisitTypeId
      WHERE v.Deleted = 0
      GROUP BY
        COALESCE(vs.Name, CONCAT('State-', v.VisitStateId)),
        CASE WHEN v.VisitTypeId IS NULL THEN 'TIP YOK' ELSE COALESCE(vt.Name, CONCAT('Type-', v.VisitTypeId)) END
      ORDER BY total DESC;
    `,
    bind: {},
  });
  console.log("Durum + tip dagilimi:", byStatus.recordset);

  const types = await queryDb({
    query: `
      SELECT TOP 20 Id, Name, Deleted
      FROM dbo.VisitType
      ORDER BY Id;
    `,
    bind: {},
  });
  console.log("Tanimli VisitType kayitlari:", types.recordset);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
