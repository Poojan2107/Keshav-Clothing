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
  if (message.id && c.messages.some((m) => m.id && m.id === message.id)) {
    return c;
  }
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

function mediaLabel(type, caption, filename) {
  if (caption) return caption;
  if (filename) return filename;
  const map = {
    image: '📷 Photo',
    video: '🎥 Video',
    audio: '🎧 Audio',
    document: '📄 Document',
    sticker: 'Sticker',
    location: '📍 Location',
    contacts: '👤 Contact'
  };
  return map[type] || `[${type}]`;
}

function extractInbound(msg) {
  const type = msg.type || 'text';
  const base = {
    type,
    mediaId: null,
    mimeType: null,
    filename: null,
    caption: null,
    text: ''
  };

  if (type === 'text') {
    base.text = msg.text?.body || '';
  } else if (type === 'image') {
    base.mediaId = msg.image?.id || null;
    base.mimeType = msg.image?.mime_type || null;
    base.caption = msg.image?.caption || null;
    base.text = mediaLabel('image', base.caption);
  } else if (type === 'video') {
    base.mediaId = msg.video?.id || null;
    base.mimeType = msg.video?.mime_type || null;
    base.caption = msg.video?.caption || null;
    base.text = mediaLabel('video', base.caption);
  } else if (type === 'audio') {
    base.mediaId = msg.audio?.id || null;
    base.mimeType = msg.audio?.mime_type || null;
    base.text = mediaLabel('audio');
  } else if (type === 'document') {
    base.mediaId = msg.document?.id || null;
    base.mimeType = msg.document?.mime_type || null;
    base.filename = msg.document?.filename || null;
    base.caption = msg.document?.caption || null;
    base.text = mediaLabel('document', base.caption, base.filename);
  } else if (type === 'sticker') {
    base.mediaId = msg.sticker?.id || null;
    base.mimeType = msg.sticker?.mime_type || null;
    base.text = mediaLabel('sticker');
  } else if (type === 'button') {
    base.text = msg.button?.text || '[button]';
  } else if (type === 'interactive') {
    base.text =
      msg.interactive?.button_reply?.title ||
      msg.interactive?.list_reply?.title ||
      `[${type}]`;
  } else if (type === 'location') {
    const lat = msg.location?.latitude;
    const lng = msg.location?.longitude;
    base.text = lat != null ? `📍 ${lat}, ${lng}` : mediaLabel('location');
  } else {
    base.text = `[${type}]`;
  }
  return base;
}

/**
 * Parse Meta WhatsApp Cloud webhook payload → inbound + echo messages.
 */
function ingestMetaWebhook(body) {
  const saved = [];
  const entries = body?.entry || [];
  for (const entry of entries) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      const field = change.field || 'messages';
      if (field !== 'messages' && field !== 'message_echoes') continue;
      const contacts = value.contacts || [];
      const nameByWa = Object.fromEntries(
        contacts.map((c) => [c.wa_id, c.profile?.name || ''])
      );

      const inboundList = value.messages || [];
      for (const msg of inboundList) {
        const phone = String(msg.from || '').replace(/\D/g, '');
        if (!phone) continue;
        const extracted = extractInbound(msg);
        const row = {
          id: msg.id,
          direction: 'inbound',
          type: extracted.type,
          text: extracted.text,
          mediaId: extracted.mediaId,
          mimeType: extracted.mimeType,
          filename: extracted.filename,
          caption: extracted.caption,
          at: new Date(Number(msg.timestamp) * 1000).toISOString(),
          name: nameByWa[phone] || nameByWa[msg.from] || ''
        };
        addMessage(phone, row);
        saved.push({ phone, ...row });
      }

      // Echoes = messages sent by the business (backup sync into inbox)
      const echoes = value.message_echoes || [];
      for (const msg of echoes) {
        const phone = String(msg.to || '').replace(/\D/g, '');
        if (!phone) continue;
        const extracted = extractInbound(msg);
        const row = {
          id: msg.id,
          direction: 'outbound',
          type: extracted.type,
          text: extracted.text,
          mediaId: extracted.mediaId,
          mimeType: extracted.mimeType,
          filename: extracted.filename,
          caption: extracted.caption,
          at: new Date(Number(msg.timestamp || Date.now() / 1000) * 1000).toISOString(),
          by: 'echo'
        };
        addMessage(phone, row);
        saved.push({ phone, ...row });
      }
    }
  }
  return saved;
}

function recordOutbound(phone, payload = {}) {
  const type = payload.type || 'text';
  return addMessage(phone, {
    id: payload.id || `out_${Date.now()}`,
    direction: 'outbound',
    type,
    text: payload.text || mediaLabel(type, payload.caption, payload.filename),
    mediaId: payload.mediaId || null,
    mimeType: payload.mimeType || null,
    filename: payload.filename || null,
    caption: payload.caption || null,
    at: new Date().toISOString(),
    by: payload.by || 'team'
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
