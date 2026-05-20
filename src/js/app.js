pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const API_URL = '/api/study';
const AUTH_KEY = 'studyforge.auth';
let content = '';
let data = null;
let auth = loadAuth();
let qAnswered = 0, qCorrect = 0;
let escState = { step: 0, puzzles: [], secs: 180, iv: null, attempts: 0, monster: 0, resets: 0, locked: false };
let simState = { step: 0 };
let matchState = { cards: [], flipped: [], matched: new Set(), moves: 0 };
let arenaState = { step: 0, playerHp: 100, foeHp: 100, streak: 0 };
let sortState = { cards: [], step: 0, score: 0 };
let forgeState = { cards: [], step: 0, picked: [] };
let panelHistory = [];
let panelBusy = false;
let panelTurn = 0;
let activeGame = null;
let gamesPlayed = { sim: false, escape: false, panel: false, match: false, jeopardy: false, timeline: false, connect: false, arena: false, sort: false, forge: false };
let escapePhotoUrls = [];
let escapeBgQueue = [];
let lastEscapeBg = '';
const BUILT_IN_ESCAPE_BACKGROUNDS = [
  'assets/escape/control-room.png',
  'assets/escape/pixel-study-room.png',
  'assets/escape/topdown-chase-room.jpg'
];
const STEP_LABELS = ['Scanning core concepts', 'Creating a crisp summary', 'Building a simple quiz', 'Assembling the games', 'Finishing your session'];

function showToast(msg, duration = 4000) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), duration);
}

function loadAuth() {
  try { return JSON.parse(localStorage.getItem(AUTH_KEY) || 'null'); }
  catch { return null; }
}

function saveAuth(nextAuth) {
  auth = nextAuth;
  if (nextAuth) localStorage.setItem(AUTH_KEY, JSON.stringify(nextAuth));
  else localStorage.removeItem(AUTH_KEY);
  updateUserUi();
}

function authHeaders() {
  return auth?.token ? { Authorization: 'Bearer ' + auth.token } : {};
}

async function apiJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(options.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Request failed.');
  return payload;
}

function switchAuth(mode) {
  const login = mode === 'login';
  document.getElementById('loginTab').classList.toggle('active', login);
  document.getElementById('signupTab').classList.toggle('active', !login);
  document.getElementById('loginForm').classList.toggle('active', login);
  document.getElementById('signupForm').classList.toggle('active', !login);
}

async function handleLogin(event) {
  event.preventDefault();
  try {
    const payload = await apiJson('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: document.getElementById('loginEmail').value,
        password: document.getElementById('loginPassword').value
      })
    });
    saveAuth(payload);
    showToast('Welcome back, ' + payload.user.name + '.');
    showScreen('upload');
  } catch (error) {
    showToast(error.message);
  }
}

async function handleSignup(event) {
  event.preventDefault();
  try {
    const payload = await apiJson('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({
        name: document.getElementById('signupName').value,
        email: document.getElementById('signupEmail').value,
        password: document.getElementById('signupPassword').value
      })
    });
    saveAuth(payload);
    showToast('Account created. Your study history will be saved.');
    showScreen('upload');
  } catch (error) {
    showToast(error.message);
  }
}

async function logout() {
  try {
    if (auth?.token) await apiJson('/api/auth/logout', { method: 'POST', body: '{}' });
  } catch {}
  saveAuth(null);
  data = null;
  showScreen('auth');
}

async function initAuth() {
  if (!auth?.token) {
    showScreen('auth');
    return;
  }
  try {
    const payload = await apiJson('/api/auth/me');
    saveAuth({ token: auth.token, user: payload.user });
    showScreen('upload');
  } catch {
    saveAuth(null);
    showScreen('auth');
  }
}

function updateUserUi() {
  const user = auth?.user;
  const dashUser = document.getElementById('dash-user');
  if (dashUser) dashUser.textContent = user ? user.name : '';
  const profileName = document.getElementById('profile-name');
  const profileEmail = document.getElementById('profile-email');
  if (profileName) profileName.textContent = user ? user.name : 'Your profile';
  if (profileEmail) profileEmail.textContent = user ? user.email : '';
}

async function saveStudyHistory() {
  if (!auth?.token || !data) return;
  try {
    await apiJson('/api/history', {
      method: 'POST',
      body: JSON.stringify({ data, sourcePreview: content.slice(0, 240) })
    });
  } catch (error) {
    showToast('Study session created, but history was not saved: ' + error.message);
  }
}

async function openProfile() {
  if (!auth?.token) {
    showScreen('auth');
    return;
  }
  updateUserUi();
  showScreen('profile');
  const list = document.getElementById('history-list');
  list.innerHTML = '<div class="history-empty">Loading saved sessions...</div>';
  try {
    const payload = await apiJson('/api/history');
    if (!payload.history.length) {
      list.innerHTML = '<div class="history-empty">No saved sessions yet. Forge one from the study screen and it will appear here.</div>';
      return;
    }
    list.innerHTML = payload.history.map(item => {
      const date = new Date(item.createdAt).toLocaleString();
      return '<div class="history-item"><div><h4>' + escHtml(item.subject) + '</h4><p>' + escHtml(date) + ' - ' + item.summaryCount + ' summary points - ' + item.quizCount + ' quiz questions</p></div><button class="next-btn" onclick="loadHistory(\'' + item.id + '\')">Open</button></div>';
    }).join('');
  } catch (error) {
    list.innerHTML = '<div class="history-empty">' + escHtml(error.message) + '</div>';
  }
}

async function loadHistory(id) {
  try {
    const payload = await apiJson('/api/history/' + encodeURIComponent(id));
    data = payload.item.data;
    content = payload.item.sourcePreview || '';
    buildDash();
    showToast('Loaded saved study session.');
    showScreen('dashboard');
  } catch (error) {
    showToast(error.message);
  }
}

function updateCharCount() {
  const v = document.getElementById('textInput').value;
  const el = document.getElementById('charCount');
  el.textContent = v.length.toLocaleString() + ' / 10,000 characters';
  el.classList.toggle('warn', v.length > 8000);
}

const uploadZone = document.getElementById('uploadZone');
const fileInput = document.getElementById('fileInput');
const escapePhotos = document.getElementById('escapePhotos');
uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.classList.add('drag'); });
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag'));
uploadZone.addEventListener('drop', e => { e.preventDefault(); uploadZone.classList.remove('drag'); handleFile(e.dataTransfer.files[0]); });
fileInput.addEventListener('change', () => handleFile(fileInput.files[0]));
escapePhotos.addEventListener('change', () => {
  escapePhotoUrls.forEach(url => URL.revokeObjectURL(url));
  escapePhotoUrls = Array.from(escapePhotos.files || []).filter(file => file.type.startsWith('image/')).map(file => URL.createObjectURL(file));
  escapeBgQueue = [];
  updateEscapePhotoCount();
});

function updateEscapePhotoCount() {
  const total = BUILT_IN_ESCAPE_BACKGROUNDS.length + escapePhotoUrls.length;
  const extra = escapePhotoUrls.length ? ' + ' + escapePhotoUrls.length + ' uploaded' : '';
  document.getElementById('photoCount').textContent = total + ' rotating' + extra;
}

async function handleFile(file) {
  if (!file) return;
  document.getElementById('fileTagName').textContent = file.name;
  document.getElementById('fileTag').style.display = 'flex';
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    try {
      const buf = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
      let txt = '';
      for (let i = 1; i <= Math.min(pdf.numPages, 40); i++) {
        const pg = await pdf.getPage(i);
        const c = await pg.getTextContent();
        txt += c.items.map(s => s.str).join(' ') + '\n\n';
      }
      document.getElementById('textInput').value = txt.slice(0, 12000);
    } catch (e) {
      showToast('Could not parse PDF. Paste text instead.');
    }
  } else {
    document.getElementById('textInput').value = await file.text();
  }
  updateCharCount();
}

function clearFile() {
  document.getElementById('fileTag').style.display = 'none';
  fileInput.value = '';
  document.getElementById('textInput').value = '';
  updateCharCount();
}

document.getElementById('startBtn').addEventListener('click', async () => {
  if (!auth?.token) { showToast('Please log in first.'); showScreen('auth'); return; }
  const v = document.getElementById('textInput').value.trim();
  if (!v) { showToast('Please add some study content first.'); return; }
  if (v.length < 80) { showToast('Your content is very short. Add more for better results.'); return; }
  content = v.slice(0, 10000);
  await runPipeline();
});

async function runPipeline() {
  showScreen('loading');
  let step = 0;
  const setStep = i => {
    document.querySelectorAll('.lstep').forEach((el, idx) => {
      el.classList.remove('active', 'done');
      if (idx < i) el.classList.add('done');
      else if (idx === i) el.classList.add('active');
    });
    document.getElementById('loading-label').textContent = STEP_LABELS[i] + '...';
  };
  setStep(0);
  const iv = setInterval(() => { if (step < 4) { step++; setStep(step); } }, 1300);

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: content })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `Server error ${response.status}`);
    }

    const payload = await response.json();
    if (!payload || !payload.data) throw new Error('Invalid backend response');

    data = payload.data;
    if (payload.fallback) showToast('AI backend not configured: using local prototype fallback.');
    await saveStudyHistory();

    clearInterval(iv);
    document.querySelectorAll('.lstep').forEach(el => { el.classList.remove('active'); el.classList.add('done'); });
    document.getElementById('loading-label').textContent = payload.fallback ? 'Ready (local fallback)' : 'Ready!';
    await new Promise(r => setTimeout(r, 600));
    buildDash();
    showScreen('dashboard');
  } catch (e) {
    clearInterval(iv);
    console.error(e);
    const fallback = generateStudySession(content);
    if (fallback) {
      data = fallback;
      await saveStudyHistory();
      document.querySelectorAll('.lstep').forEach(el => { el.classList.remove('active'); el.classList.add('done'); });
      document.getElementById('loading-label').textContent = 'Ready (local fallback)';
      await new Promise(r => setTimeout(r, 600));
      buildDash();
      showToast('Backend unavailable: using local prototype fallback.');
      showScreen('dashboard');
    } else {
      showToast('Something went wrong: ' + e.message + '. Try again.');
      showScreen('upload');
    }
  }
}

function buildDash() {
  updateUserUi();
  document.getElementById('dash-subject').textContent = data.subject;
  document.getElementById('stat-subject').textContent = data.subject.split(' ').slice(0,2).join(' ');
  document.getElementById('stat-points').textContent = data.summary.points.length;
  document.getElementById('stat-quiz').textContent = data.quiz.length + ' Q';

  buildQuiz();

  const miniSummary = document.getElementById('summary-mini');
  const points = data.summary.points || [];
  miniSummary.classList.remove('expanded');
  miniSummary.innerHTML = '<h4>Full Summary</h4><div class="mini-points">' + 
    points.slice(0, 4).map(p => '<div class="mini-point"><strong>' + escHtml(p.heading) + '</strong>' + escHtml(p.detail) + '</div>').join('') +
    '</div><div class="summary-more">' +
    points.slice(4).map(p => '<div class="mini-point"><strong>' + escHtml(p.heading) + '</strong>' + escHtml(p.detail) + '</div>').join('') +
    '</div>' + (points.length > 4 ? '<button class="summary-toggle" onclick="toggleSummary()">Show all summary points</button>' : '');
}

function toggleSummary() {
  const box = document.getElementById('summary-mini');
  box.classList.toggle('expanded');
  const btn = box.querySelector('.summary-toggle');
  if (btn) btn.textContent = box.classList.contains('expanded') ? 'Show less' : 'Show all summary points';
}

function buildSummary() {
  const s = data.summary;
  document.getElementById('sum-title').textContent = s.title;
  const c = document.getElementById('sum-points');
  c.innerHTML = '';
  s.points.forEach((p, i) => {
    const d = document.createElement('div');
    d.className = 'kp';
    d.innerHTML = '<div class="kp-n">' + (i + 1) + '</div><div class="kp-body"><strong>' + escHtml(p.heading) + '</strong> - ' + escHtml(p.detail) + '</div>';
    c.appendChild(d);
  });
}

function buildQuiz() {
  qAnswered = 0; qCorrect = 0; updateScore();
  document.getElementById('quiz-complete').style.display = 'none';
  const c = document.getElementById('quiz-body');
  c.innerHTML = '';
  const letters = ['A', 'B', 'C', 'D'];
  data.quiz.forEach((q, qi) => {
    const card = document.createElement('div');
    card.className = 'q-card';
    card.id = 'qcard-' + qi;
    card.innerHTML = '<h4>' + (qi + 1) + '. ' + escHtml(q.question) + '</h4>' +
      '<div class="q-opts" id="opts-' + qi + '">' + q.options.map((o, oi) =>
        '<button class="q-opt" onclick="answerQ(' + qi + ',' + oi + ',' + q.correct + ',this)">' +
        '<span class="q-opt-letter">' + letters[oi] + '</span>' + escHtml(o) + '</button>'
      ).join('') + '</div>' +
      '<div class="q-explanation" id="qexp-' + qi + '">' + escHtml(q.explanation || '') + '</div>';
    c.appendChild(card);
  });
}

function answerQ(qi, chosen, correct, btn) {
  document.querySelectorAll('#opts-' + qi + ' .q-opt').forEach(b => { b.disabled = true; });
  if (chosen === correct) { btn.classList.add('correct'); qCorrect++; }
  else {
    btn.classList.add('wrong');
    const correctButton = document.querySelectorAll('#opts-' + qi + ' .q-opt')[correct];
    if (correctButton) correctButton.classList.add('correct');
  }
  const exp = document.getElementById('qexp-' + qi);
  if (exp && exp.textContent) exp.style.display = 'block';
  qAnswered++;
  updateScore();
  if (qAnswered === data.quiz.length) setTimeout(showQuizComplete, 500);
}

function showQuizComplete() {
  const pct = Math.round((qCorrect / data.quiz.length) * 100);
  let title, msg;
  if (pct === 100) { title = 'Perfect score!'; msg = 'You nailed every question. Review the summary or try another game.'; }
  else if (pct >= 80) { title = 'Great work!'; msg = 'You got ' + qCorrect + ' of ' + data.quiz.length + ' correct (' + pct + '%).'; }
  else if (pct >= 60) { title = 'Good effort'; msg = 'You got ' + qCorrect + ' of ' + data.quiz.length + ' (' + pct + '%). Try another game to reinforce it.'; }
  else { title = 'Keep studying'; msg = 'You got ' + qCorrect + ' of ' + data.quiz.length + ' (' + pct + '%). The games are a great next step.'; }
  document.getElementById('quiz-complete-title').textContent = title;
  document.getElementById('quiz-complete-msg').textContent = msg;
  const el = document.getElementById('quiz-complete');
  el.style.display = 'block';
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function updateScore() {
  const total = data ? data.quiz.length : 0;
  document.getElementById('quiz-score').textContent = qCorrect + ' / ' + total;
  const pct = total > 0 ? (qCorrect / total) * 100 : 0;
  document.getElementById('score-fill').style.width = pct + '%';
}

function launchGame(type) {
  if (escState.iv) { clearInterval(escState.iv); escState.iv = null; }
  activeGame = type;
  gamesPlayed[type] = true;
  document.getElementById('card-' + type).classList.add('played');
  showScreen('game');
  if (type === 'sim') launchSim();
  else if (type === 'escape') launchEscape();
  else if (type === 'panel') launchPanel();
  else if (type === 'match') launchMatch();
  else if (type === 'jeopardy') launchJeopardy();
  else if (type === 'timeline') launchTimeline();
  else if (type === 'connect') launchConnect();
  else if (type === 'arena') launchArena();
  else if (type === 'sort') launchSort();
  else if (type === 'forge') launchForge();
}

function backToDash() {
  if (escState.iv) { clearInterval(escState.iv); escState.iv = null; }
  activeGame = null;
  showScreen('dashboard');
}

function launchSim() {
  document.getElementById('game-title').textContent = 'Live Scenario';
  simState = { step: 0, pressure: 35, trust: 45, stability: 50, history: [], lastOutcome: '' };
  renderSim();
}

function renderSim() {
  const area = document.getElementById('game-area');
  const sc = data.simulation;
  if (!sc || !sc.scenarios.length) {
    area.innerHTML = '<div class="fail-box"><span class="fail-emoji">!</span><h2>No simulation available.</h2><p>Try a different input or refresh.</p></div>';
    return;
  }
  const total = sc.scenarios.length;
  if (simState.step >= total) {
    const ending = simState.stability >= 65 ? 'You built a strong, careful solution.' : simState.trust >= 65 ? 'You won people over, but the situation still needs follow-through.' : 'You survived the crisis, but your choices left complicated consequences.';
    area.innerHTML = '<div class="win-box"><span class="win-emoji">Done</span><h2>Scenario Complete</h2><p>' + escHtml(ending) + ' Final state: pressure ' + simState.pressure + ', trust ' + simState.trust + ', stability ' + simState.stability + '.</p><div class="btn-row"><button class="next-btn" onclick="launchSim()">Play Again</button><button class="alt-btn" onclick="backToDash()">Back to dashboard</button></div></div>';
    return;
  }
  const s = sc.scenarios[simState.step];
  const dots = Array.from({ length: total }, (_, i) => '<div class="sim-dot ' + (i < simState.step ? 'done' : i === simState.step ? 'now' : '') + '"></div>').join('');
  const consequence = simState.lastOutcome ? '<div class="outcome" style="margin-bottom:14px"><div class="outcome-lbl">Last consequence</div><p>' + escHtml(simState.lastOutcome) + '</p></div>' : '';
  const ledger = '<div class="sim-ledger"><div class="ledger-card"><div class="ledger-label">Pressure</div><div class="ledger-value">' + simState.pressure + '/100</div></div><div class="ledger-card"><div class="ledger-label">Trust</div><div class="ledger-value">' + simState.trust + '/100</div></div><div class="ledger-card"><div class="ledger-label">Stability</div><div class="ledger-value">' + simState.stability + '/100</div></div></div>';
  area.innerHTML = '<div class="sim-progress">' + dots + '</div>' + ledger + consequence +
    '<div class="scene-box"><div class="role-tag">Role: ' + escHtml(sc.role) + '</div><p>' + escHtml(s.scene) + '</p></div>' +
    '<p class="scene-prompt">Decision ' + (simState.step + 1) + ' of ' + total + ': choose carefully, because the next situation reacts to this.</p>' +
    '<div class="choice-stack">' + s.choices.map((c, i) => '<button class="choice-btn" onclick="pickChoice(' + i + ')"><span class="choice-key">' + String.fromCharCode(65 + i) + '</span>' + escHtml(c.text) + '</button>').join('') + '</div>' +
    '<div id="out-area"></div>';
}

function pickChoice(idx) {
  document.querySelectorAll('.choice-btn').forEach(b => b.disabled = true);
  const choice = data.simulation.scenarios[simState.step].choices[idx];
  const effect = choice.effect || {};
  simState.pressure = clamp(simState.pressure + (effect.pressure || 0), 0, 100);
  simState.trust = clamp(simState.trust + (effect.trust || 0), 0, 100);
  simState.stability = clamp(simState.stability + (effect.stability || 0), 0, 100);
  simState.lastOutcome = choice.outcome;
  simState.history.push(choice.text);
  document.getElementById('out-area').innerHTML = '<div class="outcome"><div class="outcome-lbl">Consequence</div><p>' + escHtml(choice.outcome) + '</p><div class="btn-row" style="justify-content:flex-start"><button class="next-btn" onclick="nextSim()">Continue</button></div></div>';
  document.getElementById('out-area').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function nextSim() { simState.step++; renderSim(); }

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
function launchEscape() {
  document.getElementById('game-title').textContent = 'Study Escape Room';
  escState = createEscapeRun(0);
  renderEscape();
  escState.iv = setInterval(() => {
    escState.secs--;
    escState.monster = clamp(escState.monster + 1.15 + (escState.step * 0.1), 0, 100);
    const el = document.getElementById('esc-timer');
    if (el) { el.textContent = fmtTime(escState.secs); el.classList.toggle('low', escState.secs < 60); }
    updateMonsterHud();
    if (!escState.locked && escState.secs <= 0) failEscape('Time is up!', 'The lock system changed while you were inside. Try again for a fresh room order and new answers.');
    else if (!escState.locked && escState.monster >= 100) failEscape('The monster caught you!', 'You waited too long. The next attempt will reshuffle the rooms and answer doors.');
  }, 1000);
}

function createEscapeRun(resets) {
  const basePuzzles = data.escape?.puzzles?.length ? data.escape.puzzles : buildEscape(data.summary.points || [], data.sourceSentences || [], []).puzzles;
  const puzzles = shuffle(basePuzzles.map((puzzle, idx) => prepareEscapePuzzle(puzzle, idx, resets))).slice(0, Math.min(6, basePuzzles.length));
  return { step: 0, puzzles, secs: 180, iv: escState.iv || null, attempts: 0, monster: Math.min(resets * 6, 28), resets, locked: false };
}

function prepareEscapePuzzle(puzzle, idx, resets) {
  const answer = puzzle.answer || puzzle.options?.[0] || puzzle.type || 'Main idea';
  const options = puzzle.options && puzzle.options.length ? puzzle.options.slice() : makeDoorOptions(answer);
  if (!options.some(option => normalizeAnswer(option) === normalizeAnswer(answer))) options[0] = answer;
  return {
    ...puzzle,
    question: remixEscapeQuestion(puzzle, idx + resets),
    options: shuffle(options).slice(0, 3),
    answer
  };
}

function remixEscapeQuestion(puzzle, idx) {
  const prompts = [
    'The lights flicker. Which exit matches this evidence?',
    'A siren starts counting down. Which door is supported by the clue?',
    'The corridor behind you shakes. Which choice unlocks the safest route?',
    'The control panel demands the concept that fits the room.',
    'The monster is close. Pick the door that best matches the evidence.'
  ];
  return prompts[idx % prompts.length] + ' ' + (puzzle.question || '');
}

function fmtTime(s) {
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

function renderEscape() {
  const area = document.getElementById('game-area');
  const step = escState.step, total = escState.puzzles.length;
  if (step >= total) {
    clearInterval(escState.iv); escState.iv = null;
    area.innerHTML = '<div class="win-box"><span class="win-emoji">Open</span><h2>You escaped!</h2><p>Solved all ' + total + ' rooms with <strong style="color:var(--gold)">' + fmtTime(escState.secs) + '</strong> left. Knowledge unlocked.</p><div class="btn-row"><button class="next-btn" onclick="launchGame(\'escape\')">Play Again</button><button class="alt-btn" onclick="backToDash()">Back</button></div></div>';
    return;
  }
  const pz = escState.puzzles[step];
  escState.attempts = 0;
  escState.locked = false;
  const dotsHtml = escState.puzzles.map((_, i) => '<div class="dot' + (i < step ? ' done' : i === step ? ' now' : '') + '"></div>').join('');
  const options = (pz.options && pz.options.length ? pz.options : makeDoorOptions(pz.answer));
  const roomPhoto = getRandomEscapePhoto();
  const doors = options.map((opt, i) => {
    const colors = ['#d1a35d', '#689eb8', '#a46a8f'];
    return '<button class="door-btn" style="--door:' + colors[i % colors.length] + '" onclick="chooseDoor(' + i + ')"><span class="door-label">Door ' + String.fromCharCode(65 + i) + '</span><span class="door-choice">' + escHtml(opt) + '</span><span class="door-knob"></span></button>';
  }).join('');
  area.innerHTML = '<div class="room-top"><div class="dots">' + dotsHtml + '</div><div class="timer" id="esc-timer">' + fmtTime(escState.secs) + '</div></div>' +
    '<div class="room-view">' +
    '<div class="escape-hud"><div class="monster-meter"><div class="monster-meter-label"><span>Monster distance</span><span id="monster-label">' + Math.round(100 - escState.monster) + '% safe</span></div><div class="monster-track"><div class="monster-fill" id="monster-fill" style="width:' + escState.monster + '%"></div></div></div><div class="match-stat">Resets: ' + escState.resets + '</div></div>' +
    '<div class="ptype">Sector ' + (step + 1) + ': ' + escHtml(pz.type) + '</div>' +
    '<h3 style="margin-bottom:10px;line-height:1.45">' + escHtml(pz.question) + '</h3>' +
    '<p class="room-clue">Clue: ' + escHtml(pz.clue) + '</p>' +
    '<div class="room-tools">' + (pz.tools || []).map((tool, i) => '<button class="tool-btn" onclick="inspectTool(' + i + ', this)"><strong>' + escHtml(tool.name) + '</strong><br>Inspect</button>').join('') + '</div>' +
    '<div class="room-log" id="room-log">' + escHtml(pz.brief || 'Inspect the room, then choose the door that fits the evidence.') + '</div>' +
    '<div class="escape-stage ' + (roomPhoto ? 'photo-bg' : '') + '" style="' + (roomPhoto ? 'background-image:url(&quot;' + escHtml(roomPhoto) + '&quot;)' : '') + '" aria-label="2D escape room with three doors and a pursuing monster">' +
    '<div class="escape-prop board"></div><div class="escape-prop desk"></div><div class="escape-prop table"></div><div class="escape-prop plant"></div>' +
    '<div class="escape-monster" id="escape-monster" style="--monster-x:' + escState.monster + '"></div><div class="escape-player"></div>' +
    '<div class="escape-door-lane">' + doors + '</div></div>' +
    '<div class="fb" id="esc-fb"></div>' +
    '<div class="hint-toggle" onclick="toggleHint()">Show hint</div>' +
    '<div class="hint-box" id="hint-box">' + escHtml(pz.hint) + '</div>' +
    '<div class="skip-link" onclick="skipPuzzle()">Force open a side hatch (-30 seconds)</div></div>';
}

function getRandomEscapePhoto() {
  const pool = BUILT_IN_ESCAPE_BACKGROUNDS.concat(escapePhotoUrls);
  if (!pool.length) return '';
  if (!escapeBgQueue.length) {
    escapeBgQueue = shuffle(pool.slice());
    if (escapeBgQueue.length > 1 && escapeBgQueue[0] === lastEscapeBg) {
      escapeBgQueue.push(escapeBgQueue.shift());
    }
  }
  lastEscapeBg = escapeBgQueue.shift();
  return lastEscapeBg;
}

function inspectTool(idx, btn) {
  const pz = escState.puzzles[escState.step];
  const tool = (pz.tools || [])[idx];
  if (!tool) return;
  btn.classList.add('used');
  const log = document.getElementById('room-log');
  if (log) log.textContent = tool.reveal;
  escState.monster = clamp(escState.monster - 5, 0, 100);
  updateMonsterHud();
}

function makeDoorOptions(answer) {
  const pool = data.summary.points.map(p => p.heading).filter(Boolean);
  const options = [answer];
  pool.forEach(p => { if (options.length < 3 && p.toLowerCase() !== String(answer).toLowerCase()) options.push(p); });
  while (options.length < 3) options.push(['Cause and effect','Alliance building','Long-term consequence'][options.length - 1]);
  return shuffle(options).slice(0, 3);
}

function toggleHint() {
  const h = document.getElementById('hint-box');
  const toggle = document.querySelector('.hint-toggle');
  const showing = h.style.display === 'block';
  h.style.display = showing ? 'none' : 'block';
  toggle.textContent = showing ? 'Show hint' : 'Hide hint';
}

function chooseDoor(idx) {
  if (escState.locked) return;
  const pz = escState.puzzles[escState.step];
  const options = (pz.options && pz.options.length ? pz.options : makeDoorOptions(pz.answer));
  const picked = options[idx];
  const ok = normalizeAnswer(picked) === normalizeAnswer(pz.answer);
  const fb = document.getElementById('esc-fb');
  const doors = document.querySelectorAll('.door-btn');
  escState.locked = true;
  if (ok) {
    doors.forEach(b => b.disabled = true);
    doors[idx].classList.add('correct');
    escState.monster = clamp(escState.monster - 14, 0, 100);
    fb.innerHTML = '<span class="chip ok">Correct. You sprint through before the monster reaches you.</span>';
    updateMonsterHud();
    setTimeout(() => { escState.step++; renderEscape(); }, 850);
  } else {
    escState.attempts++;
    doors[idx].classList.add('wrong');
    doors.forEach(b => b.disabled = true);
    escState.monster = 100;
    fb.innerHTML = '<span class="chip bad">Wrong door. The monster catches you and the escape resets from the beginning.</span>';
    updateMonsterHud();
    setTimeout(resetEscapeFromWrongAnswer, 1300);
  }
}

function updateMonsterHud() {
  const fill = document.getElementById('monster-fill');
  const label = document.getElementById('monster-label');
  const monster = document.getElementById('escape-monster');
  if (fill) fill.style.width = escState.monster + '%';
  if (label) label.textContent = Math.max(0, Math.round(100 - escState.monster)) + '% safe';
  if (monster) monster.style.setProperty('--monster-x', escState.monster);
}

function resetEscapeFromWrongAnswer() {
  const iv = escState.iv;
  escState = createEscapeRun(escState.resets + 1);
  escState.iv = iv;
  showToast('Wrong answer: back to the beginning with a new order.');
  renderEscape();
}

function failEscape(title, message) {
  if (escState.iv) { clearInterval(escState.iv); escState.iv = null; }
  document.getElementById('game-area').innerHTML = '<div class="fail-box"><span class="fail-emoji">!</span><h2>' + escHtml(title) + '</h2><p>' + escHtml(message) + ' You solved ' + escState.step + ' of ' + escState.puzzles.length + ' rooms.</p><div class="btn-row"><button class="next-btn" onclick="launchGame(\'escape\')">Try Fresh Run</button><button class="alt-btn" onclick="backToDash()">Back</button></div></div>';
}

function normalizeAnswer(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function checkEsc() {
  chooseDoor(0);
}

function skipPuzzle() {
  if (escState.locked) return;
  escState.step++;
  escState.secs = Math.max(0, escState.secs - 30);
  escState.monster = clamp(escState.monster + 12, 0, 100);
  renderEscape();
}

function launchMatch() {
  document.getElementById('game-title').textContent = 'Concept Match';
  const pairs = (data.memory && data.memory.length ? data.memory : buildMemory(data.summary.points)).slice(0, 6);
  const cards = [];
  pairs.forEach((pair, idx) => {
    cards.push({ pair: idx, kind: 'term', text: pair.term });
    cards.push({ pair: idx, kind: 'detail', text: pair.detail });
  });
  matchState = { cards: shuffle(cards), flipped: [], matched: new Set(), moves: 0 };
  renderMatch();
}

function renderMatch() {
  const area = document.getElementById('game-area');
  const done = matchState.matched.size;
  area.innerHTML = '<div class="match-top"><div><h2>Match concepts to meanings</h2><p class="scene-prompt">Flip two cards. A concept matches its explanation.</p></div><div class="match-stat">Moves: ' + matchState.moves + ' | Matches: ' + done + '</div></div>' +
    '<div class="match-board">' + matchState.cards.map((card, i) => {
      const visible = matchState.flipped.includes(i) || matchState.matched.has(card.pair);
      return '<button class="match-card ' + (visible ? 'flipped ' : '') + (matchState.matched.has(card.pair) ? 'matched' : '') + '" onclick="flipMatch(' + i + ')">' + escHtml(visible ? card.text : 'Flip') + '</button>';
    }).join('') + '</div>' +
    (done === (matchState.cards.length / 2) ? '<div class="win-box" style="margin-top:18px"><h2>All matched!</h2><p>You connected the biggest ideas to what they mean.</p><div class="btn-row"><button class="next-btn" onclick="launchMatch()">Play Again</button><button class="alt-btn" onclick="backToDash()">Back</button></div></div>' : '');
}

function flipMatch(index) {
  if (matchState.flipped.includes(index) || matchState.matched.has(matchState.cards[index].pair) || matchState.flipped.length >= 2) return;
  matchState.flipped.push(index);
  if (matchState.flipped.length === 2) {
    matchState.moves++;
    const [a, b] = matchState.flipped;
    if (matchState.cards[a].pair === matchState.cards[b].pair && matchState.cards[a].kind !== matchState.cards[b].kind) {
      matchState.matched.add(matchState.cards[a].pair);
      matchState.flipped = [];
      renderMatch();
    } else {
      renderMatch();
      setTimeout(() => { matchState.flipped = []; renderMatch(); }, 800);
      return;
    }
  }
  renderMatch();
}

function launchJeopardy() {
  document.getElementById('game-title').textContent = 'Knowledge Board';
  const game = getMiniGame('jeopardy');
  const questions = (game?.questions && game.questions.length ? game.questions : data.summary.points.slice(0, 5).map(p => ({ q: 'What does "' + p.heading + '" mean?', a: p.detail, hint: 'Use the summary evidence.' }))).slice(0, 6);
  const area = document.getElementById('game-area');
  area.innerHTML = '<div class="match-top"><div><h2>' + escHtml(game?.category || data.subject) + '</h2><p class="scene-prompt">Open a prompt, answer out loud or in your notes, then reveal the expected answer.</p></div><div class="match-stat">Recall</div></div>' +
    '<div class="game-grid">' + questions.map((item, i) =>
      '<div class="game-card" style="--c:#7b61ff;cursor:default"><div class="gc-badge">' + ((i + 1) * 100) + '</div><h3>' + escHtml(item.q || item.question || 'Question') + '</h3><p id="jp-' + i + '">' + escHtml(item.hint || 'Think before revealing.') + '</p><button class="next-btn" style="margin-top:12px" onclick="revealJeopardy(' + i + ')">Reveal</button></div>'
    ).join('') + '</div>';
}

function revealJeopardy(index) {
  const game = getMiniGame('jeopardy');
  const questions = (game?.questions && game.questions.length ? game.questions : data.summary.points.map(p => ({ q: p.heading, a: p.detail })));
  const answer = questions[index]?.a || questions[index]?.answer || data.summary.points[index]?.detail || '';
  const el = document.getElementById('jp-' + index);
  if (el) el.textContent = answer;
}

function launchTimeline() {
  document.getElementById('game-title').textContent = 'Timeline Builder';
  const game = getMiniGame('timeline');
  const events = (game?.events && game.events.length ? game.events : data.summary.points.slice(0, 6).map((p, i) => ({ event: p.heading, order: i + 1, why: p.detail }))).slice(0, 6);
  const shuffled = shuffle(events.slice());
  const area = document.getElementById('game-area');
  area.innerHTML = '<div class="match-top"><div><h2>Build the sequence</h2><p class="scene-prompt">Click cards in the order you think they belong. Then reveal the explanation.</p></div><div class="match-stat" id="timeline-stat">Picked: 0</div></div>' +
    '<div class="choice-stack" id="timeline-list">' + shuffled.map((item, i) =>
      '<button class="choice-btn" onclick="pickTimeline(' + i + ', this)" data-order="' + Number(item.order || i + 1) + '"><span class="choice-key">' + (i + 1) + '</span>' + escHtml(item.event || item.heading || 'Event') + '</button>'
    ).join('') + '</div><div id="timeline-out"></div>';
}

function pickTimeline(index, btn) {
  btn.disabled = true;
  btn.dataset.picked = '1';
  const picked = Array.from(document.querySelectorAll('#timeline-list .choice-btn[data-picked="1"]'));
  document.getElementById('timeline-stat').textContent = 'Picked: ' + picked.length;
  if (picked.length === document.querySelectorAll('#timeline-list .choice-btn').length) {
    const orders = picked.map(b => Number(b.dataset.order));
    const correct = orders.every((order, i) => i === 0 || order >= orders[i - 1]);
    document.getElementById('timeline-out').innerHTML = '<div class="outcome"><div class="outcome-lbl">' + (correct ? 'Strong sequence' : 'Review sequence') + '</div><p>' + (correct ? 'Your order follows the structure from the material.' : 'Some items are out of order. Compare the summary points and try again.') + '</p><div class="btn-row" style="justify-content:flex-start"><button class="next-btn" onclick="launchTimeline()">Try Again</button></div></div>';
  }
}

function launchConnect() {
  document.getElementById('game-title').textContent = 'Connection Web';
  const game = getMiniGame('word_association');
  const pairs = (game?.pairs && game.pairs.length ? game.pairs : data.summary.points.slice(0, 5).map((p, i) => ({
    word: p.heading,
    associate: data.summary.points[(i + 1) % data.summary.points.length]?.heading || data.subject,
    why: p.detail
  }))).slice(0, 6);
  const area = document.getElementById('game-area');
  area.innerHTML = '<div class="match-top"><div><h2>Explain the link</h2><p class="scene-prompt">Each pair asks you to explain why two ideas belong together.</p></div><div class="match-stat">Connections</div></div>' +
    '<div class="choice-stack">' + pairs.map((pair, i) =>
      '<div class="scene-box"><div class="role-tag">' + escHtml(pair.word) + ' -> ' + escHtml(pair.associate) + '</div><p id="conn-' + i + '">' + escHtml(pair.why || 'Say the connection in your own words, then reveal the guide answer.') + '</p></div>'
    ).join('') + '</div>';
}

function launchArena() {
  document.getElementById('game-title').textContent = 'Concept Arena';
  arenaState = {
    step: 0,
    playerHp: 100,
    foeHp: 100,
    streak: 0,
    deck: shuffle(getArenaQuestions()).slice(0, 8),
    last: ''
  };
  renderArena();
}

function getArenaQuestions() {
  const quizItems = (data.quiz || []).filter(q => q.options && q.options.length >= 3).map(q => ({
    question: q.question,
    options: q.options.slice(0, 4),
    correct: Number(q.correct || 0),
    explanation: q.explanation || 'This answer best matches the study material.'
  }));
  if (quizItems.length >= 5) return quizItems;
  return (data.summary?.points || []).slice(0, 8).map((point, idx, points) => {
    const correct = point.detail;
    const options = uniqueOptions([
      correct,
      points[(idx + 1) % points.length]?.detail,
      'A related idea, but it does not explain this concept as directly.',
      'A surface detail that misses the cause or consequence.'
    ].filter(Boolean)).slice(0, 4);
    shuffle(options);
    return {
      question: 'What best weakens confusion about "' + point.heading + '"?',
      options,
      correct: options.indexOf(correct),
      explanation: point.detail
    };
  });
}

function renderArena() {
  const area = document.getElementById('game-area');
  if (arenaState.foeHp <= 0 || arenaState.step >= arenaState.deck.length) {
    const won = arenaState.foeHp <= 0 || arenaState.playerHp > 0;
    area.innerHTML = '<div class="' + (won ? 'win-box' : 'fail-box') + '"><h2>' + (won ? 'Confusion Broken' : 'Focus Cracked') + '</h2><p>' + (won ? 'You used the material to keep pressure on the hard ideas.' : 'Review the summary, then come back with a sharper plan.') + '</p><div class="btn-row"><button class="next-btn" onclick="launchArena()">Play Again</button><button class="alt-btn" onclick="backToDash()">Back</button></div></div>';
    return;
  }
  if (arenaState.playerHp <= 0) {
    area.innerHTML = '<div class="fail-box"><h2>Focus Cracked</h2><p>The wrong answers stacked up. Try again and use the explanations after each hit.</p><div class="btn-row"><button class="next-btn" onclick="launchArena()">Try Again</button><button class="alt-btn" onclick="backToDash()">Back</button></div></div>';
    return;
  }
  const q = arenaState.deck[arenaState.step];
  area.innerHTML = '<div class="arena-wrap">' +
    '<div class="arena-bars"><div class="arena-meter"><span><b>Your focus</b><b>' + arenaState.playerHp + '%</b></span><div class="arena-track"><div class="arena-fill" style="width:' + arenaState.playerHp + '%"></div></div></div><div class="arena-meter"><span><b>Confusion</b><b>' + arenaState.foeHp + '%</b></span><div class="arena-track"><div class="arena-fill foe" style="width:' + arenaState.foeHp + '%"></div></div></div></div>' +
    '<div class="arena-question"><div class="role-tag">Round ' + (arenaState.step + 1) + ' / ' + arenaState.deck.length + ' | Streak ' + arenaState.streak + '</div><h3>' + escHtml(q.question) + '</h3>' + (arenaState.last ? '<p class="scene-prompt">' + escHtml(arenaState.last) + '</p>' : '') + '</div>' +
    '<div class="choice-stack">' + q.options.map((option, i) => '<button class="choice-btn" onclick="answerArena(' + i + ')"><span class="choice-key">' + String.fromCharCode(65 + i) + '</span>' + escHtml(option) + '</button>').join('') + '</div></div>';
}

function answerArena(index) {
  const q = arenaState.deck[arenaState.step];
  const ok = index === q.correct;
  if (ok) {
    const damage = Math.min(34, 20 + arenaState.streak * 4);
    arenaState.foeHp = clamp(arenaState.foeHp - damage, 0, 100);
    arenaState.streak++;
    arenaState.last = 'Hit for ' + damage + '. ' + (q.explanation || 'Good evidence choice.');
  } else {
    arenaState.playerHp = clamp(arenaState.playerHp - 22, 0, 100);
    arenaState.streak = 0;
    arenaState.last = 'Confusion hit back. Correct answer: ' + q.options[q.correct];
  }
  arenaState.step++;
  renderArena();
}

function launchSort() {
  document.getElementById('game-title').textContent = 'Signal Sort Lab';
  sortState = { cards: buildSortCards(), step: 0, score: 0, last: '' };
  renderSort();
}

function buildSortCards() {
  const points = (data.summary?.points || []).slice(0, 8);
  return shuffle(points.map((point, idx) => ({
    heading: point.heading,
    detail: point.detail,
    category: classifyStudySignal(point, idx)
  })));
}

function classifyStudySignal(point, idx) {
  const text = (point.heading + ' ' + point.detail).toLowerCase();
  if (/because|cause|reason|led to|leads to|why|trigger/.test(text)) return 'Cause';
  if (/effect|result|consequence|impact|changed|therefore|after/.test(text)) return 'Consequence';
  if (/evidence|shows|according|supports|example|data|source|text/.test(text)) return 'Evidence';
  return ['Definition', 'Cause', 'Consequence', 'Evidence'][idx % 4];
}

function renderSort() {
  const area = document.getElementById('game-area');
  if (!sortState.cards.length || sortState.step >= sortState.cards.length) {
    const pct = sortState.cards.length ? Math.round((sortState.score / sortState.cards.length) * 100) : 0;
    area.innerHTML = '<div class="win-box"><h2>Signals Sorted</h2><p>You scored ' + sortState.score + ' of ' + sortState.cards.length + ' (' + pct + '%). Sorting ideas by job makes the material easier to use in answers.</p><div class="btn-row"><button class="next-btn" onclick="launchSort()">Play Again</button><button class="alt-btn" onclick="backToDash()">Back</button></div></div>';
    return;
  }
  const card = sortState.cards[sortState.step];
  const bins = ['Definition', 'Cause', 'Consequence', 'Evidence'];
  area.innerHTML = '<div class="match-top"><div><h2>Signal Sort Lab</h2><p class="scene-prompt">Score: ' + sortState.score + ' | Card ' + (sortState.step + 1) + ' of ' + sortState.cards.length + '</p></div><div class="match-stat">Pick signal</div></div>' +
    '<div class="sort-board"><div class="sort-card"><div class="role-tag">Study signal</div><h3>' + escHtml(card.heading) + '</h3><p>' + escHtml(card.detail) + '</p>' + (sortState.last ? '<p class="scene-prompt" style="margin-top:12px">' + escHtml(sortState.last) + '</p>' : '') + '</div>' +
    '<div class="sort-bins">' + bins.map(bin => '<button class="sort-bin" onclick="pickSort(\'' + bin + '\', this)">' + bin + '</button>').join('') + '</div></div>';
}

function pickSort(category, btn) {
  const card = sortState.cards[sortState.step];
  document.querySelectorAll('.sort-bin').forEach(b => b.disabled = true);
  if (category === card.category) {
    sortState.score++;
    btn.classList.add('ok');
    sortState.last = 'Correct: this card works best as ' + card.category + '.';
  } else {
    btn.classList.add('bad');
    sortState.last = 'Closest signal: ' + card.category + '.';
  }
  setTimeout(() => { sortState.step++; renderSort(); }, 650);
}

function launchForge() {
  document.getElementById('game-title').textContent = 'Word Forge';
  forgeState = { cards: buildForgeCards(), step: 0, picked: [], score: 0, last: '' };
  renderForge();
}

function buildForgeCards() {
  const points = (data.summary?.points || []).filter(point => point.heading).slice(0, 8);
  return points.map((point, idx, all) => {
    const answerWords = conceptWords(point.heading);
    const distractors = all.flatMap(other => conceptWords(other.heading)).filter(word => !answerWords.includes(word)).slice(0, 6);
    const tiles = shuffle(answerWords.concat(shuffle(distractors).slice(0, Math.min(4, Math.max(2, answerWords.length + 1))))).map((word, tileIdx) => ({ id: idx + '-' + tileIdx, word }));
    return { heading: point.heading, detail: point.detail, answerWords, tiles };
  });
}

function conceptWords(value) {
  const words = String(value || '').replace(/[^a-zA-Z0-9\s]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 4);
  return words.length ? words : ['Concept'];
}

function renderForge() {
  const area = document.getElementById('game-area');
  if (!forgeState.cards.length || forgeState.step >= forgeState.cards.length) {
    area.innerHTML = '<div class="win-box"><h2>Concepts Forged</h2><p>You rebuilt ' + forgeState.score + ' of ' + forgeState.cards.length + ' key terms from clues.</p><div class="btn-row"><button class="next-btn" onclick="launchForge()">Play Again</button><button class="alt-btn" onclick="backToDash()">Back</button></div></div>';
    return;
  }
  const card = forgeState.cards[forgeState.step];
  const pickedTiles = forgeState.picked.map(tileIndex => card.tiles[tileIndex]).filter(Boolean);
  area.innerHTML = '<div class="match-top"><div><h2>Word Forge</h2><p class="scene-prompt">Term ' + (forgeState.step + 1) + ' of ' + forgeState.cards.length + '</p></div><div class="match-stat">Forged: ' + forgeState.score + '</div></div>' +
    '<div class="forge-clue"><div class="role-tag">Clue</div><h3>' + escHtml(String(card.detail || '').slice(0, 160)) + '</h3><p>' + escHtml(forgeState.last || 'Build the concept named by this clue.') + '</p></div>' +
    '<div class="forge-answer">' + (pickedTiles.length ? pickedTiles.map((tile, i) => '<button class="word-tile" onclick="unpickForge(' + i + ')">' + escHtml(tile.word) + '</button>').join('') : '<span class="scene-prompt">Pick tiles below</span>') + '</div>' +
    '<div class="tile-bank">' + card.tiles.map((tile, i) => '<button class="word-tile" onclick="pickForge(' + i + ')" ' + (forgeState.picked.includes(i) ? 'disabled' : '') + '>' + escHtml(tile.word) + '</button>').join('') + '</div>' +
    '<div class="btn-row" style="justify-content:flex-start"><button class="next-btn" onclick="checkForge()">Forge</button><button class="alt-btn" onclick="clearForge()">Clear</button></div>';
}

function pickForge(index) {
  if (!forgeState.picked.includes(index)) forgeState.picked.push(index);
  renderForge();
}

function unpickForge(pickedIndex) {
  forgeState.picked.splice(pickedIndex, 1);
  renderForge();
}

function clearForge() {
  forgeState.picked = [];
  forgeState.last = 'Cleared.';
  renderForge();
}

function checkForge() {
  const card = forgeState.cards[forgeState.step];
  const answer = card.answerWords.join(' ').toLowerCase();
  const guess = forgeState.picked.map(i => card.tiles[i]?.word || '').join(' ').toLowerCase();
  if (guess === answer) {
    forgeState.score++;
    forgeState.last = 'Correct: ' + card.heading + '.';
    forgeState.step++;
    forgeState.picked = [];
  } else {
    forgeState.last = 'Not yet. The clue points to: ' + card.answerWords.length + ' tile' + (card.answerWords.length === 1 ? '' : 's') + '.';
  }
  renderForge();
}

function getMiniGame(type) {
  return (data.mini_games || []).find(game => game.type === type || (type === 'connect' && game.type === 'word_association'));
}

function launchPanel() {
  document.getElementById('game-title').textContent = 'Expert Panel';
  panelBusy = false;
  panelTurn++;
  panelHistory = data.experts.map(e => ({ type: 'expert', expert: e, text: e.opener }));
  renderPanel(true);
}

function renderPanel(initial = false) {
  const area = document.getElementById('game-area');
  const roster = data.experts.map(e => '<div class="expert-chip" style="border-color:' + e.color + '44">' + escHtml(e.emoji) + ' <span style="color:' + e.color + ';font-family:\'Syne\',sans-serif;font-size:12px;font-weight:700">' + escHtml(e.name) + '</span> <span style="color:#31415c;font-size:11px"> - ' + escHtml(e.role) + '</span></div>').join('');
  const msgs = panelHistory.map(m => {
    if (m.type === 'user') {
      return '<div class="exp-user-row"><div class="exp-user-msg">' + escHtml(m.text) + '</div></div>';
    }
    if (m.type === 'thinking') {
      return '<div class="exp-thinking">' + escHtml(m.text) + ' <span class="dots-ani"><span>.</span><span>.</span><span>.</span></span></div>';
    }
    return '<div class="exp-msg"><div class="exp-av" style="background:' + m.expert.color + '18;border-color:' + m.expert.color + '44;color:' + m.expert.color + '">' + escHtml(m.expert.emoji) + '</div><div class="exp-meta"><div class="exp-name" style="color:' + m.expert.color + '">' + escHtml(m.expert.name) + '</div><div class="exp-role">' + escHtml(m.expert.role) + '</div><div class="exp-bubble">' + escHtml(m.text) + '</div></div></div>';
  }).join('');
  area.innerHTML = '<div class="expert-roster">' + roster + '</div><div class="expert-panel" id="epanel">' + msgs + '</div><div class="debate-wrap"><input class="debate-inp" id="d-inp" placeholder="Ask a question about your material..." onkeydown="if(event.key===\'Enter\')sendQ()" ' + (panelBusy ? 'disabled' : '') + '><button class="btn-send" id="d-send" onclick="sendQ()" ' + (panelBusy ? 'disabled' : '') + '>' + (panelBusy ? 'Thinking' : 'Ask') + '</button></div><p class="panel-note">Experts ground answers in your PDF first, then add broader related context when useful.</p>';
  const ep = document.getElementById('epanel');
  if (ep) ep.scrollTop = ep.scrollHeight;
  if (!initial) document.getElementById('d-inp').focus();
}

async function sendQ() {
  if (panelBusy) return;
  const inp = document.getElementById('d-inp');
  const q = inp.value.trim();
  if (!q) return;
  const turn = ++panelTurn;
  panelBusy = true;
  panelHistory.push({ type: 'user', text: q });
  renderPanel(false);
  try {
    panelHistory.push({ type: 'thinking', text: 'The panel is reading your PDF and checking related background' });
    renderPanel(false);
    const payload = await apiJson('/api/panel', {
      method: 'POST',
      body: JSON.stringify({
        question: q,
        subject: data.subject,
        summaryPoints: data.summary?.points || [],
        sourceSentences: data.sourceSentences || [],
        sourceText: content,
        experts: data.experts || []
      })
    });
    panelHistory = panelHistory.filter(m => m.type !== 'thinking');
    if (payload.fallback) showToast('AI panel backend unavailable: using smarter local panel replies.');
    await revealPanelResponsesSequentially(payload.responses || createPanelReplies(q), turn);
  } catch (error) {
    panelHistory = panelHistory.filter(m => m.type !== 'thinking');
    showToast('Panel AI unavailable: ' + error.message);
    await revealPanelResponsesSequentially(createPanelReplies(q), turn);
  } finally {
    if (turn === panelTurn) {
      panelBusy = false;
      renderPanel(false);
    }
  }
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function revealPanelResponsesSequentially(responses, turn) {
  const ordered = [0, 1, 2, 3].map(idx => responses.find(r => Number(r.expertIndex) === idx) || responses[idx]).filter(Boolean);
  for (const item of ordered) {
    if (turn !== panelTurn) return;
    const expert = data.experts[item.expertIndex] || data.experts[0];
    panelHistory.push({ type: 'thinking', text: (expert?.name || 'Expert') + ' is preparing a reply' });
    renderPanel(false);
    await wait(850);
    panelHistory = panelHistory.filter(m => m.type !== 'thinking');
    panelHistory.push({ type: 'expert', expert, text: item.response });
    renderPanel(false);
    await wait(450);
  }
}

function createPanelReplies(question) {
  const q = question.replace(/\s+/g, ' ').trim();
  const focus = findRelevantPoint(q);
  const answer = answerQuestionFromMaterial(q, focus);
  const broader = getBroaderContextHint(q, focus);
  const professional = data.experts[0]?.role || 'Domain Professional';
  return [
    {
      expertIndex: 0,
      response: professional + ': From the PDF, I would anchor this in ' + focus.heading + ': ' + focus.detail + ' Broader context: ' + broader + ' Practically, that means the answer should explain what pressure changed, who had to respond, and what consequence followed.'
    },
    {
      expertIndex: 1,
      response: 'Professor view: The direct PDF evidence is this: ' + focus.detail + ' The claim is: ' + answer + ' Connected idea: ' + broader + ' I would write it as claim, PDF evidence, outside context, then a final sentence explaining why the connection matters.'
    },
    {
      expertIndex: 2,
      response: 'Logical beginner view: I would ask, "What does the PDF actually say, and what extra idea helps me understand it?" The PDF points to ' + focus.heading + ': ' + focus.detail + ' The helpful outside connection is that ' + broader + ' That keeps the answer clear instead of just repeating a sentence.'
    },
    {
      expertIndex: 3,
      response: 'Simple version: The PDF says the important part is ' + focus.heading + '. In easier words, ' + answer + ' A related outside idea is: ' + broader + ' So use the PDF as the base, then add the outside explanation only to make the base easier to understand.'
    }
  ];
}

function getBroaderContextHint(question, focus) {
  const joined = (data.subject + ' ' + question + ' ' + focus.heading + ' ' + focus.detail).toLowerCase();
  if (/war|hitler|germany|allies|axis|nazi|invasion|treaty|battle|appeasement|poland|britain|france|conflict/.test(joined)) {
    return 'historical decisions usually make more sense when you connect the immediate event to alliances, resources, geography, leadership, and long-term consequences.';
  }
  if (/chem|atom|molecule|acid|base|reaction|element|compound/.test(joined)) {
    return 'chemistry topics often need the visible result connected to particles, bonding, energy, and reaction conditions.';
  }
  if (/bio|cell|organ|dna|gene|evolution|plant|animal/.test(joined)) {
    return 'biology explanations often connect structure to function, and then connect that function to survival, regulation, or adaptation.';
  }
  if (/math|algebra|geometry|equation|function|calculus/.test(joined)) {
    return 'math ideas become easier when you connect the rule to the pattern it describes and the kind of problem it solves.';
  }
  if (/econom|market|money|inflation|trade|business/.test(joined)) {
    return 'economic explanations usually need both the direct mechanism and the incentives or trade-offs behind choices people make.';
  }
  return 'a short PDF note can be expanded by adding causes, effects, examples, and why the idea matters in the wider topic.';
}

function answerQuestionFromMaterial(question, focus) {
  const lower = question.toLowerCase();
  const detail = focus.detail || ('The material connects this to ' + focus.heading + '.');
  if (/\bwhy\b|cause|reason/.test(lower)) {
    return focus.heading + ' happened or mattered because the material shows this cause: ' + detail;
  }
  if (/consequence|effect|result|what happened after|after/.test(lower)) {
    return 'The main consequence is that ' + focus.heading + ' changed the next decisions and outcomes. The material supports that with this point: ' + detail;
  }
  if (/how|stop|solve|prevent|fix/.test(lower)) {
    return 'A careful answer is to respond to ' + focus.heading + ' by looking at both immediate action and long-term consequences. The relevant material says: ' + detail;
  }
  if (/who|allies|people|country|countries/.test(lower)) {
    return 'The best answer depends on who is connected to ' + focus.heading + '. Use the material to identify the groups involved, then explain why their role matters: ' + detail;
  }
  return 'The answer connects to ' + focus.heading + ': ' + detail;
}

function findRelevantPoint(question) {
  const words = new Set(question.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 3));
  let best = data.summary.points[0] || { heading: 'the main idea', detail: 'The material explains an important cause, effect, or relationship.' };
  let bestScore = -1;
  data.summary.points.forEach(point => {
    const haystack = (point.heading + ' ' + point.detail).toLowerCase();
    let score = 0;
    words.forEach(w => { if (haystack.includes(w)) score++; });
    if (score > bestScore) { bestScore = score; best = point; }
  });
  if (data.sourceSentences) {
    data.sourceSentences.forEach(sentence => {
      const haystack = sentence.toLowerCase();
      let score = 0;
      words.forEach(w => { if (haystack.includes(w)) score += 2; });
      if (score > bestScore) {
        bestScore = score;
        best = { heading: titleFromSentence('', sentence), detail: sentence };
      }
    });
  }
  return best;
}
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + name).classList.add('active');
  window.scrollTo(0, 0);
}

function switchTab(name, btn) {
  document.querySelectorAll('.tab-pane').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  btn.classList.add('active');
}

function restart() {
  if (escState.iv) { clearInterval(escState.iv); escState.iv = null; }
  content = ''; data = null; activeGame = null;
  gamesPlayed = { sim: false, escape: false, panel: false, match: false, jeopardy: false, timeline: false, connect: false, arena: false, sort: false, forge: false };
  qAnswered = 0; qCorrect = 0;
  document.getElementById('textInput').value = '';
  document.getElementById('fileTag').style.display = 'none';
  fileInput.value = '';
  escapePhotoUrls.forEach(url => URL.revokeObjectURL(url));
  escapePhotoUrls = [];
  escapeBgQueue = [];
  lastEscapeBg = '';
  escapePhotos.value = '';
  updateEscapePhotoCount();
  updateCharCount();
  showScreen('upload');
  document.querySelectorAll('.tab-btn').forEach((b, i) => b.classList.toggle('active', i === 0));
  document.querySelectorAll('.tab-pane').forEach((t, i) => t.classList.toggle('active', i === 0));
  ['sim', 'escape', 'panel', 'match', 'jeopardy', 'timeline', 'connect', 'arena', 'sort', 'forge'].forEach(g => document.getElementById('card-' + g).classList.remove('played'));
}

function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

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
  return { subject: title, summary: { title: 'Expanded Study Guide', points: summaryPoints.slice(0, 10) }, quiz, simulation, escape, experts, memory, sourceSentences: sentences.slice(0, 30) };
}

function buildSummaryPoints(topics, sentences) {
  const used = new Set();
  const points = [];
  topics.forEach(topic => {
    const detail = getBestSentenceForTopic(topic, sentences, used);
    if (detail) {
      points.push({
        heading: titleFromSentence(topic, detail),
        detail: explainSentence(detail, topic)
      });
    }
  });
  sentences.forEach(sentence => {
    if (points.length >= 10) return;
    const clean = sentence.replace(/\s+/g, ' ').trim();
    if (clean.length > 45 && !used.has(clean)) {
      used.add(clean);
      points.push({ heading: titleFromSentence('', clean), detail: explainSentence(clean, '') });
    }
  });
  while (points.length < 8) points.push({ heading: 'Key idea', detail: 'A useful point from the material that should be reviewed with examples and consequences.' });
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

function explainSentence(sentence, topic) {
  const clean = sentence.replace(/\s+/g, ' ').trim();
  if (!topic) return clean;
  return clean + ' This matters because it helps explain how ' + topic + ' connects to the larger lesson.';
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
  const sorted = Object.entries(freq).sort((a,b) => b[1] - a[1]).map(([word]) => word);
  return sorted.slice(0, count);
}

function capitalize(word) {
  return String(word).split(' ').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

function getSentenceForTopic(topic, sentences) {
  const lower = topic.toLowerCase();
  const match = sentences.find(s => s.toLowerCase().includes(lower));
  if (match) return match.replace(/\s+/g, ' ').trim();
  return '';
}

function buildQuizFromTopics(points, sentences, topics) {
  const quiz = [];
  const templates = [
    makeMeaningQuestion,
    makeCauseQuestion,
    makeConsequenceQuestion,
    makeEvidenceQuestion,
    makeConnectionQuestion,
    makeMisconceptionQuestion,
    makeScenarioQuestion,
    makeCompareQuestion
  ];
  for (let i = 0; i < Math.min(8, Math.max(5, points.length)); i++) {
    quiz.push(templates[i % templates.length](points[i % points.length], points, sentences, topics, i));
  }
  return quiz.filter(q => q && q.options && q.options.length >= 3);
}

function makeMeaningQuestion(point, points, sentences, topics, idx) {
  return optionQuestion('What is the best explanation of "' + point.heading + '"?', point.detail, points, idx, 'This choice uses the material most directly.');
}

function makeCauseQuestion(point, points, sentences, topics, idx) {
  const correct = 'It helps explain why ' + point.heading.toLowerCase() + ' happened or became important.';
  return optionQuestion('According to the material, what kind of role does "' + point.heading + '" play?', correct, points, idx, 'The question asks for cause or importance, not just a definition.');
}

function makeConsequenceQuestion(point, points, sentences, topics, idx) {
  const correct = 'It creates consequences that affect later events or decisions.';
  return optionQuestion('What should you watch for after "' + point.heading + '" appears in the lesson?', correct, points, idx, 'Consequences are what make a fact useful for thinking.');
}

function makeEvidenceQuestion(point, points, sentences, topics, idx) {
  const sentence = findSentenceForHeading(point.heading, sentences) || point.detail;
  return optionQuestion('Which piece of evidence best supports "' + point.heading + '"?', sentence, points, idx, 'Evidence should come from the original text.');
}

function findSentenceForHeading(heading, sentences) {
  const words = heading.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return sentences.find(sentence => {
    const lower = sentence.toLowerCase();
    return words.some(word => lower.includes(word));
  }) || '';
}

function makeConnectionQuestion(point, points, sentences, topics, idx) {
  const other = points[(idx + 1) % points.length];
  const correct = point.heading + ' connects with ' + other.heading + ' because both shape the larger outcome.';
  return optionQuestion('Which connection is most useful for understanding the material?', correct, points, idx, 'Good studying means connecting ideas, not memorizing them separately.');
}

function makeMisconceptionQuestion(point, points, sentences, topics, idx) {
  const correct = 'Treating ' + point.heading + ' as isolated is misleading; it should be linked to causes and effects.';
  return optionQuestion('Which warning would help avoid misunderstanding "' + point.heading + '"?', correct, points, idx, 'The best answer avoids shallow memorization.');
}

function makeScenarioQuestion(point, points, sentences, topics, idx) {
  const correct = 'Use ' + point.heading + ' to predict what pressure, trust, or stability changes next.';
  return optionQuestion('If you were making a decision in this topic, how should "' + point.heading + '" guide you?', correct, points, idx, 'This turns the idea into a decision tool.');
}

function makeCompareQuestion(point, points, sentences, topics, idx) {
  const other = points[(idx + 2) % points.length];
  const correct = point.heading + ' is different from ' + other.heading + ' because it answers a different part of the lesson.';
  return optionQuestion('Which comparison is the strongest?', correct, points, idx, 'Strong comparisons explain the difference, not just the names.');
}

function optionQuestion(question, correct, points, idx, explanation) {
  const distractors = [
    points[(idx + 1) % points.length]?.detail,
    points[(idx + 2) % points.length]?.heading + ' is the only detail worth remembering.',
    'It is just a vocabulary word and does not affect the rest of the lesson.',
    'It matters only because it appears many times in the text.'
  ].filter(Boolean);
  const options = uniqueOptions([correct].concat(distractors)).slice(0, 4);
  while (options.length < 4) options.push('A related idea, but not the best answer here.');
  shuffle(options);
  return { question, options, correct: options.indexOf(correct), explanation };
}

function uniqueOptions(options) {
  const seen = new Set();
  return options.filter(option => {
    const key = String(option).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildSimulation(topics, points, sentences) {
  const main = topics[0] || 'the main issue';
  const usable = points.length ? points : topics.map(t => ({ heading: capitalize(t), detail: getSentenceForTopic(t, sentences) || t }));
  const isWar = topics.some(t => /war|hitler|germany|allies|axis|nazi|invasion|treaty|battle/.test(t));
  const role = isWar ? 'You are a crisis strategist inside this history' : 'You are the decision-maker inside the lesson';
  return {
    role,
    scenarios: usable.slice(0, 6).map((point, idx) => buildScenarioStep(point, usable, idx, isWar))
  };
}

function buildScenarioStep(point, points, idx, isWar) {
  const next = points[(idx + 1) % points.length] || point;
  const later = points[(idx + 2) % points.length] || point;
  const sceneLead = idx === 0
    ? 'The first problem is centered on ' + point.heading + '.'
    : 'Your earlier decision has changed the situation. Now ' + point.heading + ' is the pressure point.';
  return {
    scene: sceneLead + ' Evidence from the text: ' + point.detail,
    choices: [
      {
        text: 'Use ' + point.heading + ' as the main guide and act quickly.',
        outcome: 'Fast action makes ' + point.heading + ' visible, but it also creates new pressure around ' + next.heading + '.',
        effect: { pressure: 8 - idx, trust: idx % 2 ? -4 : 4, stability: 4 }
      },
      {
        text: 'Pause and compare ' + point.heading + ' with ' + next.heading + ' before deciding.',
        outcome: 'You understand the relationship better and avoid a shallow answer, but the crisis keeps moving while you analyze it.',
        effect: { pressure: 5, trust: 8, stability: 6 }
      },
      {
        text: 'Build support around ' + later.heading + ' so the response is broader.',
        outcome: 'A wider plan improves trust, but it is harder to coordinate and may slow the immediate response.',
        effect: { pressure: -3, trust: 12, stability: 8 }
      },
      {
        text: 'Ignore ' + point.heading + ' and focus only on the easiest short-term fix.',
        outcome: 'The short-term problem looks smaller, but the text suggests the deeper issue returns through ' + next.heading + '.',
        effect: { pressure: -6, trust: -10, stability: -12 }
      }
    ]
  };
}

function buildEscape(points, sentences, topics) {
  const templates = [
    { type: 'Archive', ask: 'Which door matches the evidence on the desk?', clue: 'Inspect the desk note first.' },
    { type: 'Map Room', ask: 'Which door follows the strongest connection?', clue: 'The wall map links two ideas.' },
    { type: 'Pressure Lock', ask: 'Which door lowers the biggest risk?', clue: 'The gauge reveals the consequence.' },
    { type: 'Witness Room', ask: 'Which door agrees with the witness statement?', clue: 'The witness gives the plain-language version.' },
    { type: 'Final Vault', ask: 'Which door captures the main lesson?', clue: 'Use every clue, not just one word.' }
  ];
  return { puzzles: templates.map((template, idx) => {
    const correctPoint = points[idx % Math.max(points.length, 1)] || { heading: 'Main idea', detail: 'The main explanation from the material.' };
    const answer = correctPoint.heading;
    const options = makeFallbackOptions(answer, points, idx);
    return {
      type: template.type,
      clue: template.clue,
      question: template.ask,
      answer,
      options,
      brief: 'You enter a room about ' + answer + '. The exit doors are locked until you inspect the evidence.',
      tools: [
        { name: 'Desk note', reveal: correctPoint.detail },
        { name: 'Wall map', reveal: answer + ' connects with ' + (points[(idx + 1) % points.length]?.heading || 'another key idea') + '.' },
        { name: 'Gauge', reveal: 'Wrong doors cost time. The safest door is the one supported by the evidence, not the most familiar word.' }
      ],
      hint: 'The correct door is the concept most directly supported by the desk note.',
      image: 'Interactive escape room for ' + answer
    };
  }) };
}

function makeFallbackOptions(answer, points, offset) {
  const options = [answer];
  points.forEach((p, i) => {
    if (options.length < 3 && i !== offset && p.heading && !options.includes(p.heading)) options.push(p.heading);
  });
  while (options.length < 3) options.push(['Short-term reaction','Hidden consequence','Shared responsibility'][options.length - 1]);
  return shuffle(options).slice(0, 3);
}

function buildMemory(points) {
  return points.slice(0, 6).map(point => ({
    term: point.heading,
    detail: summarizeForCard(point.detail)
  }));
}

function summarizeForCard(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= 120) return clean;
  return clean.slice(0, 117).replace(/\s+\S*$/, '') + '...';
}

function buildExperts(topics) {
  const base = topics.slice(0, 4);
  const role = inferProfessionalRole(topics);
  return [
    { name:'Ari', role:role, emoji:'Pro', color:'#0066ff', opener:'I will debate this like a ' + role.toLowerCase() + ': evidence first, then strategy, risk, and consequences around ' + (base[0] || 'the main concept') + '.' },
    { name:'Prof. Rivera', role:'Professor', emoji:'Teach', color:'#00a96b', opener:'I will organize the lesson into claim, evidence, cause, effect, and a final check for understanding.' },
    { name:'Maya', role:'Logical Beginner', emoji:'Ask', color:'#ff3d8d', opener:'I will ask the simple but important questions: why did this happen, what changed, and what proof do we have?' },
    { name:'Sam', role:'Explains to a 10-year-old', emoji:'Easy', color:'#f5a400', opener:'I will make it very simple: what happened, why it happened, and why it matters.' }
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
function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

updateEscapePhotoCount();
updateUserUi();
initAuth();

