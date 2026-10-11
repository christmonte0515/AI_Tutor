import { state } from '../state.js';
import { signOut } from '../session.js';

export async function api(method, path, body) {
  let res;
  try {
    res = await fetch(`${state.server}/api${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error(`Can't reach the AI Tutor server at ${state.server}. Check your connection or the server settings.`);
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && state.token) {
    signOut('Your session has ended. Please sign in again.');
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
  return data;
}
