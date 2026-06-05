const { queryDb } = require("../db/sql");

const HIERARCHY_LEVEL = {
  SELF: 1,
  TEAM: 2,
  MULTI_TEAM: 3,
  COMPANY: 4,
};

function unique(values = []) {
  return Array.from(new Set(values.filter((x) => x !== null && x !== undefined)));
}

function isCompanyCapable(user = {}, roles = []) {
  return !!(
    user.Admin ||
    user.ManagerOfAllTeams ||
    roles.some((r) => !!r.DefaultAdmin || !!r.TestingCompanyAdmin)
  );
}

function resolveOperationalLevel(user = {}, managedTeamIds = []) {
  if (user.ManagerOfAllTeams) {
    return HIERARCHY_LEVEL.COMPANY;
  }

  const managedCount = unique(managedTeamIds).length;
  if (managedCount > 1) {
    return HIERARCHY_LEVEL.MULTI_TEAM;
  }
  if (managedCount === 1) {
    return HIERARCHY_LEVEL.TEAM;
  }

  return HIERARCHY_LEVEL.SELF;
}

function resolveHierarchyLevel(user, roles = [], managedTeamIds = []) {
  if (isCompanyCapable(user, roles) && unique(managedTeamIds).length === 0) {
    return HIERARCHY_LEVEL.COMPANY;
  }

  return resolveOperationalLevel(user, managedTeamIds);
}

function getHierarchyLabel(level) {
  switch (Number(level)) {
    case HIERARCHY_LEVEL.TEAM:
      return "TEAM";
    case HIERARCHY_LEVEL.MULTI_TEAM:
      return "MULTI_TEAM";
    case HIERARCHY_LEVEL.COMPANY:
      return "COMPANY";
    default:
      return "SELF";
  }
}

function buildBindList(values = [], prefix = "param") {
  const bind = {};
  const sqlParts = [];

  values.forEach((value, index) => {
    const key = `${prefix}${index}`;
    bind[key] = Number(value);
    sqlParts.push(`@${key}`);
  });

  return {
    sql: sqlParts.join(", "),
    bind,
  };
}

async function getTeamUserIds(teamIds = [], dbQuery = queryDb) {
  if (!Array.isArray(teamIds) || teamIds.length === 0) {
    return [];
  }

  const { sql, bind } = buildBindList(teamIds, "teamId");
  const result = await dbQuery({
    query: `
      SELECT DISTINCT ut.UserId
      FROM dbo.UserTeam ut
      INNER JOIN dbo.[User] u
        ON u.Id = ut.UserId
       AND u.Deleted = 0
      WHERE ut.Deleted = 0
        AND ut.TeamId IN (${sql});
    `,
    bind,
  });

  return unique(result.recordset.map((x) => Number(x.UserId)));
}

async function getSubscriptionUserIds(subscriptionId, dbQuery = queryDb) {
  if (!subscriptionId) {
    return [];
  }

  const result = await dbQuery({
    query: `
      SELECT u.Id
      FROM dbo.[User] u
      WHERE u.Deleted = 0
        AND u.SubscriptionId = @subscriptionId;
    `,
    bind: { subscriptionId: Number(subscriptionId) },
  });

  return unique(result.recordset.map((x) => Number(x.Id)));
}

async function buildAllowedUserIds({
  userId,
  hierarchyLevel,
  managedTeamIds = [],
  subscriptionId,
  dbQuery = queryDb,
}) {
  const uid = Number(userId);

  if (hierarchyLevel === HIERARCHY_LEVEL.COMPANY) {
    const subscriptionUserIds = await getSubscriptionUserIds(subscriptionId, dbQuery);
    return subscriptionUserIds.length ? subscriptionUserIds : [uid];
  }

  const ids = [uid];

  if (hierarchyLevel >= HIERARCHY_LEVEL.TEAM && managedTeamIds.length) {
    const teamUserIds = await getTeamUserIds(managedTeamIds, dbQuery);
    ids.push(...teamUserIds);
  }

  return unique(ids.map((x) => Number(x)));
}

function resolveManagedTeamLabel(teams = [], managedTeamIds = []) {
  const managedFromFlags = (teams || []).filter((team) => !!team.Manager);
  if (managedFromFlags.length === 1) {
    return managedFromFlags[0].teamName || `Takim ${managedFromFlags[0].teamId}`;
  }

  const managedSet = new Set(unique(managedTeamIds));
  const managedTeams = (teams || []).filter((team) => managedSet.has(Number(team.teamId)));

  if (managedTeams.length === 1) {
    return managedTeams[0].teamName || `Takim ${managedTeams[0].teamId}`;
  }

  if (managedTeams.length > 1) {
    return `${managedTeams.length} takim`;
  }

  return "Takim";
}

function pickEffectiveScope({
  isHybridScopeUser,
  defaultScopeMode,
  operationalLevel,
  operationalAllowedUserIds,
  companyAllowedUserIds,
}) {
  if (isHybridScopeUser && defaultScopeMode === "operational") {
    return {
      hierarchyLevel: operationalLevel,
      hierarchyLabel: getHierarchyLabel(operationalLevel),
      hierarchyBypassUserFilter: false,
      allowedUserIds: operationalAllowedUserIds,
      activeScopeMode: "operational",
    };
  }

  if (companyAllowedUserIds?.length) {
    return {
      hierarchyLevel: HIERARCHY_LEVEL.COMPANY,
      hierarchyLabel: "COMPANY",
      hierarchyBypassUserFilter: true,
      allowedUserIds: companyAllowedUserIds,
      activeScopeMode: "company",
    };
  }

  return {
    hierarchyLevel: operationalLevel,
    hierarchyLabel: getHierarchyLabel(operationalLevel),
    hierarchyBypassUserFilter: operationalLevel === HIERARCHY_LEVEL.COMPANY,
    allowedUserIds: operationalAllowedUserIds,
    activeScopeMode: "operational",
  };
}

async function resolveUserHierarchy({
  user,
  roles = [],
  managedTeamIds = [],
  teams = [],
  dbQuery = queryDb,
}) {
  const managedIds = unique(managedTeamIds);
  const companyCapable = isCompanyCapable(user, roles);
  const operationalLevel = resolveOperationalLevel(user, managedIds);

  const operationalAllowedUserIds = await buildAllowedUserIds({
    userId: user.Id,
    hierarchyLevel: operationalLevel,
    managedTeamIds: managedIds,
    subscriptionId: user.SubscriptionId,
    dbQuery,
  });

  const companyAllowedUserIds = companyCapable
    ? await getSubscriptionUserIds(user.SubscriptionId, dbQuery)
    : [];

  const isHybridScopeUser =
    companyCapable &&
    managedIds.length > 0 &&
    !user.ManagerOfAllTeams &&
    operationalLevel < HIERARCHY_LEVEL.COMPANY;

  const defaultScopeMode = isHybridScopeUser
    ? "operational"
    : companyCapable && managedIds.length === 0
      ? "company"
      : "operational";

  const operationalScopeLabel = resolveManagedTeamLabel(teams, managedIds);
  const companyScopeLabel = user.subscriptionCompanyName || "Sirket geneli";

  const effective = pickEffectiveScope({
    isHybridScopeUser,
    defaultScopeMode,
    operationalLevel,
    operationalAllowedUserIds,
    companyAllowedUserIds,
  });

  return {
    hierarchyLevel: effective.hierarchyLevel,
    hierarchyLabel: effective.hierarchyLabel,
    hierarchyBypassUserFilter: effective.hierarchyBypassUserFilter,
    allowedUserIds: effective.allowedUserIds,
    activeScopeMode: effective.activeScopeMode,

    operationalLevel,
    operationalLabel: getHierarchyLabel(operationalLevel),
    operationalAllowedUserIds,
    operationalScopeLabel,

    companyCapable,
    companyLevel: HIERARCHY_LEVEL.COMPANY,
    companyAllowedUserIds,
    companyScopeLabel,

    isHybridScopeUser,
    defaultScopeMode,
    managedTeamIds: managedIds,
  };
}

module.exports = {
  HIERARCHY_LEVEL,
  isCompanyCapable,
  resolveOperationalLevel,
  resolveHierarchyLevel,
  getHierarchyLabel,
  getTeamUserIds,
  getSubscriptionUserIds,
  buildAllowedUserIds,
  resolveUserHierarchy,
};
