const { readJson, writeJson } = require('./store');

const FILE = 'inbox-settings.json';
const SETTINGS_VERSION = 4;

const DEFAULT_QUICK_REPLIES = [
  {
    id: 'menu',
    title: 'Main menu',
    body:
      'Thanks for reaching Keshav Clothing. Reply with a number:\n1 — Track order\n2 — Size help\n3 — Return / exchange\n4 — Payment / COD\n5 — Talk to our team'
  },
  {
    id: 'track',
    title: 'Ask order number',
    body:
      'Please share your order number (example: #1005). We will check courier tracking and update you here.'
  },
  {
    id: 'track_ack',
    title: 'Tracking — checking',
    body:
      'Thanks — we are checking this order with our courier partner and will share the latest status shortly.'
  },
  {
    id: 'return',
    title: 'Return / exchange',
    body:
      'For return or exchange: share order number + reason (size / fit / damage) and a clear photo if possible. Security seal must be intact — no return if the seal is broken. We will guide you as per policy.'
  },
  {
    id: 'size',
    title: 'Size help',
    body:
      'For sizing help, send the product name and your usual size (or height/weight). We will suggest the best fit.'
  },
  {
    id: 'payment',
    title: 'Payment / COD',
    body:
      'We accept online payment and COD on eligible orders. Share your order number if you need a payment link or COD help.'
  },
  {
    id: 'delay',
    title: 'Checking with team',
    body: 'Thanks for waiting. Our team is checking this and will update you here shortly.'
  },
  {
    id: 'resolved',
    title: 'Closing',
    body: 'Happy to help. If you need anything else from Keshav Clothing, message us anytime.'
  },
  {
    id: 'hours',
    title: 'Business hours',
    body: 'WhatsApp desk hours: 10:00 AM – 7:00 PM IST, Monday to Saturday. We reply as soon as we can.'
  },
  {
    id: 'website',
    title: 'Website',
    body: 'Shop Keshav Clothing at https://keshavclothing.com — reply here for order help anytime.'
  }
];

const DEFAULT_KEYWORD_REPLIES = [
  {
    id: 'kw_track',
    keywords: ['track', 'tracking', 'where is my order', 'shipment', 'courier', 'delivery status', '1'],
    reply:
      'Please share your order number (example: #1005). We will check tracking and update you on this chat.'
  },
  {
    id: 'kw_return',
    keywords: ['return', 'exchange', 'refund', 'replace', '3'],
        reply:
          'For return or exchange, share your order number and the issue (size, fit, or damage). A photo helps. Important: no return/exchange if the yellow security seal is broken. We will guide you as per policy.'
      },
  {
    id: 'kw_size',
    keywords: ['size', 'sizing', 'fit', 'measurement', '2'],
    reply:
      'Happy to help with sizing. Send the product name and your usual size — we will recommend the best fit.'
  },
  {
    id: 'kw_pay',
    keywords: ['payment', 'pay', 'cod', 'upi', 'razorpay', '4'],
    reply:
      'We accept online payment and COD on eligible orders. Share your order number if you need payment help.'
  },
  {
    id: 'kw_human',
    keywords: ['agent', 'human', 'team', 'call me', 'speak', '5'],
    reply:
      'Understood — a Keshav Clothing team member will continue this chat shortly during desk hours (10 AM–7 PM IST, Mon–Sat).'
  },
  {
    id: 'kw_website',
    keywords: ['website', 'site', 'shop', 'catalogue', 'catalog', 'price'],
    reply:
      'You can browse and order at https://keshavclothing.com. Reply here if you need help with a product or order.'
  },
  {
    id: 'kw_hello',
    keywords: ['hi', 'hello', 'hey', 'namaste', 'good morning', 'good evening'],
    reply:
      'Hello from Keshav Clothing. Reply with a number:\n1 — Track order\n2 — Size help\n3 — Return / exchange\n4 — Payment / COD\n5 — Talk to our team'
  }
];

const DEFAULT_SETTINGS = {
  settingsVersion: SETTINGS_VERSION,
  autoReply: {
    enabled: true,
    /** Long cooldown for welcome / greeting / away */
    cooldownHours: 8,
    /** Short cooldown (minutes) between FAQ auto-replies so follow-up questions still get answers */
    faqCooldownMinutes: 3,
    welcomeEnabled: true,
    welcomeText:
      'Thanks for contacting Keshav Clothing. Reply with a number:\n1 — Track order\n2 — Size help\n3 — Return / exchange\n4 — Payment / COD\n5 — Talk to our team',
    awayEnabled: true,
    timezone: 'Asia/Kolkata',
    workDays: [1, 2, 3, 4, 5, 6],
    workStart: '10:00',
    workEnd: '19:00',
    awayText:
      'Thanks for messaging Keshav Clothing. Our desk is away right now. We reply 10:00 AM–7:00 PM IST (Mon–Sat). Leave your order number or question and we will follow up.',
    keywordReplies: DEFAULT_KEYWORD_REPLIES,
    orderNumberReply:
      'Thanks — we noted order {{order}}. Our team will check this and update you here shortly. For returns, also share the issue + a photo if you can.'
  },
  quickReplies: DEFAULT_QUICK_REPLIES,
  outreachTemplates: [
    {
      name: 'kc_team_note',
      label: 'Open / follow-up (clean)',
      params: ['Customer first name', 'Short note (e.g. How can we help you today?)']
    },
    {
      name: 'kc_inbox_hello',
      label: 'Open / follow-up (legacy)',
      params: ['Customer first name', 'Short note only (not a full greeting)']
    },
    {
      name: 'kc_support_ack',
      label: 'Support received',
      params: ['Name', 'Topic (tracking / sizing / return)']
    },
    {
      name: 'kc_return_guide',
      label: 'Return / exchange guide',
      params: ['Name', 'Order #']
    },
    {
      name: 'kc_store_info',
      label: 'Website info',
      params: ['Name']
    },
    {
      name: 'kc_order_confirmed',
      label: 'Order confirmed',
      params: ['Name', 'Order #', 'Amount', 'Invoice/order URL']
    },
    {
      name: 'kc_order_shipped',
      label: 'Order shipped',
      params: ['Name', 'Order #', 'Courier', 'Tracking URL']
    },
    {
      name: 'kc_order_in_transit',
      label: 'In transit',
      params: ['Name', 'Order #', 'Tracking URL']
    },
    {
      name: 'kc_order_delivered',
      label: 'Delivered',
      params: ['Name', 'Order #']
    },
    {
      name: 'kc_order_cancelled',
      label: 'Cancelled',
      params: ['Name', 'Order #']
    }
  ]
};

function deepMerge(base, patch) {
  if (!patch || typeof patch !== 'object') return base;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof out[k] === 'object' && !Array.isArray(out[k])) {
      out[k] = deepMerge(out[k] || {}, v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

async function getSettings() {
  const stored = await readJson(FILE, null);
  if (!stored) {
    const fresh = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    await writeJson(FILE, fresh);
    return fresh;
  }

  // One-time upgrade of copy/rules when we ship better defaults
  if (Number(stored.settingsVersion || 0) < SETTINGS_VERSION) {
    const upgraded = {
      ...DEFAULT_SETTINGS,
      autoReply: {
        ...DEFAULT_SETTINGS.autoReply,
        enabled: stored.autoReply?.enabled !== false,
        awayEnabled: stored.autoReply?.awayEnabled !== false,
        welcomeEnabled: stored.autoReply?.welcomeEnabled !== false,
        workStart: stored.autoReply?.workStart || DEFAULT_SETTINGS.autoReply.workStart,
        workEnd: stored.autoReply?.workEnd || DEFAULT_SETTINGS.autoReply.workEnd,
        workDays: stored.autoReply?.workDays || DEFAULT_SETTINGS.autoReply.workDays
      },
      settingsVersion: SETTINGS_VERSION
    };
    await writeJson(FILE, upgraded);
    return upgraded;
  }

  return deepMerge(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), stored);
}

async function saveSettings(patch) {
  const current = await getSettings();
  const next = deepMerge(current, patch || {});
  if (patch?.quickReplies) next.quickReplies = patch.quickReplies;
  if (patch?.autoReply?.keywordReplies) next.autoReply.keywordReplies = patch.autoReply.keywordReplies;
  if (patch?.outreachTemplates) next.outreachTemplates = patch.outreachTemplates;
  next.settingsVersion = SETTINGS_VERSION;
  await writeJson(FILE, next);
  return next;
}

async function resetAutomationDefaults() {
  const fresh = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  await writeJson(FILE, fresh);
  return fresh;
}

module.exports = {
  getSettings,
  saveSettings,
  resetAutomationDefaults,
  DEFAULT_SETTINGS,
  DEFAULT_QUICK_REPLIES,
  SETTINGS_VERSION
};
