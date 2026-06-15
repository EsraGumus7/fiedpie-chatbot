require("dotenv").config();
const { queryDb } = require("../src/db/sql");

async function findTeamLeaders(subId) {
  const result = await queryDb({
    query: `
      SELECT TOP 10
        u.Id AS userId,
        u.Email,
        u.Name,
        u.SubscriptionId,
        s.CompanyName,
        COUNT(DISTINCT ut.TeamId) AS managedTeamCount,
        MIN(t.Id) AS teamId,
        MIN(t.Name) AS teamName,
        (
          SELECT COUNT(DISTINCT ut2.UserId)
          FROM dbo.UserTeam ut2
          WHERE ut2.TeamId = MIN(t.Id)
            AND ut2.Deleted = 0
        ) AS teamMemberCountBroken
      FROM dbo.[User] u
      INNER JOIN dbo.UserTeam ut
        ON ut.UserId = u.Id
       AND ut.Manager = 1
       AND ut.Deleted = 0
      INNER JOIN dbo.Team t
        ON t.Id = ut.TeamId
       AND t.Deleted = 0
      LEFT JOIN dbo.Subscription s
        ON s.Id = u.SubscriptionId
       AND s.Deleted = 0
      WHERE u.Deleted = 0
        AND u.Blocked = 0
        AND u.SubscriptionId = @subId
      GROUP BY u.Id, u.Email, u.Name, u.SubscriptionId, s.CompanyName
      HAVING COUNT(DISTINCT ut.TeamId) = 1
      ORDER BY u.Name;
    `,
    bind: { subId },
  });

  return result.recordset;
}

async function enrichWithTeamMembers(subId, userId, teamId) {
  const members = await queryDb({
    query: `
      SELECT COUNT(DISTINCT ut.UserId) AS memberCount
      FROM dbo.UserTeam ut
      INNER JOIN dbo.[User] u ON u.Id = ut.UserId AND u.Deleted = 0
      WHERE ut.TeamId = @teamId
        AND ut.Deleted = 0
        AND u.SubscriptionId = @subId;
    `,
    bind: { teamId, subId },
  });

  const visits = await queryDb({
    query: `
      SELECT COUNT(1) AS visitCount
      FROM dbo.Visit v
      INNER JOIN dbo.UserTeam ut ON ut.UserId = v.UserId AND ut.TeamId = @teamId AND ut.Deleted = 0
      WHERE v.Deleted = 0
        AND v.Realized = 1
        AND v.SubscriptionId = @subId;
    `,
    bind: { teamId, subId },
  });

  return {
    memberCount: members.recordset[0]?.memberCount ?? 0,
    teamVisitCount: visits.recordset[0]?.visitCount ?? 0,
  };
}

async function main() {
  for (const subId of [1515, 1238]) {
    console.log(`\n=== Subscription ${subId} — L2 (tek takım lideri) ===`);
    const leaders = await findTeamLeaders(subId);

    if (!leaders.length) {
      console.log("Tek takımlı yönetici bulunamadı.");
      continue;
    }

    for (const leader of leaders.slice(0, 5)) {
      const teamId = leader.teamId;
      const extra = await enrichWithTeamMembers(subId, leader.userId, teamId);
      console.log({
        userId: leader.userId,
        email: leader.Email,
        name: leader.Name,
        company: leader.CompanyName,
        teamId,
        teamName: leader.teamName,
        managedTeamCount: leader.managedTeamCount,
        teamMembers: extra.memberCount,
        teamRealizedVisits: extra.teamVisitCount,
      });
    }
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
