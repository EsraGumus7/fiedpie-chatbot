require("dotenv").config();

const { getEffectivePermissions } = require("../src/services/adminPermissionService");
const {
  buildScopeToolbarConfig,
  normalizeScopeSelection,
  resolveScopePlanFromSelection,
} = require("../src/services/scopeSelectionService");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  console.log("Scope toolbar plan test\n");

  const jon = await getEffectivePermissions(14078);
  const amer = await getEffectivePermissions(12497);
  const mireille = await getEffectivePermissions(12942);
  const bran = await getEffectivePermissions(14081);

  const jonConfig = buildScopeToolbarConfig(jon);
  const amerConfig = buildScopeToolbarConfig(amer);
  assert(jonConfig.operationalTeams.length === 1, "Jon has 1 operational team");
  assert(jonConfig.companyTeams.length >= 1, "Jon has company teams");

  const jonCompany = resolveScopePlanFromSelection(
    jon,
    { mode: "company", teamScope: "all", teamIds: [] },
    "visitCountRealized"
  );
  assert(jonCompany.mode === "company", "Jon company plan");
  assert(jonCompany.source === "toolbar", "toolbar source");

  const jonTeams = resolveScopePlanFromSelection(
    jon,
    { mode: "teams", teamScope: "single", teamIds: [jonConfig.operationalTeams[0].teamId] },
    "visitCountRealized"
  );
  assert(jonTeams.mode === "single_team", "Jon single team plan");

  const jonCompanyMulti = resolveScopePlanFromSelection(
    jon,
    {
      mode: "company",
      teamScope: "multi",
      teamIds: jonConfig.companyTeams.slice(0, 2).map((t) => t.teamId),
    },
    "visitCountRealized"
  );
  assert(jonCompanyMulti.mode === "company_team_breakdown", "Jon company+2 teams");

  const amerAll = resolveScopePlanFromSelection(
    amer,
    { mode: "teams", teamScope: "all", teamIds: [], teamsActive: true },
    "visitCountRealized"
  );
  assert(amerAll.mode === "multi_team", "Amer all teams");
  assert(amerAll.scopeSource === "managed", "Amer managed source");

  const amerPartial = resolveScopePlanFromSelection(
    amer,
    {
      mode: "teams",
      teamScope: "multi",
      teamIds: amerConfig.operationalTeams.slice(0, 2).map((t) => t.teamId),
      teamsActive: true,
    },
    "visitCountRealized"
  );
  assert(amerPartial.mode === "multi_team", "Amer partial teams");
  assert(amerPartial.scopeSource === "selected", "Amer selected source");
  assert(amerPartial.teamIds.length === 2, "Amer 2 team ids");

  const mireilleCompany = resolveScopePlanFromSelection(
    mireille,
    { mode: "company", teamScope: "all", teamIds: [] },
    "visitCountRealized"
  );
  assert(mireilleCompany.mode === "company", "Mireille company");

  const jonBothEmpty = resolveScopePlanFromSelection(
    jon,
    { mode: "both", teamsActive: true, companyActive: true, teamScope: "none", teamIds: [] },
    "visitCountRealized"
  );
  assert(jonBothEmpty.mode === "scope_pick_required", "Jon both without team pick -> scope_pick_required");

  const jonBoth = resolveScopePlanFromSelection(
    jon,
    { mode: "both", teamsActive: true, companyActive: true, teamScope: "all", teamIds: [] },
    "visitCountRealized"
  );
  assert(jonBoth.mode === "company_team_breakdown", "Jon both with all teams -> company_team_breakdown");
  assert(jonBoth.teamIds.length >= 1, "Jon both resolves team ids");

  const jonBothSingle = resolveScopePlanFromSelection(
    jon,
    {
      mode: "both",
      teamsActive: true,
      companyActive: true,
      teamScope: "single",
      teamIds: [jonConfig.operationalTeams[0].teamId],
    },
    "visitCountRealized"
  );
  assert(
    jonBothSingle.mode === "company_team_breakdown",
    "Jon both with single team -> company_team_breakdown"
  );
  assert(jonBothSingle.teamIds.length === 1, "Jon both single keeps one team id");
  assert(jonBothSingle.includeMemberBreakdown === true, "Jon company+1 team includes members");

  assert(
    jonCompanyMulti.includeMemberBreakdown !== true,
    "Jon company+2 teams skips member breakdown"
  );

  const normalizedLocked = normalizeScopeSelection(
    { mode: "company", teamScope: "all", teamIds: [] },
    buildScopeToolbarConfig(amer)
  );
  assert(normalizedLocked.mode === "teams", "Amer company selection falls back to teams");

  const branConfig = buildScopeToolbarConfig(bran);
  assert(branConfig.operationalLevel <= 1, "Bran is L1");
  assert(branConfig.teamsButton.locked === true, "Bran teams locked");
  assert(branConfig.companyButton.locked === true, "Bran company locked");
  assert(branConfig.allowDualScopeSelect === false, "Bran no dual select");

  const branBothAttempt = normalizeScopeSelection(
    { teamsActive: true, companyActive: true, teamScope: "none", teamIds: [] },
    branConfig
  );
  assert(branBothAttempt.mode === "self", "L1 both-active selection falls back to self");

  const branPlan = resolveScopePlanFromSelection(
    bran,
    { teamsActive: true, companyActive: true, teamScope: "none", teamIds: [] },
    "visitCountRealized"
  );
  assert(branPlan.mode === "self", "L1 plan never scope_pick_required");
  assert(branPlan.mode !== "scope_pick_required", "L1 skips pick-required message");

  console.log("Plan matrix OK:");
  console.log("- Jon company:", jonCompany.mode);
  console.log("- Jon single:", jonTeams.mode);
  console.log("- Jon both:", jonBoth.mode);
  console.log("- Amer all:", amerAll.mode);
  console.log("- Mireille company:", mireilleCompany.mode);

  console.log("\nAll scope toolbar plan tests passed.");
}

main().catch((err) => {
  console.error("\nFAILED:", err.message);
  process.exit(1);
});
