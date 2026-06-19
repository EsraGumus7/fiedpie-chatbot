function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertNumber(value, fieldName) {
    if (typeof value !== "number" || Number.isNaN(value)) {
        throw new Error(`Invalid UserContext: ${fieldName} must be a number.`);
    }
}

function assertArray(value, fieldName) {
    if (!Array.isArray(value)) {
        throw new Error(`Invalid UserContext: ${fieldName} must be an array.`);
    }
}

function assertBoolean(value, fieldName) {
    if (typeof value !== "boolean") {
        throw new Error(`Invalid UserContext: ${fieldName} must be a boolean.`);
    }
}

function normalizeArray(value) {
    return value ?? [];
}

function normalizeRoles(userContext = {}) {
    if (userContext.roles !== undefined) {
        return userContext.roles;
    }

    if (userContext.role !== undefined) {
        return [userContext.role];
    }

    return [];
}

function normalizeBoolean(value, defaultValue = false) {
    if (value === undefined || value === null) {
        return defaultValue;
    }

    return value;
}

function normalizeManageAll(userContext = {}) {
    if (userContext.manageAll !== undefined && userContext.manageAll !== null) {
        return userContext.manageAll;
    }

    if (
        userContext.managerOfAllTeams !== undefined &&
        userContext.managerOfAllTeams !== null
    ) {
        return userContext.managerOfAllTeams;
    }

    return false;
}

function normalizeSubscriptionId(userContext = {}) {
    return userContext.subscriptionId ?? userContext.tenantId;
}

function normalizeUserContext(userContext = {}) {
    if (!isPlainObject(userContext)) {
        throw new Error("Invalid UserContext: context must be an object.");
    }

    const normalized = {
        userId: userContext.userId,
        subscriptionId: normalizeSubscriptionId(userContext),

        roles: normalizeRoles(userContext),

        isAdmin: normalizeBoolean(userContext.isAdmin),
        isSuperAdmin: normalizeBoolean(userContext.isSuperAdmin),
        isClientUser: normalizeBoolean(userContext.isClientUser),
        manageAll: normalizeManageAll(userContext),

        hierarchyLevel:
          userContext.hierarchyLevel !== undefined && userContext.hierarchyLevel !== null
            ? Number(userContext.hierarchyLevel)
            : null,
        hierarchyLabel: userContext.hierarchyLabel || null,
        

        allowedIntents: normalizeArray(userContext.allowedIntents),
        allowedMetrics: normalizeArray(userContext.allowedMetrics),
        allowedTables: normalizeArray(userContext.allowedTables),

        allowedColumns: normalizeArray(userContext.allowedColumns),
        maskedColumns: normalizeArray(userContext.maskedColumns),
        blockedColumns: normalizeArray(userContext.blockedColumns),

        allowedUserIds: normalizeArray(userContext.allowedUserIds),
        assignedClientIds: normalizeArray(userContext.assignedClientIds),
        effectiveClientIds: normalizeArray(userContext.effectiveClientIds),
        clientTagIds: normalizeArray(userContext.clientTagIds),
        managedTeamIds: normalizeArray(userContext.managedTeamIds),

        allowedCompanyIds: normalizeArray(userContext.allowedCompanyIds),
        allowedBrandIds: normalizeArray(userContext.allowedBrandIds),
        allowedTeamIds: normalizeArray(userContext.allowedTeamIds),
        allowedCountryIds: normalizeArray(userContext.allowedCountryIds),
        allowedRegionIds: normalizeArray(userContext.allowedRegionIds),
        allowedCityIds: normalizeArray(userContext.allowedCityIds),
        allowedDistrictIds: normalizeArray(userContext.allowedDistrictIds),

        allowedDistributorIds: normalizeArray(userContext.allowedDistributorIds),
        allowedClientGroupIds: normalizeArray(userContext.allowedClientGroupIds),

        activeScopeMode: userContext.activeScopeMode || null,
        defaultScopeMode: userContext.defaultScopeMode || null,
        hierarchyBypassUserFilter: !!userContext.hierarchyBypassUserFilter,

        allowedDynamicFieldIds: normalizeArray(userContext.allowedDynamicFieldIds),
        blockedDynamicFieldIds: normalizeArray(userContext.blockedDynamicFieldIds),
        maskedDynamicFieldIds: normalizeArray(userContext.maskedDynamicFieldIds),

        allowedFinancialMetrics: normalizeArray(userContext.allowedFinancialMetrics),
    };

    validateUserContext(normalized);

    return normalized;
}

function validateUserContext(userContext = {}) {
    if (!isPlainObject(userContext)) {
        throw new Error("Invalid UserContext: context must be an object.");
    }

    assertNumber(userContext.userId, "userId");
    assertNumber(userContext.subscriptionId, "subscriptionId");

    assertArray(userContext.roles, "roles");

    assertBoolean(userContext.isAdmin, "isAdmin");
    assertBoolean(userContext.isClientUser, "isClientUser");
    assertBoolean(userContext.manageAll, "manageAll");

    assertArray(userContext.allowedIntents, "allowedIntents");
    assertArray(userContext.allowedMetrics, "allowedMetrics");
    assertArray(userContext.allowedTables, "allowedTables");

    assertArray(userContext.allowedColumns, "allowedColumns");
    assertArray(userContext.maskedColumns, "maskedColumns");
    assertArray(userContext.blockedColumns, "blockedColumns");

    assertArray(userContext.allowedUserIds, "allowedUserIds");
    assertArray(userContext.assignedClientIds, "assignedClientIds");
    assertArray(userContext.effectiveClientIds, "effectiveClientIds");
    assertArray(userContext.clientTagIds, "clientTagIds");
    assertArray(userContext.managedTeamIds, "managedTeamIds");

    assertArray(userContext.allowedCompanyIds, "allowedCompanyIds");
    assertArray(userContext.allowedBrandIds, "allowedBrandIds");
    assertArray(userContext.allowedTeamIds, "allowedTeamIds");
    assertArray(userContext.allowedCountryIds, "allowedCountryIds");
    assertArray(userContext.allowedRegionIds, "allowedRegionIds");
    assertArray(userContext.allowedCityIds, "allowedCityIds");
    assertArray(userContext.allowedDistrictIds, "allowedDistrictIds");

    assertArray(userContext.allowedDistributorIds, "allowedDistributorIds");
    assertArray(userContext.allowedClientGroupIds, "allowedClientGroupIds");

    assertArray(userContext.allowedDynamicFieldIds, "allowedDynamicFieldIds");
    assertArray(userContext.blockedDynamicFieldIds, "blockedDynamicFieldIds");
    assertArray(userContext.maskedDynamicFieldIds, "maskedDynamicFieldIds");

    assertArray(userContext.allowedFinancialMetrics, "allowedFinancialMetrics");

    return true;
}

module.exports = {
    normalizeUserContext,
    validateUserContext,
};