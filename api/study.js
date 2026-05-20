import {
  parseBody,
  sendJson,
  sendError,
  normalizeStudyData,
  extractJson,
  generateStudySession
} from './_lib.js';

const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendError(res, 405, 'Method not allowed.');
  }

  const body = await parseBody(req);
  const text = String(body?.text || '').trim();
  if (!text || text.length < 80) {
    return sendError(res, 400, 'Please provide at least 80 characters of study content.');
  }

  const useGroq = Boolean(GROQ_API_KEY);
  const apiKey = useGroq ? GROQ_API_KEY : ANTHROPIC_API_KEY;
  if (!apiKey) {
    return sendJson(res, { fallback: true, data: await generateStudySession(text) });
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
    if (useGroq) {
      response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
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
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey
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
      return sendJson(res, { fallback: true, warning: json.error?.message || 'AI backend error', data: await generateStudySession(text) });
    }

    let rawText = '';
    if (json.choices?.[0]?.message?.content) {
      rawText = json.choices[0].message.content;
    } else if (json.content?.[0]?.text) {
      rawText = json.content[0].text;
    }

    const parsed = JSON.parse(extractJson(rawText));
    const data = normalizeStudyData(parsed, text);
    return sendJson(res, { fallback: false, data });
  } catch (error) {
    console.error(error);
    return sendJson(res, { fallback: true, warning: error.message, data: await generateStudySession(text) });
  }
}
