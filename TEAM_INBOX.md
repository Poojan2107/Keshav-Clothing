# KC team WhatsApp chat inbox

Built into customer-ops (no Chatwoot / no work email needed).

**URL (live):** https://keshav-clothing.onrender.com/inbox  
**URL (after GoDaddy):** https://inbox.keshavclothing.com/inbox *(same app — see subdomain below)*

## Who (restricted)

Only this email can access (allowlist):
- `keshavclothingkc@gmail.com`

Login: that **email** + inbox password.  
Optional: **Sign in with Google** (same Gmail only) when `INBOX_GOOGLE_CLIENT_ID` is set.

Anyone else gets **403 / not allowed**.

## Render env (required)

```
INBOX_ENABLED=1
INBOX_PASSWORD=keshav123
INBOX_TOKEN_SECRET=<random string>
INBOX_ALLOWED_EMAILS=keshavclothingkc@gmail.com
INBOX_GOOGLE_CLIENT_ID=<optional Google OAuth client id>
PUBLIC_BASE_URL=https://keshav-clothing.onrender.com
META_WEBHOOK_VERIFY_TOKEN=kc_wa_verify_change_me
DATA_DIR=/var/data
```

(Plus existing Meta token / phone ID.)

`DATA_DIR` stores chat history on disk (`inbox-conversations.json`). Without a persistent disk, redeploys can wipe history.

## Keep history (WhatsApp-like)

1. Render → your **Web Service** → **Disks**
2. Add a disk, mount path: `/var/data` (1 GB is enough)
3. Set env `DATA_DIR=/var/data`
4. Redeploy

Chats keep up to ~4000–5000 messages per contact with atomic writes + `.bak` backup. Inbound customer messages, team replies, media captions, and order template sends all land in the same thread.

## Brand / visuals

Inbox UI matches **Keshav Clothing** site cues:
- Display: **Oswald** (uppercase / letter-spacing like store headings)
- Body: **Inter**
- Palette: `#171717` black, gray borders, white panels
- Chat layout stays WhatsApp-like (list + bubbles + 24h session)

## GoDaddy → unified subdomain (when DNS access is ready)

Wire so store + inbox feel like one brand:

1. GoDaddy → **DNS** for `keshavclothing.com`
2. Add **CNAME**:
   - **Host:** `inbox`
   - **Points to:** `keshav-clothing.onrender.com`
   - TTL: default / 1 hour
3. Render → Web Service → **Custom Domains** → add `inbox.keshavclothing.com` → wait for SSL
4. Update env:
   ```
   PUBLIC_BASE_URL=https://inbox.keshavclothing.com
   ```
5. Meta webhook Callback URL (optional but cleaner):
   `https://inbox.keshavclothing.com/webhooks/meta`  
   (same verify token; can keep the onrender.com URL if already verified)
6. Team bookmark: **https://inbox.keshavclothing.com/inbox**

Do **not** change Meta phone number or WABA — only the hostname in front of the same app.

## Meta webhook (required for inbound chats)

1. [developers.facebook.com](https://developers.facebook.com) → your WhatsApp app  
2. WhatsApp → **Configuration** → Webhook  
3. **Callback URL:** `https://keshav-clothing.onrender.com/webhooks/meta`  
   *(or `https://inbox.keshavclothing.com/webhooks/meta` after custom domain)*  
4. **Verify token:** same as `META_WEBHOOK_VERIFY_TOKEN`  
5. Verify and save  
6. Subscribe to **messages** (and optionally `message_template_status_update`)

## How it works

| Direction | Path |
|-----------|------|
| Customer → business | Meta webhook → `/inbox` |
| Team reply | `/inbox` → Cloud API (within 24h of last customer message) |
| Order templates | Shopify → Render (unchanged; also logged into chat history) |

## Features

- Full chat history per customer (persisted when `DATA_DIR` + disk is set)  
- Text replies  
- **Attach** images, video, audio, PDF/docs  
- **Camera** / photo capture (mobile)  
- View inbound photos/files from customers  

## Limits

- Free-form reply + media only inside WhatsApp **24-hour** customer service window (customer must message first, or after they reply to an order template).  
- Not full WhatsApp app (no Status, Communities, etc.) — core chat + media for the team.  
- Change `INBOX_PASSWORD` anytime in Render → Environment → Save.
