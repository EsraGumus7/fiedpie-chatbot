require("dotenv").config();

const { resolveScopePlan } = require("../src/services/scopeContextService");
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
  const jonCtx = await getEffectivePermissions(14078);

  assert(jonCtx.isHybridScopeUser, "Jon hibrit olmali");
  assert(
    (jonCtx.subscriptionTeams || []).length >= 1,
    "Jon icin subscriptionTeams yuklenmeli"
  );

  const subscriptionTeamQuery = resolveScopePlan(
    jonCtx,
    "intern-test-team-1 ziyaret sayisi",
    "visitCountRealized"
  );
  assert(
    subscriptionTeamQuery.mode === "single_team",
    `Hibrit admin subscription takimi: expected single_team, got ${subscriptionTeamQuery.mode}`
  );

  const distributionDual = resolveScopePlan(
    jonCtx,
    "tamamlanan ve bekleyen ziyaret",
    "visitsByCompletionStatus"
  );
  assert(
    distributionDual.mode === "dual",
    `Distribution dual: expected dual, got ${distributionDual.mode}`
  );

  const hybridBreakdown = resolveScopePlan(
    jonCtx,
    "takim bazinda ziyaret sayisi",
    "visitCountRealized"
  );
  assert(
    hybridBreakdown.mode === "multi_team",
    `Hybrid breakdown: expected multi_team, got ${hybridBreakdown.mode}`
  );
  assert(
    hybridBreakdown.scopeSource === "subscription",
    "Hybrid breakdown scopeSource"
  );

  const companyBreakdown = resolveScopePlan(
    jonCtx,
    "sirket takim bazinda ziyaret sayisi",
    "visitCountRealized"
  );
  assert(
    companyBreakdown.mode === "multi_team",
    `Company breakdown: expected multi_team, got ${companyBreakdown.mode}`
  );
  assert(
    companyBreakdown.scopeSource === "subscription",
    "Company breakdown scopeSource"
  );

  const stark = resolveScopePlan(jonCtx, "Stark ziyaret sayisi", "visitCountRealized");
  assert(stark.mode === "single_team", `Stark: expected single_team, got ${stark.mode}`);

  console.log("Unit tests: OK");
}

async function testApi() {
  const jonToken = await login("jon@gmail.com");

  const cases = [
    {
      question: "intern-test-team-1 ziyaret sayisi",
      expectMode: "denied",
      expectDenyReason: "team_out_of_operational_scope",
    },
    {
      question: "ziyaret sayisi",
      expectMode: "dual",
      expectDisplay: "dual",
    },
    {
      question: "tamamlanan ve bekleyen ziyaret",
      expectMode: "dual",
      expectDisplay: "dual",
    },
    {
      question: "takim bazinda ziyaret sayisi",
      expectMode: "multi_team",
      expectDisplay: "breakdown",
      expectMultiTeam: true,
      minTeamCount: 2,
    },
    {
      question: "sirket takim bazinda ziyaret sayisi",
      expectMode: "multi_team",
      expectDisplay: "breakdown",
      expectMultiTeam: true,
      minTeamCount: 2,
    },
    {
      question: "Stark ziyaret sayisi",
      expectMode: "single_team",
    },
  ];

  for (const testCase of cases) {
    const result = await chat(jonToken, testCase.question);
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

    if (testCase.expectDenyReason) {
      assert(
        result.scopePlan?.denyReason === testCase.expectDenyReason,
        `[${testCase.question}] denyReason mismatch`
      );
      assert(
        /yonetim kapsaminizda degil/i.test(result.answer || ""),
        `[${testCase.question}] expected out-of-scope message`
      );
    }

    if (testCase.expectMultiTeam) {
      assert(
        result.multiTeamScope?.teams?.length >= (testCase.minTeamCount || 1),
        `[${testCase.question}] expected multiTeamScope, got ${result.multiTeamScope?.teams?.length}`
      );
      assert(
        result.multiTeamScope?.scopeSource === "subscription",
        `[${testCase.question}] scopeSource should be subscription`
      );
    }

    if (testCase.expectMode === "dual") {
      assert(result.dualScope?.operational, `[${testCase.question}] missing operational dual`);
      assert(result.dualScope?.company, `[${testCase.question}] missing company dual`);
    }

    console.log(`API OK: "${testCase.question}" -> ${mode} / ${result.scopePlan?.display || "-"}`);
  }
}

async function main() {
  console.log("Hybrid scope test suite\n");
  await testPlanUnit();
  await testApi();
  console.log("\nAll hybrid scope tests passed.");
}

main().catch((err) => {
  console.error("\nFAILED:", err.message);
  process.exit(1);
});
