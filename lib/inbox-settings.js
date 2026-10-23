const { readJson, writeJson } = require('./store');

const FILE = 'inbox-settings.json';

const DEFAULT_QUICK_REPLIES = [
  {
    id: 'greet',
    title: 'Welcome',
    body: 'Hello! Thank you for contacting Keshav Clothing. How may we help you today?'
  },
  {
    id: 'track',
    title: 'Order tracking',
    body: 'Please share your order number (e.g. #1005). We will check the tracking status and update you here.'
  },
  {
    id: 'return',
    title: 'Return / exchange',
    body: 'We support returns/exchanges within our policy window. Share your order number and reason, and we will guide you step by step. You can also start at https://keshavclothing.com'
  },
  {
    id: 'size',
    title: 'Size help',
    body: 'Happy to help with sizing. Tell us the product name and your usual size — we will recommend the best fit.'
  },
  {
    id: 'payment',
    title: 'Payment / COD',
    body: 'We accept online payment and COD on eligible orders. If a payment link is needed, share your order number and we will assist.'
  },
  {
    id: 'delay',
    title: 'Slight delay',
    body: 'Thanks for your patience. We are checking this with our team and will update you shortly.'
  },
  {
    id: 'resolved',
    title: 'Resolved',
    body: 'Glad we could help! If you need anything else from Keshav Clothing, just message us here.'
  },
  {
    id: 'hours',
    title: 'Business hours',
    body: 'Our WhatsApp desk is usually available 10:00 AM – 7:00 PM IST, Monday to Saturday. We will reply as soon as we can.'
  }
];

const DEFAULT_SETTINGS = {
  autoReply: {
    enabled: true,
    cooldownHours: 12,
    welcomeEnabled: true,
    welcomeText:
      'Thank you for contacting Keshav Clothing. Our team has received your message and will reply shortly. Shop: https://keshavclothing.com',
    awayEnabled: true,
    timezone: 'Asia/Kolkata',
    /** 0=Sun … 6=Sat — default Mon–Sat */
    workDays: [1, 2, 3, 4, 5, 6],
    workStart: '10:00',
    workEnd: '19:00',
    awayText:
      'Thank you for messaging Keshav Clothing. We are currently away from the desk. Our team replies between 10:00 AM and 7:00 PM IST (Mon–Sat). We will get back to you soon.',
    keywordReplies: [
      {
        id: 'kw_track',
        keywords: ['track', 'tracking', 'where is my order', 'shipment', 'courier'],
        reply:
          'Please share your order number. We will check tracking with our courier partner and update you here.'
      },
      {
        id: 'kw_return',
        keywords: ['return', 'exchange', 'refund', 'replace'],
        reply:
          'For returns or exchanges, share your order number and the issue (size/fit/damage). Our team will guide you as per policy.'
      },
      {
        id: 'kw_hello',
        keywords: ['hi', 'hello', 'hey', 'namaste'],
        reply:
          'Hello! Welcome to Keshav Clothing. How can we help — order, sizing, tracking, or returns?'
      }
    ]
  },
  quickReplies: DEFAULT_QUICK_REPLIES,
  /** Named outbound templates the team can fill from inbox */
  outreachTemplates: [
    {
      name: 'kc_inbox_hello',
      label: 'Open / follow-up chat',
      params: ['Customer first name', 'Your note (short)']
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
    },
    {
      name: 'kc_support_ack',
      label: 'Support received',
      params: ['Name', 'Topic (e.g. sizing / tracking)']
    },
    {
      name: 'kc_return_guide',
      label: 'Return / exchange guide',
      params: ['Name', 'Order #']
    },
    {
      name: 'kc_store_info',
      label: 'Store & website info',
      params: ['Name']
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
  if (!stored) return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  return deepMerge(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), stored);
}

async function saveSettings(patch) {
  const current = await getSettings();
  const next = deepMerge(current, patch || {});
  // Allow full replace of arrays when provided
  if (patch?.quickReplies) next.quickReplies = patch.quickReplies;
  if (patch?.autoReply?.keywordReplies) next.autoReply.keywordReplies = patch.autoReply.keywordReplies;
  if (patch?.outreachTemplates) next.outreachTemplates = patch.outreachTemplates;
  await writeJson(FILE, next);
  return next;
}

module.exports = {
  getSettings,
  saveSettings,
  DEFAULT_SETTINGS,
  DEFAULT_QUICK_REPLIES
};
