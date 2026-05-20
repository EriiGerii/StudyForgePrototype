import { getAuthUser, deleteSession, sendJson, sendError } from '../_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendError(res, 405, 'Method not allowed.');
  }
  const auth = await getAuthUser(req);
  if (!auth) {
    return sendError(res, 401, 'Please log in first.');
  }
  await deleteSession(auth.token);
  return sendJson(res, { ok: true });
}
