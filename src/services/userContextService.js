const { queryDb } = require("../db/sql");
const {
  getTeamUserIds,
  resolveUserHierarchy,
} = require("./hierarchyService");

function unique(values = []) {
  return Array.from(new Set(values.filter((x) => x !== null && x !== undefined)));
}

async function getUserBase(userId) {
  const result = await queryDb({
    query: `
      SELECT TOP 1
        u.Id,
        u.Email,
        u.Name,
        u.SubscriptionId,
        u.Admin,
        u.ApiUser,
        u.ClientUser,
        u.ManagerOfAllTeams,
        u.Contractor,
        u.Blocked,
        u.Deleted,
        u.ClientGroupId,
        u.ProductGroupId,
        u.DistributorGroupId,
        u.InformationForTeamId,
        u.Company,
        s.CompanyName AS subscriptionCompanyName
      FROM dbo.[User] u
      LEFT JOIN dbo.Subscription s
        ON s.Id = u.SubscriptionId
       AND s.Deleted = 0
      WHERE u.Id = @userId
        AND u.Deleted = 0;
    `,
    bind: { userId },
  });

  return result.recordset[0] || null;
}

async function getRoles(userId) {
  const result = await queryDb({
    query: `
      SELECT
        r.Id AS roleId,
        r.Name AS roleName,
        r.DefaultAdmin,
        r.DefaultFieldForce,
        r.Tester,
        r.WaterUtility,
        r.TestingCompanyAdmin,
        r.Code
      FROM dbo.UserRole ur
      INNER JOIN dbo.Role r
        ON r.Id = ur.RoleId
       AND r.Deleted = 0
      WHERE ur.UserId = @userId
        AND ur.Deleted = 0;
    `,
    bind: { userId },
  });

  return result.recordset;
}

async function getTeams(userId) {
  const result = await queryDb({
    query: `
      SELECT
        t.Id AS teamId,
        t.Name AS teamName,
        t.SubscriptionId,
        ut.Manager,
        ut.Member
      FROM dbo.UserTeam ut
      INNER JOIN dbo.Team t
        ON t.Id = ut.TeamId
       AND t.Deleted = 0
      WHERE ut.UserId = @userId
        AND ut.Deleted = 0;
    `,
    bind: { userId },
  });

  return result.recordset;
}

async function getBrands(userId) {
  const result = await queryDb({
    query: `
      SELECT
        b.Id AS brandId,
        b.Name AS brandName,
        b.SubscriptionId
      FROM dbo.UserBrand ub
      INNER JOIN dbo.Brand b
        ON b.Id = ub.BrandId
       AND b.Deleted = 0
      WHERE ub.UserId = @userId
        AND ub.Deleted = 0;
    `,
    bind: { userId },
  });

  return result.recordset;
}

async function getClients(userId) {
  const result = await queryDb({
    query: `
      SELECT
        c.Id AS clientId,
        c.Name AS clientName,
        c.SubscriptionId,
        c.CountryId,
        co.Name AS countryName,
        c.City,
        c.State,
        c.TeamId,
        c.ClientGroupId,
        c.CustomerRepresentativeUserId
      FROM dbo.ClientUser cu
      INNER JOIN dbo.Client c
        ON c.Id = cu.ClientId
       AND c.Deleted = 0
      LEFT JOIN dbo.Country co
        ON co.Id = c.CountryId
       AND co.Deleted = 0
      WHERE cu.UserId = @userId
        AND cu.Deleted = 0;
    `,
    bind: { userId },
  });

  return result.recordset;
}

function buildEffectiveFlags(user, roles) {
  const roleAdmin = roles.some((r) => !!r.DefaultAdmin || !!r.TestingCompanyAdmin);

  return {
    admin: !!user.Admin || roleAdmin,
    apiUser: !!user.ApiUser,
    clientUser: !!user.ClientUser,
    managerOfAllTeams: !!user.ManagerOfAllTeams,
    contractor: !!user.Contractor,
    fieldForce: roles.some((r) => !!r.DefaultFieldForce),
    tester: roles.some((r) => !!r.Tester),
    waterUtility: roles.some((r) => !!r.WaterUtility),
  };
}

async function buildUserContext(userId) {
  const user = await getUserBase(userId);

  if (!user) {
    throw new Error("Kullanici bulunamadi veya silinmis.");
  }

  if (user.Blocked) {
    throw new Error("Kullanici bloke durumda.");
  }

  const [roles, teams, brands, clients] = await Promise.all([
    getRoles(userId),
    getTeams(userId),
    getBrands(userId),
    getClients(userId),
  ]);

  const flags = buildEffectiveFlags(user, roles);

  const roleIds = unique(roles.map((x) => x.roleId));
  const teamIds = unique(teams.map((x) => x.teamId));
  const managedTeamIds = unique(teams.filter((x) => !!x.Manager).map((x) => x.teamId));
  const brandIds = unique(brands.map((x) => x.brandId));
  const clientIds = unique(clients.map((x) => x.clientId));

  const countryIds = unique(clients.map((x) => x.CountryId));
  const cities = unique(clients.map((x) => x.City).filter(Boolean));
  const clientGroupIds = unique([user.ClientGroupId, ...clients.map((x) => x.ClientGroupId)]);

  const effectiveTeamIds = unique([
    ...teamIds,
    user.InformationForTeamId,
    ...clients.map((x) => x.TeamId),
  ]);

  const hierarchy = await resolveUserHierarchy({
    user,
    roles,
    managedTeamIds,
    teams,
    dbQuery: queryDb,
  });

  return {
    userId: Number(user.Id),
    subscriptionId: Number(user.SubscriptionId),
    tenantId: Number(user.SubscriptionId),

    email: user.Email,
    name: user.Name,
    company: user.Company,
    subscriptionCompanyName: user.subscriptionCompanyName,

    roles,
    roleIds,

    isAdmin: flags.admin,
    isClientUser: flags.clientUser,
    manageAll: flags.managerOfAllTeams,

    flags,

    teams,
    brands,
    clients,

    teamIds: effectiveTeamIds,
    brandIds,
    clientIds,

    allowedIntents: [],
    allowedMetrics: [],
    allowedTables: [],

    allowedColumns: [],
    maskedColumns: [],
    blockedColumns: [],

    allowedUserIds: hierarchy.allowedUserIds,
    hierarchyLevel: hierarchy.hierarchyLevel,
    hierarchyLabel: hierarchy.hierarchyLabel,
    hierarchyBypassUserFilter: hierarchy.hierarchyBypassUserFilter,
    activeScopeMode: hierarchy.activeScopeMode,
    operationalLevel: hierarchy.operationalLevel,
    operationalLabel: hierarchy.operationalLabel,
    operationalAllowedUserIds: hierarchy.operationalAllowedUserIds,
    operationalScopeLabel: hierarchy.operationalScopeLabel,
    companyCapable: hierarchy.companyCapable,
    companyLevel: hierarchy.companyLevel,
    companyAllowedUserIds: hierarchy.companyAllowedUserIds,
    companyScopeLabel: hierarchy.companyScopeLabel,
    isHybridScopeUser: hierarchy.isHybridScopeUser,
    defaultScopeMode: hierarchy.defaultScopeMode,
    assignedClientIds: clientIds,
    effectiveClientIds: clientIds,
    clientTagIds: [],
    managedTeamIds: hierarchy.managedTeamIds,

    allowedCompanyIds: [Number(user.SubscriptionId)],
    allowedSubscriptionIds: [Number(user.SubscriptionId)],
    allowedBrandIds: brandIds,
    allowedRegionIds: [],
    allowedCountryIds: countryIds,
    allowedCityIds: [],
    allowedCities: cities,
    allowedDistrictIds: [],
    allowedStates: [],

    allowedDistributorIds: [],
    allowedClientGroupIds: clientGroupIds,

    allowedDynamicFieldIds: [],
    blockedDynamicFieldIds: [],
    maskedDynamicFieldIds: [],

    allowedFinancialMetrics: flags.admin ? ["*"] : [],

    scopes: {
      subscriptionIds: [user.SubscriptionId],
      companyIds: [user.SubscriptionId],
      clientIds,
      brandIds,
      teamIds: effectiveTeamIds,
      countryIds,
      cityIds: [],
      cities,
      stateIds: [],
      states: [],
      regionIds: [],
      districtIds: [],
      clientGroupIds,
      productGroupIds: unique([user.ProductGroupId]),
      distributorGroupIds: unique([user.DistributorGroupId]),
    },

    permissions: {
      allowedIntents: [],
      allowedMetrics: [],
      allowedTables: [],
      allowedColumns: [],
      maskedColumns: [],
      blockedColumns: [],
      deniedColumns: [],
    },

    accessMode: {
      isGlobalAdmin: flags.admin,
      isSubscriptionScoped: true,
      isClientScoped: clientIds.length > 0 && !flags.admin,
      isBrandScoped: brandIds.length > 0 && !flags.admin,
      isTeamScoped: effectiveTeamIds.length > 0 && !flags.admin,
    },
  };
}

module.exports = {
  buildUserContext,
  getTeamUserIds,
};
