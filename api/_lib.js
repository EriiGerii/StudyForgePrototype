import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
console.log('ENV CHECK:', !!SUPABASE_URL, !!SUPABASE_KEY, Object.keys(process.env).filter(k => k.includes('SUPA')));
const LOCAL_DATA_DIR = path.join(__dirname, '..', 'data');
const LOCAL_DB_PATH = path.join(LOCAL_DATA_DIR, 'db.json');
const supabase = SUPABASE_URL && SUPABASE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    })
  : null;

export function sendJson(res, body, status = 200) {
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    return res.status(status).json(body);
  }
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

export function sendError(res, status, message) {
  return sendJson(res, { error: message }, status);
}

export async function parseBody(req) {
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    return {};
  }
}

export function cleanName(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 60);
}

export function cleanEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 32, 'sha256').toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, expected] = String(stored || '').split(':');
  if (!salt || !expected) return false;
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 32, 'sha256').toString('hex');
  if (hash.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(expected, 'hex'));
}

async function getSupabaseClient() {
  return supabase;
}

function ensureLocalDb() {
  if (!fs.existsSync(LOCAL_DATA_DIR)) {
    fs.mkdirSync(LOCAL_DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(LOCAL_DB_PATH)) {
    writeLocalDb({ users: [], sessions: [], histories: [] });
  }
}

function readLocalDb() {
  ensureLocalDb();
  try {
    const raw = fs.readFileSync(LOCAL_DB_PATH, 'utf8');
    return JSON.parse(raw || '{}');
  } catch {
    return { users: [], sessions: [], histories: [] };
  }
}

function writeLocalDb(db) {
  ensureLocalDb();
  fs.writeFileSync(LOCAL_DB_PATH, JSON.stringify(db, null, 2));
}

async function getCollection(collectionName) {
  return await getSupabaseClient();
}

export async function findUserByEmail(email) {
  if (!email) return null;
  const supabaseClient = await getCollection('users');
  if (supabaseClient) {
    const { data, error } = await supabaseClient.from('users').select('*').eq('email', email).single();
    if (!error) return data;
    if (error.code === 'PGRST116') return null;
    console.error('Supabase findUserByEmail error:', error.message || error);
    return null;
  }

  if (process.env.VERCEL) {
    throw new Error('Supabase is not configured. Set SUPABASE_URL and SUPABASE_KEY env vars.');
  }
  const db = readLocalDb();
  return db.users.find(user => user.email === email) || null;
}

export async function findUserById(id) {
  if (!id) return null;
  const supabaseClient = await getCollection('users');
  if (supabaseClient) {
    const { data, error } = await supabaseClient.from('users').select('*').eq('id', id).single();
    if (!error) return data;
    if (error.code === 'PGRST116') return null;
    console.error('Supabase findUserById error:', error.message || error);
    return null;
  }

  if (process.env.VERCEL) {
    throw new Error('Supabase is not configured. Set SUPABASE_URL and SUPABASE_KEY env vars.');
  }
  const db = readLocalDb();
  return db.users.find(user => user.id === id) || null;
}

export async function createUser(user) {
  const supabaseClient = await getCollection('users');
  if (supabaseClient) {
    const { error } = await supabaseClient.from('users').insert([user]);
    if (!error) return user;
    console.error('Supabase createUser REAL error:', JSON.stringify(error));
    if (process.env.VERCEL) {
      throw new Error('Supabase is not configured. Set SUPABASE_URL and SUPABASE_KEY env vars.');
    }
    throw new Error('Failed to create user in Supabase.');
  }

  const db = readLocalDb();
  db.users.push(user);
  writeLocalDb(db);
  return user;
}

export async function findSessionByToken(token) {
  if (!token) return null;
  const supabaseClient = await getCollection('sessions');
  if (supabaseClient) {
    const { data, error } = await supabaseClient.from('sessions').select('*').eq('token', token).single();
    if (!error) return data;
    if (error.code === 'PGRST116') return null;
    console.error('Supabase findSessionByToken error:', error.message || error);
  if (process.env.VERCEL) {
    return null;
  }
    return null;
  }

  const db = readLocalDb();
  return db.sessions.find(session => session.token === token) || null;
}

export async function createSession(userId) {
  const session = {
    token: crypto.randomBytes(32).toString('hex'),
    userId,
    createdAt: new Date().toISOString()
  };
  const supabaseClient = await getCollection('sessions');
  if (supabaseClient) {
    const { error: deleteError } = await supabaseClient.from('sessions').delete().eq('userId', userId);
    if (deleteError && deleteError.code !== 'PGRST116') console.error('Supabase createSession delete error:', deleteError.message || deleteError);
    const { error: insertError } = await supabaseClient.from('sessions').insert([session]);
    if (!insertError) return session;
    console.error('Supabase createSession insert error:', insertError.message || insertError);
  if (process.env.VERCEL) {
    throw new Error('Supabase is not configured. Set SUPABASE_URL and SUPABASE_KEY env vars.');
  }
    throw new Error('Failed to create session in Supabase.');
  }

  const db = readLocalDb();
  db.sessions = db.sessions.filter(item => item.userId !== userId);
  db.sessions.push(session);
  writeLocalDb(db);
  return session;
}

export async function deleteSession(token) {
  const supabaseClient = await getCollection('sessions');
  if (supabaseClient) {
    const { error } = await supabaseClient.from('sessions').delete().eq('token', token);
    if (!error) return;
    console.error('Supabase deleteSession error:', error.message || error);
  if (process.env.VERCEL) {
    return;
  }
    return;
  }

  const db = readLocalDb();
  db.sessions = db.sessions.filter(session => session.token !== token);
  writeLocalDb(db);
}

export async function createHistory(entry) {
  const supabaseClient = await getCollection('histories');
  if (supabaseClient) {
  if (process.env.VERCEL) {
    throw new Error('Supabase is not configured. Set SUPABASE_URL and SUPABASE_KEY env vars.');
  }
    const { data, error } = await supabaseClient.from('histories').insert([entry]).select().single();
    if (!error) return data || entry;
    console.error('Supabase createHistory error:', error.message || error);
    throw new Error('Failed to create history entry in Supabase.');
  }

  const db = readLocalDb();
  db.histories.push(entry);
  writeLocalDb(db);
  return entry;
}

export async function getHistoryList(userId) {
  const supabaseClient = await getCollection('histories');
  if (supabaseClient) {
    const { data, error } = await supabaseClient
      .from('histories')
      .select('*')
      .eq('userId', userId)
      .order('createdAt', { ascending: false });
    if (!error) return data || [];
    console.error('Supabase getHistoryList error:', error.message || error);
    return [];
  }

  if (process.env.VERCEL) {
    return [];
  }
  const db = readLocalDb();
  return db.histories
    .filter(item => item.userId === userId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export async function findHistoryById(id) {
  if (!id) return null;
  const supabaseClient = await getCollection('histories');
  if (supabaseClient) {
    const { data, error } = await supabaseClient.from('histories').select('*').eq('id', id).single();
    if (!error && data) return data;
    if (error && error.code !== 'PGRST116') console.error('Supabase findHistoryById error:', error.message || error);
  }

  if (process.env.VERCEL) {
    return null;
  }
  const db = readLocalDb();
  return db.histories.find(item => item.id === id) || null;
}

export async function getAuthUser(req) {
  const header = String(req.headers.authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return null;
  const session = await findSessionByToken(token);
  if (!session) return null;
  const user = await findUserById(session.userId);
  if (!user) return null;
  return { user, token };
}

export function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt
  };
}

export function extractJson(rawText) {
  const cleaned = String(rawText || '')
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) return cleaned;
  return cleaned.slice(first, last + 1);
}

export function normalizeStudyData(value, sourceText) {
  const fallback = generateStudySession(sourceText);
  const data = value && typeof value === 'object' ? value : {};
  data.subject = data.subject || fallback.subject;
  data.summary = data.summary && Array.isArray(data.summary.points) && data.summary.points.length ? data.summary : fallback.summary;
  data.summary.title = data.summary.title || fallback.summary.title;
  data.summary.points = (Array.isArray(data.summary.points) ? data.summary.points : [])
    .map((point, idx) => ({
      heading: String(point?.heading || fallback.summary.points[idx]?.heading || 'Key idea'),
      detail: String(point?.detail || fallback.summary.points[idx]?.detail || 'Review this important idea from the material.')
    }))
    .slice(0, 10);

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

export function normalizePanelResponses(value, fallbackResponses) {
  const list = Array.isArray(value) ? value : [];
  const responses = fallbackResponses.map((fallback, idx) => {
    const match = list.find(item => Number(item?.expertIndex) === idx) || list[idx] || {};
    return {
      expertIndex: idx,
      response: String(match.response || fallback.response || '').replace(/\s+/g, ' ').trim()
    };
  });
  return responses.map((item, idx) => (item.response ? item : fallbackResponses[idx]));
}

export function buildPanelFallbackResponses(question, subject, context, experts) {
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
  const sentences = String(context).split(/(?<=[.!?])\s+|\n+/).map(sentence => sentence.replace(/^[\-\s]+/, '').trim()).filter(sentence => sentence.length > 30);
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
  if (/war|hitler|germany|allies|axis|nazi|invasion|treaty|battle|conflict|peace/.test(joined)) {
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

export function buildPanelContext({ sourceText, summaryPoints, sourceSentences }) {
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

export async function generateStudySession(text) {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
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
  const stop = new Set(['about','above','after','again','against','all','also','am','an','and','any','are','as','at','be','because','been','before','being','began','below','between','both','but','by','became','can','could','did','do','does','doing','down','during','each','few','for','formed','from','further','had','has','have','having','he','her','here','hers','herself','him','himself','his','how','i','if','in','includes','including','into','is','it','its','itself','just','major','me','more','most','my','myself','no','nor','not','now','of','off','on','once','only','or','other','our','ours','ourselves','out','over','own','powers','same','she','should','so','some','states','such','than','that','the','their','theirs','them','themselves','then','there','these','they','this','those','through','till','to','too','tried','under','united','until','up','very','was','we','were','what','when','where','which','while','who','whom','why','with','world','would','you','your','yours','yourself','yourselves']);
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
      points.push({ heading: titleFromSentence(topic, detail), detail });
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

function buildExperts(topics) {
  const defaults = [
    { name: 'Ari', role: 'Domain Professional', emoji: '🧠', color: '#1f8ef1', opener: 'Based on the material, we should focus on what works in practice.' },
    { name: 'Prof. Rivera', role: 'Professor', emoji: '📘', color: '#ff6f61', opener: 'The evidence in the text suggests a structured explanation is needed.' },
    { name: 'Maya', role: 'Logical Beginner', emoji: '🤔', color: '#ffb400', opener: 'I want to ask the simple question the material helps answer.' },
    { name: 'Sam', role: 'Simple Explainer', emoji: '✨', color: '#34c38f', opener: 'Let me make the main idea easy to understand.' }
  ];
  return defaults;
}

function buildMemory(points) {
  return points.slice(0, 6).map(point => ({ term: point.heading, detail: point.detail }));
}

function buildMiniGames(points, topics) {
  return [
    {
      type: 'jeopardy',
      category: topics[0] || 'Main topic',
      questions: points.slice(0, 4).map(point => ({ q: point.heading, a: point.detail, hint: 'Remember the main idea.' }))
    },
    {
      type: 'timeline',
      category: 'Sequence',
      events: points.slice(0, 5).map((point, idx) => ({ event: point.heading, order: idx + 1, why: point.detail.slice(0, 100) }))
    },
    {
      type: 'word_association',
      category: 'Connections',
      pairs: points.slice(0, 6).map(point => ({ word: point.heading, associate: point.detail.split(' ')[0] || 'idea', why: 'It links to the key concept.' }))
    }
  ];
}

function shuffle(array) {
  return [...array].sort(() => Math.random() - 0.5);
}
