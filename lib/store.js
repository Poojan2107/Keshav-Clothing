const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');

const TURSO_URL = process.env.TURSO_DATABASE_URL || process.env.LIBSQL_URL || '';
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN || process.env.LIBSQL_AUTH_TOKEN || '';

let turso = null;
let tursoReady = null;

function persistenceMode() {
  return TURSO_URL ? 'turso' : 'local';
}

function getTurso() {
  if (!TURSO_URL) return null;
  if (!turso) {
    const { createClient } = require('@libsql/client');
    turso = createClient({
      url: TURSO_URL,
      authToken: TURSO_TOKEN || undefined
    });
  }
  return turso;
}

async function ensureTurso() {
  const client = getTurso();
  if (!client) return null;
  if (!tursoReady) {
    tursoReady = client
      .execute(
        `CREATE TABLE IF NOT EXISTS kv (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`
      )
      .then(() => true)
      .catch((err) => {
        tursoReady = null;
        throw err;
      });
  }
  await tursoReady;
  return client;
}

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function filePath(name) {
  ensureDir();
  return path.join(DATA_DIR, name);
}

function readJsonLocal(name, fallback) {
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

function writeJsonLocal(name, data) {
  ensureDir();
  const p = filePath(name);
  const tmp = `${p}.${process.pid}.tmp`;
  const json = JSON.stringify(data, null, 2);
  fs.writeFileSync(tmp, json);
  try {
    if (fs.existsSync(p)) fs.copyFileSync(p, `${p}.bak`);
  } catch (_) {
    /* ignore */
  }
  fs.renameSync(tmp, p);
}

async function readJson(name, fallback) {
  const client = await ensureTurso().catch((err) => {
    console.error('[store] Turso connect failed:', err.message);
    return null;
  });
  if (!client) return readJsonLocal(name, fallback);

  try {
    const rs = await client.execute({
      sql: 'SELECT value FROM kv WHERE key = ?',
      args: [name]
    });
    if (!rs.rows.length) {
      // One-time migrate from local disk if present
      const local = readJsonLocal(name, null);
      if (local) {
        await writeJson(name, local);
        console.log(`[store] Migrated ${name} from local disk → Turso`);
        return local;
      }
      return fallback;
    }
    return JSON.parse(rs.rows[0].value);
  } catch (err) {
    console.error('[store] Turso read failed, using local:', err.message);
    return readJsonLocal(name, fallback);
  }
}

async function writeJson(name, data) {
  const client = await ensureTurso().catch((err) => {
    console.error('[store] Turso connect failed:', err.message);
    return null;
  });

  // Always keep a local copy as emergency cache on this instance
  try {
    writeJsonLocal(name, data);
  } catch (_) {
    /* ignore local write failures on read-only FS */
  }

  if (!client) return;

  const json = JSON.stringify(data);
  await client.execute({
    sql: `INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            updated_at = excluded.updated_at`,
    args: [name, json, new Date().toISOString()]
  });
}

module.exports = {
  readJson,
  writeJson,
  DATA_DIR,
  persistenceMode,
  isRemote: () => Boolean(TURSO_URL)
};
