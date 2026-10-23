/**
 * Submit KC Utility WhatsApp templates to the WABA (Meta review).
 * Usage: node scripts/create_wa_templates.js
 *
 * Requires META_WHATSAPP_TOKEN + META_WABA_ID in .env
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const axios = require('axios');

const token = process.env.META_WHATSAPP_TOKEN;
const wabaId = process.env.META_WABA_ID;
const version = process.env.META_GRAPH_VERSION || 'v21.0';
const lang = process.env.WA_TEMPLATE_LANGUAGE || 'en';

const TEMPLATES = [
  {
    name: 'kc_order_confirmed',
    category: 'UTILITY',
    language: lang,
    components: [
      {
        type: 'BODY',
        text: 'Hi {{1}}, your Keshav Clothing order {{2}} is confirmed. Total amount is {{3}}. You can view your invoice here: {{4}}. Thank you for shopping with us.',
        example: {
          body_text: [['Rahul', '#1005', '₹1,999', 'https://keshavclothing.com/account/orders']]
        }
      }
    ]
  },
  {
    name: 'kc_order_shipped',
    category: 'UTILITY',
    language: lang,
    components: [
      {
        type: 'BODY',
        text: 'Hi {{1}}, your Keshav Clothing order {{2}} has been shipped via {{3}}. Track your shipment here: {{4}}. We will notify you again when it is out for delivery.',
        example: {
          body_text: [['Rahul', '#1005', 'Shiprocket', 'https://tracking.example/abc']]
        }
      }
    ]
  },
  {
    name: 'kc_order_in_transit',
    category: 'UTILITY',
    language: lang,
    components: [
      {
        type: 'BODY',
        text: 'Hi {{1}}, your Keshav Clothing order {{2}} is in transit with the courier. Track your package here: {{3}}. Reply if you need any help with delivery.',
        example: {
          body_text: [['Rahul', '#1005', 'https://tracking.example/abc']]
        }
      }
    ]
  },
  {
    name: 'kc_order_delivered',
    category: 'UTILITY',
    language: lang,
    components: [
      {
        type: 'BODY',
        text: 'Hi {{1}}, order {{2}} has been delivered. Thank you for shopping Keshav Clothing!',
        example: {
          body_text: [['Rahul', '#1005']]
        }
      }
    ]
  },
  {
    name: 'kc_order_cancelled',
    category: 'UTILITY',
    language: lang,
    components: [
      {
        type: 'BODY',
        text: 'Hi {{1}}, order {{2}} has been cancelled. Reply if you need help.',
        example: {
          body_text: [['Rahul', '#1005']]
        }
      }
    ]
  },
  {
    name: 'kc_inbox_hello',
    category: 'UTILITY',
    language: lang,
    components: [
      {
        type: 'BODY',
        text: 'Hi {{1}}, this is Keshav Clothing. {{2}} Please reply to continue chatting with our team.',
        example: {
          body_text: [
            ['Rahul', 'We are following up on your enquiry with our team.']
          ]
        }
      }
    ]
  },
  {
    name: 'kc_support_ack',
    category: 'UTILITY',
    language: lang,
    components: [
      {
        type: 'BODY',
        text: 'Hi {{1}}, we received your message about {{2}}. The Keshav Clothing team will assist you on this chat shortly.',
        example: {
          body_text: [['Rahul', 'order tracking']]
        }
      }
    ]
  },
  {
    name: 'kc_return_guide',
    category: 'UTILITY',
    language: lang,
    components: [
      {
        type: 'BODY',
        text: 'Hi {{1}}, regarding order {{2}}: please share photos of the product and the issue (size, fit, or damage). Our Keshav Clothing team will guide you on return or exchange as per policy.',
        example: {
          body_text: [['Rahul', '#1005']]
        }
      }
    ]
  },
  {
    name: 'kc_store_info',
    category: 'UTILITY',
    language: lang,
    components: [
      {
        type: 'BODY',
        text: 'Hi {{1}}, thank you for choosing Keshav Clothing. Shop online at https://keshavclothing.com — reply here for order help, sizing, tracking, or returns.',
        example: {
          body_text: [['Rahul']]
        }
      }
    ]
  },
  {
    name: 'kc_team_note',
    category: 'UTILITY',
    language: lang,
    components: [
      {
        type: 'BODY',
        text: 'Hi {{1}}, Keshav Clothing here — {{2}}',
        example: {
          body_text: [['Rahul', 'How can we help you today?']]
        }
      }
    ]
  }
];

async function listExisting() {
  const url = `https://graph.facebook.com/${version}/${wabaId}/message_templates?limit=50`;
  const res = await axios.get(url, {
    headers: { Authorization: `Bearer ${token}` },
    validateStatus: () => true
  });
  if (res.status >= 400) {
    console.error('list_failed', res.status, JSON.stringify(res.data).slice(0, 400));
    return [];
  }
  return res.data.data || [];
}

async function createOne(tpl) {
  const url = `https://graph.facebook.com/${version}/${wabaId}/message_templates`;
  const res = await axios.post(url, tpl, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    validateStatus: () => true
  });
  return { status: res.status, data: res.data };
}

async function main() {
  if (!token || !wabaId) {
    console.error('Need META_WHATSAPP_TOKEN and META_WABA_ID in .env');
    process.exit(1);
  }
  console.log('WABA', wabaId);

  const existing = await listExisting();
  const byName = new Map(existing.map((t) => [t.name, t]));
  console.log(
    'existing',
    existing.map((t) => `${t.name}:${t.status}`).join(', ') || '(none)'
  );

  for (const tpl of TEMPLATES) {
    const found = byName.get(tpl.name);
    if (found) {
      console.log('SKIP', tpl.name, 'already', found.status, found.id);
      continue;
    }
    const result = await createOne(tpl);
    if (result.status >= 400) {
      console.error('FAIL', tpl.name, JSON.stringify(result.data).slice(0, 500));
    } else {
      console.log('CREATED', tpl.name, JSON.stringify(result.data));
    }
  }

  const after = await listExisting();
  console.log('\n=== TEMPLATE STATUS ===');
  for (const name of TEMPLATES.map((t) => t.name)) {
    const t = after.find((x) => x.name === name);
    console.log(name, t ? `${t.status} (${t.id})` : 'MISSING');
  }
}

main().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
