# Instagram AI Chatbot MVP — zero dependency

This version is intentionally dependency-free. It uses Node's built-in HTTP server and `fetch`, so there is no `npm install` step.

## 1) Run it on Windows

1. Extract this folder.
2. Copy `.env.example` to `.env`.
3. Put in your Instagram access token and Instagram account ID when you have them. Put your OpenAI API key in `OPENAI_API_KEY` if you want AI replies.
4. Open PowerShell in this folder and run:

```powershell
node --version
npm run dev
```

Open `http://localhost:4000`.

## 2) Instagram API

For the current Instagram API with Instagram Login, Meta's documentation says the setup is for professional Instagram accounts (Business/Creator) and uses `instagram_business_manage_messages` for messaging. Meta's current Send API examples use:

`POST https://graph.instagram.com/{api-version}/{ig-account-id}/messages`

with a body containing `recipient.id` and `message.text`.

The recipient must be in a supported messaging flow; in particular, Meta states that conversations begin when an Instagram user sends a message to the professional account.

## 3) Webhook

Callback URL:

`https://YOUR_PUBLIC_HOST/webhook/instagram`

Verification:

`GET /webhook/instagram?hub.mode=subscribe&hub.verify_token=YOUR_TOKEN&hub.challenge=...`

Set the same random token in `IG_VERIFY_TOKEN` and Meta's webhook settings.

For real Instagram webhooks, your local port 4000 needs to be reachable by Meta over HTTPS (for example with a secure tunnel while developing).

## 4) Privacy / bot behavior

- Quiet hours are 02:00–07:00 Asia/Kolkata.
- Replies use Hindi/Hinglish with occasional English, light flirting, and low emoji usage according to `.env`.
- If directly asked whether AI is involved, the assistant does not claim to be human.
- The project does not implement hidden personal-data extraction.
- Keep API tokens out of the frontend and out of source control.

## 5) Important production hardening

Before public deployment, add HTTPS, authentication for the dashboard, durable database storage, rate limiting, retry/backoff, webhook replay protection, and Meta App Review/permissions appropriate to your account.
