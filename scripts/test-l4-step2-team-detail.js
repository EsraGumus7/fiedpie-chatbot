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
  console.log("L4 Adim 2: takim adi + uye kirilimi testi\n");

  const ctx = await getEffectivePermissions(12942);
  assert(ctx.isPureCompanyScopeUser, "Mireille saf L4 olmali");
  assert((ctx.subscriptionTeams || []).length > 0, "subscriptionTeams bos");

  function pickUniqueTeamToken(name) {
    return String(name || "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((part) => part.length >= 5)
      .sort((a, b) => b.length - a.length)[0];
  }

  const sampleTeam = ctx.subscriptionTeams[0];
  const uniqueToken = pickUniqueTeamToken(sampleTeam.teamName);

  assert(uniqueToken, "Ornek takim tokeni bulunamadi");

  const questions = [
    `${sampleTeam.teamName} ziyaret sayisi`,
    `${uniqueToken} ziyaret sayisi`,
  ];

  for (const question of questions) {
    const plan = resolveScopePlan(ctx, question, "visitCountRealized");
    assert(
      plan.mode === "single_team",
      `[unit] "${question}" -> expected single_team, got ${plan.mode}`
    );
    assert(plan.display === "team_detail", `[unit] display team_detail olmali`);
    console.log(`Unit OK: "${question}" -> ${plan.mode} / ${plan.display}`);
  }

  const token = await login("1mireille.nader@napconational.com");

  for (const question of questions) {
    const result = await chat(token, question);
    assert(
      result.scopePlan?.mode === "single_team",
      `[api] "${question}" -> expected single_team, got ${result.scopePlan?.mode}. answer: ${result.answer}`
    );
    assert(
      result.scopePlan?.display === "team_detail",
      `[api] display team_detail olmali for "${question}"`
    );
    assert(
      Array.isArray(result.singleTeamScope?.members) &&
        result.singleTeamScope.members.length > 0,
      `[api] member breakdown bekleniyor for "${question}"`
    );
    assert(
      result.singleTeamScope?.teamName,
      `[api] teamName eksik for "${question}"`
    );
    console.log(
      `API OK: "${question}" -> team=${result.singleTeamScope.teamName}, members=${result.singleTeamScope.members.length}`
    );
  }

  const generic = await chat(token, "ziyaret sayisi");
  assert(
    generic.scopePlan?.mode !== "single_team",
    "Genel soru single_team olmamali"
  );
  assert(!generic.multiTeamScope?.teams?.length, "Genel soru multi_team olmamali (Adim 3)");
  console.log(`API OK: "ziyaret sayisi" -> ${generic.scopePlan?.mode} (tek sirket toplami)`);

  console.log("\nL4 Adim 2: OK");
}

main().catch((err) => {
  console.error("\nFAILED:", err.message);
  process.exit(1);
});
