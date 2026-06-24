const { queryDb } = require("../src/db/sql");

async function main() {
  const ddfCols = await queryDb({
    query: `
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'DynamicDataField'
      ORDER BY ORDINAL_POSITION
    `,
    bind: {},
  });
  console.log("DynamicDataField columns:", ddfCols.recordset.map((r) => r.COLUMN_NAME).join(", "));

  const rafFields = await queryDb({
    query: `
      SELECT TOP 10 Id, Name
      FROM dbo.DynamicDataConfigurationField
      WHERE Deleted = 0 AND Name LIKE '%Raf%'
      ORDER BY Id
    `,
    bind: {},
  });
  console.log("Raf-related config fields:", rafFields.recordset);

  const countWithFieldId = await queryDb({
    query: `
      SELECT TOP 5
        f.DynamicDataConfigurationFieldId AS fieldId,
        cfg.Name AS fieldName,
        COUNT(1) AS responseCount
      FROM dbo.DynamicData d
      INNER JOIN dbo.DynamicDataField f ON f.DynamicDataId = d.Id
      INNER JOIN dbo.DynamicDataConfigurationField cfg
        ON cfg.Id = f.DynamicDataConfigurationFieldId
       AND cfg.Deleted = 0
      WHERE d.Deleted = 0
        AND cfg.Name LIKE '%Raf%'
        AND d.CreateTime >= DATEADD(day, -30, GETDATE())
      GROUP BY f.DynamicDataConfigurationFieldId, cfg.Name
      ORDER BY responseCount DESC
    `,
    bind: {},
  });
  console.log("Last 30d raf field counts:", countWithFieldId.recordset);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
