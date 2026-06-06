require("dotenv").config();

const { getEffectivePermissions } = require("../src/services/adminPermissionService");
const {
  buildScopeToolbarConfig,
  resolveScopePlanFromSelection,
} = require("../src/services/scopeSelectionService");

const BASE = process.env.TEST_BASE_URL || "http://localhost:3000";

async function login(email) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "x" }),
  });
  const data = await res.json();
  if (!data.token) {
    throw new Error(`Login failed for ${email}: ${JSON.stringify(data)}`);
  }
  return data.token;
}

async function chat(token, question, scopeSelection) {
  const body = { question };
  if (scopeSelection) {
    body.scopeSelection = scopeSelection;
  }
  const res = await fetch(`${BASE}/api/chat/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function testUnitMatrix() {
  const jon = await getEffectivePermissions(14078);
  const amer = await getEffectivePermissions(12497);
  const jonConfig = buildScopeToolbarConfig(jon);

  const companyPlan = resolveScopePlanFromSelection(
    jon,
    { mode: "company", teamScope: "all", teamIds: [] },
    "visitCountRealized"
  );
  assert(companyPlan.mode === "company", "Jon toolbar company plan");
  assert(companyPlan.source === "toolbar", "toolbar source flag");

  const withoutToolbar = resolveScopePlanFromSelection(
    jon,
    { mode: "teams", teamScope: "single", teamIds: [jonConfig.operationalTeams[0].teamId] },
    "visitCountRealized"
  );
  assert(withoutToolbar.mode === "single_team", "Jon toolbar single team");

  const amerAll = resolveScopePlanFromSelection(
    amer,
    { mode: "teams", teamScope: "all", teamIds: [] },
    "visitCountRealized"
  );
  assert(amerAll.mode === "multi_team", "Amer toolbar all teams");

  console.log("Unit matrix: OK");
}

async function testApiToolbar() {
  const jonToken = await login("jon@gmail.com");
  const amerToken = await login("1Amer.Haffar@napconational.com");
  const mireilleToken = await login("1mireille.nader@napconational.com");

  const jonCtx = await getEffectivePermissions(14078);
  const jonConfig = buildScopeToolbarConfig(jonCtx);
  const starkId = jonConfig.operationalTeams[0]?.teamId;
  assert(starkId, "Jon operational team id");

  const companyTeamIds = (jonConfig.companyTeams || [])
    .slice(0, 2)
    .map((team) => team.teamId);
  assert(companyTeamIds.length >= 2, "Jon needs 2 company teams for breakdown test");

  const cases = [
    {
      label: "Jon toolbar company (no dual)",
      token: jonToken,
      question: "ziyaret sayisi",
      scopeSelection: { mode: "company", teamScope: "all", teamIds: [] },
      expectMode: "company",
      expectDual: false,
      expectPayload: null,
    },
    {
      label: "Jon toolbar single team",
      token: jonToken,
      question: "ziyaret sayisi",
      scopeSelection: { mode: "teams", teamScope: "single", teamIds: [starkId] },
      expectMode: "single_team",
      expectPayload: "singleTeamScope",
    },
    {
      label: "Jon toolbar both (company + 1 team)",
      token: jonToken,
      question: "ziyaret sayisi",
      scopeSelection: {
        mode: "both",
        teamsActive: true,
        companyActive: true,
        teamScope: "single",
        teamIds: [starkId],
      },
      expectMode: "company_team_breakdown",
      expectDual: false,
      expectPayload: "companyTeamScope",
      expectMembers: true,
    },
    {
      label: "Jon toolbar both (company + all teams)",
      token: jonToken,
      question: "ziyaret sayisi",
      scopeSelection: {
        mode: "both",
        teamsActive: true,
        companyActive: true,
        teamScope: "all",
        teamIds: [],
      },
      expectMode: "company_team_breakdown",
      expectDual: false,
      expectPayload: "companyTeamScope",
      expectCombinedMatchesCompany: true,
    },
    {
      label: "Jon toolbar company + teams",
      token: jonToken,
      question: "ziyaret sayisi",
      scopeSelection: {
        mode: "company",
        teamScope: "multi",
        teamIds: companyTeamIds,
      },
      expectMode: "company_team_breakdown",
      expectPayload: "companyTeamScope",
    },
    {
      label: "Amer toolbar all teams",
      token: amerToken,
      question: "ziyaret sayisi",
      scopeSelection: { mode: "teams", teamScope: "all", teamIds: [] },
      expectMode: "multi_team",
      expectPayload: "multiTeamScope",
    },
    {
      label: "Mireille toolbar company",
      token: mireilleToken,
      question: "ziyaret sayisi",
      scopeSelection: { mode: "company", teamScope: "all", teamIds: [] },
      expectMode: "company",
      expectDual: false,
    },
  ];

  for (const testCase of cases) {
    const data = await chat(testCase.token, testCase.question, testCase.scopeSelection);
    assert(
      data.scopePlan?.mode === testCase.expectMode,
      `${testCase.label}: expected mode ${testCase.expectMode}, got ${data.scopePlan?.mode}`
    );
    assert(
      data.scopePlan?.source === "toolbar",
      `${testCase.label}: scopePlan.source should be toolbar`
    );

    if (testCase.expectDual === false) {
      assert(!data.dualScope, `${testCase.label}: dualScope should be absent`);
    }

    if (testCase.expectPayload) {
      assert(data[testCase.expectPayload], `${testCase.label}: missing ${testCase.expectPayload}`);
    }

    if (testCase.expectMembers) {
      assert(
        data.companyTeamScope?.includeMemberBreakdown,
        `${testCase.label}: expected member breakdown`
      );
      assert(
        (data.companyTeamScope?.members || []).length > 0,
        `${testCase.label}: expected member rows`
      );
    }

    if (testCase.expectCombinedMatchesCompany) {
      const companyTotal =
        data.companyTeamScope?.company?.rows?.[0]?.total ??
        data.companyTeamScope?.company?.rows?.[0]?.totalUsers;
      const combinedTotal =
        data.companyTeamScope?.selectedCombined?.rows?.[0]?.total ??
        data.companyTeamScope?.selectedCombined?.rows?.[0]?.totalUsers;
      assert(
        companyTotal != null && combinedTotal === companyTotal,
        `${testCase.label}: Toplam should match company (${combinedTotal} vs ${companyTotal})`
      );
    }

    console.log(`API OK: ${testCase.label} -> ${data.scopePlan.mode}`);
  }

  const jonNoToolbar = await chat(jonToken, "ziyaret sayisi");
  assert(
    jonNoToolbar.scopePlan?.mode === "dual",
    `Jon without toolbar should still dual, got ${jonNoToolbar.scopePlan?.mode}`
  );
  assert(jonNoToolbar.dualScope, "Jon without toolbar should return dualScope");
  console.log("API OK: Jon without toolbar still dual (legacy fallback)");
}

async function main() {
  console.log("Scope toolbar integration test\n");
  await testUnitMatrix();
  await testApiToolbar();
  console.log("\nAll scope toolbar integration tests passed.");
}

main().catch((err) => {
  console.error("\nFAILED:", err.message);
  process.exit(1);
});
