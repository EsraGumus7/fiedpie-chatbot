const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(process.cwd(), "data");
const PERM_FILE = path.join(DATA_DIR, "admin-user-permissions.json");

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(PERM_FILE)) {
    fs.writeFileSync(PERM_FILE, "{}", "utf8");
  }
}

function readAll() {
  try {
    ensureFile();
    const raw = fs.readFileSync(PERM_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_err) {
    return {};
  }
}

function getUserIntents(userId) {
  const all = readAll();
  const intents = all[String(userId)];
  return Array.isArray(intents) ? intents : [];
}

function saveUserIntents(userId, allowedIntents = []) {
  const all = readAll();
  all[String(userId)] = allowedIntents;
  ensureFile();
  fs.writeFileSync(PERM_FILE, JSON.stringify(all, null, 2), "utf8");
  return allowedIntents;
}

function isMissingTableError(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  return msg.includes("aiuserpermission") || msg.includes("invalid object name");
}

module.exports = {
  getUserIntents,
  saveUserIntents,
  isMissingTableError,
  PERM_FILE,
};
