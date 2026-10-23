const axios = require('axios');
const FormData = require('form-data');
const config = require('../config');

function graphUrl(path) {
  return `https://graph.facebook.com/${config.meta.graphVersion}${path}`;
}

function isConfigured() {
  return Boolean(config.meta.token && config.meta.phoneNumberId);
}

function authHeaders() {
  return { Authorization: `Bearer ${config.meta.token}` };
}

function formatTemplatePreview(name, params) {
  const [a, b, c, d] = params;
  switch (name) {
    case 'kc_order_confirmed':
      return `Hi ${a}, your Keshav Clothing order ${b} is confirmed. Total amount is ${c}. You can view your invoice here: ${d}. Thank you for shopping with us.`;
    case 'kc_order_shipped':
      return `Hi ${a}, your Keshav Clothing order ${b} has been shipped via ${c}. Track your shipment here: ${d}. We will notify you again when it is out for delivery.`;
    case 'kc_order_in_transit':
      return `Hi ${a}, your Keshav Clothing order ${b} is in transit with the courier. Track your package here: ${c}. Reply if you need any help with delivery.`;
    case 'kc_order_delivered':
      return `Hi ${a}, order ${b} has been delivered. Thank you for shopping Keshav Clothing!`;
    case 'kc_order_cancelled':
      return `Hi ${a}, order ${b} has been cancelled. Reply if you need help.`;
    case 'kc_inbox_hello':
    case 'kc_team_note': {
      const who = String(a || 'there').trim() || 'there';
      const note = sanitizeInboxNote(b);
      if (name === 'kc_team_note') {
        return `Hi ${who}, Keshav Clothing here — ${note}`;
      }
      return `Hi ${who}, this is Keshav Clothing. ${note} Please reply to continue chatting with our team.`;
    }
    case 'kc_support_ack':
      return `Hi ${a}, we received your message about ${b}. The Keshav Clothing team will assist you on this chat shortly.`;
    case 'kc_return_guide':
      return `Hi ${a}, regarding order ${b}: please share photos of the product and the issue (size, fit, or damage). Our Keshav Clothing team will guide you on return or exchange as per policy.`;
    case 'kc_store_info':
      return `Hi ${a}, thank you for choosing Keshav Clothing. Shop online at https://keshavclothing.com — reply here for order help, sizing, tracking, or returns.`;
    default:
      return params.length ? `📤 ${name}: ${params.join(' · ')}` : `📤 ${name}`;
  }
}

/** First name only for template {{1}} — avoids "Hi Parth Parekh KC," */
function greetNameFrom(name) {
  const raw = String(name || '')
    .replace(/\bKC\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw) return 'there';
  return raw.split(' ')[0].slice(0, 40);
}

const DEFAULT_INBOX_NOTE = 'How can we help you today?';

/**
 * Clean {{2}} for kc_inbox_hello so we never send "Hi Please reply…"
 * or double-wrap a full website/FAQ blurb inside the opener template.
 */
function sanitizeInboxNote(raw) {
  let note = String(raw || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!note) return DEFAULT_INBOX_NOTE;
  // Bare greetings / placeholders → real note
  if (/^(hi|hello|hey|namaste|test|ok|\.|-)[!.,]*$/i.test(note)) {
    return DEFAULT_INBOX_NOTE;
  }
  // If team pasted a full ready-made message, don't also force it through opener —
  // still use as note but strip trailing "please reply…" duplication
  note = note.replace(/\s*please reply to continue chatting with our team\.?\s*$/i, '').trim();
  // Drop leading "Hi … Keshav Clothing." if they pasted a full template body
  note = note.replace(/^hi\b[^.]{0,40}keshav clothing[^.]*\.\s*/i, '').trim();
  if (!note || note.length < 3) return DEFAULT_INBOX_NOTE;
  return note.slice(0, 200);
}

function logOutbound(payload, result, by) {
  if (!result?.ok) return;
  try {
    const inbox = require('./inbox');
    const phone = String(payload.to || '').replace(/\D/g, '');
    if (!phone) return;
    const msgId = result.data?.messages?.[0]?.id;
    const type = payload.type;
    let text = '';
    let mediaId = null;
    let filename = null;
    let caption = null;
    let outType = type;

    if (type === 'text') {
      text = payload.text?.body || '';
    } else if (type === 'template') {
      outType = 'text';
      const name = payload.template?.name || 'template';
      const params = [];
      for (const c of payload.template?.components || []) {
        if (String(c.type).toLowerCase() === 'body') {
          for (const p of c.parameters || []) {
            if (p.text != null) params.push(String(p.text));
          }
        }
      }
      text = formatTemplatePreview(name, params);
    } else if (['image', 'video', 'audio', 'document', 'sticker'].includes(type)) {
      const body = payload[type] || {};
      mediaId = body.id || null;
      caption = body.caption || null;
      filename = body.filename || null;
      text = caption || filename || `[${type}]`;
    } else {
      text = `[${type}]`;
    }

    Promise.resolve(
      inbox.recordOutbound(phone, {
        type: outType,
        text,
        mediaId,
        filename,
        caption,
        id: msgId,
        by: by || 'system'
      })
    ).catch((err) => console.error('[inbox outbound]', err.message));
  } catch (_) {
    /* inbox optional */
  }
}

async function sendPayload(payload, opts = {}) {
  if (!isConfigured()) {
    const err = new Error('WhatsApp not configured (META_WHATSAPP_TOKEN / META_PHONE_NUMBER_ID)');
    err.code = 'WA_NOT_CONFIGURED';
    throw err;
  }

  const by = opts.by || payload._inboxBy || 'system';
  const clean = { ...payload };
  delete clean._inboxBy;

  const url = graphUrl(`/${config.meta.phoneNumberId}/messages`);
  try {
    const res = await axios.post(url, clean, {
      headers: {
        ...authHeaders(),
        'Content-Type': 'application/json'
      },
      timeout: 20000
    });
    const result = { ok: true, data: res.data };
    if (opts.log !== false) logOutbound(clean, result, by);
    return result;
  } catch (err) {
    const detail = err.response?.data || { message: err.message };
    return { ok: false, error: detail };
  }
}

/**
 * Upload binary to Meta media API. Returns { ok, id } or { ok:false, error }.
 */
async function uploadMedia(buffer, { filename, mimeType, type }) {
  if (!isConfigured()) {
    return { ok: false, error: { message: 'WhatsApp not configured' } };
  }
  const form = new FormData();
  const mime = mimeType || 'application/octet-stream';
  form.append('messaging_product', 'whatsapp');
  form.append('type', type || mime);
  form.append('file', buffer, {
    filename: filename || 'file',
    contentType: mime
  });
  try {
    const res = await axios.post(graphUrl(`/${config.meta.phoneNumberId}/media`), form, {
      headers: { ...authHeaders(), ...form.getHeaders() },
      maxBodyLength: 64 * 1024 * 1024,
      timeout: 60000
    });
    return { ok: true, id: res.data?.id, data: res.data };
  } catch (err) {
    return { ok: false, error: err.response?.data || { message: err.message } };
  }
}

async function sendMedia(toDigits, { type, mediaId, caption, filename }, opts = {}) {
  const body = { id: mediaId };
  if (caption && (type === 'image' || type === 'video' || type === 'document')) {
    body.caption = String(caption).slice(0, 1024);
  }
  if (filename && type === 'document') body.filename = filename;
  return sendPayload(
    {
      messaging_product: 'whatsapp',
      to: toDigits,
      type,
      [type]: body
    },
    { by: opts.by || 'team' }
  );
}

async function getMediaMeta(mediaId) {
  try {
    const res = await axios.get(graphUrl(`/${mediaId}`), {
      headers: authHeaders(),
      timeout: 20000
    });
    return { ok: true, data: res.data };
  } catch (err) {
    return { ok: false, error: err.response?.data || { message: err.message } };
  }
}

async function downloadMedia(mediaId) {
  const meta = await getMediaMeta(mediaId);
  if (!meta.ok || !meta.data?.url) return meta;
  try {
    const res = await axios.get(meta.data.url, {
      headers: authHeaders(),
      responseType: 'arraybuffer',
      timeout: 60000
    });
    return {
      ok: true,
      buffer: Buffer.from(res.data),
      mimeType: meta.data.mime_type || res.headers['content-type'] || 'application/octet-stream',
      meta: meta.data
    };
  } catch (err) {
    return { ok: false, error: err.response?.data || { message: err.message } };
  }
}

/**
 * Send an approved template message.
 * bodyParams: string[] → {{1}}, {{2}}, ...
 */
async function sendTemplate(toDigits, templateName, bodyParams = [], languageCode = config.templates.language, opts = {}) {
  const components = [];
  if (bodyParams.length) {
    components.push({
      type: 'body',
      parameters: bodyParams.map((text) => ({ type: 'text', text: String(text ?? '') }))
    });
  }

  return sendPayload(
    {
      messaging_product: 'whatsapp',
      to: toDigits,
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode },
        ...(components.length ? { components } : {})
      }
    },
    { by: opts.by || 'orders-bot' }
  );
}

async function sendText(toDigits, body, opts = {}) {
  return sendPayload(
    {
      messaging_product: 'whatsapp',
      to: toDigits,
      type: 'text',
      text: { preview_url: true, body: String(body) }
    },
    { by: opts.by || 'team' }
  );
}

/**
 * Prefer template; optionally fall back to plaintext (24h window only).
 */
async function sendTemplateOrText(toDigits, templateName, bodyParams, plaintext, opts = {}) {
  const by = opts.by || 'orders-bot';
  const tpl = await sendTemplate(toDigits, templateName, bodyParams, config.templates.language, { by });
  if (tpl.ok) return { ...tpl, mode: 'template' };

  if (config.allowPlaintextFallback && plaintext) {
    const txt = await sendText(toDigits, plaintext, { by });
    return { ...txt, mode: 'plaintext', templateError: tpl.error };
  }

  return { ...tpl, mode: 'template' };
}

async function sendDocument(toDigits, { link, filename, caption, mediaId }, opts = {}) {
  if (mediaId) {
    return sendMedia(toDigits, { type: 'document', mediaId, caption, filename }, opts);
  }
  return sendPayload(
    {
      messaging_product: 'whatsapp',
      to: toDigits,
      type: 'document',
      document: {
        link,
        filename: filename || 'invoice.pdf',
        ...(caption ? { caption } : {})
      }
    },
    { by: opts.by || 'system' }
  );
}

module.exports = {
  isConfigured,
  sendTemplate,
  sendText,
  sendTemplateOrText,
  greetNameFrom,
  sanitizeInboxNote,
  formatTemplatePreview,
  sendDocument,
  sendMedia,
  uploadMedia,
  getMediaMeta,
  downloadMedia,
  graphUrl
};
