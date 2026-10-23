# KC team WhatsApp chat inbox

Built into customer-ops (no Chatwoot / no work email needed).

**URL:** https://keshav-clothing.onrender.com/inbox

## Who

Share with:
- keshavclothingkc@gmail.com (Parth / KC)
- Parth (and anyone else who should reply)

They open the link → enter **name** + **team password** → see chats → reply.

## Render env (required)

```
INBOX_ENABLED=1
INBOX_PASSWORD=keshav123
INBOX_TOKEN_SECRET=<random string>
PUBLIC_BASE_URL=https://keshav-clothing.onrender.com
META_WEBHOOK_VERIFY_TOKEN=kc_wa_verify_change_me
```

(Plus existing Meta token / phone ID.)

## Meta webhook (required for inbound chats)

1. [developers.facebook.com](https://developers.facebook.com) → your WhatsApp app  
2. WhatsApp → **Configuration** → Webhook  
3. **Callback URL:** `https://keshav-clothing.onrender.com/webhooks/meta`  
4. **Verify token:** same as `META_WEBHOOK_VERIFY_TOKEN`  
5. Verify and save  
6. Subscribe to **messages** (and optionally `message_template_status_update`)

## How it works

| Direction | Path |
|-----------|------|
| Customer → business | Meta webhook → `/inbox` |
| Team reply | `/inbox` → Cloud API (within 24h of last customer message) |
| Order templates | Shopify → Render (unchanged) |

## Limits

- Free-form reply only inside WhatsApp **24-hour** customer service window (customer must message first, or after they reply to an order template).  
- Render free disk is ephemeral — old chats may reset on redeploy; fine for live ops, not a forever archive.  
- Change `INBOX_PASSWORD` anytime in Render → Environment → Save.
