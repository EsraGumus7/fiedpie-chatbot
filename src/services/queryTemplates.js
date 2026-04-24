function buildFieldTerms(fieldName = "") {
  const base = String(fieldName || "Raf").trim();
  const lowered = base.toLowerCase();
  return Array.from(
    new Set([
      base,
      lowered,
      lowered.replace(/ı/g, "i"),
      lowered.replace(/\s+/g, ""),
    ])
  ).filter(Boolean);
}

const TEMPLATES = {
  visitCountRealized: ({ startDate, endDate }) => ({
    query: `
      SELECT COUNT(1) AS total
      FROM dbo.Visit v
      WHERE v.Realized = 1
        AND (@startDate IS NULL OR v.StartedAt >= @startDate)
        AND (@endDate IS NULL OR v.StartedAt < DATEADD(day, 1, @endDate));
    `,
    bind: { startDate, endDate },
  }),

  avgVisitDuration: ({ startDate, endDate }) => ({
    query: `
      SELECT AVG(CAST(DATEDIFF(second, v.StartedAt, v.EndedAt) AS FLOAT)) AS avgDurationSec
      FROM dbo.Visit v
      WHERE v.Realized = 1
        AND v.StartedAt IS NOT NULL
        AND v.EndedAt IS NOT NULL
        AND v.EndedAt >= v.StartedAt
        AND (@startDate IS NULL OR v.StartedAt >= @startDate)
        AND (@endDate IS NULL OR v.StartedAt < DATEADD(day, 1, @endDate));
    `,
    bind: { startDate, endDate },
  }),

  visitsByState: ({ startDate, endDate }) => ({
    query: `
      SELECT
        COALESCE(vs.Name, CONCAT('State-', v.VisitStateId)) AS visitState,
        COUNT(1) AS total
      FROM dbo.Visit v
      LEFT JOIN dbo.VisitState vs ON vs.Id = v.VisitStateId
      WHERE (@startDate IS NULL OR v.StartedAt >= @startDate)
        AND (@endDate IS NULL OR v.StartedAt < DATEADD(day, 1, @endDate))
      GROUP BY COALESCE(vs.Name, CONCAT('State-', v.VisitStateId))
      ORDER BY total DESC;
    `,
    bind: { startDate, endDate },
  }),

  visitsByType: ({ startDate, endDate }) => ({
    query: `
      SELECT
        COALESCE(vt.Name, CONCAT('Type-', v.VisitTypeId)) AS visitType,
        COUNT(1) AS total
      FROM dbo.Visit v
      LEFT JOIN dbo.VisitType vt ON vt.Id = v.VisitTypeId
      WHERE (@startDate IS NULL OR v.StartedAt >= @startDate)
        AND (@endDate IS NULL OR v.StartedAt < DATEADD(day, 1, @endDate))
      GROUP BY COALESCE(vt.Name, CONCAT('Type-', v.VisitTypeId))
      ORDER BY total DESC;
    `,
    bind: { startDate, endDate },
  }),

  visitTrend: ({ startDate, endDate }) => ({
    query: `
      SELECT
        CONVERT(date, v.StartedAt) AS visitDate,
        COUNT(1) AS total
      FROM dbo.Visit v
      WHERE v.Realized = 1
        AND v.StartedAt IS NOT NULL
        AND (@startDate IS NULL OR v.StartedAt >= @startDate)
        AND (@endDate IS NULL OR v.StartedAt < DATEADD(day, 1, @endDate))
      GROUP BY CONVERT(date, v.StartedAt)
      ORDER BY CONVERT(date, v.StartedAt);
    `,
    bind: { startDate, endDate },
  }),

  dynamicFieldSummary: ({ fieldName, fieldId, startDate, endDate }) => ({
    query: `
      SELECT
        CONCAT('Field-', CAST(f.DynamicDataConfigurationFieldId AS nvarchar(64))) AS fieldName,
        COUNT(1) AS responseCount,
        AVG(TRY_CAST(f.DecimalValue AS FLOAT)) AS avgNumericValue
      FROM dbo.DynamicData d
      INNER JOIN dbo.DynamicDataField f ON f.DynamicDataId = d.Id
      WHERE (
        (
          @fieldId IS NOT NULL
          AND f.DynamicDataConfigurationFieldId = @fieldId
        )
        OR (
          @fieldId IS NULL
          AND (
            f.StringValue LIKE @fieldName1
            OR f.StringValue LIKE @fieldName2
            OR f.StringValue LIKE @fieldName3
            OR f.StringValue LIKE @fieldName4
            OR CAST(f.DynamicDataConfigurationFieldId AS nvarchar(64)) LIKE @fieldName1
          )
        )
      )
        AND (@startDate IS NULL OR d.CreateTime >= @startDate)
        AND (@endDate IS NULL OR d.CreateTime < DATEADD(day, 1, @endDate))
      GROUP BY CONCAT('Field-', CAST(f.DynamicDataConfigurationFieldId AS nvarchar(64)))
      ORDER BY responseCount DESC;
    `,
    bind: (() => {
      const terms = buildFieldTerms(fieldName);
      return {
        fieldName1: `%${terms[0] || fieldName || "Raf"}%`,
        fieldName2: `%${terms[1] || terms[0] || fieldName || "Raf"}%`,
        fieldName3: `%${terms[2] || terms[0] || fieldName || "Raf"}%`,
        fieldName4: `%${terms[3] || terms[0] || fieldName || "Raf"}%`,
        fieldId: fieldId ? Number(fieldId) : null,
        startDate,
        endDate,
      };
    })(),
  }),

  dynamicTopFields: ({ startDate, endDate, limit }) => ({
    query: `
      SELECT TOP (@limit)
        f.DynamicDataConfigurationFieldId AS fieldId,
        COUNT(1) AS responseCount,
        SUM(CASE WHEN f.StringValue IS NOT NULL AND LTRIM(RTRIM(f.StringValue)) <> '' THEN 1 ELSE 0 END) AS stringCount,
        SUM(CASE WHEN f.DecimalValue IS NOT NULL THEN 1 ELSE 0 END) AS decimalCount,
        SUM(CASE WHEN f.BoolValue IS NOT NULL THEN 1 ELSE 0 END) AS boolCount,
        SUM(CASE WHEN f.DateTimeValue IS NOT NULL THEN 1 ELSE 0 END) AS dateTimeCount
      FROM dbo.DynamicData d
      INNER JOIN dbo.DynamicDataField f ON f.DynamicDataId = d.Id
      WHERE (@startDate IS NULL OR d.CreateTime >= @startDate)
        AND (@endDate IS NULL OR d.CreateTime < DATEADD(day, 1, @endDate))
      GROUP BY f.DynamicDataConfigurationFieldId
      ORDER BY responseCount DESC;
    `,
    bind: { startDate, endDate, limit: Number(limit) || 20 },
  }),
};

module.exports = TEMPLATES;
