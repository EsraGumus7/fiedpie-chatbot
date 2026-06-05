require("dotenv").config({ quiet: true });
const { queryDb } = require("../src/db/sql");
const { writeAuditLog, getAuditLogs } = require("../src/services/adminPermissionService");

async function main() {
  const t = await queryDb({
    query: "SELECT OBJECT_ID('dbo.AiAuditLog', 'U') AS tableId",
    bind: {},
  });
  console.log("AiAuditLog exists:", !!t.recordset[0]?.tableId);

  try {
    const rows = await queryDb({
      query: "SELECT TOP 3 * FROM dbo.AiAuditLog ORDER BY Id DESC",
      bind: {},
    });
    console.log("rows:", rows.recordset.length);
  } catch (e) {
    console.log("select error:", e.message);
  }
}

main().catch((e) => console.error(e.message));
