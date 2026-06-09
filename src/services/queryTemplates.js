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

function buildConfigFieldNamePatterns(fieldName = "") {
  const terms = buildFieldTerms(fieldName);
  const normalized = String(fieldName || "")
    .toLowerCase()
    .replace(/ı/g, "i")
    .trim();

  const patterns = terms.map((term) => `%${term}%`);

  if (normalized.includes("raf") && !normalized.includes("fotograf")) {
    patterns.push("% raf %", "% raf%", "raf %");
  }

  return Array.from(new Set(patterns.filter(Boolean)));
}

const TEMPLATES = {
  visitCountRealized: ({ startDate, endDate, visitRealized = 1 }) => ({
    query: `
      SELECT COUNT(1) AS total
      FROM dbo.Visit v
      WHERE v.Realized = @visitRealized
        AND (@startDate IS NULL OR v.StartedAt >= @startDate)
        AND (@endDate IS NULL OR v.StartedAt < DATEADD(day, 1, @endDate));
    `,
    bind: { startDate, endDate, visitRealized },
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
      WHERE v.Deleted = 0
        AND (@startDate IS NULL OR v.StartedAt >= @startDate)
        AND (@endDate IS NULL OR v.StartedAt < DATEADD(day, 1, @endDate))
      GROUP BY COALESCE(vs.Name, CONCAT('State-', v.VisitStateId))
      ORDER BY total DESC;
    `,
    bind: { startDate, endDate },
  }),

  visitsByCompletionStatus: ({ startDate, endDate }) => ({
    query: `
      SELECT
        CASE WHEN v.Realized = 1 THEN N'Tamamlanan' ELSE N'Bekleyen' END AS visitState,
        COUNT(1) AS total
      FROM dbo.Visit v
      WHERE v.Deleted = 0
        AND (
          @startDate IS NULL
          OR COALESCE(v.StartedAt, v.PlanStartsAt, v.StartDate, v.CreateTime) >= @startDate
        )
        AND (
          @endDate IS NULL
          OR COALESCE(v.StartedAt, v.PlanStartsAt, v.StartDate, v.CreateTime) < DATEADD(day, 1, @endDate)
        )
      GROUP BY v.Realized
      ORDER BY v.Realized DESC;
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

  dynamicFieldSummary: ({ fieldName, fieldId, startDate, endDate }) => {
    const namePatterns = buildConfigFieldNamePatterns(fieldName);
    const bind = {
      fieldId: fieldId ? Number(fieldId) : null,
      startDate,
      endDate,
    };
    const nameClauses = namePatterns.map((pattern, index) => {
      const key = `fieldName${index}`;
      bind[key] = pattern;
      return `LOWER(cfg.Name) LIKE LOWER(@${key})`;
    });

    return {
      query: `
      SELECT
        COALESCE(
          cfg.Name,
          CONCAT('Field-', CAST(f.DynamicDataConfigurationFieldId AS nvarchar(64)))
        ) AS fieldName,
        COUNT(1) AS responseCount,
        AVG(TRY_CAST(f.DecimalValue AS FLOAT)) AS avgNumericValue
      FROM dbo.DynamicData d
      INNER JOIN dbo.DynamicDataField f
        ON f.DynamicDataId = d.Id
       AND f.Deleted = 0
      LEFT JOIN dbo.DynamicDataConfigurationField cfg
        ON cfg.Id = f.DynamicDataConfigurationFieldId
       AND cfg.Deleted = 0
      WHERE d.Deleted = 0
        AND (
          (@fieldId IS NOT NULL AND f.DynamicDataConfigurationFieldId = @fieldId)
          OR (
            @fieldId IS NULL
            AND (${nameClauses.join(" OR ")})
          )
        )
        AND (@startDate IS NULL OR d.CreateTime >= @startDate)
        AND (@endDate IS NULL OR d.CreateTime < DATEADD(day, 1, @endDate))
      GROUP BY
        COALESCE(
          cfg.Name,
          CONCAT('Field-', CAST(f.DynamicDataConfigurationFieldId AS nvarchar(64)))
        )
      ORDER BY responseCount DESC;
    `,
      bind,
    };
  },

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
      INNER JOIN dbo.DynamicDataField f
        ON f.DynamicDataId = d.Id
       AND f.Deleted = 0
      WHERE d.Deleted = 0
        AND (@startDate IS NULL OR d.CreateTime >= @startDate)
        AND (@endDate IS NULL OR d.CreateTime < DATEADD(day, 1, @endDate))
      GROUP BY f.DynamicDataConfigurationFieldId
      ORDER BY responseCount DESC;
    `,
    bind: { startDate, endDate, limit: Number(limit) || 20 },
  }),

  userTotalCount: ({ startDate, endDate }) => ({
    query: `
      SELECT COUNT(1) AS totalUsers
      FROM dbo.[User] u
      WHERE u.Deleted = 0
        AND (@startDate IS NULL OR u.CreateTime >= @startDate)
        AND (@endDate IS NULL OR u.CreateTime < DATEADD(day, 1, @endDate));
    `,
    bind: { startDate, endDate },
  }),

  userStatusSummary: ({ startDate, endDate }) => ({
    query: `
      SELECT
        COUNT(1) AS totalUsers,
        SUM(CASE WHEN u.Deleted = 0 AND u.Blocked = 0 AND u.DeleteRequest = 0 THEN 1 ELSE 0 END) AS activeUsers,
        SUM(CASE WHEN u.Deleted = 0 AND u.Blocked = 1 THEN 1 ELSE 0 END) AS blockedUsers,
        SUM(CASE WHEN u.Deleted = 0 AND u.DeleteRequest = 1 THEN 1 ELSE 0 END) AS deleteRequestUsers,
        SUM(CASE WHEN u.Deleted = 0 AND u.Admin = 1 THEN 1 ELSE 0 END) AS adminUsers,
        SUM(CASE WHEN u.Deleted = 0 AND u.ApiUser = 1 THEN 1 ELSE 0 END) AS apiUsers,
        SUM(CASE WHEN u.Deleted = 0 AND u.ClientUser = 1 THEN 1 ELSE 0 END) AS clientUsers,
        SUM(CASE WHEN u.Deleted = 0 AND u.Contractor = 1 THEN 1 ELSE 0 END) AS contractorUsers,
        SUM(CASE WHEN u.Deleted = 0 AND ISNULL(u.ManagerOfAllTeams, 0) = 1 THEN 1 ELSE 0 END) AS managerOfAllTeamsUsers
      FROM dbo.[User] u
      WHERE (@startDate IS NULL OR u.CreateTime >= @startDate)
        AND (@endDate IS NULL OR u.CreateTime < DATEADD(day, 1, @endDate));
    `,
    bind: { startDate, endDate },
  }),

  userAdminSummary: ({ startDate, endDate }) => ({
    query: `
      SELECT
        SUM(CASE WHEN u.Deleted = 0 AND u.Admin = 1 THEN 1 ELSE 0 END) AS adminUsers,
        SUM(CASE WHEN u.Deleted = 0 AND u.ApiUser = 1 THEN 1 ELSE 0 END) AS apiUsers,
        SUM(CASE WHEN u.Deleted = 0 AND u.ClientUser = 1 THEN 1 ELSE 0 END) AS clientUsers,
        SUM(CASE WHEN u.Deleted = 0 AND u.Contractor = 1 THEN 1 ELSE 0 END) AS contractorUsers,
        SUM(CASE WHEN u.Deleted = 0 AND ISNULL(u.ManagerOfAllTeams, 0) = 1 THEN 1 ELSE 0 END) AS managerOfAllTeamsUsers
      FROM dbo.[User] u
      WHERE (@startDate IS NULL OR u.CreateTime >= @startDate)
        AND (@endDate IS NULL OR u.CreateTime < DATEADD(day, 1, @endDate));
    `,
    bind: { startDate, endDate },
  }),

  usersByRole: ({ startDate, endDate }) => ({
    query: `
      SELECT
        COALESCE(r.Name, CONCAT('Role-', ur.RoleId)) AS roleName,
        COUNT(DISTINCT u.Id) AS totalUsers,
        COUNT(DISTINCT CASE WHEN u.Blocked = 0 AND u.DeleteRequest = 0 THEN u.Id END) AS activeUsers
      FROM dbo.[User] u
      INNER JOIN dbo.UserRole ur
        ON ur.UserId = u.Id
       AND ur.Deleted = 0
      LEFT JOIN dbo.Role r
        ON r.Id = ur.RoleId
       AND r.Deleted = 0
      WHERE u.Deleted = 0
        AND (@startDate IS NULL OR u.CreateTime >= @startDate)
        AND (@endDate IS NULL OR u.CreateTime < DATEADD(day, 1, @endDate))
      GROUP BY COALESCE(r.Name, CONCAT('Role-', ur.RoleId))
      ORDER BY totalUsers DESC;
    `,
    bind: { startDate, endDate },
  }),

  usersByTeam: ({ startDate, endDate }) => ({
    query: `
      SELECT
        COALESCE(t.Name, CONCAT('Team-', ut.TeamId)) AS teamName,
        COUNT(DISTINCT u.Id) AS totalUsers,
        COUNT(DISTINCT CASE WHEN ut.Manager = 1 THEN u.Id END) AS managerCount,
        COUNT(DISTINCT CASE WHEN ut.Member = 1 THEN u.Id END) AS memberCount
      FROM dbo.[User] u
      INNER JOIN dbo.UserTeam ut
        ON ut.UserId = u.Id
       AND ut.Deleted = 0
      LEFT JOIN dbo.Team t
        ON t.Id = ut.TeamId
       AND t.Deleted = 0
      WHERE u.Deleted = 0
        AND (@startDate IS NULL OR u.CreateTime >= @startDate)
        AND (@endDate IS NULL OR u.CreateTime < DATEADD(day, 1, @endDate))
      GROUP BY COALESCE(t.Name, CONCAT('Team-', ut.TeamId))
      ORDER BY totalUsers DESC;
    `,
    bind: { startDate, endDate },
  }),

  usersByBrand: ({ startDate, endDate }) => ({
    query: `
      SELECT
        COALESCE(b.Name, CONCAT('Brand-', ub.BrandId)) AS brandName,
        COUNT(DISTINCT u.Id) AS totalUsers
      FROM dbo.[User] u
      INNER JOIN dbo.UserBrand ub
        ON ub.UserId = u.Id
       AND ub.Deleted = 0
      LEFT JOIN dbo.Brand b
        ON b.Id = ub.BrandId
       AND b.Deleted = 0
      WHERE u.Deleted = 0
        AND (@startDate IS NULL OR u.CreateTime >= @startDate)
        AND (@endDate IS NULL OR u.CreateTime < DATEADD(day, 1, @endDate))
      GROUP BY COALESCE(b.Name, CONCAT('Brand-', ub.BrandId))
      ORDER BY totalUsers DESC;
    `,
    bind: { startDate, endDate },
  }),

  usersByClient: ({ startDate, endDate, limit }) => ({
    query: `
      SELECT TOP (@limit)
        COALESCE(c.Name, CONCAT('Client-', cu.ClientId)) AS clientName,
        COUNT(DISTINCT u.Id) AS totalUsers
      FROM dbo.[User] u
      INNER JOIN dbo.ClientUser cu
        ON cu.UserId = u.Id
       AND cu.Deleted = 0
      LEFT JOIN dbo.Client c
        ON c.Id = cu.ClientId
       AND c.Deleted = 0
      WHERE u.Deleted = 0
        AND (@startDate IS NULL OR u.CreateTime >= @startDate)
        AND (@endDate IS NULL OR u.CreateTime < DATEADD(day, 1, @endDate))
      GROUP BY COALESCE(c.Name, CONCAT('Client-', cu.ClientId))
      ORDER BY totalUsers DESC;
    `,
    bind: { startDate, endDate, limit: Number(limit) || 20 },
  }),

  userRecentLogins: ({ startDate, endDate, limit }) => ({
    query: `
      SELECT TOP (@limit)
        ul.CreateTime AS loginDate,
        ul.UserId AS userId,
        COALESCE(u.Name, 'Bilinmeyen Kullanici') AS userName,
        ul.LoginSuccess AS loginSuccess,
        ul.App AS app,
        ul.Domain AS domain
      FROM dbo.UserLogin ul
      LEFT JOIN dbo.[User] u
        ON u.Id = ul.UserId
       AND u.Deleted = 0
      WHERE ul.Deleted = 0
        AND (@startDate IS NULL OR ul.CreateTime >= @startDate)
        AND (@endDate IS NULL OR ul.CreateTime < DATEADD(day, 1, @endDate))
      ORDER BY ul.CreateTime DESC;
    `,
    bind: { startDate, endDate, limit: Number(limit) || 20 },
  }),

  userLoginSuccessSummary: ({ startDate, endDate }) => ({
    query: `
      SELECT
        CASE WHEN ul.LoginSuccess = 1 THEN 'Basarili' ELSE 'Basarisiz' END AS loginStatus,
        COALESCE(ul.App, 'Bilinmeyen App') AS app,
        COALESCE(ul.Domain, 'Bilinmeyen Domain') AS domain,
        COUNT(1) AS totalLogins
      FROM dbo.UserLogin ul
      WHERE ul.Deleted = 0
        AND (@startDate IS NULL OR ul.CreateTime >= @startDate)
        AND (@endDate IS NULL OR ul.CreateTime < DATEADD(day, 1, @endDate))
      GROUP BY
        CASE WHEN ul.LoginSuccess = 1 THEN 'Basarili' ELSE 'Basarisiz' END,
        COALESCE(ul.App, 'Bilinmeyen App'),
        COALESCE(ul.Domain, 'Bilinmeyen Domain')
      ORDER BY totalLogins DESC;
    `,
    bind: { startDate, endDate },
  }),

  userDeviceSummary: ({ startDate, endDate }) => ({
    query: `
      SELECT
        COUNT(1) AS totalDeviceRecords,
        COUNT(DISTINCT ud.UserId) AS usersWithDevice,
        SUM(CASE WHEN ud.TerminationDate IS NULL THEN 1 ELSE 0 END) AS activeDeviceRecords,
        SUM(CASE WHEN ud.TerminationDate IS NOT NULL THEN 1 ELSE 0 END) AS terminatedDeviceRecords,
        SUM(CASE WHEN ISNULL(ud.OnlyAllowCriticalWebServices, 0) = 1 THEN 1 ELSE 0 END) AS criticalOnlyDeviceRecords
      FROM dbo.UserDevice ud
      WHERE ud.Deleted = 0
        AND (@startDate IS NULL OR ud.CreateTime >= @startDate)
        AND (@endDate IS NULL OR ud.CreateTime < DATEADD(day, 1, @endDate));
    `,
    bind: { startDate, endDate },
  }),

  userSavedViewSummary: ({ startDate, endDate }) => ({
    query: `
      SELECT
        COALESCE(usv.Module, 'Bilinmeyen Modul') AS moduleName,
        COUNT(1) AS savedViewCount,
        COUNT(DISTINCT usv.UserId) AS userCount
      FROM dbo.UserSavedView usv
      WHERE usv.Deleted = 0
        AND (@startDate IS NULL OR usv.CreateTime >= @startDate)
        AND (@endDate IS NULL OR usv.CreateTime < DATEADD(day, 1, @endDate))
      GROUP BY COALESCE(usv.Module, 'Bilinmeyen Modul')
      ORDER BY savedViewCount DESC;
    `,
    bind: { startDate, endDate },
  }),

  userStepSummary: ({ startDate, endDate, limit }) => ({
    query: `
      SELECT TOP (@limit)
        ush.UserId AS userId,
        COALESCE(u.Name, 'Bilinmeyen Kullanici') AS userName,
        SUM(ISNULL(ush.StepCount, 0)) AS totalSteps,
        AVG(CAST(ISNULL(ush.StepCount, 0) AS FLOAT)) AS avgSteps,
        COUNT(1) AS recordCount
      FROM dbo.UserStepHistory ush
      LEFT JOIN dbo.[User] u
        ON u.Id = ush.UserId
       AND u.Deleted = 0
      WHERE ush.Deleted = 0
        AND (@startDate IS NULL OR ush.StartDate >= @startDate)
        AND (@endDate IS NULL OR ush.StartDate < DATEADD(day, 1, @endDate))
      GROUP BY ush.UserId, COALESCE(u.Name, 'Bilinmeyen Kullanici')
      ORDER BY totalSteps DESC;
    `,
    bind: { startDate, endDate, limit: Number(limit) || 20 },
  }),

  userVisitSummary: ({ startDate, endDate, limit }) => ({
    query: `
      SELECT TOP (@limit)
        v.UserId AS userId,
        COALESCE(u.Name, 'Bilinmeyen Kullanici') AS userName,
        COUNT(1) AS totalVisits,
        SUM(CASE WHEN v.Realized = 1 THEN 1 ELSE 0 END) AS realizedVisits,
        SUM(CASE WHEN v.Realized = 0 THEN 1 ELSE 0 END) AS unrealizedVisits
      FROM dbo.Visit v
      LEFT JOIN dbo.[User] u
        ON u.Id = v.UserId
       AND u.Deleted = 0
      WHERE v.Deleted = 0
        AND v.UserId IS NOT NULL
        AND (@startDate IS NULL OR v.StartedAt >= @startDate)
        AND (@endDate IS NULL OR v.StartedAt < DATEADD(day, 1, @endDate))
      GROUP BY v.UserId, COALESCE(u.Name, 'Bilinmeyen Kullanici')
      ORDER BY totalVisits DESC;
    `,
    bind: { startDate, endDate, limit: Number(limit) || 20 },
  }),

    // =============================
  // CLIENT (MÜŞTERİ) TEMPLATES
  // Sadece client.intents.json içindeki intentler entegre edildi
  // =============================

  clientCountActive: ({ startDate, endDate }) => ({
    query: `
      SELECT COUNT(1) AS total
      FROM dbo.Client
      WHERE Deleted = 0 AND Passive = 0
        AND (@startDate IS NULL OR CreateTime >= @startDate)
        AND (@endDate IS NULL OR CreateTime < DATEADD(day, 1, @endDate));
    `,
    bind: { startDate, endDate }
  }),

  clientCountTotal: ({ startDate, endDate }) => ({
    query: `
      SELECT COUNT(1) AS total
      FROM dbo.Client
      WHERE Deleted = 0
        AND (@startDate IS NULL OR CreateTime >= @startDate)
        AND (@endDate IS NULL OR CreateTime < DATEADD(day, 1, @endDate));
    `,
    bind: { startDate, endDate }
  }),

  clientCountPassive: ({ startDate, endDate }) => ({
    query: `
      SELECT COUNT(1) AS total
      FROM dbo.Client
      WHERE Deleted = 0 AND Passive = 1
        AND (@startDate IS NULL OR CreateTime >= @startDate)
        AND (@endDate IS NULL OR CreateTime < DATEADD(day, 1, @endDate));
    `,
    bind: { startDate, endDate }
  }),

  clientCountArchived: ({ startDate, endDate }) => ({
    query: `
      SELECT COUNT(1) AS total
      FROM dbo.Client
      WHERE Deleted = 0 AND Archived = 1
        AND (@startDate IS NULL OR CreateTime >= @startDate)
        AND (@endDate IS NULL OR CreateTime < DATEADD(day, 1, @endDate));
    `,
    bind: { startDate, endDate }
  }),

  clientsByGroup: ({ startDate, endDate }) => ({
    query: `
      SELECT COALESCE(cg.Name, 'Bilinmeyen Grup') AS groupName, COUNT(1) AS total
      FROM dbo.Client c
      LEFT JOIN dbo.ClientGroup cg ON cg.Id = c.ClientGroupId
      WHERE c.Deleted = 0
        AND (@startDate IS NULL OR c.CreateTime >= @startDate)
        AND (@endDate IS NULL OR c.CreateTime < DATEADD(day, 1, @endDate))
      GROUP BY COALESCE(cg.Name, 'Bilinmeyen Grup')
      ORDER BY total DESC;
    `,
    bind: { startDate, endDate }
  }),

  clientsByState: ({ startDate, endDate }) => ({
    query: `
      SELECT COALESCE(cs.Name, 'Bilinmeyen Durum') AS groupName, COUNT(1) AS total
      FROM dbo.Client c
      LEFT JOIN dbo.ClientState cs ON cs.Id = c.ClientStateId
      WHERE c.Deleted = 0
        AND (@startDate IS NULL OR c.CreateTime >= @startDate)
        AND (@endDate IS NULL OR c.CreateTime < DATEADD(day, 1, @endDate))
      GROUP BY COALESCE(cs.Name, 'Bilinmeyen Durum')
      ORDER BY total DESC;
    `,
    bind: { startDate, endDate }
  }),

  clientsByCountry: ({ startDate, endDate }) => ({
    query: `
      SELECT COALESCE(co.Name, 'Bilinmeyen Ulke') AS groupName, COUNT(1) AS total
      FROM dbo.Client c
      LEFT JOIN dbo.Country co ON co.Id = c.CountryId
      WHERE c.Deleted = 0
        AND (@startDate IS NULL OR c.CreateTime >= @startDate)
        AND (@endDate IS NULL OR c.CreateTime < DATEADD(day, 1, @endDate))
      GROUP BY COALESCE(co.Name, 'Bilinmeyen Ulke')
      ORDER BY total DESC;
    `,
    bind: { startDate, endDate }
  }),

  clientsByProgramType: ({ startDate, endDate }) => ({
    query: `
      SELECT COALESCE(pt.Name, 'Bilinmeyen Program') AS groupName, COUNT(1) AS total
      FROM dbo.Client c
      LEFT JOIN dbo.ProgramType pt ON pt.Id = c.ProgramTypeId
      WHERE c.Deleted = 0
        AND (@startDate IS NULL OR c.CreateTime >= @startDate)
        AND (@endDate IS NULL OR c.CreateTime < DATEADD(day, 1, @endDate))
      GROUP BY COALESCE(pt.Name, 'Bilinmeyen Program')
      ORDER BY total DESC;
    `,
    bind: { startDate, endDate }
  }),

  totalClientDealAmount: ({ startDate, endDate }) => ({
    query: `
      SELECT SUM(ISNULL(DealAmount, 0)) AS totalAmount
      FROM dbo.Client
      WHERE Deleted = 0
        AND (@startDate IS NULL OR CreateTime >= @startDate)
        AND (@endDate IS NULL OR CreateTime < DATEADD(day, 1, @endDate));
    `,
    bind: { startDate, endDate }
  }),

  clientTrend: ({ startDate, endDate }) => ({
    query: `
      SELECT CONVERT(date, CreateTime) AS createDate, COUNT(1) AS total
      FROM dbo.Client
      WHERE Deleted = 0
        AND (@startDate IS NULL OR CreateTime >= @startDate)
        AND (@endDate IS NULL OR CreateTime < DATEADD(day, 1, @endDate))
      GROUP BY CONVERT(date, CreateTime)
      ORDER BY createDate;
    `,
    bind: { startDate, endDate }
  }),

  totalDistributors: ({ startDate, endDate }) => ({
    query: `
      SELECT COUNT(1) AS total
      FROM dbo.DistributorNetworkEntity
      WHERE Deleted = 0
        AND (@startDate IS NULL OR CreateTime >= @startDate)
        AND (@endDate IS NULL OR CreateTime < DATEADD(day, 1, @endDate));
    `,
    bind: { startDate, endDate }
  }),

  distributorsByRegion: ({ startDate, endDate }) => ({
    query: `
      SELECT COALESCE(r.Name, 'Bilinmeyen Bolge') AS groupName, COUNT(1) AS total
      FROM dbo.DistributorNetworkEntity d
      LEFT JOIN dbo.Region r ON r.Id = d.RegionId
      WHERE d.Deleted = 0
        AND (@startDate IS NULL OR d.CreateTime >= @startDate)
        AND (@endDate IS NULL OR d.CreateTime < DATEADD(day, 1, @endDate))
      GROUP BY COALESCE(r.Name, 'Bilinmeyen Bolge')
      ORDER BY total DESC;
    `,
    bind: { startDate, endDate }
  }),

   distributorsByGroup: ({ startDate, endDate }) => ({
  query: `
    SELECT
      COALESCE(CAST(d.GroupId AS NVARCHAR(50)), 'Bilinmeyen Grup') AS groupName,
      COUNT(1) AS total
    FROM dbo.DistributorNetworkEntity d
    WHERE d.Deleted = 0
      AND (@startDate IS NULL OR d.CreateTime >= @startDate)
      AND (@endDate IS NULL OR d.CreateTime < DATEADD(day, 1, @endDate))
    GROUP BY d.GroupId
    ORDER BY total DESC;
  `,
  bind: { startDate, endDate }
}),
  distributorsByType: ({ startDate, endDate }) => ({
  query: `
    SELECT
      COALESCE(CAST(d.TypeId AS nvarchar(100)), 'Bilinmeyen Tip') AS groupName,
      COUNT(1) AS total
    FROM dbo.DistributorNetworkEntity d
    WHERE d.Deleted = 0
      AND (@startDate IS NULL OR d.CreateTime >= @startDate)
      AND (@endDate IS NULL OR d.CreateTime < DATEADD(day, 1, @endDate))
    GROUP BY d.TypeId
    ORDER BY total DESC;
  `,
  bind: { startDate, endDate }
}),

  distributorsByStatus: ({ startDate, endDate }) => ({
    query: `
      SELECT
        CASE WHEN ISNULL(d.Passive, 0) = 1 THEN 'Pasif' ELSE 'Aktif' END AS groupName,
        COUNT(1) AS total
      FROM dbo.DistributorNetworkEntity d
      WHERE d.Deleted = 0
        AND (@startDate IS NULL OR d.CreateTime >= @startDate)
        AND (@endDate IS NULL OR d.CreateTime < DATEADD(day, 1, @endDate))
      GROUP BY CASE WHEN ISNULL(d.Passive, 0) = 1 THEN 'Pasif' ELSE 'Aktif' END
      ORDER BY total DESC;
    `,
    bind: { startDate, endDate }
  }),

  distributorsExperienceStores: ({ startDate, endDate }) => ({
    query: `
      SELECT COUNT(1) AS total
      FROM dbo.DistributorNetworkEntity d
      INNER JOIN dbo.DistributorAdditionalInfo dai
        ON dai.DistributorNetworkEntityId = d.Id
       AND dai.Deleted = 0
      WHERE d.Deleted = 0
        AND ISNULL(dai.IsExperienceStore, 0) = 1
        AND (@startDate IS NULL OR d.CreateTime >= @startDate)
        AND (@endDate IS NULL OR d.CreateTime < DATEADD(day, 1, @endDate));
    `,
    bind: { startDate, endDate }
  }),

  distributorTrend: ({ startDate, endDate }) => ({
    query: `
      SELECT CONVERT(date, CreateTime) AS createDate, COUNT(1) AS total
      FROM dbo.DistributorNetworkEntity
      WHERE Deleted = 0
        AND (@startDate IS NULL OR CreateTime >= @startDate)
        AND (@endDate IS NULL OR CreateTime < DATEADD(day, 1, @endDate))
      GROUP BY CONVERT(date, CreateTime)
      ORDER BY createDate;
    `,
    bind: { startDate, endDate }
  }),

  consumerCountTotal: ({ startDate, endDate }) => ({
    query: `
      SELECT COUNT(1) AS total
      FROM dbo.Consumer
      WHERE Deleted = 0
        AND (@startDate IS NULL OR CreateTime >= @startDate)
        AND (@endDate IS NULL OR CreateTime < DATEADD(day, 1, @endDate));
    `,
    bind: { startDate, endDate }
  }),

  consumersBySegment: ({ startDate, endDate }) => ({
    query: `
      SELECT COALESCE(cs.Name, 'Bilinmeyen Segment') AS groupName, COUNT(1) AS total
      FROM dbo.Consumer c
      LEFT JOIN dbo.ConsumerSegment cs ON cs.Id = c.ConsumerSegmentId
      WHERE c.Deleted = 0
        AND (@startDate IS NULL OR c.CreateTime >= @startDate)
        AND (@endDate IS NULL OR c.CreateTime < DATEADD(day, 1, @endDate))
      GROUP BY COALESCE(cs.Name, 'Bilinmeyen Segment')
      ORDER BY total DESC;
    `,
    bind: { startDate, endDate }
  }),

  consumerTrend: ({ startDate, endDate }) => ({
    query: `
      SELECT CONVERT(date, CreateTime) AS createDate, COUNT(1) AS total
      FROM dbo.Consumer
      WHERE Deleted = 0
        AND (@startDate IS NULL OR CreateTime >= @startDate)
        AND (@endDate IS NULL OR CreateTime < DATEADD(day, 1, @endDate))
      GROUP BY CONVERT(date, CreateTime)
      ORDER BY createDate;
    `,
    bind: { startDate, endDate }
  }),

  totalDataChanges: ({ startDate, endDate }) => ({
    query: `
      SELECT COUNT(1) AS total
      FROM dbo.ClientDataChange
      WHERE Deleted = 0
        AND (@startDate IS NULL OR CreateTime >= @startDate)
        AND (@endDate IS NULL OR CreateTime < DATEADD(day, 1, @endDate));
    `,
    bind: { startDate, endDate }
  }),

  dataChangesByType: ({ startDate, endDate }) => ({
    query: `
      SELECT COALESCE(CAST(ChangeTypeId AS nvarchar(100)), 'Bilinmeyen Tip') AS groupName, COUNT(1) AS total
      FROM dbo.ClientDataChange
      WHERE Deleted = 0
        AND (@startDate IS NULL OR CreateTime >= @startDate)
        AND (@endDate IS NULL OR CreateTime < DATEADD(day, 1, @endDate))
      GROUP BY COALESCE(CAST(ChangeTypeId AS nvarchar(100)), 'Bilinmeyen Tip')
      ORDER BY total DESC;
    `,
    bind: { startDate, endDate }
  }),

  dataChangeTrend: ({ startDate, endDate }) => ({
    query: `
      SELECT CONVERT(date, CreateTime) AS createDate, COUNT(1) AS total
      FROM dbo.ClientDataChange
      WHERE Deleted = 0
        AND (@startDate IS NULL OR CreateTime >= @startDate)
        AND (@endDate IS NULL OR CreateTime < DATEADD(day, 1, @endDate))
      GROUP BY CONVERT(date, CreateTime)
      ORDER BY createDate;
    `,
    bind: { startDate, endDate }
  }),

  totalClientInfoUpdates: ({ startDate, endDate }) => ({
    query: `
      SELECT COUNT(1) AS total
      FROM dbo.ClientInfoUpdate
      WHERE Deleted = 0
        AND (@startDate IS NULL OR CreateTime >= @startDate)
        AND (@endDate IS NULL OR CreateTime < DATEADD(day, 1, @endDate));
    `,
    bind: { startDate, endDate }
  }),

  totalRniDevices: ({ startDate, endDate }) => ({
    query: `
      SELECT COUNT(1) AS total
      FROM dbo.RNI
      WHERE Deleted = 0
        AND (@startDate IS NULL OR CreateTime >= @startDate)
        AND (@endDate IS NULL OR CreateTime < DATEADD(day, 1, @endDate));
    `,
    bind: { startDate, endDate }
  }),

  totalClientFiles: ({ startDate, endDate }) => ({
    query: `
      SELECT COUNT(1) AS total
      FROM dbo.ClientFile
      WHERE Deleted = 0
        AND (@startDate IS NULL OR CreateTime >= @startDate)
        AND (@endDate IS NULL OR CreateTime < DATEADD(day, 1, @endDate));
    `,
    bind: { startDate, endDate }
  }),

  // =============================
  // SALES & FINANCE TEMPLATES
  // =============================
   totalPurchaseOrders: ({ startDate, endDate }) => ({
    query: `
      SELECT COUNT(1) AS total
      FROM dbo.PurchaseOrder
      WHERE Deleted = 0
        AND (@startDate IS NULL OR CreateTime >= @startDate)
        AND (@endDate IS NULL OR CreateTime < DATEADD(day, 1, @endDate));
    `,
    bind: { startDate, endDate }
  }),

  totalPurchaseOrderAmount: ({ startDate, endDate }) => ({
    query: `
      SELECT SUM(ISNULL(TotalWithTax, 0)) AS totalAmount
      FROM dbo.PurchaseOrder
      WHERE Deleted = 0
        AND (@startDate IS NULL OR CreateTime >= @startDate)
        AND (@endDate IS NULL OR CreateTime < DATEADD(day, 1, @endDate));
    `,
    bind: { startDate, endDate }
  }),

  purchaseOrdersByStatus: ({ startDate, endDate }) => ({
    query: `
      SELECT COALESCE(pos.Name, 'Bilinmeyen Durum') AS statusName, COUNT(1) AS total
      FROM dbo.PurchaseOrder po
      LEFT JOIN dbo.PurchaseOrderStatus pos
        ON pos.Id = po.PurchaseOrderStatusId
       AND pos.Deleted = 0
      WHERE po.Deleted = 0
        AND (@startDate IS NULL OR po.CreateTime >= @startDate)
        AND (@endDate IS NULL OR po.CreateTime < DATEADD(day, 1, @endDate))
      GROUP BY COALESCE(pos.Name, 'Bilinmeyen Durum')
      ORDER BY total DESC;
    `,
    bind: { startDate, endDate }
  }),

  purchaseOrderTrend: ({ startDate, endDate }) => ({
    query: `
      SELECT CONVERT(date, CreateTime) AS createDate, COUNT(1) AS total
      FROM dbo.PurchaseOrder
      WHERE Deleted = 0
        AND (@startDate IS NULL OR CreateTime >= @startDate)
        AND (@endDate IS NULL OR CreateTime < DATEADD(day, 1, @endDate))
      GROUP BY CONVERT(date, CreateTime)
      ORDER BY createDate;
    `,
    bind: { startDate, endDate }
  }),

  totalPurchaseOrderDetails: ({ startDate, endDate }) => ({
    query: `
      SELECT COUNT(1) AS total
      FROM dbo.PurchaseOrderDetail
      WHERE Deleted = 0
        AND (@startDate IS NULL OR CreateTime >= @startDate)
        AND (@endDate IS NULL OR CreateTime < DATEADD(day, 1, @endDate));
    `,
    bind: { startDate, endDate }
  }),

  totalInvoices: ({ startDate, endDate }) => ({
    query: `
      SELECT COUNT(1) AS total
      FROM dbo.Invoice
      WHERE Deleted = 0
        AND (@startDate IS NULL OR CreateTime >= @startDate)
        AND (@endDate IS NULL OR CreateTime < DATEADD(day, 1, @endDate));
    `,
    bind: { startDate, endDate }
  }),

  totalInvoiceAmount: ({ startDate, endDate }) => ({
    query: `
      SELECT SUM(ISNULL(TotalAmountWithTax, 0)) AS totalAmount
      FROM dbo.Invoice
      WHERE Deleted = 0
        AND (@startDate IS NULL OR CreateTime >= @startDate)
        AND (@endDate IS NULL OR CreateTime < DATEADD(day, 1, @endDate));
    `,
    bind: { startDate, endDate }
  }),

  totalInvoiceBalance: ({ startDate, endDate }) => ({
    query: `
      SELECT SUM(ISNULL(Balance, 0)) AS totalBalance
      FROM dbo.Invoice
      WHERE Deleted = 0
        AND ISNULL(Paid, 0) = 0
        AND (@startDate IS NULL OR CreateTime >= @startDate)
        AND (@endDate IS NULL OR CreateTime < DATEADD(day, 1, @endDate));
    `,
    bind: { startDate, endDate }
  }),

  invoicesByStatus: ({ startDate, endDate }) => ({
    query: `
      SELECT COALESCE(s.Name, 'Bilinmeyen Durum') AS statusName, COUNT(1) AS total
      FROM dbo.Invoice i
      LEFT JOIN dbo.InvoiceState s
        ON s.Id = i.InvoiceStateId
       AND s.Deleted = 0
      WHERE i.Deleted = 0
        AND (@startDate IS NULL OR i.CreateTime >= @startDate)
        AND (@endDate IS NULL OR i.CreateTime < DATEADD(day, 1, @endDate))
      GROUP BY COALESCE(s.Name, 'Bilinmeyen Durum')
      ORDER BY total DESC;
    `,
    bind: { startDate, endDate }
  }),

  invoiceTrend: ({ startDate, endDate }) => ({
    query: `
      SELECT CONVERT(date, CreateTime) AS createDate, COUNT(1) AS total
      FROM dbo.Invoice
      WHERE Deleted = 0
        AND (@startDate IS NULL OR CreateTime >= @startDate)
        AND (@endDate IS NULL OR CreateTime < DATEADD(day, 1, @endDate))
      GROUP BY CONVERT(date, CreateTime)
      ORDER BY createDate;
    `,
    bind: { startDate, endDate }
  }),

  totalInvoiceDetails: ({ startDate, endDate }) => ({
    query: `
      SELECT COUNT(1) AS total
      FROM dbo.InvoiceDetail
      WHERE Deleted = 0
        AND (@startDate IS NULL OR CreateTime >= @startDate)
        AND (@endDate IS NULL OR CreateTime < DATEADD(day, 1, @endDate));
    `,
    bind: { startDate, endDate }
  }),

  totalInvoicePayments: ({ startDate, endDate }) => ({
    query: `
      SELECT SUM(ISNULL(Amount, 0)) AS totalAmount
      FROM dbo.InvoicePayment
      WHERE Deleted = 0
        AND (@startDate IS NULL OR PaymentDate >= @startDate)
        AND (@endDate IS NULL OR PaymentDate < DATEADD(day, 1, @endDate));
    `,
    bind: { startDate, endDate }
  }),

  invoicePaymentTrend: ({ startDate, endDate }) => ({
    query: `
      SELECT CONVERT(date, PaymentDate) AS createDate, COUNT(1) AS total
      FROM dbo.InvoicePayment
      WHERE Deleted = 0
        AND (@startDate IS NULL OR PaymentDate >= @startDate)
        AND (@endDate IS NULL OR PaymentDate < DATEADD(day, 1, @endDate))
      GROUP BY CONVERT(date, PaymentDate)
      ORDER BY createDate;
    `,
    bind: { startDate, endDate }
  }),

  totalPayments: ({ startDate, endDate }) => ({
    query: `
      SELECT SUM(ISNULL(Amount, 0)) AS totalAmount
      FROM dbo.Payment
      WHERE Deleted = 0
        AND (@startDate IS NULL OR PaymentDate >= @startDate)
        AND (@endDate IS NULL OR PaymentDate < DATEADD(day, 1, @endDate));
    `,
    bind: { startDate, endDate }
  }),

  paymentsByState: ({ startDate, endDate }) => ({
    query: `
      SELECT COALESCE(ps.Name, 'Bilinmeyen Durum') AS statusName, COUNT(1) AS total
      FROM dbo.Payment p
      LEFT JOIN dbo.PaymentState ps
        ON ps.Id = p.PaymentStateId
       AND ps.Deleted = 0
      WHERE p.Deleted = 0
        AND (@startDate IS NULL OR p.PaymentDate >= @startDate)
        AND (@endDate IS NULL OR p.PaymentDate < DATEADD(day, 1, @endDate))
      GROUP BY COALESCE(ps.Name, 'Bilinmeyen Durum')
      ORDER BY total DESC;
    `,
    bind: { startDate, endDate }
  }),

  activeCampaigns: ({ startDate, endDate }) => ({
    query: `
      SELECT COUNT(1) AS total
      FROM dbo.Campaign
      WHERE Deleted = 0
        AND ISNULL(Passive, 0) = 0
        AND (@startDate IS NULL OR CreateTime >= @startDate)
        AND (@endDate IS NULL OR CreateTime < DATEADD(day, 1, @endDate));
    `,
    bind: { startDate, endDate }
  }),

  totalCampaigns: ({ startDate, endDate }) => ({
    query: `
      SELECT COUNT(1) AS total
      FROM dbo.Campaign
      WHERE Deleted = 0
        AND (@startDate IS NULL OR CreateTime >= @startDate)
        AND (@endDate IS NULL OR CreateTime < DATEADD(day, 1, @endDate));
    `,
    bind: { startDate, endDate }
  }),

  totalCampaignProducts: ({ startDate, endDate }) => ({
    query: `
      SELECT COUNT(1) AS total
      FROM dbo.CampaignProduct
      WHERE Deleted = 0
        AND ISNULL(Active, 0) = 1
        AND (@startDate IS NULL OR CreateTime >= @startDate)
        AND (@endDate IS NULL OR CreateTime < DATEADD(day, 1, @endDate));
    `,
    bind: { startDate, endDate }
  }),

  totalClientProductPrices: ({ startDate, endDate }) => ({
    query: `
      SELECT COUNT(1) AS total
      FROM dbo.ClientProductPrice
      WHERE Deleted = 0
        AND (@startDate IS NULL OR CreateTime >= @startDate)
        AND (@endDate IS NULL OR CreateTime < DATEADD(day, 1, @endDate));
    `,
    bind: { startDate, endDate }
  }),

  totalCosts: ({ startDate, endDate }) => ({
    query: `
      SELECT SUM(ISNULL(Amount, 0)) AS totalAmount
      FROM dbo.Cost
      WHERE Deleted = 0
        AND (@startDate IS NULL OR CreateTime >= @startDate)
        AND (@endDate IS NULL OR CreateTime < DATEADD(day, 1, @endDate));
    `,
    bind: { startDate, endDate }
  }),

  costsByCategory: ({ startDate, endDate }) => ({
    query: `
      SELECT COALESCE(Category, 'Bilinmeyen Kategori') AS groupName, COUNT(1) AS total
      FROM dbo.Cost
      WHERE Deleted = 0
        AND (@startDate IS NULL OR CreateTime >= @startDate)
        AND (@endDate IS NULL OR CreateTime < DATEADD(day, 1, @endDate))
      GROUP BY COALESCE(Category, 'Bilinmeyen Kategori')
      ORDER BY total DESC;
    `,
    bind: { startDate, endDate }
  }),

  totalCommissions: ({ startDate, endDate }) => ({
    query: `
      SELECT SUM(ISNULL(TotalCommission, 0)) AS totalAmount
      FROM dbo.Commission
      WHERE Deleted = 0
        AND (@startDate IS NULL OR CreateTime >= @startDate)
        AND (@endDate IS NULL OR CreateTime < DATEADD(day, 1, @endDate));
    `,
    bind: { startDate, endDate }
  }),

  totalTrackedOrders: ({ startDate, endDate }) => ({
    query: `
      SELECT COUNT(1) AS total
      FROM dbo.PurchaseOrderTracker
      WHERE Deleted = 0
        AND (@startDate IS NULL OR CreateTime >= @startDate)
        AND (@endDate IS NULL OR CreateTime < DATEADD(day, 1, @endDate));
    `,
    bind: { startDate, endDate }
  }),

  totalBipPromotions: ({ startDate, endDate }) => ({
    query: `
      SELECT COUNT(1) AS total
      FROM dbo.BipPromotion
      WHERE Deleted = 0
        AND (@startDate IS NULL OR CreateTime >= @startDate)
        AND (@endDate IS NULL OR CreateTime < DATEADD(day, 1, @endDate));
    `,
    bind: { startDate, endDate }
  }),

  totalDistributorCommercials: ({ startDate, endDate }) => ({
    query: `
      SELECT COUNT(1) AS total
      FROM dbo.DistributorCommercial
      WHERE Deleted = 0
        AND (@startDate IS NULL OR CreateTime >= @startDate)
        AND (@endDate IS NULL OR CreateTime < DATEADD(day, 1, @endDate));
    `,
    bind: { startDate, endDate }
  }),

  totalIyzicoTransactions: ({ startDate, endDate }) => ({
    query: `
      SELECT COUNT(1) AS total
      FROM dbo.IyzicoPaymentTransaction
      WHERE Deleted = 0
        AND (@startDate IS NULL OR CreateTime >= @startDate)
        AND (@endDate IS NULL OR CreateTime < DATEADD(day, 1, @endDate));
    `,
    bind: { startDate, endDate }
  }),

  iyzicoTransactionsByStatus: ({ startDate, endDate }) => ({
    query: `
      SELECT COALESCE(PaymentStatus, 'Bilinmeyen Durum') AS statusName, COUNT(1) AS total
      FROM dbo.IyzicoPaymentTransaction
      WHERE Deleted = 0
        AND (@startDate IS NULL OR CreateTime >= @startDate)
        AND (@endDate IS NULL OR CreateTime < DATEADD(day, 1, @endDate))
      GROUP BY COALESCE(PaymentStatus, 'Bilinmeyen Durum')
      ORDER BY total DESC;
    `,
    bind: { startDate, endDate }
  }),
};

module.exports = TEMPLATES;
