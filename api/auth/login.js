import {
  cleanEmail,
  verifyPassword,
  findUserByEmail,
  createSession,
  publicUser,
  sendJson,
  sendError,
  parseBody
} from '../_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendError(res, 405, 'Method not allowed.');
  }

  const body = await parseBody(req);
  const email = cleanEmail(body.email);
  const password = String(body.password || '');
  const user = await findUserByEmail(email);

  if (!user || !verifyPassword(password, user.passwordHash)) {
    return sendError(res, 401, 'Email or password is incorrect.');
  }

  const session = await createSession(user.id);
  return sendJson(res, { token: session.token, user: publicUser(user) });
}
