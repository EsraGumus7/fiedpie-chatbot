function hasWildcardPermission(permissions = []) {
    return permissions.includes("*");
}

function assertIntentAllowed(intent, userContext = {}) {
    if (!intent || typeof intent !== "string") {
        throw new Error("Intent permission denied: invalid intent.");
    }

    const allowedIntents = userContext.allowedIntents || [];

    if (!Array.isArray(allowedIntents)) {
        throw new Error("Intent permission denied: allowedIntents must be an array.");
    }

    if (hasWildcardPermission(allowedIntents)) {
        return true;
    }

    if (!allowedIntents.includes(intent)) {
        throw new Error(`Intent permission denied: ${intent} is not allowed.`);
    }

    return true;
}

module.exports = {
    assertIntentAllowed,
};