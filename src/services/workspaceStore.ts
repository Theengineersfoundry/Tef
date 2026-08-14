import type { Workspace } from '../types/terminal';

const WORKSPACES_KEY = 'tef_saved_workspaces';

export class WorkspaceStore {
  static getWorkspaces(): Workspace[] {
    try {
      const stored = localStorage.getItem(WORKSPACES_KEY);
      if (stored) return JSON.parse(stored);
    } catch {
      /* corrupt storage */
    }
    return [];
  }

  static saveWorkspaces(workspaces: Workspace[]): void {
    try {
      localStorage.setItem(WORKSPACES_KEY, JSON.stringify(workspaces));
    } catch {
      /* quota / private mode */
    }
  }

  static exportWorkspaceJSON(workspace: Workspace): string {
    return JSON.stringify(workspace, null, 2);
  }

  static parseWorkspaceJSON(jsonString: string): Workspace | null {
    try {
      const parsed = JSON.parse(jsonString);
      if (parsed && parsed.name && Array.isArray(parsed.tabs)) {
        return parsed as Workspace;
      }
    } catch {
      /* invalid JSON */
    }
    return null;
  }
}
