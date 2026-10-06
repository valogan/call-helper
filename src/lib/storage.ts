import type { Session } from '../types';

const KEY = 'call-helper:sessions:v1';
const MAX_SESSIONS = 50;

export function loadSessions(): Session[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Session[]) : [];
  } catch {
    return [];
  }
}

export function persistSession(session: Session): void {
  try {
    const sessions = loadSessions().filter((s) => s.id !== session.id);
    sessions.unshift(session);
    sessions.sort((a, b) => b.createdAt - a.createdAt);
    localStorage.setItem(KEY, JSON.stringify(sessions.slice(0, MAX_SESSIONS)));
  } catch {
    // Storage full or unavailable — nothing safe to do here.
  }
}

export function deleteSession(id: string): void {
  try {
    const sessions = loadSessions().filter((s) => s.id !== id);
    localStorage.setItem(KEY, JSON.stringify(sessions));
  } catch {
    // ignore
  }
}

export function getSession(id: string): Session | undefined {
  return loadSessions().find((s) => s.id === id);
}
