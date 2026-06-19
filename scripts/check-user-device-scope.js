const { queryDb } = require("../src/db/sql");

async function run() {
  const company = await queryDb({
    query: `
      SELECT COUNT(1) AS total
      FROM dbo.UserDevice ud
      INNER JOIN dbo.[User] u
        ON u.Id = ud.UserId
       AND u.Deleted = 0
      WHERE ud.Deleted = 0
        AND u.SubscriptionId = 1515;
    `,
    bind: {},
  });

  const stark = await queryDb({
    query: `
      SELECT COUNT(1) AS total
      FROM dbo.UserDevice ud
      INNER JOIN dbo.[User] u
        ON u.Id = ud.UserId
       AND u.Deleted = 0
      INNER JOIN dbo.UserTeam ut
        ON ut.UserId = u.Id
       AND ut.Deleted = 0
       AND ut.TeamId = 1464
      WHERE ud.Deleted = 0
        AND u.SubscriptionId = 1515;
    `,
    bind: {},
  });

  console.log("Intern Demo devices:", company.recordset[0]?.total);
  console.log("Stark team devices:", stark.recordset[0]?.total);
}

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
