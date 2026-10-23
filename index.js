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
    inboxEnabled: Boolean(config.inbox.enabled && config.inbox.password),
    returnWindowDays: config.returnWindowDays,
    timestamp: new Date().toISOString()
  });
});

function signInboxToken(who) {
  const body = Buffer.from(JSON.stringify({ who, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 })).toString(
    'base64url'
  );
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
  if (!session) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  req.inboxUser = session.who || 'team';
  return next();
}

app.get('/inbox', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'inbox.html'));
});

app.post('/inbox/api/login', (req, res) => {
  if (!config.inbox.enabled || !config.inbox.password) {
    return res.status(503).json({ ok: false, error: 'Inbox not configured' });
  }
  const password = String(req.body?.password || '');
  if (password !== config.inbox.password) {
    return res.status(401).json({ ok: false, error: 'Wrong password' });
  }
  const who = String(req.body?.who || 'team').slice(0, 40);
  return res.json({ ok: true, token: signInboxToken(who), who });
});

app.get('/inbox/api/conversations', requireInbox, (_req, res) => {
  res.json({ ok: true, conversations: inbox.listConversations() });
});

app.get('/inbox/api/conversations/:phone', requireInbox, (req, res) => {
  const phone = normalizePhone(req.params.phone);
  const conversation = inbox.getConversation(phone);
  if (!conversation) return res.status(404).json({ ok: false, error: 'Not found' });
  inbox.markRead(phone);
  res.json({
    ok: true,
    conversation: inbox.getConversation(phone),
    canReplySession: inbox.canSendSession(phone)
  });
});

app.post('/inbox/api/reply', requireInbox, async (req, res) => {
  try {
    const phone = normalizePhone(req.body?.phone);
    const text = String(req.body?.text || '').trim();
    if (!phone || !text) return res.status(400).json({ ok: false, error: 'phone and text required' });
    if (!inbox.canSendSession(phone)) {
      return res.status(400).json({
        ok: false,
        error: 'Customer must message first (24h window closed)'
      });
    }
    const result = await wa.sendText(phone, text);
    if (!result.ok) return res.status(502).json(result);
    inbox.recordOutbound(phone, {
      type: 'text',
      text,
      id: result.data?.messages?.[0]?.id,
      by: req.body?.who || req.inboxUser
    });
    return res.json({ ok: true, result });
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
    if (!inbox.canSendSession(phone)) {
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

    const result = await wa.sendMedia(phone, {
      type,
      mediaId: uploaded.id,
      caption: caption || undefined,
      filename: type === 'document' ? filename : undefined
    });
    if (!result.ok) return res.status(502).json(result);

    inbox.recordOutbound(phone, {
      type,
      text: caption || filename,
      caption: caption || null,
      filename,
      mediaId: uploaded.id,
      mimeType,
      id: result.data?.messages?.[0]?.id,
      by: req.body?.who || req.inboxUser
    });
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

app.post('/webhooks/meta', (req, res) => {
  try {
    const saved = inbox.ingestMetaWebhook(req.body || {});
    if (saved.length) console.log(`[Meta inbox] ${saved.length} inbound message(s)`);
  } catch (err) {
    console.error('[Meta inbox]', err.message);
  }
  res.sendStatus(200);
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
    console.log(`[KC Customer Ops] http://localhost:${config.port}`);
    console.log(`[KC Customer Ops] WhatsApp configured: ${wa.isConfigured()}`);
    console.log(`[KC Customer Ops] POST /api/otp/request  /api/otp/verify  /api/returns`);
    console.log(`[KC Customer Ops] POST /webhooks/shopify/orders-create|fulfillments-create|fulfillments-update|orders-cancelled`);
    console.log(`[KC Customer Ops] Team inbox: http://localhost:${config.port}/inbox`);
  });
}

module.exports = app;
