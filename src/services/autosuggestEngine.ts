const COMMON_LINUX_COMMANDS = [
  'ls',
  'ls -la',
  'cd',
  'pwd',
  'cat',
  'less',
  'head',
  'tail',
  'tail -f',
  'grep',
  'find',
  'cp',
  'mv',
  'rm',
  'mkdir',
  'touch',
  'chmod',
  'chown',
  'ps',
  'top',
  'df -h',
  'du -h',
  'free -h',
  'uname -a',
  'whoami',
  'clear',
  'nano',
  'vim',
  'sudo',
  'apt update',
  'apt upgrade',
  'systemctl status',
  'systemctl restart',
  'journalctl -u',
  'ip a',
  'ss -tulpn',
  'ping',
  'curl',
  'wget',
  'scp',
  'ssh',
  'git status',
  'git pull',
  'python3',
];

const FILE_VERBS =
  /^(cd|cat|less|head|tail|grep|find|cp|mv|rm|mkdir|touch|chmod|chown|nano|vim|sudo(?:\s+nano)?|python3|ls|scp|\.\/)\s+(.*)$/i;

export class AutoSuggestEngine {
  private static dynamicFiles: string[] = [];
  private static commandHistory: string[] = [];

  static indexRemoteOutput(output: string): void {
    const tokens = output.split(/[\s\r\n\t]+/).filter(Boolean);
    tokens.forEach((t) => {
      const clean = t.replace(/\x1b\[[0-9;]*[mGKH]/g, '').trim();
      if (clean && clean.length > 2 && !clean.includes('/') && !this.dynamicFiles.includes(clean)) {
        if (/^[a-zA-Z0-9_\-\.]+$/.test(clean)) {
          this.dynamicFiles.push(clean);
        }
      }
    });
  }

  static addHistory(command: string): void {
    const trimmed = command.trim();
    if (trimmed && !this.commandHistory.includes(trimmed)) {
      this.commandHistory.unshift(trimmed);
    }
  }

  /**
   * Returns only the unfinished suffix to show as ghost text after the cursor
   * (standard inline completion style — never repeats what the user already typed).
   */
  static getSuggestion(inputPrefix: string): string | null {
    const prefix = inputPrefix;
    if (!prefix || !prefix.trim()) return null;

    const lowerPrefix = prefix.toLowerCase();

    const fromList = (list: string[]): string | null => {
      for (const cmd of list) {
        if (cmd.toLowerCase().startsWith(lowerPrefix) && cmd.length > prefix.length) {
          return cmd.slice(prefix.length);
        }
      }
      return null;
    };

    const historyHit = fromList(this.commandHistory);
    if (historyHit) return historyHit;

    const lastWordMatch = prefix.match(FILE_VERBS);
    if (lastWordMatch) {
      const filePrefix = lastWordMatch[2];
      const lowerFile = filePrefix.toLowerCase();

      for (const file of this.dynamicFiles) {
        if (file.toLowerCase().startsWith(lowerFile) && file.length > filePrefix.length) {
          return file.slice(filePrefix.length);
        }
      }
    }

    const tokenMatch = prefix.match(/^(.*?)([^\s]+)$/);
    if (tokenMatch) {
      const before = tokenMatch[1];
      const token = tokenMatch[2];
      const lowerToken = token.toLowerCase();

      for (const cmd of this.commandHistory) {
        for (const part of cmd.split(/\s+/)) {
          if (part.toLowerCase().startsWith(lowerToken) && part.length > token.length) {
            if (!before || cmd.toLowerCase().startsWith(before.toLowerCase().trimStart())) {
              return part.slice(token.length);
            }
          }
        }
      }
    }

    return fromList(COMMON_LINUX_COMMANDS);
  }
}
