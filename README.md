# StudyForge Prototype

A study app prototype that converts pasted notes or PDF text into:
- a concise summary
- a simple multiple-choice quiz
- three adaptive mini-games: simulation, escape room (with AI-generated images), and expert panel
- login/signup accounts with saved profile study history

## Setup
1. Open the folder in VS Code:
   - `code StudyForgePrototype`
2. Install dependencies:
   - `npm install`
3. (Optional but recommended) Set your AI key for better content:
   - Sign up at https://console.anthropic.com/ for a free API key (new users get $5 credit)
   - PowerShell: `$env:ANTHROPIC_API_KEY="your_key"`
   - Command Prompt: `set ANTHROPIC_API_KEY=your_key`
4. Start the backend server:
   - `npm start`
5. Open the app in your browser:
   - `http://localhost:3000`

## How it works
- The app is served from `server.js`.
- `/api/study` accepts study text and returns summary, quiz, and game content.
- `/api/auth/signup`, `/api/auth/login`, and `/api/auth/me` manage local accounts.
- `/api/history` saves and reloads generated study sessions for the logged-in user.
- If `ANTHROPIC_API_KEY` is not configured, the backend falls back to a local prototype generator.

## Notes
- The backend is a simple Express server with an AI-assisted route.
- Accounts and saved study history are stored locally in `data/db.json`, which is ignored by Git.
- With an Anthropic API key, the app can generate higher-quality content from text.
- Without a key, the app still runs locally using a heuristic fallback.
- The escape room puzzles include AI-generated images for immersion.

## Files
- `index.html` — main front-end prototype
- `server.js` — Express backend and AI service endpoint
- `package.json` — Node.js project config
- `.gitignore` — ignores `node_modules` and `.env`
