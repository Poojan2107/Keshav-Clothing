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

## Forever chat history (FREE — required on Render Free)

Render Free has **no disks**. Without a remote store, every redeploy / sleep wipes chats.  
We use **Turso** (free SQLite cloud — no credit card).

### One-time setup (~5 min)

1. Open [https://turso.tech](https://turso.tech) → **Sign up** with GitHub (Free plan).
2. Create a database, e.g. name `kc-inbox`, region closest to India (or default).
3. Open the database → **Tokens** → create a token (or use “Connect” / CLI output).
4. Copy:
   - **Database URL** — looks like `libsql://kc-inbox-xxxx.turso.io`
   - **Auth token** — long secret string
5. Render → **Keshav-Clothing** → **Environment** → add:

```
TURSO_DATABASE_URL=libsql://kc-inbox-xxxx.turso.io
TURSO_AUTH_TOKEN=eyJ...your-token...
```

6. **Save** → wait for redeploy.

After that, chats stay forever (refresh, redeploy, sleep — all fine).  
Logs should show: `Inbox persistence: turso (Turso — survives redeploys)`.

You do **not** need Render Starter / Disks.

## Render env (required)

```
INBOX_ENABLED=1
INBOX_PASSWORD=keshav123
INBOX_TOKEN_SECRET=<random string>
INBOX_ALLOWED_EMAILS=keshavclothingkc@gmail.com
INBOX_GOOGLE_CLIENT_ID=<optional Google OAuth client id>
PUBLIC_BASE_URL=https://keshav-clothing.onrender.com
META_WEBHOOK_VERIFY_TOKEN=kc_wa_verify_change_me
TURSO_DATABASE_URL=libsql://...
TURSO_AUTH_TOKEN=...
```

(Plus existing Meta token / phone ID.)

## Brand / visuals

Inbox UI matches **Keshav Clothing** site cues:
- Display: **Oswald** (uppercase / letter-spacing)
- Body: **Inter**
- Palette: `#171717` black, gray borders, white panels
- Chat layout stays WhatsApp-like (list + bubbles + 24h session)

## GoDaddy → unified subdomain (when DNS access is ready)

1. GoDaddy → **DNS** for `keshavclothing.com`
2. Add **CNAME**:
   - **Host:** `inbox`
   - **Points to:** `keshav-clothing.onrender.com`
3. Render → **Custom Domains** → `inbox.keshavclothing.com` → wait for SSL
4. Set `PUBLIC_BASE_URL=https://inbox.keshavclothing.com`
5. Optionally point Meta webhook to `https://inbox.keshavclothing.com/webhooks/meta`
6. Bookmark: **https://inbox.keshavclothing.com/inbox**

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
| Customer → business | Meta webhook → Turso → `/inbox` |
| Team reply | `/inbox` → Cloud API (within 24h) |
| Order templates | Shopify → Render → logged into same chat history |

## Features

- Full chat history per customer (Turso = forever on Free plan)  
- **New chat** — message any WhatsApp number from the inbox  
- **Customer CRUD** — tap chat header → edit name, WhatsApp number (migrate), email, order ref, tags, internal notes, pin, archive, mark unread, clear history, delete  
- Active / Archived tabs  
- Text replies, attach, camera (media needs open 24h window)  
- Outside 24h: sends via approved template `kc_inbox_hello` (Meta must show **Approved**)  
- View inbound photos/files  

### Message anyone (Meta rule)

| Situation | What you can send |
|-----------|-------------------|
| Customer messaged in last 24h | Free text + media |
| New number / window closed | Template `kc_inbox_hello` first; after they reply → free chat |

Check template: Meta WhatsApp Manager → Message templates → `kc_inbox_hello`.  


## Limits

- Free-form reply + media only inside WhatsApp **24-hour** window.  
- Not full WhatsApp app — core team chat + media.  
- Change `INBOX_PASSWORD` anytime in Render → Environment → Save.
