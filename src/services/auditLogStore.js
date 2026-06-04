const fs = require("fs");
const path = require("path");

const AUDIT_DIR = path.join(process.cwd(), "data");
const AUDIT_FILE = path.join(AUDIT_DIR, "admin-audit.json");

function ensureFile() {
  if (!fs.existsSync(AUDIT_DIR)) {
    fs.mkdirSync(AUDIT_DIR, { recursive: true });
  }
  if (!fs.existsSync(AUDIT_FILE)) {
    fs.writeFileSync(AUDIT_FILE, "[]", "utf8");
  }
}

function readFileLogs() {
  try {
    ensureFile();
    const raw = fs.readFileSync(AUDIT_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_err) {
    return [];
  }
}

function appendFileLog(entry) {
  const logs = readFileLogs();
  logs.unshift(entry);
  ensureFile();
  fs.writeFileSync(AUDIT_FILE, JSON.stringify(logs.slice(0, 500), null, 2), "utf8");
  return entry;
}

function listFileLogs(limit = 50) {
  return readFileLogs().slice(0, Number(limit) || 50);
}

module.exports = {
  appendFileLog,
  listFileLogs,
  AUDIT_FILE,
};
