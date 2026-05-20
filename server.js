import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const app = express();
const PORT = process.env.PORT || 3000;
loadEnvFile();
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');

app.use(express.json({ limit: '20mb' }));
app.use(express.static(process.cwd()));

app.post('/api/auth/signup', (req, res) => {
  const name = cleanName(req.body?.name);
  const email = cleanEmail(req.body?.email);
  const password = String(req.body?.password || '');
  if (!name || name.length < 2) return res.status(400).json({ error: 'Please enter your name.' });
  if (!isEmail(email)) return res.status(400).json({ error: 'Please enter a valid email.' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });

  const db = readDb();
  if (db.users.some(user => user.email === email)) {
    return res.status(409).json({ error: 'An account already exists for that email.' });
  }

  const user = {
    id: crypto.randomUUID(),
    name,
    email,
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString()
  };
  db.users.push(user);
  const session = createSession(db, user.id);
  writeDb(db);
  res.status(201).json({ token: session.token, user: publicUser(user) });
});

app.post('/api/auth/login', (req, res) => {
  const email = cleanEmail(req.body?.email);
  const password = String(req.body?.password || '');
  const db = readDb();
  const user = db.users.find(item => item.email === email);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Email or password is incorrect.' });
  }
  const session = createSession(db, user.id);
  writeDb(db);
  res.json({ token: session.token, user: publicUser(user) });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  const db = readDb();
  db.sessions = db.sessions.filter(session => session.token !== req.token);
  writeDb(db);
  res.json({ ok: true });
});

app.get('/api/history', requireAuth, (req, res) => {
  const db = readDb();
  const history = db.histories
    .filter(item => item.userId === req.user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(item => ({
      id: item.id,
      subject: item.subject,
      summaryCount: item.summaryCount,
      quizCount: item.quizCount,
      createdAt: item.createdAt
    }));
  res.json({ history });
});

app.get('/api/history/:id', requireAuth, (req, res) => {
  const db = readDb();
  const item = db.histories.find(entry => entry.id === req.params.id && entry.userId === req.user.id);
  if (!item) return res.status(404).json({ error: 'History item not found.' });
  res.json({ item });
});

app.post('/api/history', requireAuth, (req, res) => {
  const sessionData = req.body?.data;
  if (!sessionData || typeof sessionData !== 'object') {
    return res.status(400).json({ error: 'Missing study session data.' });
  }
  const db = readDb();
  const item = {
    id: crypto.randomUUID(),
    userId: req.user.id,
    subject: String(sessionData.subject || 'Study Session').slice(0, 80),
    summaryCount: Array.isArray(sessionData.summary?.points) ? sessionData.summary.points.length : 0,
    quizCount: Array.isArray(sessionData.quiz) ? sessionData.quiz.length : 0,
    data: sessionData,
    sourcePreview: String(req.body?.sourcePreview || '').slice(0, 240),
    createdAt: new Date().toISOString()
  };
  db.histories.push(item);
  writeDb(db);
  res.status(201).json({ item });
});

app.post('/api/study', async (req, res) => {
  const text = String(req.body?.text || '').trim();
  if (!text || text.length < 80) {
    return res.status(400).json({ error: 'Please provide at least 80 characters of study content.' });
  }

  const useGroq = Boolean(GROQ_API_KEY);
  const apiKey = useGroq ? GROQ_API_KEY : ANTHROPIC_API_KEY;

  if (!apiKey) {
    return res.json({ fallback: true, data: generateStudySession(text) });
  }

  const prompt = `You are StudyForge AI. Return ONLY valid JSON, no markdown, no explanation, no backticks.

MATERIAL:
"""
${text}
"""

Return exactly this JSON:
{
  "subject": "short title",
  "summary": {
    "title": "Summary",
    "points": [{"heading": "concept", "detail": "explanation"}]
  },
  "quiz": [
    {"question": "?", "options": ["A","B","C","D"], "correct": 0, "explanation": "why"}
  ],
  "simulation": {
    "role": "your role based on material",
    "scenarios": [
      {"scene": "situation with material context", "choices": [{"text": "choice", "outcome": "result", "effect": {"pressure": 0, "trust": 0, "stability": 0}}]}
    ]
  },
  "escape": {
    "puzzles": [
      {"type": "Puzzle", "brief": "room description", "clue": "hint", "question": "?", "tools": [{"name": "item", "reveal": "clue"}], "options": ["opt1", "opt2", "opt3"], "answer": "correct", "hint": "help", "image": "photo description"}
    ]
  },
  "experts": [
    {"name": "Name", "role": "Role", "emoji": "Em", "color": "#000000", "opener": "intro"}
  ],
  "memory": [
    {"term": "concept", "detail": "explanation"}
  ],
  "mini_games": [
    {"type": "jeopardy", "category": "Topic", "questions": [{"q": "?", "a": "answer", "hint": "short hint"}]},
    {"type": "timeline", "category": "Sequence", "events": [{"event": "event or step", "order": 1, "why": "why this order makes sense"}]},
    {"type": "word_association", "category": "Connections", "pairs": [{"word": "concept", "associate": "connected concept", "why": "connection"}]}
  ],
  "sourceSentences": ["sentence from material"]
}

REQUIREMENTS:
- Summary is mandatory: 8-10 points with clear heading AND 2-3 sentence detail explaining cause, effect, decision, evidence, or importance.
- 8 varied quiz questions (meaning, cause, effect, evidence, connection, misconception, application, comparison)
- 5-6 progressive simulation scenarios based on the material. If it is WWII, make the player prevent escalation, build alliances, negotiate, manage trust, and face historical consequences. For any other topic, adapt the role and decisions to that domain.
- Every scenario has 4 creative choices and effect values from -20 to +20 for pressure/trust/stability.
- 5 escape puzzles set inside an abandoned hotel/chase escape room. The player escapes by answering material-based questions. Use 3 meaningful options each, never generic Door A/B/C.
- 4 expert voices adapted to the subject: a domain professional (commander for war, chemist for chemistry, etc.), professor, logical beginner who asks useful questions, and child-level explainer.
- Expert openers should sound like a debate panel and disagree constructively.
- 6 memory pairs must be meaningful question-answer or concept-evidence matches, not random words.
- Mini-games must directly help learning: jeopardy, timeline/order, word association/connections.
- ALL answers must be directly supported by the material.`;

  try {
    let response;
    
    if (useGroq || (!ANTHROPIC_API_KEY && GROQ_API_KEY)) {
      // Use Groq
      response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${GROQ_API_KEY}`
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.55,
          max_tokens: 6500,
          response_format: { type: 'json_object' }
        })
      });
    } else {
      // Use Claude
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY
        },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 6500
        })
      });
    }

    const json = await response.json();
    if (!response.ok) {
      console.error('API Error:', json);
      return res.json({ fallback: true, warning: json.error?.message || 'AI backend error', data: generateStudySession(text) });
    }

    let rawText = '';
    if (json.choices?.[0]?.message?.content) {
      // Groq response format
      rawText = json.choices[0].message.content;
    } else if (json.content?.[0]?.text) {
      // Claude response format
      rawText = json.content[0].text;
    }
    
    const data = normalizeStudyData(JSON.parse(extractJson(rawText)), text);
    return res.json({ fallback: false, data });
  } catch (error) {
    console.error(error);
    return res.json({ fallback: true, warning: error.message, data: generateStudySession(text) });
  }
});

app.post('/api/panel', requireAuth, async (req, res) => {
  const question = String(req.body?.question || '').replace(/\s+/g, ' ').trim().slice(0, 800);
  const subject = String(req.body?.subject || 'the study material').slice(0, 120);
  const sourceText = String(req.body?.sourceText || '').replace(/\s+/g, ' ').trim().slice(0, 8000);
  const summaryPoints = Array.isArray(req.body?.summaryPoints) ? req.body.summaryPoints.slice(0, 10) : [];
  const sourceSentences = Array.isArray(req.body?.sourceSentences) ? req.body.sourceSentences.slice(0, 12) : [];
  const experts = Array.isArray(req.body?.experts) ? req.body.experts.slice(0, 4) : [];

  if (!question) return res.status(400).json({ error: 'Ask a question first.' });

  const context = buildPanelContext({ sourceText, summaryPoints, sourceSentences });
  const fallbackResponses = buildPanelFallbackResponses(question, subject, context, experts);
  const useGroq = Boolean(GROQ_API_KEY);
  const apiKey = useGroq ? GROQ_API_KEY : ANTHROPIC_API_KEY;

  if (!apiKey) {
    return res.json({ fallback: true, responses: fallbackResponses });
  }

  const expertList = experts.length ? experts : [
    { name: 'Ari', role: 'Domain Professional' },
    { name: 'Prof. Rivera', role: 'Professor' },
    { name: 'Maya', role: 'Logical Beginner' },
    { name: 'Sam', role: 'Simple Explainer' }
  ];

  const prompt = `You are the StudyForge Expert Panel. Return ONLY valid JSON.

Student question:
"${question}"

Subject:
"${subject}"

PDF / uploaded material context:
"""
${context}
"""

Panel experts:
${expertList.map((expert, idx) => `${idx}: ${expert.name || `Expert ${idx + 1}`} - ${expert.role || 'Expert'}`).join('\n')}

Return exactly:
{
  "responses": [
    {"expertIndex": 0, "response": "answer"},
    {"expertIndex": 1, "response": "answer"},
    {"expertIndex": 2, "response": "answer"},
    {"expertIndex": 3, "response": "answer"}
  ]
}

Rules:
- Main focus must be the PDF/uploaded material. Start each answer by grounding it in something from the material.
- If the PDF context is thin, add relevant broader background knowledge from your general knowledge, clearly separating it with phrases like "Broader context:" or "Connected idea:".
- Do not claim you searched the live internet. Do not invent exact quotes, page numbers, sources, dates, or statistics unless they are in the provided material.
- Each expert should answer the same question with the same core meaning but different wording, reasoning style, and emphasis.
- Domain professional: practical, strategic, real-world implications.
- Professor: structured explanation using claim, evidence, and significance.
- Logical beginner: asks/answers the simple confusion directly.
- Simple explainer: clear and short, but not childish.
- 80-140 words per response.
- Avoid repeating the same sentence structure across experts.`;

  try {
    let response;
    if (useGroq || (!ANTHROPIC_API_KEY && GROQ_API_KEY)) {
      response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${GROQ_API_KEY}`
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.8,
          max_tokens: 1400,
          response_format: { type: 'json_object' }
        })
      });
    } else {
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 1400,
          temperature: 0.8
        })
      });
    }

    const json = await response.json();
    if (!response.ok) {
      console.error('Panel API Error:', json);
      return res.json({ fallback: true, warning: json.error?.message || 'AI backend error', responses: fallbackResponses });
    }

    const rawText = json.choices?.[0]?.message?.content || json.content?.[0]?.text || '';
    const parsed = JSON.parse(extractJson(rawText));
    const responses = normalizePanelResponses(parsed.responses, fallbackResponses);
    return res.json({ fallback: false, responses });
  } catch (error) {
    console.error(error);
    return res.json({ fallback: true, warning: error.message, responses: fallbackResponses });
  }
});

function loadEnvFile() {
  const path = '.env';
  if (!fs.existsSync(path)) return;
  const lines = fs.readFileSync(path, 'utf8').split(/\r?\n/);
  lines.forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const idx = trimmed.indexOf('=');
    if (idx === -1) return;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    if (key && process.env[key] === undefined) process.env[key] = value;
  });
}

function readDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    return { users: [], sessions: [], histories: [] };
  }
  try {
    const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    return {
      users: Array.isArray(db.users) ? db.users : [],
      sessions: Array.isArray(db.sessions) ? db.sessions : [],
      histories: Array.isArray(db.histories) ? db.histories : []
    };
  } catch {
    return { users: [], sessions: [], histories: [] };
  }
}

function writeDb(db) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function cleanName(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 60);
}

function cleanEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 32, 'sha256').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, expected] = String(stored || '').split(':');
  if (!salt || !expected) return false;
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 32, 'sha256').toString('hex');
  if (hash.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(expected, 'hex'));
}

function createSession(db, userId) {
  const session = {
    token: crypto.randomBytes(32).toString('hex'),
    userId,
    createdAt: new Date().toISOString()
  };
  db.sessions = db.sessions.filter(item => item.userId !== userId);
  db.sessions.push(session);
  return session;
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt
  };
}

function requireAuth(req, res, next) {
  const header = String(req.headers.authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Please log in first.' });
  const db = readDb();
  const session = db.sessions.find(item => item.token === token);
  const user = session ? db.users.find(item => item.id === session.userId) : null;
  if (!session || !user) return res.status(401).json({ error: 'Your session expired. Please log in again.' });
  req.token = token;
  req.user = user;
  next();
}

function extractJson(rawText) {
  const cleaned = String(rawText || '').replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) return cleaned;
  return cleaned.slice(first, last + 1);
}

function normalizeStudyData(value, sourceText) {
  const fallback = generateStudySession(sourceText);
  const data = value && typeof value === 'object' ? value : {};
  data.subject = data.subject || fallback.subject;
  data.summary = data.summary && Array.isArray(data.summary.points) && data.summary.points.length ? data.summary : fallback.summary;
  data.summary.title = data.summary.title || fallback.summary.title;
  data.summary.points = data.summary.points.map((point, idx) => ({
    heading: String(point?.heading || fallback.summary.points[idx]?.heading || 'Key idea'),
    detail: String(point?.detail || fallback.summary.points[idx]?.detail || 'Review this important idea from the material.')
  })).slice(0, 10);
  while (data.summary.points.length < 8 && fallback.summary.points[data.summary.points.length]) {
    data.summary.points.push(fallback.summary.points[data.summary.points.length]);
  }
  data.quiz = Array.isArray(data.quiz) && data.quiz.length >= 5 ? data.quiz : fallback.quiz;
  data.simulation = data.simulation?.scenarios?.length ? data.simulation : fallback.simulation;
  data.escape = data.escape?.puzzles?.length ? data.escape : fallback.escape;
  data.experts = Array.isArray(data.experts) && data.experts.length >= 4 ? data.experts.slice(0, 4) : fallback.experts;
  data.memory = Array.isArray(data.memory) && data.memory.length >= 4 ? data.memory : fallback.memory;
  data.mini_games = Array.isArray(data.mini_games) && data.mini_games.length ? data.mini_games : fallback.mini_games;
  data.sourceSentences = Array.isArray(data.sourceSentences) && data.sourceSentences.length ? data.sourceSentences : fallback.sourceSentences;
  return data;
}

function buildPanelContext({ sourceText, summaryPoints, sourceSentences }) {
  const parts = [];
  if (sourceSentences.length) {
    parts.push('Source sentences:\n' + sourceSentences.map(sentence => '- ' + String(sentence).slice(0, 500)).join('\n'));
  }
  if (summaryPoints.length) {
    parts.push('Summary points:\n' + summaryPoints.map(point => '- ' + String(point?.heading || 'Point') + ': ' + String(point?.detail || '').slice(0, 500)).join('\n'));
  }
  if (sourceText) parts.push('Source excerpt:\n' + sourceText.slice(0, 5000));
  return parts.join('\n\n').slice(0, 7000) || 'No detailed source text was provided.';
}

function normalizePanelResponses(value, fallbackResponses) {
  const list = Array.isArray(value) ? value : [];
  const responses = fallbackResponses.map((fallback, idx) => {
    const match = list.find(item => Number(item?.expertIndex) === idx) || list[idx] || {};
    return {
      expertIndex: idx,
      response: String(match.response || fallback.response || '').replace(/\s+/g, ' ').trim()
    };
  });
  return responses.map((item, idx) => item.response ? item : fallbackResponses[idx]);
}

function buildPanelFallbackResponses(question, subject, context, experts) {
  const focus = findPanelFocus(question, context, subject);
  const broader = inferBroaderContext(subject, question, focus);
  const names = experts.length ? experts : [
    { role: 'Domain Professional' },
    { role: 'Professor' },
    { role: 'Logical Beginner' },
    { role: 'Simple Explainer' }
  ];
  return [
    {
      expertIndex: 0,
      response: `From the material, the useful anchor is ${focus.heading}: ${focus.detail} Broader context: ${broader} As a ${names[0]?.role || 'domain professional'}, I would connect the PDF point to what changes in practice: who acts, what pressure increases, and what consequence follows.`
    },
    {
      expertIndex: 1,
      response: `A strong academic answer would start with the PDF evidence: ${focus.detail} The claim is that ${focus.heading} matters because it explains part of ${subject}. Connected idea: ${broader} So your answer should separate the material's direct statement from the extra background that helps explain why it matters.`
    },
    {
      expertIndex: 2,
      response: `I would simplify it like this: the PDF gives us one clear clue, which is ${focus.heading}. It says: ${focus.detail} If that feels too small, the bigger related idea is this: ${broader} So the answer is not only "what does the PDF say?" but also "what does that point help us understand?"`
    },
    {
      expertIndex: 3,
      response: `Short version: the PDF points to ${focus.heading}. The important part is: ${focus.detail} A related background idea is that ${broader} That means you can answer from the PDF first, then add outside explanation as support, as long as you do not pretend the outside part came from the PDF.`
    }
  ];
}

function findPanelFocus(question, context, subject) {
  const words = new Set(String(question).toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length > 3));
  const sentences = String(context).split(/(?<=[.!?])\s+|\n+/).map(sentence => sentence.replace(/^[-\s]+/, '').trim()).filter(sentence => sentence.length > 30);
  let best = sentences[0] || String(subject || 'the topic');
  let bestScore = -1;
  sentences.forEach(sentence => {
    const lower = sentence.toLowerCase();
    let score = 0;
    words.forEach(word => { if (lower.includes(word)) score += 1; });
    if (score > bestScore) {
      bestScore = score;
      best = sentence;
    }
  });
  const heading = best.split(':')[0].replace(/^Summary points|^Source sentences/i, '').trim() || subject || 'the topic';
  return { heading, detail: best.slice(0, 420) };
}

function inferBroaderContext(subject, question, focus) {
  const joined = `${subject} ${question} ${focus.heading} ${focus.detail}`.toLowerCase();
  if (/war|hitler|germany|allies|axis|nazi|invasion|treaty|battle|appeasement|poland|britain|france|conflict/.test(joined)) {
    return 'historical events usually become clearer when you connect immediate decisions to alliances, resources, geography, leadership choices, and long-term consequences.';
  }
  if (/chem|atom|molecule|acid|base|reaction|element|compound/.test(joined)) {
    return 'chemistry ideas usually make more sense when the visible result is connected to particles, bonding, energy, and reaction conditions.';
  }
  if (/bio|cell|organ|dna|gene|evolution|plant|animal/.test(joined)) {
    return 'biology explanations often connect structure to function, and then connect that function to survival, regulation, or adaptation.';
  }
  if (/math|algebra|geometry|equation|function|calculus/.test(joined)) {
    return 'math concepts are easier to use when you connect the rule to the pattern it describes and the problem type it solves.';
  }
  if (/econom|market|money|inflation|trade|business/.test(joined)) {
    return 'economic topics often need both the direct mechanism and the incentives or trade-offs that make people respond in a certain way.';
  }
  return 'a thin note from the PDF can be expanded by connecting it to causes, effects, examples, and why the idea matters in the wider topic.';
}

app.get('*', (req, res) => {
  res.sendFile('index.html', { root: process.cwd() });
});

app.listen(PORT, () => {
  console.log(`StudyForge backend listening at http://localhost:${PORT}`);
});

function generateStudySession(text) {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  const sentences = splitSentences(cleaned);
  const frequency = getFrequency(cleaned);
  const topics = selectTopics(frequency, 10);
  const title = topics.length ? capitalize(topics[0]) + ' Essentials' : 'Study Summary';
  const summaryPoints = buildSummaryPoints(topics, sentences);
  const quiz = buildQuizFromTopics(summaryPoints, sentences, topics);
  const simulation = buildSimulation(topics, summaryPoints, sentences);
  const escape = buildEscape(summaryPoints, sentences, topics);
  const experts = buildExperts(topics);
  const memory = buildMemory(summaryPoints);
  const mini_games = buildMiniGames(summaryPoints, topics);
  return {
    subject: title,
    summary: { title: 'Study Guide', points: summaryPoints.slice(0, 10) },
    quiz,
    simulation,
    escape,
    experts,
    memory,
    mini_games,
    sourceSentences: sentences.slice(0, 30)
  };
}

function splitSentences(text) {
  const matches = text.match(/[^.!?]+[.!?]+/g);
  return matches ? matches.map(s => s.trim()) : [text];
}

function getFrequency(text) {
  const stop = new Set(['about','above','after','again','against','all','also','am','an','and','any','are','as','at','be','because','been','before','being','began','below','between','both','but','by','became','can','could','did','do','does','doing','down','during','each','few','for','formed','from','further','had','has','have','having','he','her','here','hers','herself','him','himself','his','how','i','if','in','includes','including','into','is','it','its','itself','just','major','me','more','most','my','myself','no','nor','not','now','of','off','on','once','only','or','other','our','ours','ourselves','out','over','own','powers','same','she','should','so','some','states','such','than','that','the','their','theirs','them','themselves','then','there','these','they','this','those','through','to','too','tried','under','united','until','up','very','was','we','were','what','when','where','which','while','who','whom','why','with','world','would','you','your','yours','yourself','yourselves']);
  const raw = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  const freq = {};
  raw.split(/\s+/).forEach(word => {
    if (word.length < 4 || stop.has(word)) return;
    freq[word] = (freq[word] || 0) + 1;
  });
  const clauses = text.toLowerCase().split(/[.!?;:,()]|\band\b|\bwhile\b|\bbecause\b|\bafter\b|\bbefore\b|\bwith\b/);
  clauses.forEach(clause => {
    const words = clause.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(word => word.length >= 4 && !stop.has(word));
    for (let i = 0; i < words.length - 1; i++) {
      const phrase = words[i] + ' ' + words[i + 1];
      freq[phrase] = (freq[phrase] || 0) + 3;
    }
  });
  return freq;
}

function selectTopics(freq, count) {
  return Object.entries(freq).sort((a, b) => b[1] - a[1]).map(([word]) => word).slice(0, count);
}

function capitalize(word) {
  return String(word).split(' ').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

function buildSummaryPoints(topics, sentences) {
  const used = new Set();
  const points = [];
  topics.forEach(topic => {
    const detail = getBestSentenceForTopic(topic, sentences, used);
    if (detail) {
      points.push({
        heading: titleFromSentence(topic, detail),
        detail: detail
      });
    }
  });
  sentences.forEach(sentence => {
    if (points.length >= 10) return;
    const clean = sentence.replace(/\s+/g, ' ').trim();
    if (clean.length > 45 && !used.has(clean)) {
      used.add(clean);
      points.push({ heading: titleFromSentence('', clean), detail: clean });
    }
  });
  while (points.length < 8) points.push({ heading: 'Key idea', detail: 'An important point from the material.' });
  return points;
}

function getBestSentenceForTopic(topic, sentences, used) {
  const lower = topic.toLowerCase();
  const matches = sentences
    .map(s => s.replace(/\s+/g, ' ').trim())
    .filter(s => s.length > 35 && s.toLowerCase().includes(lower) && !used.has(s))
    .sort((a, b) => Math.abs(160 - a.length) - Math.abs(160 - b.length));
  const pick = matches[0];
  if (pick) used.add(pick);
  return pick || '';
}

function titleFromSentence(topic, sentence) {
  if (topic) return capitalize(topic);
  const words = sentence.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 4);
  return capitalize(words[0] || 'Key idea');
}

function buildQuizFromTopics(points, sentences, topics) {
  const quiz = [];
  const starters = [
    p => 'What is the best explanation of ' + p.heading + '?',
    p => 'What consequence follows from ' + p.heading + '?',
    p => 'Which evidence supports ' + p.heading + '?',
    p => 'Which warning helps avoid misunderstanding ' + p.heading + '?',
    p => 'How does ' + p.heading + ' affect a decision?',
    p => 'How is ' + p.heading + ' different from the next key idea?',
    p => 'If you apply ' + p.heading + ' to a real scenario, what happens?',
    p => 'According to the material, what role does ' + p.heading + ' play?'
  ];
  for (let i = 0; i < Math.min(8, points.length); i++) {
    const point = points[i] || { heading: 'Main', detail: 'Key point' };
    const correct = i % 3 === 0 ? point.detail : 'It explains or causes ' + point.heading;
    const options = [correct];
    let guard = 0;
    while (options.length < 4 && guard < 20) {
      guard++;
      const other = points[(i + options.length) % points.length];
      const candidate = options.length === 3 ? 'It is only a vocabulary word.' : (other?.detail || 'Another point from the material.');
      if (!options.includes(candidate)) options.push(candidate);
    }
    while (options.length < 4) {
      options.push(['A related but incomplete idea.', 'A detail that is not the best evidence.', 'A choice that ignores cause and effect.'][options.length - 1] || 'Another possible answer.');
    }
    options.sort(() => Math.random() - 0.5);
    quiz.push({
      question: starters[i % starters.length](point),
      options,
      correct: options.indexOf(correct),
      explanation: 'This question tests understanding, not just memorization.'
    });
  }
  return quiz;
}

function buildSimulation(topics, points, sentences) {
  const main = topics[0] || 'the main issue';
  const isWar = topics.some(t => /war|hitler|germany|allies|axis|nazi|invasion|treaty|battle|conflict|peace/.test(t));
  const isSocial = topics.some(t => /social|community|people|rights|justice|movement|protest/.test(t));
  
  let role = 'You are a decision-maker';
  if (isWar) role = 'You are a strategist during this historical conflict';
  else if (isSocial) role = 'You are a community leader';
  else role = 'You are the person guiding this process';

  return {
    role,
    scenarios: points.slice(0, 6).map((point, idx) => buildScenarioStep(point, points, idx, isWar, isSocial))
  };
}

function buildScenarioStep(point, points, idx, isWar, isSocial) {
  const next = points[(idx + 1) % points.length] || point;
  const sceneLead = idx === 0
    ? 'The first challenge centers on ' + point.heading + '.'
    : 'Your previous decision has changed things. Now ' + point.heading + ' is the key issue.';
  
  return {
    scene: sceneLead + ' Background: ' + point.detail,
    choices: [
      {
        text: 'Act quickly using ' + point.heading + ' as your main guide.',
        outcome: 'Fast action addresses ' + point.heading + ', but creates pressure around ' + next.heading + '.',
        effect: { pressure: 8, trust: 2, stability: 4 }
      },
      {
        text: 'Take time to compare ' + point.heading + ' with ' + next.heading + ' before deciding.',
        outcome: 'You understand the full situation, but delays allow pressure to build.',
        effect: { pressure: 4, trust: 10, stability: 6 }
      },
      {
        text: 'Build broader support around multiple factors before acting.',
        outcome: 'People understand and support the plan, but coordination takes time.',
        effect: { pressure: -2, trust: 14, stability: 10 }
      },
      {
        text: 'Focus only on the easiest short-term fix and ignore deeper issues.',
        outcome: 'The problem looks smaller immediately, but returns through ' + next.heading + ' later.',
        effect: { pressure: -5, trust: -12, stability: -14 }
      }
    ]
  };
}

function buildEscape(points, sentences, topics) {
  const types = ['Evidence', 'Connection', 'Consequence', 'Application', 'Synthesis'];
  const puzzles = [];
  
  for (let i = 0; i < Math.min(5, points.length); i++) {
    const point = points[i] || { heading: 'Main', detail: 'Key point' };
    const nextPoint = points[(i + 1) % points.length] || point;
    const answer = point.heading;
    
    const options = [answer, nextPoint.heading];
    const third = points[(i + 2) % points.length];
    if (third && third.heading !== answer && third.heading !== nextPoint.heading) {
      options.push(third.heading);
    } else {
      options.push('Alternative concept');
    }
    
    puzzles.push({
      type: types[i % types.length],
      brief: 'Room ' + (i + 1) + ': ' + point.heading,
      clue: 'Inspect the tools for evidence.',
      question: 'Which concept best answers this: ' + point.heading + '?',
      tools: [
        { name: 'Documentation', reveal: point.detail },
        { name: 'Reference guide', reveal: answer + ' connects to ' + nextPoint.heading },
        { name: 'Analysis', reveal: 'The right choice is based on evidence, not guessing.' }
      ],
      options: shuffle(options).slice(0, 3),
      answer,
      hint: 'Look at the documentation for the key evidence.',
      image: 'Escape room puzzle for ' + answer
    });
  }
  
  return { puzzles };
}

function buildMemory(points) {
  return points.slice(0, 6).map(point => ({
    term: point.heading,
    detail: point.detail.length > 120 ? point.detail.slice(0, 117) + '...' : point.detail
  }));
}

function buildExperts(topics) {
  const base = topics.slice(0, 4);
  const role = inferProfessionalRole(topics);
  return [
    {
      name: 'Ari',
      role,
      emoji: 'Pro',
      color: '#0066ff',
      opener: 'I will debate this like a ' + role.toLowerCase() + ': evidence first, then strategy, risk, and consequences around ' + (base[0] || 'the material') + '.'
    },
    {
      name: 'Prof. Rivera',
      role: 'Professor',
      emoji: 'Teach',
      color: '#00a96b',
      opener: 'I explain like a teacher: claim, evidence, consequence, and checking your understanding.'
    },
    {
      name: 'Maya',
      role: 'Logical Beginner',
      emoji: 'Ask',
      color: '#ff3d8d',
      opener: 'I will ask the simple but important questions: why did this happen, what changed, and what proof do we have?'
    },
    {
      name: 'Sam',
      role: 'Simple (10-year-old)',
      emoji: 'Easy',
      color: '#f5a400',
      opener: 'I keep it super simple: what happened, why it happened, and why it matters.'
    }
  ];
}

function inferProfessionalRole(topics) {
  const joined = topics.join(' ').toLowerCase();
  if (/war|hitler|germany|allies|alliance|axis|nazi|invasion|treaty|battle|ww2|world war|appeasement|poland|britain|france|conflict/.test(joined)) return 'Military Historian and Commander';
  if (/chem|atom|molecule|acid|base|reaction|element|compound/.test(joined)) return 'Experienced Chemist';
  if (/bio|cell|organ|dna|gene|evolution|plant|animal/.test(joined)) return 'Biologist';
  if (/math|algebra|geometry|equation|function|calculus/.test(joined)) return 'Mathematician';
  if (/econom|market|money|inflation|trade|business/.test(joined)) return 'Economist';
  if (/law|rights|court|constitution|justice/.test(joined)) return 'Legal Analyst';
  if (/code|software|computer|algorithm|program/.test(joined)) return 'Software Engineer';
  return 'Domain Professional';
}

function buildMiniGames(points, topics) {
  const games = [];
  
  // Jeopardy-style game
  games.push({
    type: 'jeopardy',
    category: capitalize(topics[0] || 'Main Topic'),
    questions: points.slice(0, 5).map(p => ({
      q: 'What is ' + p.heading + '?',
      a: p.detail.split('.')[0] + '.'
    }))
  });
  
  // Timeline game
  games.push({
    type: 'timeline',
    category: 'Sequence',
    events: points.slice(0, 4).map((p, i) => ({
      event: p.heading,
      order: i + 1
    }))
  });
  
  // Word association
  games.push({
    type: 'word_association',
    category: 'Connections',
    pairs: points.slice(0, 3).map((p, i) => ({
      word: p.heading,
      associate: points[(i + 1) % points.length].heading
    }))
  });
  
  return games;
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}
