const crypto = require('crypto');
const path = require('path');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const wa = require('./lib/whatsapp');
const otp = require('./lib/otp');
const inbox = require('./lib/inbox');
const { notify } = require('./lib/orders-notify');
const { createReturnRequest, loadReturns } = require('./lib/returns');
const { maskPhone, normalizePhone } = require('./lib/phone');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 64 * 1024 * 1024 }
});

function waTypeFromMime(mime, forced) {
  if (forced) return forced;
  const m = String(mime || '');
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  return 'document';
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    }
  })
);

const corsOrigins = config.corsOrigins.length
  ? config.corsOrigins
  : ['https://keshavclothing.com', 'https://www.keshavclothing.com'];

app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true);
      if (corsOrigins.includes(origin) || /\.myshopify\.com$/.test(origin)) {
        return cb(null, true);
      }
      return cb(null, false);
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
  })
);

function verifyShopifyHmac(req) {
  if (config.shopify.skipWebhookHmac) return { ok: true, skipped: true };
  if (!config.shopify.webhookSecret) {
    return { ok: false, error: 'SHOPIFY_WEBHOOK_SECRET not set' };
  }
  const hmacHeader = req.get('X-Shopify-Hmac-Sha256');
  if (!hmacHeader) return { ok: false, error: 'Missing HMAC' };
  const digest = crypto
    .createHmac('sha256', config.shopify.webhookSecret)
    .update(req.rawBody)
    .digest('base64');
  const a = Buffer.from(digest);
  const b = Buffer.from(hmacHeader);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, error: 'Invalid HMAC' };
  }
  return { ok: true };
}

app.get('/health', (_req, res) => {
  res.json({
    status: 'online',
    service: 'Keshav Clothing Customer Ops',
    version: '1.1.0',
    whatsappConfigured: wa.isConfigured(),
    shopifyConfigured: Boolean(config.shopify.shop && config.shopify.adminToken),
    inboxEnabled: Boolean(config.inbox.enabled && config.inbox.password && config.inbox.allowedEmails.length),
    returnWindowDays: config.returnWindowDays,
    timestamp: new Date().toISOString()
  });
});

function isAllowedInboxEmail(email) {
  const e = String(email || '')
    .trim()
    .toLowerCase();
  if (!e || !e.includes('@')) return false;
  return config.inbox.allowedEmails.includes(e);
}

function signInboxToken({ who, email }) {
  const body = Buffer.from(
    JSON.stringify({
      who: String(who || 'team').slice(0, 40),
      email: String(email || '').toLowerCase(),
      exp: Date.now() + 7 * 24 * 60 * 60 * 1000
    })
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', config.inbox.tokenSecret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function readInboxToken(req) {
  const hdr = req.get('Authorization') || '';
  const token =
    (hdr.startsWith('Bearer ') ? hdr.slice(7) : '') || String(req.query?.token || '');
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expect = crypto.createHmac('sha256', config.inbox.tokenSecret).update(body).digest('base64url');
  if (sig !== expect) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function requireInbox(req, res, next) {
  if (!config.inbox.enabled || !config.inbox.password) {
    return res.status(503).json({ ok: false, error: 'Inbox not configured (INBOX_PASSWORD)' });
  }
  const session = readInboxToken(req);
  if (!session || !isAllowedInboxEmail(session.email)) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  req.inboxUser = session.who || session.email;
  req.inboxEmail = session.email;
  return next();
}

app.get('/inbox', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'inbox.html'));
});

app.get('/inbox/api/config', (_req, res) => {
  const store = require('./lib/store');
  res.json({
    ok: true,
    googleClientId: config.inbox.googleClientId || null,
    allowedHint: config.inbox.allowedEmails.length === 1 ? config.inbox.allowedEmails[0] : 'authorized KC email',
    persistence: store.persistenceMode(),
    historyForever: store.isRemote()
  });
});

app.post('/inbox/api/login', (req, res) => {
  if (!config.inbox.enabled || !config.inbox.password) {
    return res.status(503).json({ ok: false, error: 'Inbox not configured' });
  }
  const email = String(req.body?.email || '')
    .trim()
    .toLowerCase();
  const password = String(req.body?.password || '');
  if (!isAllowedInboxEmail(email)) {
    return res.status(403).json({ ok: false, error: 'This email is not allowed to access the inbox' });
  }
  if (password !== config.inbox.password) {
    return res.status(401).json({ ok: false, error: 'Wrong password' });
  }
  const who = String(req.body?.who || email.split('@')[0]).slice(0, 40);
  return res.json({
    ok: true,
    token: signInboxToken({ who, email }),
    who,
    email
  });
});

app.post('/inbox/api/google-login', async (req, res) => {
  try {
    if (!config.inbox.enabled || !config.inbox.googleClientId) {
      return res.status(503).json({ ok: false, error: 'Google Sign-In not configured' });
    }
    const credential = String(req.body?.credential || '');
    if (!credential) return res.status(400).json({ ok: false, error: 'Missing Google credential' });

    const { OAuth2Client } = require('google-auth-library');
    const client = new OAuth2Client(config.inbox.googleClientId);
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: config.inbox.googleClientId
    });
    const payload = ticket.getPayload() || {};
    const email = String(payload.email || '').toLowerCase();
    if (!payload.email_verified) {
      return res.status(403).json({ ok: false, error: 'Google email not verified' });
    }
    if (!isAllowedInboxEmail(email)) {
      return res.status(403).json({
        ok: false,
        error: 'Only the authorized Keshav Clothing Google account can access this inbox'
      });
    }
    const who = String(payload.name || email.split('@')[0]).slice(0, 40);
    return res.json({
      ok: true,
      token: signInboxToken({ who, email }),
      who,
      email
    });
  } catch (err) {
    console.error('[inbox google-login]', err.message);
    return res.status(401).json({ ok: false, error: 'Google Sign-In failed' });
  }
});

app.get('/inbox/api/conversations', requireInbox, async (req, res) => {
  try {
    const archived = String(req.query.archived || '') === '1' || req.query.archived === 'true';
    res.json({ ok: true, conversations: await inbox.listConversations({ archived }) });
  } catch (err) {
    console.error('[inbox list]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/inbox/api/conversations/:phone', requireInbox, async (req, res) => {
  try {
    const phone = normalizePhone(req.params.phone);
    const conversation = await inbox.getConversation(phone);
    if (!conversation) return res.status(404).json({ ok: false, error: 'Not found' });
    if (String(req.query.markRead || '1') !== '0') await inbox.markRead(phone);
    res.json({
      ok: true,
      conversation: await inbox.getConversation(phone),
      canReplySession: await inbox.canSendSession(phone)
    });
  } catch (err) {
    console.error('[inbox get]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/** Update customer profile (name, notes, tags, pin, archive, …) */
app.patch('/inbox/api/conversations/:phone', requireInbox, async (req, res) => {
  try {
    const phone = normalizePhone(req.params.phone);
    const conversation = await inbox.updateConversation(phone, req.body || {});
    return res.json({ ok: true, conversation });
  } catch (err) {
    return res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

/** Change WhatsApp number for a contact (moves / merges chat history) */
app.post('/inbox/api/conversations/:phone/migrate', requireInbox, async (req, res) => {
  try {
    const from = normalizePhone(req.params.phone);
    const to = normalizePhone(req.body?.phone || req.body?.to);
    if (!to) return res.status(400).json({ ok: false, error: 'New phone required' });
    const conversation = await inbox.migratePhone(from, to);
    return res.json({ ok: true, phone: conversation.phone, conversation });
  } catch (err) {
    return res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

app.post('/inbox/api/conversations/:phone/unread', requireInbox, async (req, res) => {
  try {
    const phone = normalizePhone(req.params.phone);
    const conversation = await inbox.markUnread(phone);
    return res.json({ ok: true, conversation });
  } catch (err) {
    return res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

app.post('/inbox/api/conversations/:phone/clear', requireInbox, async (req, res) => {
  try {
    const phone = normalizePhone(req.params.phone);
    const conversation = await inbox.clearHistory(phone);
    return res.json({ ok: true, conversation });
  } catch (err) {
    return res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

app.delete('/inbox/api/conversations/:phone', requireInbox, async (req, res) => {
  try {
    const phone = normalizePhone(req.params.phone);
    await inbox.deleteConversation(phone);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

/**
 * Reply in an open chat.
 * Inside 24h → free text. Outside 24h → approved kc_inbox_hello template (can message anyone).
 */
app.post('/inbox/api/reply', requireInbox, async (req, res) => {
  try {
    const phone = normalizePhone(req.body?.phone);
    const text = String(req.body?.text || '').trim();
    const who = req.body?.who || req.inboxUser;
    if (!phone || !text) return res.status(400).json({ ok: false, error: 'phone and text required' });

    const sessionOk = await inbox.canSendSession(phone);
    if (sessionOk) {
      const result = await wa.sendText(phone, text, { by: who });
      if (!result.ok) return res.status(502).json(result);
      return res.json({ ok: true, mode: 'session', result });
    }

    const existing = await inbox.getConversation(phone);
    const greetName = wa.greetNameFrom(req.body?.name || existing?.name);
    const note = text.slice(0, 200);
    const result = await wa.sendTemplate(
      phone,
      config.templates.inboxHello,
      [greetName, note],
      config.templates.language,
      { by: who }
    );
    if (!result.ok) {
      return res.status(502).json({
        ...result,
        errorHint:
          'Template send failed. Ensure kc_inbox_hello is Approved in Meta, or wait until the customer messages first.'
      });
    }
    return res.json({ ok: true, mode: 'template', result });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/** Start a chat with any WhatsApp number (creates thread + optional first message). */
app.post('/inbox/api/start', requireInbox, async (req, res) => {
  try {
    const phone = normalizePhone(req.body?.phone);
    const name = String(req.body?.name || '').trim().slice(0, 80);
    const text = String(req.body?.text || '').trim();
    const who = req.body?.who || req.inboxUser;
    if (!phone) return res.status(400).json({ ok: false, error: 'Valid phone required (e.g. 9876543210)' });

    await inbox.ensureConversation(phone, name);

    if (!text) {
      return res.json({
        ok: true,
        phone,
        mode: 'opened',
        canReplySession: await inbox.canSendSession(phone)
      });
    }

    const sessionOk = await inbox.canSendSession(phone);
    let result;
    let mode;
    if (sessionOk) {
      result = await wa.sendText(phone, text, { by: who });
      mode = 'session';
    } else {
      result = await wa.sendTemplate(
        phone,
        config.templates.inboxHello,
        [wa.greetNameFrom(name), text.slice(0, 200)],
        config.templates.language,
        { by: who }
      );
      mode = 'template';
    }
    if (!result.ok) {
      return res.status(502).json({
        ...result,
        phone,
        errorHint:
          'Could not send. Outside 24h needs approved template kc_inbox_hello. Run npm run templates:create or approve it in Meta.'
      });
    }
    return res.json({
      ok: true,
      phone,
      mode,
      result,
      canReplySession: await inbox.canSendSession(phone)
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

const inboxSettings = require('./lib/inbox-settings');

app.get('/inbox/api/settings', requireInbox, async (_req, res) => {
  try {
    const settings = await inboxSettings.getSettings();
    return res.json({ ok: true, settings });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.put('/inbox/api/settings', requireInbox, async (req, res) => {
  try {
    const settings = await inboxSettings.saveSettings(req.body || {});
    return res.json({ ok: true, settings });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/** Send an approved Meta template from the inbox (works outside 24h). */
app.post('/inbox/api/send-template', requireInbox, async (req, res) => {
  try {
    const phone = normalizePhone(req.body?.phone);
    const templateName = String(req.body?.template || req.body?.name || '').trim();
    const params = Array.isArray(req.body?.params)
      ? req.body.params.map((p) => String(p ?? '').slice(0, 200))
      : [];
    const who = req.body?.who || req.inboxUser;
    if (!phone || !templateName) {
      return res.status(400).json({ ok: false, error: 'phone and template required' });
    }
    await inbox.ensureConversation(phone, req.body?.name || '');
    const result = await wa.sendTemplate(
      phone,
      templateName,
      params,
      config.templates.language,
      { by: who }
    );
    if (!result.ok) {
      return res.status(502).json({
        ...result,
        errorHint: 'Template must be Approved in Meta WhatsApp Manager.'
      });
    }
    return res.json({
      ok: true,
      result,
      canReplySession: await inbox.canSendSession(phone)
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/inbox/api/media', requireInbox, upload.single('file'), async (req, res) => {
  try {
    const phone = normalizePhone(req.body?.phone);
    const caption = String(req.body?.caption || '').trim();
    if (!phone) return res.status(400).json({ ok: false, error: 'phone required' });
    if (!req.file) return res.status(400).json({ ok: false, error: 'file required' });
    if (!(await inbox.canSendSession(phone))) {
      return res.status(400).json({
        ok: false,
        error: 'Customer must message first (24h window closed)'
      });
    }

    const mimeType = req.file.mimetype || 'application/octet-stream';
    const filename = req.file.originalname || 'file';
    const type = waTypeFromMime(mimeType, req.body?.type);

    const uploaded = await wa.uploadMedia(req.file.buffer, {
      filename,
      mimeType,
      type: mimeType
    });
    if (!uploaded.ok) return res.status(502).json(uploaded);

    const result = await wa.sendMedia(
      phone,
      {
        type,
        mediaId: uploaded.id,
        caption: caption || undefined,
        filename: type === 'document' ? filename : undefined
      },
      { by: req.body?.who || req.inboxUser }
    );
    if (!result.ok) return res.status(502).json(result);
    return res.json({ ok: true, result, mediaId: uploaded.id, type });
  } catch (err) {
    console.error('[inbox media]', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/inbox/api/media/:mediaId', requireInbox, async (req, res) => {
  try {
    const downloaded = await wa.downloadMedia(req.params.mediaId);
    if (!downloaded.ok) return res.status(404).json(downloaded);
    res.setHeader('Content-Type', downloaded.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return res.send(downloaded.buffer);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ----- OTP (Meta WhatsApp) -----
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many OTP requests. Try again later.' }
});

app.post('/api/otp/request', otpLimiter, async (req, res) => {
  try {
    const result = await otp.requestOtp(req.body?.phone || req.body?.mobile);
    if (!result.ok) {
      return res.status(result.detail ? 502 : 400).json({
        ok: false,
        error: result.error,
        detail: result.detail || undefined
      });
    }
    return res.json({
      ok: true,
      phoneMasked: maskPhone(result.phone),
      expiresIn: result.expiresIn,
      mode: result.mode
    });
  } catch (err) {
    console.error('[OTP request]', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/otp/verify', otpLimiter, (req, res) => {
  const result = otp.verifyOtp(req.body?.phone || req.body?.mobile, req.body?.otp || req.body?.code);
  if (!result.ok) return res.status(400).json(result);
  return res.json({
    ok: true,
    phoneMasked: maskPhone(result.phone),
    token: result.token
  });
});

// ----- Returns / Exchanges -----
app.post('/api/returns', async (req, res) => {
  try {
    const result = await createReturnRequest(req.body);
    if (!result.ok) return res.status(400).json(result);
    return res.status(201).json(result);
  } catch (err) {
    console.error('[Returns]', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/returns', (_req, res) => {
  const db = loadReturns();
  res.json({ ok: true, count: db.requests.length, requests: db.requests.slice(0, 50) });
});

// ----- Shopify webhooks → WhatsApp -----
async function handleOrderCreate(req, res) {
  const auth = verifyShopifyHmac(req);
  if (!auth.ok) return res.status(401).json({ error: auth.error });
  try {
    const result = await notify('order_confirmed', req.body);
    return res.status(200).json(result);
  } catch (err) {
    console.error('[orders-create WA]', err.message);
    return res.status(500).json({ error: err.message });
  }
}

app.post('/webhooks/shopify/orders-create', handleOrderCreate);
app.post('/webhooks/shopify/orders-paid', handleOrderCreate);

app.post('/webhooks/shopify/fulfillments-create', async (req, res) => {
  const auth = verifyShopifyHmac(req);
  if (!auth.ok) return res.status(401).json({ error: auth.error });
  try {
    const fulfillment = req.body;
    // Fulfillment webhook payload includes order_id; build minimal order shell
    const order = {
      id: fulfillment.order_id,
      name: fulfillment.name || `#${fulfillment.order_id}`,
      phone: fulfillment.destination?.phone,
      shipping_address: fulfillment.destination,
      email: fulfillment.email,
      fulfillments: [fulfillment],
      order_status_url: fulfillment.tracking_url
    };
    const shipmentEvent =
      fulfillment.shipment_status === 'delivered'
        ? 'order_delivered'
        : fulfillment.shipment_status === 'in_transit' || fulfillment.shipment_status === 'out_for_delivery'
          ? 'order_in_transit'
          : 'order_shipped';
    const result = await notify(shipmentEvent, order, {
      fulfillment,
      fulfillmentId: fulfillment.id
    });
    return res.status(200).json(result);
  } catch (err) {
    console.error('[fulfillments-create WA]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

app.post('/webhooks/shopify/fulfillments-update', async (req, res) => {
  const auth = verifyShopifyHmac(req);
  if (!auth.ok) return res.status(401).json({ error: auth.error });
  try {
    const fulfillment = req.body;
    const order = {
      id: fulfillment.order_id,
      name: fulfillment.name || `#${fulfillment.order_id}`,
      phone: fulfillment.destination?.phone,
      shipping_address: fulfillment.destination,
      fulfillments: [fulfillment]
    };
    let event = 'order_in_transit';
    if (fulfillment.shipment_status === 'delivered') event = 'order_delivered';
    else if (fulfillment.shipment_status === 'failure') event = 'order_shipped';
    const result = await notify(event, order, {
      fulfillment,
      fulfillmentId: `${fulfillment.id}:${fulfillment.shipment_status || 'update'}`
    });
    return res.status(200).json(result);
  } catch (err) {
    console.error('[fulfillments-update WA]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

app.post('/webhooks/shopify/orders-cancelled', async (req, res) => {
  const auth = verifyShopifyHmac(req);
  if (!auth.ok) return res.status(401).json({ error: auth.error });
  try {
    const result = await notify('order_cancelled', req.body);
    return res.status(200).json(result);
  } catch (err) {
    console.error('[orders-cancelled WA]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// Meta webhook verification (optional inbound)
app.get('/webhooks/meta', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === config.meta.webhookVerifyToken) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

app.post('/webhooks/meta', async (req, res) => {
  // Respond fast; persist after ack so Meta does not retry on slow Turso writes
  res.sendStatus(200);
  try {
    const saved = await inbox.ingestMetaWebhook(req.body || {});
    if (saved.length) console.log(`[Meta inbox] ${saved.length} message(s)`);
    const autoReply = require('./lib/auto-reply');
    for (const row of saved) {
      if (row.direction !== 'inbound') continue;
      try {
        const ar = await autoReply.handleInbound({
          phone: row.phone,
          text: row.text,
          name: row.name
        });
        if (ar?.ok) console.log(`[auto-reply] ${row.phone} reason=${ar.reason}`);
      } catch (err) {
        console.error('[auto-reply]', err.message);
      }
    }
  } catch (err) {
    console.error('[Meta inbox]', err.message);
  }
});

// Debug: send a test WA message
app.post('/debug/send-wa', async (req, res) => {
  try {
    const { phone, message } = req.body || {};
    if (!phone || !message) {
      return res.status(400).json({ ok: false, error: 'phone and message required' });
    }
    const { normalizePhone } = require('./lib/phone');
    const to = normalizePhone(phone);
    if (!to) return res.status(400).json({ ok: false, error: 'invalid phone' });
    const result = await wa.sendText(to, message);
    return res.status(result.ok ? 200 : 502).json(result);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

if (require.main === module) {
  app.listen(config.port, () => {
    const store = require('./lib/store');
    console.log(`[KC Customer Ops] http://localhost:${config.port}`);
    console.log(`[KC Customer Ops] WhatsApp configured: ${wa.isConfigured()}`);
    console.log(
      `[KC Customer Ops] Inbox persistence: ${store.persistenceMode()}` +
        (store.isRemote() ? ' (Turso — survives redeploys)' : ' (local only — set TURSO_* for forever history)')
    );
    console.log(`[KC Customer Ops] Inbox data dir: ${store.DATA_DIR}`);
    console.log(`[KC Customer Ops] POST /api/otp/request  /api/otp/verify  /api/returns`);
    console.log(`[KC Customer Ops] POST /webhooks/shopify/orders-create|fulfillments-create|fulfillments-update|orders-cancelled`);
    console.log(`[KC Customer Ops] Team inbox: http://localhost:${config.port}/inbox`);
  });
}

module.exports = app;
