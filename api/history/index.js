import crypto from 'crypto';
import {
  getAuthUser,
  getHistoryList,
  createHistory,
  sendJson,
  sendError,
  parseBody
} from '../_lib.js';

export default async function handler(req, res) {
  const auth = await getAuthUser(req);
  if (!auth) {
    return sendError(res, 401, 'Please log in first.');
  }

  if (req.method === 'GET') {
    const history = await getHistoryList(auth.user.id);
    const list = history.map(item => ({
      id: item.id,
      subject: item.subject,
      summaryCount: item.summaryCount,
      quizCount: item.quizCount,
      createdAt: item.createdAt
    }));
    return sendJson(res, { history: list });
  }

  if (req.method === 'POST') {
    const body = await parseBody(req);
    const sessionData = body?.data;
    if (!sessionData || typeof sessionData !== 'object') {
      return sendError(res, 400, 'Missing study session data.');
    }

    const item = {
      id: crypto.randomUUID(),
      userId: auth.user.id,
      subject: String(sessionData.subject || 'Study Session').slice(0, 80),
      summaryCount: Array.isArray(sessionData.summary?.points) ? sessionData.summary.points.length : 0,
      quizCount: Array.isArray(sessionData.quiz) ? sessionData.quiz.length : 0,
      data: sessionData,
      sourcePreview: String(body?.sourcePreview || '').slice(0, 240),
      createdAt: new Date().toISOString()
    };

    await createHistory(item);
    return sendJson(res, { item }, 201);
  }

  return sendError(res, 405, 'Method not allowed.');
}
