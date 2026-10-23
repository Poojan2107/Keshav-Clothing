const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function filePath(name) {
  ensureDir();
  return path.join(DATA_DIR, name);
}

function readJson(name, fallback) {
  const p = filePath(name);
  if (!fs.existsSync(p)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    const bak = `${p}.bak`;
    if (fs.existsSync(bak)) {
      try {
        return JSON.parse(fs.readFileSync(bak, 'utf8'));
      } catch {
        return fallback;
      }
    }
    return fallback;
  }
}

function writeJson(name, data) {
  ensureDir();
  const p = filePath(name);
  const tmp = `${p}.${process.pid}.tmp`;
  const json = JSON.stringify(data, null, 2);
  fs.writeFileSync(tmp, json);
  try {
    if (fs.existsSync(p)) fs.copyFileSync(p, `${p}.bak`);
  } catch (_) {
    /* ignore backup errors */
  }
  fs.renameSync(tmp, p);
}

module.exports = { readJson, writeJson, DATA_DIR };
