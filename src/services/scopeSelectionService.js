const {
  resolveManagedTeams,
  resolveSubscriptionTeams,
  formatCompanyDisplayLabel,
} = require("./scopeContextService");

const DEFAULT_MAX_TEAM_SELECTION = 10;

function uniqueTeamIds(teamIds = []) {
  return Array.from(
    new Set(
      (teamIds || [])
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id > 0)
    )
  );
}

function resolveToolbarTeams(userContext = {}) {
  if (userContext.isPureCompanyScopeUser || userContext.isHybridScopeUser) {
    const subscriptionTeams = resolveSubscriptionTeams(userContext);
    if (subscriptionTeams.length) {
      return subscriptionTeams;
    }
  }

  return resolveManagedTeams(userContext);
}

function resolveOperationalTeams(userContext = {}) {
  const managedTeams = resolveManagedTeams(userContext);
  if (managedTeams.length) {
    return managedTeams;
  }

  return resolveToolbarTeams(userContext);
}

function resolveCompanyTeams(userContext = {}) {
  if (!userContext.companyCapable) {
    return [];
  }

  const subscriptionTeams = resolveSubscriptionTeams(userContext);
  if (subscriptionTeams.length) {
    return subscriptionTeams;
  }

  return resolveOperationalTeams(userContext);
}

function findTeamMeta(teams = [], teamId) {
  return (teams || []).find((team) => Number(team.teamId) === Number(teamId)) || null;
}

function resolveBreakdownTeamList(userContext = {}, toolbarConfig = {}, teamIds = []) {
  const ids = uniqueTeamIds(teamIds);
  const pool =
    ids.length && toolbarConfig.companyTeams?.length
      ? toolbarConfig.companyTeams
      : toolbarConfig.operationalTeams?.length
        ? toolbarConfig.operationalTeams
        : toolbarConfig.teams || [];

  if (ids.length) {
    const idSet = new Set(ids);
    return pool.filter((team) => idSet.has(Number(team.teamId)));
  }

  if (userContext.isPureCompanyScopeUser) {
    return toolbarConfig.companyTeams?.length
      ? toolbarConfig.companyTeams
      : toolbarConfig.teams || [];
  }

  return toolbarConfig.operationalTeams?.length
    ? toolbarConfig.operationalTeams
    : toolbarConfig.teams || [];
}

function buildDefaultScopeSelection(userContext = {}, toolbarConfig = {}) {
  const operationalTeams = toolbarConfig.operationalTeams || [];
  const teamsUsable = !toolbarConfig.teamsButton?.locked;
  const companyUsable = !toolbarConfig.companyButton?.locked;

  if (!teamsUsable && !companyUsable) {
    return { mode: "self", teamScope: "single", teamIds: [] };
  }

  if (teamsUsable && companyUsable) {
    return { mode: "both", teamScope: "all", teamIds: [] };
  }

  if (companyUsable) {
    return { mode: "company", teamScope: "all", teamIds: [] };
  }

  // Saf L2/L3: sirket kilitli — varsayilan ilk yonetilen takim
  if (operationalTeams.length >= 1) {
    return {
      mode: "teams",
      teamScope: "single",
      teamIds: [operationalTeams[0].teamId],
    };
  }

  return { mode: "teams", teamScope: "all", teamIds: [] };
}

function buildScopeToolbarConfig(userContext = {}) {
  const level = Number(userContext.operationalLevel ?? userContext.hierarchyLevel ?? 1);
  const companyCapable = !!userContext.companyCapable;
  const operationalTeams = resolveOperationalTeams(userContext);
  const companyTeams = resolveCompanyTeams(userContext);
  const teams = companyCapable && companyTeams.length ? companyTeams : operationalTeams;
  const managedCount = operationalTeams.length;
  const allowMultiTeamSelect =
    level >= 3 ||
    userContext.isPureCompanyScopeUser ||
    operationalTeams.length > 1 ||
    (companyCapable && companyTeams.length > 1);

  const teamsUsable =
    level > 1 &&
    (operationalTeams.length > 0 ||
      (companyCapable &&
        companyTeams.length > 0 &&
        (userContext.isPureCompanyScopeUser || userContext.isHybridScopeUser)));

  const companyUsable = level > 1 && companyCapable;

  const teamsButton = {
    visible: true,
    enabled: teamsUsable,
    locked: !teamsUsable,
  };
  const companyButton = {
    visible: true,
    enabled: companyUsable,
    locked: !companyUsable,
  };

  const allowDualScopeSelect = teamsUsable && companyUsable;

  let badgeLabel = "Kendim";
  if (level >= 4 || userContext.isPureCompanyScopeUser) {
    badgeLabel = "Sirket geneli";
  } else if (managedCount > 1) {
    badgeLabel = `${managedCount} takim`;
  } else if (managedCount === 1) {
    badgeLabel = operationalTeams[0]?.teamName || userContext.operationalScopeLabel || "Takim";
  }

  const toolbarConfig = {
    operationalLevel: level,
    isHybridScopeUser: !!userContext.isHybridScopeUser,
    isPureCompanyScopeUser: !!userContext.isPureCompanyScopeUser,
    companyCapable,
    teamsButton,
    companyButton,
    teams,
    operationalTeams,
    companyTeams,
    allowMultiTeamSelect,
    allowDualScopeSelect,
    allowSelectAllTeams: operationalTeams.length > 1,
    maxTeamSelection: DEFAULT_MAX_TEAM_SELECTION,
    badgeLabel,
  };

  toolbarConfig.defaultSelection = buildDefaultScopeSelection(userContext, toolbarConfig);
  return toolbarConfig;
}

function getAllowedTeamIdSet(toolbarConfig = {}, selectionMode = "teams") {
  const pool =
    selectionMode === "company"
      ? toolbarConfig.companyTeams || toolbarConfig.teams || []
      : toolbarConfig.operationalTeams || toolbarConfig.teams || [];

  return new Set(pool.map((team) => Number(team.teamId)));
}

const SCOPE_PICK_REQUIRED_MESSAGE =
  "Sirket ve takim kapsami birlikte acik. Lutfen Takimlar menusunden bir secim yapiniz.";

function normalizeScopeSelection(rawSelection = {}, toolbarConfig = {}) {
  const defaults = toolbarConfig.defaultSelection || {
    mode: "teams",
    teamScope: "all",
    teamIds: [],
  };

  if (toolbarConfig.operationalLevel <= 1) {
    return { mode: "self", teamScope: "single", teamIds: [], teamsActive: false, companyActive: false };
  }

  let teamScope = String(rawSelection?.teamScope || defaults.teamScope || "all").trim();
  let teamIds = uniqueTeamIds(rawSelection?.teamIds ?? defaults.teamIds);

  let teamsActive =
    rawSelection?.teamsActive ??
    (rawSelection?.mode === "both" ||
      rawSelection?.mode === "teams" ||
      (!rawSelection?.mode && defaults.mode === "teams"));
  let companyActive =
    rawSelection?.companyActive ??
    (rawSelection?.mode === "both" ||
      rawSelection?.mode === "company" ||
      defaults.mode === "company");

  if (toolbarConfig.teamsButton?.locked) {
    teamsActive = false;
  }
  if (toolbarConfig.companyButton?.locked) {
    companyActive = false;
  }

  if (!teamsActive && !companyActive) {
    teamsActive = !toolbarConfig.teamsButton?.locked;
    companyActive = !toolbarConfig.companyButton?.locked && defaults.mode === "company";
    if (teamsActive && companyActive && !toolbarConfig.allowDualScopeSelect) {
      if (defaults.mode === "company") {
        teamsActive = false;
      } else {
        companyActive = false;
      }
    }
    if (!teamsActive && !companyActive) {
      teamsActive = !toolbarConfig.teamsButton?.locked;
    }
  }

  if (!toolbarConfig.allowDualScopeSelect) {
    if (rawSelection?.mode === "company" || (companyActive && !teamsActive)) {
      teamsActive = false;
      companyActive = !toolbarConfig.companyButton?.locked;
    } else {
      companyActive = false;
      teamsActive = !toolbarConfig.teamsButton?.locked;
    }
  }

  if (teamsActive && companyActive && toolbarConfig.allowDualScopeSelect) {
    const hasTeamPick = teamScope === "all" || teamIds.length > 0;
    if (!hasTeamPick) {
      return {
        mode: "scope_pick_required",
        teamScope: "none",
        teamIds: [],
        teamsActive: true,
        companyActive: true,
      };
    }

    if (teamScope !== "all") {
      const allowed = getAllowedTeamIdSet(toolbarConfig, "teams");
      teamIds = teamIds.filter((id) => allowed.has(id));
      if (!teamIds.length) {
        return {
          mode: "scope_pick_required",
          teamScope: "none",
          teamIds: [],
          teamsActive: true,
          companyActive: true,
        };
      }
    }

    return {
      mode: "both",
      teamScope: teamScope === "all" ? "all" : teamIds.length === 1 ? "single" : "multi",
      teamIds: teamScope === "all" ? [] : teamIds,
      teamsActive: true,
      companyActive: true,
    };
  }

  if (companyActive) {
    teamIds = teamIds.filter((id) => getAllowedTeamIdSet(toolbarConfig, "company").has(id));
    if (teamIds.length === 0) {
      return {
        mode: "company",
        teamScope: "all",
        teamIds: [],
        teamsActive: false,
        companyActive: true,
      };
    }
    return {
      mode: "company",
      teamScope: teamIds.length === 1 ? "single" : "multi",
      teamIds,
      teamsActive: false,
      companyActive: true,
    };
  }

  const allowed = getAllowedTeamIdSet(toolbarConfig, "teams");
  teamIds = teamIds.filter((id) => allowed.has(id));

  if (teamScope === "all" || (!teamIds.length && teamScope !== "single")) {
    return {
      mode: "teams",
      teamScope: "all",
      teamIds: [],
      teamsActive: true,
      companyActive: false,
    };
  }

  if (!teamIds.length && allowed.size === 1) {
    return {
      mode: "teams",
      teamScope: "single",
      teamIds: [...allowed],
      teamsActive: true,
      companyActive: false,
    };
  }

  if (!teamIds.length) {
    return {
      mode: "teams",
      teamScope: "all",
      teamIds: [],
      teamsActive: true,
      companyActive: false,
    };
  }

  if (teamIds.length === 1) {
    return {
      mode: "teams",
      teamScope: "single",
      teamIds,
      teamsActive: true,
      companyActive: false,
    };
  }

  const operationalMax = (toolbarConfig.operationalTeams || []).length;
  const max =
    operationalMax > 0
      ? operationalMax
      : toolbarConfig.maxTeamSelection || DEFAULT_MAX_TEAM_SELECTION;
  return {
    mode: "teams",
    teamScope: "multi",
    teamIds: teamIds.slice(0, max),
    teamsActive: true,
    companyActive: false,
  };
}

function resolveScopePlanFromSelection(userContext = null, rawSelection = {}, intent = "") {
  const toolbarConfig = buildScopeToolbarConfig(userContext);
  const selection = normalizeScopeSelection(rawSelection, toolbarConfig);

  const basePlan = {
    source: "toolbar",
    selection,
    scopePreference: selection.mode === "company" ? "company" : "operational",
    teamMatch: null,
    teamIds: [],
    intent,
  };

  if (selection.mode === "scope_pick_required") {
    if (toolbarConfig.operationalLevel <= 1 || !toolbarConfig.allowDualScopeSelect) {
      return {
        ...basePlan,
        mode: "self",
        display: "single",
      };
    }
    return {
      ...basePlan,
      mode: "scope_pick_required",
      display: "none",
      answer: SCOPE_PICK_REQUIRED_MESSAGE,
    };
  }

  if (!userContext || selection.mode === "self") {
    return {
      ...basePlan,
      mode: "self",
      display: "single",
    };
  }

  if (selection.mode === "both") {
    const breakdownTeams = resolveBreakdownTeamList(
      userContext,
      toolbarConfig,
      selection.teamScope === "all" ? [] : selection.teamIds
    );

    return {
      ...basePlan,
      mode: "company_team_breakdown",
      display: "company_team_breakdown",
      scopePreference: "company",
      scopeSource: selection.teamScope === "all" ? "managed" : "selected",
      teamIds: breakdownTeams.map((team) => team.teamId),
      includeMemberBreakdown: breakdownTeams.length === 1,
      useCompanyScopeForCombinedTotal: selection.teamScope === "all",
      combinedLabel:
        selection.teamScope === "all" && breakdownTeams.length > 1
          ? "Toplam"
          : "Secili takimlar toplami",
    };
  }

  if (selection.mode === "company") {
    if (selection.teamIds.length === 0) {
      return {
        ...basePlan,
        mode: "company",
        display: "single",
      };
    }

    return {
      ...basePlan,
      mode: "company_team_breakdown",
      display: "company_team_breakdown",
      scopeSource: "subscription",
      teamIds: selection.teamIds,
      includeMemberBreakdown: selection.teamIds.length === 1,
      combinedLabel: "Secili takimlar toplami",
    };
  }

  if (selection.teamScope === "single" && selection.teamIds.length === 1) {
    const teamId = selection.teamIds[0];
    const teamMeta =
      findTeamMeta(toolbarConfig.operationalTeams, teamId) ||
      findTeamMeta(toolbarConfig.teams, teamId);

    return {
      ...basePlan,
      mode: "single_team",
      display: "team_detail",
      includeMemberBreakdown: true,
      teamIds: [teamId],
      teamMatch: {
        teamId,
        teamName: teamMeta?.teamName || `Takim ${teamId}`,
      },
    };
  }

  if (selection.teamScope === "all") {
    const breakdownTeams = resolveBreakdownTeamList(userContext, toolbarConfig);
    return {
      ...basePlan,
      mode: "multi_team",
      display: "breakdown",
      scopeSource: userContext.isPureCompanyScopeUser ? "subscription" : "managed",
      teamIds: breakdownTeams.map((team) => team.teamId),
      combinedLabel: userContext.isPureCompanyScopeUser
        ? formatCompanyDisplayLabel(userContext.companyScopeLabel || "Sirket geneli")
        : "Toplam",
    };
  }

  return {
    ...basePlan,
    mode: "multi_team",
    display: "breakdown",
    scopeSource: "selected",
    teamIds: selection.teamIds,
    combinedLabel: "Secili takimlar toplami",
  };
}

module.exports = {
  DEFAULT_MAX_TEAM_SELECTION,
  SCOPE_PICK_REQUIRED_MESSAGE,
  buildScopeToolbarConfig,
  normalizeScopeSelection,
  resolveScopePlanFromSelection,
  resolveToolbarTeams,
  resolveOperationalTeams,
  resolveCompanyTeams,
  resolveBreakdownTeamList,
};
