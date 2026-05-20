import crypto from 'crypto';
import {
  cleanName,
  cleanEmail,
  isEmail,
  hashPassword,
  findUserByEmail,
  createUser,
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
  const name = cleanName(body.name);
  const email = cleanEmail(body.email);
  const password = String(body.password || '');

  if (!name || name.length < 2) {
    return sendError(res, 400, 'Please enter your name.');
  }
  if (!isEmail(email)) {
    return sendError(res, 400, 'Please enter a valid email.');
  }
  if (password.length < 6) {
    return sendError(res, 400, 'Password must be at least 6 characters.');
  }

  const existingUser = await findUserByEmail(email);
  if (existingUser) {
    return sendError(res, 409, 'An account already exists for that email.');
  }

  const user = {
    id: crypto.randomUUID(),
    name,
    email,
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString()
  };

  await createUser(user);
  const session = await createSession(user.id);
  return sendJson(res, { token: session.token, user: publicUser(user) }, 201);
}
