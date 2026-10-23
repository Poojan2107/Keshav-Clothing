const { readJson, writeJson } = require('./store');

const FILE = 'inbox-conversations.json';
const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Serialize read-modify-write so concurrent webhooks don't clobber history */
let lock = Promise.resolve();

function withLock(fn) {
  const run = lock.then(fn, fn);
  lock = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

async function load() {
  return readJson(FILE, { conversations: {} });
}

async function save(db) {
  await writeJson(FILE, db);
}

function touchConversation(db, phone, patch = {}) {
  if (!db.conversations[phone]) {
    db.conversations[phone] = {
      phone,
      name: '',
      nameLocked: false,
      email: '',
      notes: '',
      tags: [],
      orderRef: '',
      pinned: false,
      archived: false,
      messages: [],
      lastInboundAt: null,
      lastAt: null,
      unread: 0
    };
  }
  Object.assign(db.conversations[phone], patch);
  return db.conversations[phone];
}

async function addMessage(phone, message) {
  return withLock(async () => {
    const db = await load();
    const c = touchConversation(db, phone);
    // Don't overwrite a name the team set manually
    if (message.name && !c.nameLocked) c.name = message.name;
    if (message.id && c.messages.some((m) => m.id && m.id === message.id)) {
      return c;
    }
    c.messages.push(message);
    if (c.messages.length > 5000) c.messages = c.messages.slice(-4000);
    c.lastAt = message.at;
    if (message.direction === 'inbound') {
      c.lastInboundAt = message.at;
      c.unread = (c.unread || 0) + 1;
    }
    await save(db);
    return c;
  });
}

/** Rewrite ugly old template dumps so the inbox looks like WhatsApp */
function polishMessageText(text) {
  const raw = String(text || '');
  if (!raw.startsWith('📤 kc_inbox_hello:')) return raw;
  const rest = raw.slice('📤 kc_inbox_hello:'.length).trim();
  const sep = rest.indexOf(' · ');
  if (sep < 0) return rest;
  const who = rest.slice(0, sep).trim() || 'there';
  const note = rest.slice(sep + 3).trim();
  if (note && /^hi\b/i.test(note) && /keshav clothing/i.test(note)) return note;
  if (note) {
    return `Hi ${who.split(/\s+/)[0]}, this is Keshav Clothing. ${note} Please reply to continue chatting with our team.`;
  }
  return `Hi ${who.split(/\s+/)[0]}, this is Keshav Clothing. Please reply to continue chatting with our team.`;
}

function polishConversation(c) {
  if (!c) return c;
  return {
    ...c,
    messages: (c.messages || []).map((m) => ({
      ...m,
      text: polishMessageText(m.text)
    }))
  };
}

async function listConversations({ archived = false } = {}) {
  const db = await load();
  return Object.values(db.conversations)
    .filter((c) => Boolean(c.archived) === Boolean(archived))
    .map(polishConversation)
    .sort((a, b) => {
      if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
      const ta = a.lastAt ? Date.parse(a.lastAt) : 0;
      const tb = b.lastAt ? Date.parse(b.lastAt) : 0;
      return tb - ta;
    });
}

async function getConversation(phone) {
  const db = await load();
  return polishConversation(db.conversations[phone] || null);
}

async function ensureConversation(phone, name = '') {
  return withLock(async () => {
    const db = await load();
    const c = touchConversation(db, phone);
    if (name) {
      c.name = String(name).slice(0, 80);
      c.nameLocked = true;
    }
    if (!c.lastAt) c.lastAt = new Date().toISOString();
    await save(db);
    return c;
  });
}

async function updateConversation(phone, patch = {}) {
  return withLock(async () => {
    const db = await load();
    if (!db.conversations[phone]) {
      const err = new Error('Not found');
      err.status = 404;
      throw err;
    }
    const c = db.conversations[phone];
    if (patch.name != null) {
      c.name = String(patch.name).trim().slice(0, 80);
      c.nameLocked = true;
    }
    if (patch.email != null) c.email = String(patch.email).trim().slice(0, 120);
    if (patch.notes != null) c.notes = String(patch.notes).slice(0, 4000);
    if (patch.orderRef != null) c.orderRef = String(patch.orderRef).trim().slice(0, 80);
    if (patch.tags != null) {
      const tags = Array.isArray(patch.tags)
        ? patch.tags
        : String(patch.tags)
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean);
      c.tags = [...new Set(tags.map((t) => String(t).slice(0, 32)))].slice(0, 12);
    }
    if (patch.pinned != null) c.pinned = Boolean(patch.pinned);
    if (patch.archived != null) c.archived = Boolean(patch.archived);
    if (patch.nameLocked != null) c.nameLocked = Boolean(patch.nameLocked);
    if (patch.lastAutoReplyAt != null) c.lastAutoReplyAt = patch.lastAutoReplyAt;
    if (patch.lastAutoReplyReason != null) c.lastAutoReplyReason = String(patch.lastAutoReplyReason).slice(0, 40);
    c.updatedAt = new Date().toISOString();
    await save(db);
    return polishConversation(c);
  });
}

async function migratePhone(fromPhone, toPhone) {
  return withLock(async () => {
    const db = await load();
    const from = db.conversations[fromPhone];
    if (!from) {
      const err = new Error('Conversation not found');
      err.status = 404;
      throw err;
    }
    if (!toPhone || toPhone === fromPhone) {
      const err = new Error('New phone required');
      err.status = 400;
      throw err;
    }
    const incoming = from.messages || [];
    if (db.conversations[toPhone]) {
      const dest = db.conversations[toPhone];
      const seen = new Set((dest.messages || []).map((m) => m.id).filter(Boolean));
      for (const m of incoming) {
        if (m.id && seen.has(m.id)) continue;
        dest.messages.push(m);
        if (m.id) seen.add(m.id);
      }
      dest.messages.sort((a, b) => Date.parse(a.at || 0) - Date.parse(b.at || 0));
      if (dest.messages.length > 5000) dest.messages = dest.messages.slice(-4000);
      dest.name = dest.name || from.name;
      dest.notes = [dest.notes, from.notes].filter(Boolean).join('\n---\n').slice(0, 4000);
      dest.tags = [...new Set([...(dest.tags || []), ...(from.tags || [])])].slice(0, 12);
      dest.email = dest.email || from.email;
      dest.orderRef = dest.orderRef || from.orderRef;
      dest.pinned = dest.pinned || from.pinned;
      dest.lastAt = dest.messages.slice(-1)[0]?.at || dest.lastAt;
      dest.lastInboundAt =
        [...dest.messages].reverse().find((m) => m.direction === 'inbound')?.at || dest.lastInboundAt;
      delete db.conversations[fromPhone];
      await save(db);
      return polishConversation(dest);
    }
    from.phone = toPhone;
    db.conversations[toPhone] = from;
    delete db.conversations[fromPhone];
    await save(db);
    return polishConversation(from);
  });
}

async function deleteConversation(phone) {
  return withLock(async () => {
    const db = await load();
    if (!db.conversations[phone]) {
      const err = new Error('Not found');
      err.status = 404;
      throw err;
    }
    delete db.conversations[phone];
    await save(db);
    return true;
  });
}

async function clearHistory(phone) {
  return withLock(async () => {
    const db = await load();
    const c = db.conversations[phone];
    if (!c) {
      const err = new Error('Not found');
      err.status = 404;
      throw err;
    }
    c.messages = [];
    c.lastInboundAt = null;
    c.lastAt = new Date().toISOString();
    c.unread = 0;
    c.updatedAt = new Date().toISOString();
    await save(db);
    return polishConversation(c);
  });
}

async function markRead(phone) {
  return withLock(async () => {
    const db = await load();
    if (db.conversations[phone]) {
      db.conversations[phone].unread = 0;
      await save(db);
    }
  });
}

async function markUnread(phone) {
  return withLock(async () => {
    const db = await load();
    if (!db.conversations[phone]) {
      const err = new Error('Not found');
      err.status = 404;
      throw err;
    }
    db.conversations[phone].unread = Math.max(1, db.conversations[phone].unread || 0);
    await save(db);
    return polishConversation(db.conversations[phone]);
  });
}

async function canSendSession(phone) {
  const c = await getConversation(phone);
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
async function ingestMetaWebhook(body) {
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
        await addMessage(phone, row);
        saved.push({ phone, ...row });
      }

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
        await addMessage(phone, row);
        saved.push({ phone, ...row });
      }
    }
  }
  return saved;
}

async function recordOutbound(phone, payload = {}) {
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
  ensureConversation,
  updateConversation,
  migratePhone,
  deleteConversation,
  clearHistory,
  markRead,
  markUnread,
  canSendSession,
  ingestMetaWebhook,
  recordOutbound,
  SESSION_WINDOW_MS
};
