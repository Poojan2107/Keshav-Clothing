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
    default:
      return params.length ? `📤 ${name}: ${params.join(' · ')}` : `📤 ${name}`;
  }
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

    inbox.recordOutbound(phone, {
      type: outType,
      text,
      mediaId,
      filename,
      caption,
      id: msgId,
      by: by || 'system'
    });
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
  sendDocument,
  sendMedia,
  uploadMedia,
  getMediaMeta,
  downloadMedia,
  graphUrl
};
