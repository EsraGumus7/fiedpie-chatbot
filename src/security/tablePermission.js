function hasWildcardPermission(permissions = []) {
    return permissions.includes("*");
}

function assertTablesAllowed(sourceTables = [], userContext = {}) {
    if (!Array.isArray(sourceTables)) {
        throw new Error("Table permission denied: sourceTables must be an array.");
    }

    const allowedTables = userContext.allowedTables || [];

    if (!Array.isArray(allowedTables)) {
        throw new Error("Table permission denied: allowedTables must be an array.");
    }

    if (hasWildcardPermission(allowedTables)) {
        return true;
    }

    const deniedTables = sourceTables.filter(
        (table) => !allowedTables.includes(table)
    );

    if (deniedTables.length > 0) {
        throw new Error(
            `Table permission denied: ${deniedTables.join(", ")}`
        );
    }

    return true;
}

module.exports = {
    assertTablesAllowed,
};