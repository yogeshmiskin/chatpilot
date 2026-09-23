# ChatPilot — Local Conversation Studio (Gemini)

A local-only chat dashboard for manual conversation practice and reply suggestions.

## AI provider

Gemini is the primary provider. Put your Gemini API key in `.env` as `GEMINI_API_KEY`. The app calls Gemini's REST `generateContent` endpoint and keeps the key server-side. OpenAI remains optional.

Recommended current model for this build:

```text
GEMINI_MODEL=gemini-3.8-flash
```

Model availability and free/paid limits depend on your Google AI Studio project and current Google Gemini API policies.

## Windows

1. Extract the ZIP.
2. Open PowerShell in the project folder.
3. Create `.env` from `.env.example`:

```powershell
Copy-Item .env.example .env
notepad .env
```

Add your Gemini key:

```env
GEMINI_API_KEY=YOUR_GEMINI_API_KEY
GEMINI_MODEL=gemini-3.8-flash
```

Then run:

```powershell
npm.cmd run dev
```

Open:

`http://localhost:4000`

## Features

- Dark neon ChatPilot dashboard
- Independent chat profiles and message history
- Incoming/outgoing manual messages
- Copy-Paste reply workflow
- Gemini reply generation
- Optional OpenAI support
- Built-in local fallback when no provider key is configured
- Flirting, romantic, mature toggles
- Per-chat memory and custom instructions
- Search, delete, debug panel, quiet-hours display
- Download project as ZIP
- No Meta/Instagram webhook
- Auto Reply OFF

Never commit or upload `.env`.
