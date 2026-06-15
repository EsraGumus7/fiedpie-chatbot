const { queryDb } = require("../src/db/sql");

async function main() {
  const subId = 1517; // Chatbot

  const all = await queryDb({
    query: `
      SELECT
        COUNT(1) AS total,
        SUM(CASE WHEN v.Realized = 1 THEN 1 ELSE 0 END) AS realized,
        SUM(CASE WHEN v.Realized = 0 OR v.Realized IS NULL THEN 1 ELSE 0 END) AS notRealized,
        SUM(CASE WHEN v.StartedAt IS NULL THEN 1 ELSE 0 END) AS noStartedAt,
        SUM(CASE WHEN v.Realized = 1 AND v.StartedAt IS NOT NULL THEN 1 ELSE 0 END) AS trendEligible
      FROM dbo.Visit v
      INNER JOIN dbo.[User] u ON u.Id = v.UserId AND u.Deleted = 0
      WHERE v.Deleted = 0
        AND u.SubscriptionId = @subId
    `,
    bind: { subId },
  });
  console.log("Chatbot subscription visit counts:", all.recordset[0]);

  const byStatus = await queryDb({
    query: `
      SELECT
        COALESCE(vs.Name, CONCAT('State-', v.VisitStateId)) AS visitStatus,
        v.Realized,
        COUNT(1) AS total,
        SUM(CASE WHEN v.StartedAt IS NOT NULL THEN 1 ELSE 0 END) AS withStartedAt
      FROM dbo.Visit v
      INNER JOIN dbo.[User] u ON u.Id = v.UserId AND u.Deleted = 0
      LEFT JOIN dbo.VisitState vs ON vs.Id = v.VisitStateId
      WHERE v.Deleted = 0
        AND u.SubscriptionId = @subId
      GROUP BY COALESCE(vs.Name, CONCAT('State-', v.VisitStateId)), v.Realized
      ORDER BY total DESC
    `,
    bind: { subId },
  });
  console.log("By status + Realized:", byStatus.recordset);

  const trend = await queryDb({
    query: `
      SELECT
        CONVERT(date, v.StartedAt) AS visitDate,
        COUNT(1) AS total
      FROM dbo.Visit v
      INNER JOIN dbo.[User] u ON u.Id = v.UserId AND u.Deleted = 0
      WHERE v.Deleted = 0
        AND u.SubscriptionId = @subId
        AND v.Realized = 1
        AND v.StartedAt IS NOT NULL
      GROUP BY CONVERT(date, v.StartedAt)
      ORDER BY visitDate
    `,
    bind: { subId },
  });
  console.log("Trend rows (realized + started):", trend.recordset);
  console.log(
    "Trend total sum:",
    trend.recordset.reduce((s, r) => s + Number(r.total), 0)
  );
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
