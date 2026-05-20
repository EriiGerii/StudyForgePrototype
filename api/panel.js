import {
  parseBody,
  sendJson,
  sendError,
  getAuthUser,
  buildPanelContext,
  buildPanelFallbackResponses,
  normalizePanelResponses,
  extractJson
} from './_lib.js';

const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendError(res, 405, 'Method not allowed.');
  }

  const auth = await getAuthUser(req);
  if (!auth) {
    return sendError(res, 401, 'Please log in first.');
  }

  const body = await parseBody(req);
  const question = String(body.question || '').replace(/\s+/g, ' ').trim().slice(0, 800);
  const subject = String(body.subject || 'the study material').slice(0, 120);
  const sourceText = String(body.sourceText || '').replace(/\s+/g, ' ').trim().slice(0, 8000);
  const summaryPoints = Array.isArray(body.summaryPoints) ? body.summaryPoints.slice(0, 10) : [];
  const sourceSentences = Array.isArray(body.sourceSentences) ? body.sourceSentences.slice(0, 12) : [];
  const experts = Array.isArray(body.experts) ? body.experts.slice(0, 4) : [];

  if (!question) {
    return sendError(res, 400, 'Ask a question first.');
  }

  const context = buildPanelContext({ sourceText, summaryPoints, sourceSentences });
  const fallbackResponses = buildPanelFallbackResponses(question, subject, context, experts);
  const useGroq = Boolean(GROQ_API_KEY);
  const apiKey = useGroq ? GROQ_API_KEY : ANTHROPIC_API_KEY;
  if (!apiKey) {
    return sendJson(res, { fallback: true, responses: fallbackResponses });
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
- If the PDF context is thin, add relevant broader background knowledge from your general knowledge, clearly separating it with phrases like "Broader context:" or "Connected idea:."
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
          'x-api-key': apiKey,
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
      return sendJson(res, { fallback: true, warning: json.error?.message || 'AI backend error', responses: fallbackResponses });
    }

    const rawText = json.choices?.[0]?.message?.content || json.content?.[0]?.text || '';
    const parsed = JSON.parse(extractJson(rawText));
    const responses = normalizePanelResponses(parsed.responses, fallbackResponses);
    return sendJson(res, { fallback: false, responses });
  } catch (error) {
    console.error(error);
    return sendJson(res, { fallback: true, warning: error.message, responses: fallbackResponses });
  }
}
