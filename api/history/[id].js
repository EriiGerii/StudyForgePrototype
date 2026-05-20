import { getAuthUser, findHistoryById, sendJson, sendError } from '../_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return sendError(res, 405, 'Method not allowed.');
  }

  const auth = await getAuthUser(req);
  if (!auth) {
    return sendError(res, 401, 'Please log in first.');
  }

  const id = String(req.query?.id || req.url?.split('/').pop() || '').trim();
  if (!id) {
    return sendError(res, 400, 'Missing history id.');
  }

  const item = await findHistoryById(id);
  if (!item || item.userId !== auth.user.id) {
    return sendError(res, 404, 'History item not found.');
  }

  return sendJson(res, { item });
}
