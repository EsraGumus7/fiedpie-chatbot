function maskEmail(value) {
    if (!value || typeof value !== "string") return value;

    const [name, domain] = value.split("@");

    if (!name || !domain) return "***";

    return `${name.slice(0, 1)}****@${domain}`;
}

function maskPhone(value) {
    if (!value) return value;

    const text = String(value);
    if (text.length <= 4) return "****";

    return `${text.slice(0, 4)}******${text.slice(-2)}`;
}

function maskGeneric(value) {
    if (value == null) return value;
    return "***";
}

function normalizeColumnName(columnName) {
    return String(columnName || "")
        .split(".")
        .pop()
        .trim()
        .toLowerCase();
}

function normalizeColumnList(columns = []) {
    if (!Array.isArray(columns)) {
        return [];
    }

    return columns.map(normalizeColumnName);
}

function maskValue(columnName, value) {
    const normalized = normalizeColumnName(columnName);

    if (normalized.includes("email")) {
        return maskEmail(value);
    }

    if (
        normalized.includes("phone") ||
        normalized.includes("mobile")
    ) {
        return maskPhone(value);
    }

    return maskGeneric(value);
}

function applyColumnSecurity(rows = [], userContext = {}) {
    if (!Array.isArray(rows)) {
        return rows;
    }

    const allowedColumns = normalizeColumnList(userContext.allowedColumns || []);
    const maskedColumns = normalizeColumnList(userContext.maskedColumns || []);
    const blockedColumns = normalizeColumnList(userContext.blockedColumns || []);

    return rows.map((row) => {
        const securedRow = {};

        Object.entries(row).forEach(([columnName, value]) => {
            const normalizedColumnName = normalizeColumnName(columnName);

            if (blockedColumns.includes(normalizedColumnName)) {
                return;
            }

            if (maskedColumns.includes(normalizedColumnName)) {
                securedRow[columnName] = maskValue(columnName, value);
                return;
            }

            if (
                allowedColumns.length > 0 &&
                !allowedColumns.includes(normalizedColumnName) &&
                !maskedColumns.includes(normalizedColumnName)
            ) {
                return;
            }

            securedRow[columnName] = value;
        });

        return securedRow;
    });
}

module.exports = {
    applyColumnSecurity,
    maskValue,
    normalizeColumnName,
    normalizeColumnList,
};