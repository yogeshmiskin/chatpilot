# ChatPilot — Multi-user Conversation Studio

Local/Render-ready Node app with private user accounts, per-user conversations, mobile-first UI, and Gemini-powered message generation.

## Core behavior
- Email + password accounts.
- Each user's conversations, messages, settings and uploaded files are isolated by user ID.
- Auto reply is OFF. AI only generates suggestions; the user chooses what to send/save.
- No Meta/Instagram webhook is included.
- Mobile UI uses compact bottom navigation and an option sheet while desktop keeps the full side panels.
- Supports text and file/image attachments up to 8 MB.
- Gemini API key stays server-side via environment variables.

## AI message studio
- **Generate Reply**: uses the latest conversation context.
- **Generate Message**: turns a plain-language intention such as `bolna hai: chalo bahar chalte hain` into one polished, ready-to-send message.
- **Regenerate**: creates a fresh variation while keeping the same intent.
- Per-chat AI style prompt is combined with the built-in ChatPilot behavior: context-aware, direct, natural Hindi/Hinglish/English, practical solutions, fresh wording, and no manipulative pressure.

## Environment
Set:
- `GEMINI_API_KEY`
- `GEMINI_MODEL`

Render should use `npm start`. The package start script uses `--env-file-if-exists=.env`, so local `.env` works when present while Render can use dashboard environment variables without a `.env` file.

## Run
`npm install`
`npm run dev`
Open `http://localhost:4000`.

## Chat naming

Each conversation has an editable display name. Use **Edit name** from the chat header (or **Edit chat name** on mobile) to rename a chat without changing its messages, memory, or per-chat settings. The renamed title is saved to that user's account and reappears after logout/login.


## User AI API settings
Each logged-in user can add their own AI API from **AI API**. Supported providers: Google Gemini, OpenAI, and OpenAI-compatible/custom endpoints. Credentials are encrypted at rest with `APP_SECRET`. Do not commit `.env`.

## Incoming message input
Use the visible **THEM / ME** selector above the composer. Select **THEM** to paste the other person's message and click **Add Them Message**; select **ME** to save your own outgoing message.

## Ongoing conversation mode
The AI prompt treats each chat as an ongoing conversation rather than an isolated reply. It can keep continuity across many turns, answer questions, suggest practical next steps, and ask a relevant follow-up only when it naturally moves the conversation forward. The app keeps a larger recent context window for long chats. Choose `Ongoing conversation`, `Concise`, or `Detailed` in Chat options.

## Add your own API key
After login, if the account has no saved AI credential, ChatPilot opens **AI API settings** and shows **Add your API key**. The provider selector supports Google Gemini, OpenAI, and OpenAI-compatible/custom endpoints. For Gemini, the panel includes a direct **Get your API key** link to Google AI Studio: https://aistudio.google.com/apikey. The key is sent only to the server and stored encrypted per user; it is never returned to the browser after saving.

## Sending generated replies
The AI Message Studio includes **Send suggestion** so a generated reply can be saved into the current conversation as the user's outgoing message. Auto Reply remains OFF; nothing is sent automatically.

## Chat naming
- New Chat asks only for a chat name (for example, Ruhi).
- Chat names can be edited later without changing messages, memory, or settings.
- Participant ID is not part of the user-facing chat form.
