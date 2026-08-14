/** Routes macro/snippet text into the active terminal tab's WebSocket (or local xterm). */

type InjectFn = (data: string) => boolean;

const injectors = new Map<string, InjectFn>();
let activeTabId: string | null = null;

export const TerminalBridge = {
  setActive(tabId: string | null) {
    activeTabId = tabId;
  },

  register(tabId: string, inject: InjectFn): () => void {
    injectors.set(tabId, inject);
    return () => {
      if (injectors.get(tabId) === inject) injectors.delete(tabId);
    };
  },

  /** Send text to the active tab. Appends newline if the command has none. */
  inject(command: string): boolean {
    if (!activeTabId || !command) return false;
    const fn = injectors.get(activeTabId);
    if (!fn) return false;
    const payload = command.endsWith('\n') || command.endsWith('\r') ? command : `${command}\n`;
    return fn(payload);
  },
};
