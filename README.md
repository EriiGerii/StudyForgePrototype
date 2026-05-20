# StudyForge Prototype

A study app prototype that converts pasted notes or PDF text into:
- a concise summary
- a simple multiple-choice quiz
- interactive mini-games: simulation, escape room, expert panel, concept match, knowledge board, timeline, connection web, concept arena, signal sort, and word forge
- login/signup accounts with saved profile study history

## Setup
1. Open the folder in VS Code:
   - `code StudyForgePrototype`
2. Install dependencies:
   - `npm install`
3. (Optional but recommended) Set your AI key for better content:
   - Sign up at https://console.anthropic.com/ for a free API key
   - PowerShell: `$env:ANTHROPIC_API_KEY="your_key"`
   - Command Prompt: `set ANTHROPIC_API_KEY=your_key`
4. Start the backend server:
   - `npm start`
5. Open the app in your browser:
   - `http://localhost:3000`

## How it works
- The app is served from `server.js`.
- `/api/study` accepts study text and returns summary, quiz, and game content.
- `/api/panel` powers smarter Expert Panel replies when an AI key is configured.
- `/api/auth/signup`, `/api/auth/login`, and `/api/auth/me` manage local accounts.
- `/api/history` saves and reloads generated study sessions for the logged-in user.
- If no AI key is configured, the backend falls back to a local prototype generator.

## Project structure
- `index.html` - markup and screen structure
- `src/styles/main.css` - front-end styles and responsive layout
- `src/js/app.js` - client app logic, auth UI, study dashboard, and games
- `assets/escape/` - built-in escape room background images
- `server.js` - Express backend, auth/history APIs, AI study generation, and panel endpoint
- `package.json` - Node.js project config
- `.gitignore` - ignores `node_modules` and `.env`

## Notes
- Accounts and saved study history are stored locally in `data/db.json`, which is ignored by Git.
- With an Anthropic or Groq API key, the app can generate higher-quality content from text.
- Without a key, the app still runs locally using heuristic fallbacks.
