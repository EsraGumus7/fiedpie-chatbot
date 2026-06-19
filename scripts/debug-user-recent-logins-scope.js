async function run() {
  const base = process.env.API_BASE || "http://localhost:3000";
  const email = process.env.TEST_EMAIL || "nilaybsl@evatro.com";
  const password = process.env.TEST_PASSWORD || "1463";

  const login = await (
    await fetch(`${base}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    })
  ).json();

  if (!login.token) {
    console.log("LOGIN FAIL", login);
    process.exit(1);
  }

  const token = login.token;
  const me = await (
    await fetch(`${base}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json();
  const teams = me.context?.subscriptionTeams || me.context?.operationalTeams || [];
  const stark = teams.find((team) => /stark/i.test(team.teamName || team.name || ""));

  console.log(`Logged in as ${login.user?.name}`);
  console.log("Stark team:", stark);

  const scopeSelection = {
    teamsActive: true,
    companyActive: true,
    mode: "both",
    teamScope: stark ? "single" : "all",
    teamIds: stark ? [stark.teamId || stark.id] : [],
  };

  const res = await fetch(`${base}/api/chat/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      question: "en son kimler giris yapmis",
      scopeSelection,
    }),
  });

  const data = await res.json();
  const cts = data.companyTeamScope;

  console.log("Intent:", data.intent);
  console.log("Scope plan:", data.scopePlan?.mode);

  if (!cts) {
    console.log("No companyTeamScope payload");
    console.log("Answer:", data.answer);
    process.exit(1);
  }

  const companyRows = cts.company?.rows || [];
  const teamRows = (cts.teams || [])[0]?.rows || [];
  const sql = String(data.sql || "");

  console.log("Company row count:", companyRows.length);
  console.log("Team row count:", teamRows.length);
  console.log("SQL has subscription scope:", /u_scope\.SubscriptionId/i.test(sql));
  console.log("SQL has user scope:", /scopeUlUser/i.test(sql));
  console.log("Company userIds:", [...new Set(companyRows.map((row) => row.userId))].slice(0, 8));
  console.log("Team userIds:", [...new Set(teamRows.map((row) => row.userId))].slice(0, 8));
  console.log("Answer:\n", data.answer);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
