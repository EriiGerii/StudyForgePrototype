import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import signupHandler from './api/auth/signup.js';
import loginHandler from './api/auth/login.js';
import meHandler from './api/auth/me.js';
import logoutHandler from './api/auth/logout.js';
import historyHandler from './api/history/index.js';
import historyIdHandler from './api/history/[id].js';
import studyHandler from './api/study.js';
import panelHandler from './api/panel.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
loadEnvFile();

app.use(express.json({ limit: '20mb' }));
app.use(express.static(__dirname));

function loadEnvFile() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    value = value.replace(/^['\"]|['\"]$/g, '');
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

async function routeHandler(req, res, handler) {
  try {
    await handler(req, res);
  } catch (error) {
    console.error(error);
    if (typeof res.status === 'function' && typeof res.json === 'function') {
      return res.status(500).json({ error: 'Internal server error.' });
    }
    res.statusCode = 500;
    res.end('Internal server error.');
  }
}

app.all('/api/auth/signup', (req, res) => routeHandler(req, res, signupHandler));
app.all('/api/auth/login', (req, res) => routeHandler(req, res, loginHandler));
app.all('/api/auth/me', (req, res) => routeHandler(req, res, meHandler));
app.all('/api/auth/logout', (req, res) => routeHandler(req, res, logoutHandler));
app.all('/api/history', (req, res) => routeHandler(req, res, historyHandler));
app.all('/api/history/:id', (req, res) => routeHandler(req, res, historyIdHandler));
app.all('/api/study', (req, res) => routeHandler(req, res, studyHandler));
app.all('/api/panel', (req, res) => routeHandler(req, res, panelHandler));

app.get('*', (req, res) => {
  res.sendFile('index.html', { root: __dirname });
});

app.listen(PORT, () => {
  console.log(`StudyForge backend listening at http://localhost:${PORT}`);
});
