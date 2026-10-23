const { readJson, writeJson } = require('./store');

const FILE = 'inbox-conversations.json';
const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

function load() {
  return readJson(FILE, { conversations: {} });
}

function save(db) {
  writeJson(FILE, db);
}

function touchConversation(db, phone, patch = {}) {
  if (!db.conversations[phone]) {
    db.conversations[phone] = {
      phone,
      name: '',
      messages: [],
      lastInboundAt: null,
      lastAt: null,
      unread: 0
    };
  }
  Object.assign(db.conversations[phone], patch);
  return db.conversations[phone];
}

function addMessage(phone, message) {
  const db = load();
  const c = touchConversation(db, phone);
  if (message.name) c.name = message.name;
  c.messages.push(message);
  if (c.messages.length > 200) c.messages = c.messages.slice(-200);
  c.lastAt = message.at;
  if (message.direction === 'inbound') {
    c.lastInboundAt = message.at;
    c.unread = (c.unread || 0) + 1;
  }
  save(db);
  return c;
}

function listConversations() {
  const db = load();
  return Object.values(db.conversations).sort((a, b) => {
    const ta = a.lastAt ? Date.parse(a.lastAt) : 0;
    const tb = b.lastAt ? Date.parse(b.lastAt) : 0;
    return tb - ta;
  });
}

function getConversation(phone) {
  const db = load();
  return db.conversations[phone] || null;
}

function markRead(phone) {
  const db = load();
  if (db.conversations[phone]) {
    db.conversations[phone].unread = 0;
    save(db);
  }
}

function canSendSession(phone) {
  const c = getConversation(phone);
  if (!c?.lastInboundAt) return false;
  return Date.now() - Date.parse(c.lastInboundAt) < SESSION_WINDOW_MS;
}

/**
 * Parse Meta WhatsApp Cloud webhook payload → inbound text messages.
 */
function ingestMetaWebhook(body) {
  const saved = [];
  const entries = body?.entry || [];
  for (const entry of entries) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      if (change.field && change.field !== 'messages') continue;
      const contacts = value.contacts || [];
      const nameByWa = Object.fromEntries(
        contacts.map((c) => [c.wa_id, c.profile?.name || ''])
      );
      for (const msg of value.messages || []) {
        const phone = String(msg.from || '').replace(/\D/g, '');
        if (!phone) continue;
        let text = '';
        if (msg.type === 'text') text = msg.text?.body || '';
        else if (msg.type === 'button') text = msg.button?.text || '[button]';
        else if (msg.type === 'interactive') {
          text =
            msg.interactive?.button_reply?.title ||
            msg.interactive?.list_reply?.title ||
            `[${msg.type}]`;
        } else text = `[${msg.type}]`;
        const row = {
          id: msg.id,
          direction: 'inbound',
          type: msg.type,
          text,
          at: new Date(Number(msg.timestamp) * 1000).toISOString(),
          name: nameByWa[phone] || nameByWa[msg.from] || ''
        };
        addMessage(phone, row);
        saved.push({ phone, ...row });
      }
    }
  }
  return saved;
}

function recordOutbound(phone, text, meta = {}) {
  return addMessage(phone, {
    id: meta.id || `out_${Date.now()}`,
    direction: 'outbound',
    type: 'text',
    text,
    at: new Date().toISOString(),
    by: meta.by || 'team'
  });
}

module.exports = {
  listConversations,
  getConversation,
  markRead,
  canSendSession,
  ingestMetaWebhook,
  recordOutbound,
  SESSION_WINDOW_MS
};
