require("dotenv").config();

const { getEffectivePermissions } = require("../src/services/adminPermissionService");
const { resolveScopePlan } = require("../src/services/scopeContextService");

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

async function main() {
  console.log("L4 Adim 3: takim bazinda breakdown testi\n");

  const ctx = await getEffectivePermissions(12942);
  const breakdownQuestion = "takim bazinda ziyaret sayisi";
  const plan = resolveScopePlan(ctx, breakdownQuestion, "visitCountRealized");
  assert(plan.mode === "multi_team", `unit mode multi_team, got ${plan.mode}`);
  assert(plan.display === "breakdown", "unit display breakdown");
  assert(plan.scopeSource === "subscription", "unit scopeSource subscription");
  console.log(`Unit OK: "${breakdownQuestion}" -> ${plan.mode} / ${plan.scopeSource}`);

  const genericPlan = resolveScopePlan(ctx, "ziyaret sayisi", "visitCountRealized");
  assert(genericPlan.mode !== "multi_team", "genel soru multi_team olmamali");
  console.log(`Unit OK: "ziyaret sayisi" -> ${genericPlan.mode}`);

  const token = await login("1mireille.nader@napconational.com");

  const result = await chat(token, breakdownQuestion);
  assert(
    result.scopePlan?.mode === "multi_team",
    `api mode multi_team, got ${result.scopePlan?.mode}`
  );
  assert(
    result.multiTeamScope?.scopeSource === "subscription",
    "api scopeSource subscription"
  );
  assert(
    (result.multiTeamScope?.teams || []).length >= 10,
    `expected many teams, got ${result.multiTeamScope?.teams?.length}`
  );
  assert(result.multiTeamScope?.hasMoreTeams === true, "hasMoreTeams true");
  assert(result.multiTeamScope?.displayLimit === 15, "displayLimit 15");
  assert((result.multiTeamScope?.combined?.rows || []).length >= 1, "combined rows");
  console.log(
    `API OK: "${breakdownQuestion}" -> ${result.multiTeamScope.teams.length} takim + sirket toplami`
  );

  const generic = await chat(token, "ziyaret sayisi");
  assert(generic.scopePlan?.mode !== "multi_team", "genel soru api multi_team olmamali");
  console.log(`API OK: "ziyaret sayisi" -> ${generic.scopePlan?.mode}`);

  console.log("\nL4 Adim 3: OK");
}

main().catch((err) => {
  console.error("\nFAILED:", err.message);
  process.exit(1);
});
