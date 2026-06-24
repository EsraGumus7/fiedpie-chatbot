const { executeSecureIntent } = require("./secureIntentExecutor");

const CUSTOMER_BREAKDOWN_LIMIT = 20;

const CUSTOMER_BREAKDOWN_INTENTS = new Set([
    "totalInvoices",
    "totalInvoiceAmount",
    "totalInvoiceBalance",
    "totalPurchaseOrders",
    "totalPurchaseOrderAmount",
    "totalInvoicePayments",
]);

const MONEY_BREAKDOWN_INTENTS = new Set([
    "totalInvoiceAmount",
    "totalInvoiceBalance",
    "totalPurchaseOrderAmount",
    "totalInvoicePayments",
]);

function isSalesFinanceCustomerBreakdownIntent(intent = "") {
    return CUSTOMER_BREAKDOWN_INTENTS.has(String(intent || "").trim());
}

function normalizeLimit(limit) {
    const parsed = Number(limit);

    if (!Number.isFinite(parsed) || parsed <= 0) {
        return CUSTOMER_BREAKDOWN_LIMIT;
    }

    return Math.min(Math.trunc(parsed), 20);
}

function buildInvoiceCustomerBreakdownQuery(
    intent,
    params = {},
    limit = CUSTOMER_BREAKDOWN_LIMIT
) {
    const { startDate, endDate } = params;
    const topLimit = normalizeLimit(limit);

    const valueExpressionByIntent = {
        totalInvoices: "COUNT(DISTINCT i.Id)",
        totalInvoiceAmount: "SUM(ISNULL(i.TotalAmountWithTax, 0))",
        totalInvoiceBalance: "SUM(ISNULL(i.Balance, 0))",
    };

    const valueAliasByIntent = {
        totalInvoices: "total",
        totalInvoiceAmount: "totalAmount",
        totalInvoiceBalance: "totalBalance",
    };

    const valueExpression = valueExpressionByIntent[intent];
    const valueAlias = valueAliasByIntent[intent];

    const selectValueColumns =
        intent === "totalInvoices"
            ? `
        COUNT(DISTINCT i.Id) AS total,
        SUM(ISNULL(i.TotalAmountWithTax, 0)) AS totalAmount`
            : `
        ${valueExpression} AS ${valueAlias}`;

    const orderValueAlias = intent === "totalInvoices" ? "total" : valueAlias;

    const paidFilter =
        intent === "totalInvoiceBalance" ? "AND ISNULL(i.Paid, 0) = 0" : "";

    const clientExpression = "COALESCE(c.Name, N'Müşteri bilgisi yok')";
    const userExpression = "COALESCE(u.Name, u.Email, N'Kullanıcı bilgisi yok')";

    return {
        query: `
          SELECT TOP (${topLimit})
        ${clientExpression} AS clientName,
        ${userExpression} AS userName,
        ${selectValueColumns}
      FROM dbo.Invoice i
      LEFT JOIN dbo.ClientInvoice ci
        ON ci.Id = i.ClientInvoiceId
       AND ci.Deleted = 0
      LEFT JOIN dbo.Visit v
        ON v.Id = i.VisitId
       AND v.Deleted = 0
      LEFT JOIN dbo.Client c
        ON c.Id = COALESCE(ci.ClientId, v.ClientId)
       AND c.Deleted = 0
      LEFT JOIN dbo.[User] u
        ON u.Id = COALESCE(ci.UserId, v.UserId)
       AND u.Deleted = 0
      WHERE i.Deleted = 0
        ${paidFilter}
        AND (@startDate IS NULL OR i.CreateTime >= @startDate)
        AND (@endDate IS NULL OR i.CreateTime < DATEADD(day, 1, @endDate))
      GROUP BY
        ${clientExpression},
        ${userExpression}
           ORDER BY
        ${orderValueAlias} DESC,
        ${clientExpression} ASC,
        ${userExpression} ASC;
    `,
        bind: { startDate, endDate },
    };
}

function buildPurchaseOrderCustomerBreakdownQuery(
    intent,
    params = {},
    limit = CUSTOMER_BREAKDOWN_LIMIT
) {
    const { startDate, endDate } = params;
    const topLimit = normalizeLimit(limit);

    const valueExpressionByIntent = {
        totalPurchaseOrders: "COUNT(DISTINCT po.Id)",
        totalPurchaseOrderAmount: "SUM(ISNULL(po.TotalWithTax, 0))",
    };

    const valueAliasByIntent = {
        totalPurchaseOrders: "total",
        totalPurchaseOrderAmount: "totalAmount",
    };

    const valueExpression = valueExpressionByIntent[intent];
    const valueAlias = valueAliasByIntent[intent];

    const clientExpression = "COALESCE(c.Name, N'Müşteri bilgisi yok')";
    const userExpression = "COALESCE(u.Name, u.Email, N'Kullanıcı bilgisi yok')";

    return {
        query: `
      SELECT TOP (${topLimit})
        ${clientExpression} AS clientName,
        ${userExpression} AS userName,
        ${valueExpression} AS ${valueAlias}
      FROM dbo.PurchaseOrder po
      LEFT JOIN dbo.ClientPurchaseOrder cpo
        ON cpo.Id = po.ClientPurchaseOrderId
       AND cpo.Deleted = 0
      LEFT JOIN dbo.Visit v
        ON v.Id = po.VisitId
       AND v.Deleted = 0
      LEFT JOIN dbo.Client c
        ON c.Id = COALESCE(cpo.ClientId, v.ClientId)
       AND c.Deleted = 0
      LEFT JOIN dbo.[User] u
        ON u.Id = COALESCE(cpo.UserId, v.UserId)
       AND u.Deleted = 0
      WHERE po.Deleted = 0
        AND (@startDate IS NULL OR po.CreateTime >= @startDate)
        AND (@endDate IS NULL OR po.CreateTime < DATEADD(day, 1, @endDate))
      GROUP BY
        ${clientExpression},
        ${userExpression}
      ORDER BY
        ${valueAlias} DESC,
        ${clientExpression} ASC,
        ${userExpression} ASC;
    `,
        bind: { startDate, endDate },
    };
}

function buildInvoicePaymentCustomerBreakdownQuery(
    _intent,
    params = {},
    limit = CUSTOMER_BREAKDOWN_LIMIT
) {
    const { startDate, endDate } = params;
    const topLimit = normalizeLimit(limit);

    const clientExpression = "COALESCE(c.Name, N'Müşteri bilgisi yok')";
    const userExpression = "COALESCE(u.Name, u.Email, N'Kullanıcı bilgisi yok')";

    return {
        query: `
      SELECT TOP (${topLimit})
        ${clientExpression} AS clientName,
        ${userExpression} AS userName,
        SUM(ISNULL(ip.Amount, 0)) AS totalAmount
      FROM dbo.InvoicePayment ip
      INNER JOIN dbo.Invoice i
        ON i.Id = ip.InvoiceId
       AND i.Deleted = 0
      LEFT JOIN dbo.ClientInvoice ci
        ON ci.Id = i.ClientInvoiceId
       AND ci.Deleted = 0
      LEFT JOIN dbo.Visit v
        ON v.Id = i.VisitId
       AND v.Deleted = 0
      LEFT JOIN dbo.Client c
        ON c.Id = COALESCE(ci.ClientId, v.ClientId)
       AND c.Deleted = 0
      LEFT JOIN dbo.[User] u
        ON u.Id = COALESCE(ci.UserId, v.UserId)
       AND u.Deleted = 0
      WHERE ip.Deleted = 0
        AND (@startDate IS NULL OR ip.PaymentDate >= @startDate)
        AND (@endDate IS NULL OR ip.PaymentDate < DATEADD(day, 1, @endDate))
      GROUP BY
        ${clientExpression},
        ${userExpression}
      ORDER BY
        totalAmount DESC,
        ${clientExpression} ASC,
        ${userExpression} ASC;
    `,
        bind: { startDate, endDate },
    };
}

function buildCustomerBreakdownQuery(
    intent,
    params = {},
    limit = CUSTOMER_BREAKDOWN_LIMIT
) {
    if (
        [
            "totalInvoices",
            "totalInvoiceAmount",
            "totalInvoiceBalance",
        ].includes(intent)
    ) {
        return buildInvoiceCustomerBreakdownQuery(intent, params, limit);
    }

    if (
        [
            "totalPurchaseOrders",
            "totalPurchaseOrderAmount",
        ].includes(intent)
    ) {
        return buildPurchaseOrderCustomerBreakdownQuery(intent, params, limit);
    }

    if (intent === "totalInvoicePayments") {
        return buildInvoicePaymentCustomerBreakdownQuery(intent, params, limit);
    }

    return null;
}

async function executeSalesFinanceCustomerBreakdown({
    intent,
    params = {},
    userContext,
    metric,
    limit = CUSTOMER_BREAKDOWN_LIMIT,
} = {}) {
    if (!isSalesFinanceCustomerBreakdownIntent(intent) || !userContext || !metric) {
        return { recordset: [], rows: [], security: null };
    }

    const templateSource = {
        [intent]: (templateParams = {}) =>
            buildCustomerBreakdownQuery(intent, templateParams, limit),
    };

    return executeSecureIntent({
        intent,
        params,
        userContext,
        metric,
        templateSource,
    });
}

function getBreakdownValue(intent, row = {}) {
    if (intent === "totalInvoiceBalance") {
        return row.totalBalance ?? 0;
    }

    if (MONEY_BREAKDOWN_INTENTS.has(intent)) {
        return row.totalAmount ?? 0;
    }

    return row.total ?? 0;
}

function formatNumber(value) {
    if (value == null || Number.isNaN(Number(value))) return "-";
    return new Intl.NumberFormat("tr-TR").format(Number(value));
}

function formatMoney(value, currencySymbol = "$") {
    if (value == null || value === "" || Number.isNaN(Number(value))) return "-";

    return `${currencySymbol}${new Intl.NumberFormat("tr-TR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(Number(value))}`;
}

function isInvoiceCountIntent(intent = "") {
    return String(intent || "").trim() === "totalInvoices";
}

function formatInvoiceCountAmount(countValue, amountValue) {
    return `${formatNumber(countValue)} fatura | ${formatMoney(amountValue)}`;
}

function formatCustomerBreakdownValue(intent, value) {
    return MONEY_BREAKDOWN_INTENTS.has(intent)
        ? formatMoney(value)
        : formatNumber(value);
}

function formatCustomerBreakdownDisplay(intent, countValue, amountValue = 0) {
    if (isInvoiceCountIntent(intent)) {
        return formatInvoiceCountAmount(countValue, amountValue);
    }

    return formatCustomerBreakdownValue(intent, countValue);
}

function getCustomerBreakdownUnit(intent) {
    const labels = {
        totalInvoices: "fatura",
        totalPurchaseOrders: "sipariş",
    };

    return labels[intent] || "";
}

function formatSalesFinanceCustomerBreakdown(
    intent,
    rows = [],
    title = "Müşteri bazlı dağılım"
) {
    if (
        !isSalesFinanceCustomerBreakdownIntent(intent) ||
        !Array.isArray(rows) ||
        !rows.length
    ) {
        return "";
    }

    const unit = getCustomerBreakdownUnit(intent);
    const lines = [`${title}:`];
    const groupedByClient = new Map();

    rows.forEach((row) => {
        const clientName =
            String(row.clientName || "").trim() || "Müşteri bilgisi yok";
        const userName =
            String(row.userName || "").trim() || "Kullanıcı bilgisi yok";
        const value = Number(getBreakdownValue(intent, row) || 0);
        const amountValue = Number(row.totalAmount || 0);

        if (!groupedByClient.has(clientName)) {
            groupedByClient.set(clientName, {
                clientName,
                totalValue: 0,
                totalAmount: 0,
                users: [],
            });
        }

        const clientGroup = groupedByClient.get(clientName);
        clientGroup.totalValue += value;

        if (isInvoiceCountIntent(intent)) {
            clientGroup.totalAmount += amountValue;
        }

        clientGroup.users.push({
            userName,
            value,
            totalAmount: amountValue,
        });
    });

    const sortedClientGroups = Array.from(groupedByClient.values()).sort((a, b) => {
        if (b.totalValue !== a.totalValue) {
            return b.totalValue - a.totalValue;
        }

        return String(a.clientName).localeCompare(String(b.clientName), "tr");
    });

    sortedClientGroups.forEach((clientGroup, index) => {
        if (index > 0) {
            lines.push("");
        }

        const formattedClientValue = formatCustomerBreakdownDisplay(
            intent,
            clientGroup.totalValue,
            clientGroup.totalAmount
        );
        const clientSuffix = unit && !isInvoiceCountIntent(intent) ? ` ${unit}` : "";

        lines.push(
            `• ${clientGroup.clientName}: ${formattedClientValue}${clientSuffix}`
        );

        clientGroup.users
            .sort((a, b) => {
                if (b.value !== a.value) {
                    return b.value - a.value;
                }

                return String(a.userName).localeCompare(String(b.userName), "tr");
            })
            .forEach((user) => {
                const formattedUserValue = formatCustomerBreakdownDisplay(
                    intent,
                    user.value,
                    user.totalAmount
                );
                const userSuffix = unit && !isInvoiceCountIntent(intent) ? ` ${unit}` : "";

                lines.push(`  ↳ ${user.userName}: ${formattedUserValue}${userSuffix}`);
            });
    });

    return lines.join("\n");
}

module.exports = {
    CUSTOMER_BREAKDOWN_LIMIT,
    isSalesFinanceCustomerBreakdownIntent,
    executeSalesFinanceCustomerBreakdown,
    formatSalesFinanceCustomerBreakdown,
};