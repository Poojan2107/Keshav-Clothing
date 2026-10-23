const wa = require('./whatsapp');
const inbox = require('./inbox');
const { getSettings } = require('./inbox-settings');

const FAQ_REASONS = new Set([
  'order_ref',
  'kw_track',
  'kw_return',
  'kw_size',
  'kw_pay',
  'kw_human',
  'kw_website',
  'menu'
]);

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
    const weekday = get('weekday');
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

function extractOrderRef(text) {
  const raw = String(text || '');
  const hash = raw.match(/#\s?(\d{3,8})\b/);
  if (hash) return `#${hash[1]}`;
  const labeled = raw.match(/\b(?:order|ord|order\s*no\.?|order\s*number)\s*[:#-]?\s*(\d{3,8})\b/i);
  if (labeled) return `#${labeled[1]}`;
  // bare 4–6 digit number alone in short message
  const alone = raw.trim().match(/^#?\s?(\d{4,6})$/);
  if (alone) return `#${alone[1]}`;
  return null;
}

function matchKeyword(text, rules) {
  const hay = String(text || '').toLowerCase().trim();
  if (!hay) return null;

  // Exact menu digits win first
  if (/^[1-5]$/.test(hay)) {
    const byDigit = (rules || []).find((r) => (r.keywords || []).includes(hay));
    if (byDigit) return byDigit;
  }

  for (const rule of rules || []) {
    const keys = rule.keywords || [];
    for (const k of keys) {
      const needle = String(k || '')
        .toLowerCase()
        .trim();
      if (!needle || /^[1-5]$/.test(needle)) continue;
      if (needle.length <= 3 || !needle.includes(' ')) {
        const re = new RegExp(
          `(?:^|[^a-z0-9])${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[^a-z0-9]|$)`,
          'i'
        );
        if (re.test(hay)) return rule;
      } else if (hay.includes(needle)) {
        return rule;
      }
    }
  }
  return null;
}

function shouldSkipCooldown(conv, reason, ar) {
  if (!conv?.lastAutoReplyAt) return false;
  const elapsed = Date.now() - Date.parse(conv.lastAutoReplyAt);
  // Hard floor against webhook double-delivery
  if (elapsed < 40 * 1000) return true;
  const faqMs = Math.max(1, Number(ar.faqCooldownMinutes) || 3) * 60 * 1000;
  const longMs = Math.max(1, Number(ar.cooldownHours) || 8) * 60 * 60 * 1000;
  const key = String(reason || '').replace(/^keyword:/, '');
  const isFaq = FAQ_REASONS.has(key);
  if (isFaq) {
    if (conv.lastAutoReplyReason === key && elapsed < faqMs) return true;
    return false;
  }
  return elapsed < longMs;
}

function personalize(replyText, name, convName) {
  let text = String(replyText || '').trim();
  if (!text) return text;
  if (/^(hi|hello|hey|thanks|thank you)\b/i.test(text)) return text;
  const first = wa.greetNameFrom(name || convName);
  if (first && first !== 'there') {
    return `Hi ${first} — ${text}`;
  }
  return text;
}

/**
 * One automatic answer per inbound message (FAQ / menu / order # / away / welcome).
 */
async function handleInbound({ phone, text, name }) {
  if (!phone || !wa.isConfigured()) return null;
  const settings = await getSettings();
  const ar = settings.autoReply || {};
  if (!ar.enabled) return null;

  const conv = await inbox.getConversation(phone);
  const inboundText = String(text || '').trim();

  let replyText = null;
  let reason = null;

  // 1) Order number → acknowledge (highest value automation)
  const orderRef = extractOrderRef(inboundText);
  if (orderRef) {
    const tpl =
      ar.orderNumberReply ||
      'Thanks — we noted order {{order}}. Our team will check this and update you here shortly.';
    replyText = tpl.replace(/\{\{order\}\}/gi, orderRef);
    reason = 'order_ref';
  }

  // 2) Keyword / menu intents
  if (!replyText) {
    const kw = matchKeyword(inboundText, ar.keywordReplies);
    if (kw?.reply) {
      replyText = kw.reply;
      reason = kw.id || 'keyword:match';
    }
  }

  // 3) Away (only if no FAQ match)
  if (!replyText && ar.awayEnabled && !isWithinBusinessHours(ar) && ar.awayText) {
    replyText = ar.awayText;
    reason = 'away';
  }

  // 4) Welcome menu — first inbound only
  if (!replyText && ar.welcomeEnabled && ar.welcomeText) {
    const inboundCount = (conv?.messages || []).filter((m) => m.direction === 'inbound').length;
    if (inboundCount <= 1) {
      replyText = ar.welcomeText;
      reason = 'welcome';
    }
  }

  if (!replyText) return { skipped: 'no_rule' };

  if (shouldSkipCooldown(conv, reason, ar)) {
    return { skipped: 'cooldown', reason };
  }

  replyText = personalize(replyText, name, conv?.name);

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

module.exports = {
  handleInbound,
  isWithinBusinessHours,
  matchKeyword,
  extractOrderRef
};
