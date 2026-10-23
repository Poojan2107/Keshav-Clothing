const wa = require('./whatsapp');
const inbox = require('./inbox');
const { getSettings } = require('./inbox-settings');

function parseHm(hm) {
  const [h, m] = String(hm || '0:0')
    .split(':')
    .map((n) => Number(n));
  return (h || 0) * 60 + (m || 0);
}

function nowInTimezone(tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz || 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hour12: false
    }).formatToParts(new Date());
    const get = (type) => parts.find((p) => p.type === type)?.value;
    const weekday = get('weekday'); // Mon, Tue…
    const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const hour = Number(get('hour'));
    const minute = Number(get('minute'));
    return { day: map[weekday] ?? new Date().getDay(), minutes: hour * 60 + minute };
  } catch {
    const d = new Date();
    return { day: d.getDay(), minutes: d.getHours() * 60 + d.getMinutes() };
  }
}

function isWithinBusinessHours(ar) {
  const { day, minutes } = nowInTimezone(ar.timezone);
  const days = ar.workDays || [1, 2, 3, 4, 5, 6];
  if (!days.includes(day)) return false;
  const start = parseHm(ar.workStart || '10:00');
  const end = parseHm(ar.workEnd || '19:00');
  return minutes >= start && minutes < end;
}

function matchKeyword(text, rules) {
  const hay = String(text || '').toLowerCase();
  if (!hay) return null;
  for (const rule of rules || []) {
    const keys = rule.keywords || [];
    for (const k of keys) {
      const needle = String(k || '')
        .toLowerCase()
        .trim();
      if (!needle) continue;
      // Short tokens need word boundaries ("hi" must not match "which")
      if (needle.length <= 3 || !needle.includes(' ')) {
        const re = new RegExp(`(?:^|[^a-z0-9])${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[^a-z0-9]|$)`, 'i');
        if (re.test(hay)) return rule;
      } else if (hay.includes(needle)) {
        return rule;
      }
    }
  }
  return null;
}

/**
 * After an inbound customer message is saved, optionally send an auto-reply.
 * Free-text is allowed because the customer just messaged (24h window open).
 */
async function handleInbound({ phone, text, name }) {
  if (!phone || !wa.isConfigured()) return null;
  const settings = await getSettings();
  const ar = settings.autoReply || {};
  if (!ar.enabled) return null;

  const conv = await inbox.getConversation(phone);
  const cooldownMs = Math.max(1, Number(ar.cooldownHours) || 12) * 60 * 60 * 1000;
  if (conv?.lastAutoReplyAt && Date.now() - Date.parse(conv.lastAutoReplyAt) < cooldownMs) {
    return { skipped: 'cooldown' };
  }

  let replyText = null;
  let reason = null;

  const kw = matchKeyword(text, ar.keywordReplies);
  if (kw?.reply) {
    replyText = kw.reply;
    reason = `keyword:${kw.id || 'match'}`;
  } else if (ar.awayEnabled && !isWithinBusinessHours(ar) && ar.awayText) {
    replyText = ar.awayText;
    reason = 'away';
  } else if (ar.welcomeEnabled && ar.welcomeText) {
    // Welcome only if this looks like a fresh/first contact recently
    const inboundCount = (conv?.messages || []).filter((m) => m.direction === 'inbound').length;
    if (inboundCount <= 1) {
      replyText = ar.welcomeText;
      reason = 'welcome';
    }
  }

  if (!replyText) return { skipped: 'no_rule' };

  // Light personalization
  const first = wa.greetNameFrom(name || conv?.name);
  if (first && first !== 'there' && !/^hi\b/i.test(replyText) && !/^hello\b/i.test(replyText)) {
    replyText = `Hi ${first}, ${replyText.charAt(0).toLowerCase()}${replyText.slice(1)}`;
  }

  const result = await wa.sendText(phone, replyText.slice(0, 4000), { by: 'auto-reply' });
  if (result.ok) {
    await inbox
      .updateConversation(phone, {
        lastAutoReplyAt: new Date().toISOString(),
        lastAutoReplyReason: reason
      })
      .catch(() => null);
  }
  return { ok: result.ok, reason, result };
}

module.exports = { handleInbound, isWithinBusinessHours, matchKeyword };
