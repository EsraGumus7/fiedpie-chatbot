require("dotenv").config();

const { spawnSync } = require("child_process");
const path = require("path");

const scripts = [
  "test-l4-step1-subscription-teams.js",
  "test-l4-step2-team-detail.js",
  "test-l4-step3-team-breakdown.js",
  "test-hybrid-scope.js",
  "test-f7-scope.js",
];

console.log("L4 + F7 scope test suite\n");

let failed = false;

for (const script of scripts) {
  const scriptPath = path.join(__dirname, script);
  console.log(`--- ${script} ---`);
  const result = spawnSync(process.execPath, [scriptPath], {
    stdio: "inherit",
    env: process.env,
  });

  if (result.status !== 0) {
    failed = true;
    console.error(`FAILED: ${script}\n`);
  } else {
    console.log("");
  }
}

if (failed) {
  process.exit(1);
}

console.log("All L4 + F7 scope tests passed.");
