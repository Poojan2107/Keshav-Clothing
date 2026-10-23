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

async function sendPayload(payload) {
  if (!isConfigured()) {
    const err = new Error('WhatsApp not configured (META_WHATSAPP_TOKEN / META_PHONE_NUMBER_ID)');
    err.code = 'WA_NOT_CONFIGURED';
    throw err;
  }

  const url = graphUrl(`/${config.meta.phoneNumberId}/messages`);
  try {
    const res = await axios.post(url, payload, {
      headers: {
        ...authHeaders(),
        'Content-Type': 'application/json'
      },
      timeout: 20000
    });
    return { ok: true, data: res.data };
  } catch (err) {
    const detail = err.response?.data || { message: err.message };
    return { ok: false, error: detail };
  }
}

/**
 * Upload binary to Meta media API. Returns { ok, id } or { ok:false, error }.
 * type: image | document | audio | video | sticker
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

async function sendMedia(toDigits, { type, mediaId, caption, filename }) {
  const body = { id: mediaId };
  if (caption && (type === 'image' || type === 'video' || type === 'document')) {
    body.caption = String(caption).slice(0, 1024);
  }
  if (filename && type === 'document') body.filename = filename;
  return sendPayload({
    messaging_product: 'whatsapp',
    to: toDigits,
    type,
    [type]: body
  });
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
async function sendTemplate(toDigits, templateName, bodyParams = [], languageCode = config.templates.language) {
  const components = [];
  if (bodyParams.length) {
    components.push({
      type: 'body',
      parameters: bodyParams.map((text) => ({ type: 'text', text: String(text ?? '') }))
    });
  }

  return sendPayload({
    messaging_product: 'whatsapp',
    to: toDigits,
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode },
      ...(components.length ? { components } : {})
    }
  });
}

async function sendText(toDigits, body) {
  return sendPayload({
    messaging_product: 'whatsapp',
    to: toDigits,
    type: 'text',
    text: { preview_url: true, body: String(body) }
  });
}

/**
 * Prefer template; optionally fall back to plaintext (24h window only).
 */
async function sendTemplateOrText(toDigits, templateName, bodyParams, plaintext) {
  const tpl = await sendTemplate(toDigits, templateName, bodyParams);
  if (tpl.ok) return { ...tpl, mode: 'template' };

  if (config.allowPlaintextFallback && plaintext) {
    const txt = await sendText(toDigits, plaintext);
    return { ...txt, mode: 'plaintext', templateError: tpl.error };
  }

  return { ...tpl, mode: 'template' };
}

async function sendDocument(toDigits, { link, filename, caption, mediaId }) {
  if (mediaId) {
    return sendMedia(toDigits, { type: 'document', mediaId, caption, filename });
  }
  return sendPayload({
    messaging_product: 'whatsapp',
    to: toDigits,
    type: 'document',
    document: {
      link,
      filename: filename || 'invoice.pdf',
      ...(caption ? { caption } : {})
    }
  });
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
