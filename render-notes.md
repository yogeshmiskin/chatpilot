# Render notes

- Build Command: `npm install`
- Start Command: `npm start`
- Put `GEMINI_API_KEY` and `GEMINI_MODEL` in Render Environment Variables.
- Do not commit `.env` or API keys.
- No Meta/Instagram webhook is included.
- For persistent multi-user SQLite data and uploaded files in production, use a Render persistent disk and configure `SQLITE_PATH` plus the upload directory accordingly.
