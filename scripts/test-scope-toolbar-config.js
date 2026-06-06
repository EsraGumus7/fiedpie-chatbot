require("dotenv").config();

const { getEffectivePermissions } = require("../src/services/adminPermissionService");
const {
  buildScopeToolbarConfig,
  normalizeScopeSelection,
} = require("../src/services/scopeSelectionService");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  console.log("Scope toolbar config test\n");

  const jon = await getEffectivePermissions(14078);
  const amer = await getEffectivePermissions(12497);
  const mireille = await getEffectivePermissions(12942);

  const personas = [
    ["Jon hibrit", jon],
    ["Amer L3", amer],
    ["Mireille L4", mireille],
  ];

  for (const [label, ctx] of personas) {
    const config = buildScopeToolbarConfig(ctx);
    console.log(label, {
      level: config.operationalLevel,
      teamsLocked: config.teamsButton.locked,
      companyLocked: config.companyButton.locked,
      allowDual: config.allowDualScopeSelect,
      teamCount: config.teams.length,
      default: config.defaultSelection,
    });
  }

  const jonConfig = buildScopeToolbarConfig(jon);
  assert(jonConfig.teamsButton.visible === true, "Jon teams always shown");
  assert(jonConfig.companyButton.visible === true, "Jon company always shown");
  assert(jonConfig.teamsButton.locked === false, "Jon teams unlocked");
  assert(jonConfig.companyButton.locked === false, "Jon company unlocked");
  assert(jonConfig.allowDualScopeSelect === true, "Jon dual select");
  assert(jonConfig.operationalTeams.length >= 1, "Jon operational teams");

  const amerConfig = buildScopeToolbarConfig(amer);
  assert(amerConfig.companyButton.visible === true, "Amer company always shown");
  assert(amerConfig.companyButton.locked === true, "Amer company locked");
  assert(amerConfig.teamsButton.visible === true, "Amer teams always shown");
  assert(amerConfig.teamsButton.locked === false, "Amer teams unlocked");
  assert(amerConfig.allowDualScopeSelect === false, "Amer no dual select");
  assert(amerConfig.defaultSelection.mode === "teams", "Amer default teams");
  assert(amerConfig.defaultSelection.teamScope === "all", "Amer default all teams");

  const mireilleConfig = buildScopeToolbarConfig(mireille);
  assert(mireilleConfig.defaultSelection.mode === "both", "L4 default company+all teams");
  assert(mireilleConfig.defaultSelection.teamScope === "all", "L4 default all teams");
  assert(jonConfig.defaultSelection.mode === "both", "Jon default company+all teams");
  assert(mireilleConfig.teamsButton.locked === false, "L4 teams unlocked");
  assert(mireilleConfig.companyButton.locked === false, "L4 company unlocked");
  assert(mireilleConfig.allowDualScopeSelect === true, "L4 dual select");

  const companyPlusThree = normalizeScopeSelection(
    {
      mode: "company",
      teamScope: "multi",
      teamIds: mireilleConfig.companyTeams.slice(0, 3).map((t) => t.teamId),
    },
    mireilleConfig
  );
  assert(companyPlusThree.mode === "company", "company+3 mode");
  assert(companyPlusThree.teamIds.length === 3, "company+3 teamIds preserved");

  console.log("\nAll scope toolbar config tests passed.");
}

main().catch((err) => {
  console.error("\nFAILED:", err.message);
  process.exit(1);
});
