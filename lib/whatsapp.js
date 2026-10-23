const axios = require('axios');
const config = require('../config');

function graphUrl(path) {
  return `https://graph.facebook.com/${config.meta.graphVersion}${path}`;
}

function isConfigured() {
  return Boolean(config.meta.token && config.meta.phoneNumberId);
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
        Authorization: `Bearer ${config.meta.token}`,
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

async function sendDocument(toDigits, { link, filename, caption }) {
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
  graphUrl
};
