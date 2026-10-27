const fs = require('fs');
const path = require('path');
const config = require('./config');

const TURSO_URL = process.env.TURSO_DATABASE_URL || process.env.LIBSQL_URL || '';
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN || process.env.LIBSQL_AUTH_TOKEN || '';
const REMOTE_KEY = 'miracle:id-map';

/**
 * Local JSON + optional Turso KV (free) so Render free-tier sleep/redeploy
 * does not lose order→voucher mappings (avoids duplicate Sales Bills / credit burn).
 */
class IdStore {
  constructor(fileName = 'id-map.json') {
    if (!fs.existsSync(config.dataDir)) fs.mkdirSync(config.dataDir, { recursive: true });
    this.filePath = path.join(config.dataDir, fileName);
    this.data = { accounts: {}, products: {}, orders: {}, meta: {} };
    this._turso = null;
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        this.data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        this.data.accounts = this.data.accounts || {};
        this.data.products = this.data.products || {};
        this.data.orders = this.data.orders || {};
        this.data.meta = this.data.meta || {};
      }
    } catch (err) {
      console.warn('[IdStore] load failed:', err.message);
      this.data = { accounts: {}, products: {}, orders: {}, meta: {} };
    }
  }

  save() {
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
    this.persistRemote().catch((err) => {
      console.warn('[IdStore] remote save failed:', err.message);
    });
  }

  getTurso() {
    if (!TURSO_URL) return null;
    if (!this._turso) {
      const { createClient } = require('@libsql/client');
      this._turso = createClient({
        url: TURSO_URL,
        authToken: TURSO_TOKEN || undefined
      });
    }
    return this._turso;
  }

  async ensureRemote() {
    const client = this.getTurso();
    if (!client) return null;
    await client.execute(
      `CREATE TABLE IF NOT EXISTS kv (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`
    );
    return client;
  }

  async hydrateFromRemote() {
    const client = await this.ensureRemote();
    if (!client) return false;
    const res = await client.execute({
      sql: 'SELECT value FROM kv WHERE key = ?',
      args: [REMOTE_KEY]
    });
    const row = res.rows && res.rows[0];
    if (!row || !row.value) return false;
    const remote = JSON.parse(row.value);
    this.data = {
      accounts: { ...(remote.accounts || {}), ...this.data.accounts },
      products: { ...(remote.products || {}), ...this.data.products },
      orders: { ...(remote.orders || {}), ...this.data.orders },
      meta: { ...(remote.meta || {}), ...this.data.meta }
    };
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
    console.log('[IdStore] Hydrated id-map from Turso');
    return true;
  }

  async persistRemote() {
    const client = await this.ensureRemote();
    if (!client) return;
    await client.execute({
      sql: `INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      args: [REMOTE_KEY, JSON.stringify(this.data), new Date().toISOString()]
    });
  }

  getAccount(key) {
    return this.data.accounts[key] || null;
  }

  setAccount(key, uniqueId, meta = {}) {
    this.data.accounts[key] = { uniqueId, ...meta, updatedAt: new Date().toISOString() };
    this.save();
  }

  getProduct(key) {
    return this.data.products[key] || null;
  }

  setProduct(key, uniqueId, meta = {}) {
    this.data.products[key] = { uniqueId, ...meta, updatedAt: new Date().toISOString() };
    this.save();
  }

  getOrder(shopifyOrderId) {
    return this.data.orders[String(shopifyOrderId)] || null;
  }

  setOrder(shopifyOrderId, voucherUniqueId, meta = {}) {
    this.data.orders[String(shopifyOrderId)] = {
      voucherUniqueId,
      ...meta,
      syncedAt: new Date().toISOString()
    };
    this.save();
  }

  getMeta(key) {
    return this.data.meta[key];
  }

  setMeta(key, value) {
    this.data.meta[key] = value;
    this.save();
  }
}

module.exports = IdStore;
