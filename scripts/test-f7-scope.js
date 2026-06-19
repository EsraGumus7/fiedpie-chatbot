require("dotenv").config();

const { resolveScopePlan } = require("../src/services/scopeContextService");
const { parseQuestionFilters } = require("../src/services/questionFilterService");
const { getEffectivePermissions } = require("../src/services/adminPermissionService");

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

async function chat(token, question) {
  const res = await fetch(`${BASE}/api/chat/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ question }),
  });
  return res.json();
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function testPlanUnit() {
  const amerCtx = await getEffectivePermissions(12497);
  const jonCtx = await getEffectivePermissions(14078);

  const amerGeneric = resolveScopePlan(amerCtx, "ziyaret sayisi", "visitCountRealized");
  assert(amerGeneric.mode === "multi_team", `Amer generic: expected multi_team, got ${amerGeneric.mode}`);

  const amerRodolfo = resolveScopePlan(
    amerCtx,
    "Rodolfo takimi ziyaret sayisi",
    "visitCountRealized"
  );
  assert(amerRodolfo.mode === "single_team", `Amer Rodolfo: expected single_team, got ${amerRodolfo.mode}`);
  assert(amerRodolfo.display === "team_detail", "Amer Rodolfo display");
  assert(amerRodolfo.includeMemberBreakdown === true, "Amer Rodolfo member breakdown");

  const amerStatus = resolveScopePlan(
    amerCtx,
    "tamamlanan ve bekleyen ziyaret",
    "visitsByCompletionStatus"
  );
  assert(amerStatus.mode === "multi_team", `Amer status: expected multi_team, got ${amerStatus.mode}`);
  assert(amerStatus.display === "breakdown", "Amer status display");

  const amerCompany = resolveScopePlan(
    amerCtx,
    "sirket ziyaret sayisi",
    "visitCountRealized"
  );
  assert(amerCompany.mode === "denied", `Amer company: expected denied, got ${amerCompany.mode}`);

  const jonGeneric = resolveScopePlan(jonCtx, "ziyaret sayisi", "visitCountRealized");
  assert(jonGeneric.mode === "dual", `Jon generic: expected dual, got ${jonGeneric.mode}`);

  const jonStark = resolveScopePlan(jonCtx, "Stark ziyaret sayisi", "visitCountRealized");
  assert(jonStark.mode === "single_team", `Jon Stark: expected single_team, got ${jonStark.mode}`);

  const filters = parseQuestionFilters(
    "Rodolfo bugun bekleyen ziyaret",
    "visitsByCompletionStatus",
    { startDate: "2026-06-04", endDate: "2026-06-04" }
  );
  assert(filters.visitRealized === undefined || filters.visitRealized === null, "no visitRealized filter on status intent");

  console.log("Unit tests: OK");
}

async function testApi() {
  const amerToken = await login("1Amer.Haffar@napconational.com");
  const jonToken = await login("jon@gmail.com");

  const cases = [
    {
      token: amerToken,
      question: "Rodolfo takimi ziyaret sayisi",
      expectMode: "single_team",
      expectDisplay: "team_detail",
      expectIntent: "visitCountRealized",
      expectMemberBreakdown: true,
    },
    {
      token: amerToken,
      question: "rodolfo ziyaret sayisi",
      expectMode: "single_team",
      expectIntent: "visitCountRealized",
    },
    {
      token: amerToken,
      question: "ziyaret sayisi",
      expectMode: "multi_team",
      expectDisplay: "breakdown",
      expectIntent: "visitCountRealized",
      expectMultiTeam: true,
    },
    {
      token: amerToken,
      question: "Rodolfo bugun bekleyen ziyaret",
      expectMode: "single_team",
      expectIntent: "visitsByCompletionStatus",
      expectRowsMin: 2,
    },
    {
      token: amerToken,
      question: "tamamlanan ve bekleyen ziyaret",
      expectMode: "multi_team",
      expectDisplay: "breakdown",
      expectIntent: "visitsByCompletionStatus",
      expectMultiTeam: true,
      expectTeamCount: 5,
    },
    {
      token: amerToken,
      question: "sirket ziyaret sayisi",
      expectMode: "denied",
    },
    {
      token: jonToken,
      question: "Stark ziyaret sayisi",
      expectMode: "single_team",
    },
    {
      token: jonToken,
      question: "ziyaret sayisi",
      expectMode: "dual",
      expectDisplay: "dual",
    },
  ];

  for (const testCase of cases) {
    const result = await chat(testCase.token, testCase.question);
    const mode = result.scopePlan?.mode;
    assert(
      mode === testCase.expectMode,
      `[${testCase.question}] expected mode ${testCase.expectMode}, got ${mode}. answer: ${result.answer}`
    );
    if (testCase.expectDisplay) {
      assert(
        result.scopePlan?.display === testCase.expectDisplay,
        `[${testCase.question}] expected display ${testCase.expectDisplay}, got ${result.scopePlan?.display}`
      );
    }
    if (testCase.expectIntent) {
      assert(result.intent === testCase.expectIntent, `intent mismatch for ${testCase.question}: ${result.intent}`);
    }
    if (testCase.expectRowsMin) {
      assert(
        (result.rows || []).length >= testCase.expectRowsMin,
        `expected at least ${testCase.expectRowsMin} rows for ${testCase.question}, got ${(result.rows || []).length}`
      );
    }
    if (testCase.expectMultiTeam) {
      assert(result.multiTeamScope?.teams?.length, `expected multiTeamScope for ${testCase.question}`);
    }
    if (testCase.expectTeamCount) {
      assert(
        result.multiTeamScope?.teams?.length === testCase.expectTeamCount,
        `expected ${testCase.expectTeamCount} teams, got ${result.multiTeamScope?.teams?.length}`
      );
      const combined = result.multiTeamScope?.combined?.rows || [];
      const states = combined.map((row) => row.visitState);
      assert(states.includes("Tamamlanan"), "combined missing Tamamlanan");
      assert(states.includes("Bekleyen"), "combined missing Bekleyen");
    }
    if (testCase.expectMemberBreakdown) {
      assert(
        Array.isArray(result.singleTeamScope?.members) &&
          result.singleTeamScope.members.length > 0,
        `expected member breakdown for ${testCase.question}`
      );
      assert(
        result.singleTeamScope.memberTotalCount === result.singleTeamScope.members.length,
        "memberTotalCount mismatch"
      );
      assert(result.singleTeamScope.displayLimit === 15, "displayLimit should be 15");
    }
    console.log(`API OK: "${testCase.question}" -> ${mode} / ${result.scopePlan?.display || "-"}`);
  }
}

async function main() {
  console.log("F7 scope test suite\n");
  await testPlanUnit();
  await testApi();
  console.log("\nAll tests passed.");
}

main().catch((err) => {
  console.error("\nFAILED:", err.message);
  process.exit(1);
});
