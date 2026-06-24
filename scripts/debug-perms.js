require("dotenv").config();
const { queryDb } = require("../src/db/sql");
const { getUserIntents } = require("../src/services/userPermissionStore");
const { getEffectivePermissions, getUserPermissions } = require("../src/services/adminPermissionService");

async function main() {
  const email = process.argv[2] || "jon@gmail.com";

  const userRes = await queryDb({
    query: `
      SELECT TOP 1 Id, Email, Name, SubscriptionId, Admin
      FROM dbo.[User]
      WHERE Email = @email AND Deleted = 0
    `,
    bind: { email },
  });
  const user = userRes.recordset[0];
  console.log("USER:", user || "NOT FOUND");
  if (!user) return;

  console.log("FILE intents:", getUserIntents(user.Id));
  console.log("getUserPermissions:", await getUserPermissions(user.Id));

  const effective = await getEffectivePermissions(user.Id);
  console.log("effective allowedIntents:", effective.allowedIntents);
  console.log("effective directAllowedIntents:", effective.directAllowedIntents);
  console.log("effective roleIds:", effective.roleIds);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
