import type { Session, Snippet } from '../types/terminal';

const SESSIONS_KEY = 'tef_saved_sessions';
const SNIPPETS_KEY = 'tef_saved_snippets';

export const DEFAULT_SESSIONS: Session[] = [];

export const DEFAULT_SNIPPETS: Snippet[] = [];

export class SessionStore {
  static getSessions(): Session[] {
    try {
      const stored = localStorage.getItem(SESSIONS_KEY);
      if (stored) return JSON.parse(stored);
    } catch {
      /* corrupt storage */
    }
    return DEFAULT_SESSIONS;
  }

  static saveSessions(sessions: Session[]): void {
    try {
      localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
    } catch {
      /* quota / private mode */
    }
  }

  static getSnippets(): Snippet[] {
    try {
      const stored = localStorage.getItem(SNIPPETS_KEY);
      if (stored) return JSON.parse(stored);
    } catch {
      /* corrupt storage */
    }
    return DEFAULT_SNIPPETS;
  }

  static saveSnippets(snippets: Snippet[]): void {
    try {
      localStorage.setItem(SNIPPETS_KEY, JSON.stringify(snippets));
    } catch {
      /* quota / private mode */
    }
  }
}
