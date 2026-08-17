export class SerialManager {
  static textToBytes(input: string): number[] {
    const bytes: number[] = [];
    for (let i = 0; i < input.length; i++) {
      bytes.push(input.charCodeAt(i) & 0xff);
    }
    return bytes;
  }

  static formatHexDumpFromBytes(bytes: number[]): string {
    if (bytes.length === 0) return '';
    let result = '';

    for (let i = 0; i < bytes.length; i += 16) {
      const chunk = bytes.slice(i, i + 16);
      const hexRow = chunk
        .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
        .join(' ');

      const asciiRow = chunk
        .map((b) => (b >= 32 && b <= 126 ? String.fromCharCode(b) : '.'))
        .join('');

      const paddedHex = hexRow.padEnd(47, ' ');
      result += `\x1b[33m${paddedHex}\x1b[0m  \x1b[36m|${asciiRow}|\x1b[0m\r\n`;
    }

    return result;
  }

  static format16ByteHexDump(input: string): string {
    return this.formatHexDumpFromBytes(this.textToBytes(input));
  }

  /** Append the selected TX line ending (ASCII mode only). */
  static formatLineEnding(rawInput: string, ending: 'CRLF' | 'LF' | 'CR' | 'NONE'): string {
    switch (ending) {
      case 'CRLF':
        return `${rawInput}\r\n`;
      case 'LF':
        return `${rawInput}\n`;
      case 'CR':
        return `${rawInput}\r`;
      case 'NONE':
        return rawInput;
    }
  }

  /**
   * Parse hex TX input into bytes.
   * Accepts: "41 54 0D 0A", "41540D0A", "0x41,0x54"
   */
  static parseHexInput(raw: string): number[] | null {
    const cleaned = raw.trim().replace(/0x/gi, '').replace(/[,:;|]/g, ' ');
    if (!cleaned) return null;

    let tokens: string[];
    if (/\s/.test(cleaned)) {
      tokens = cleaned.split(/\s+/).filter(Boolean);
    } else {
      const hexOnly = cleaned.replace(/[^0-9a-fA-F]/g, '');
      if (hexOnly.length === 0 || hexOnly.length % 2 !== 0) return null;
      tokens = hexOnly.match(/.{2}/g) || [];
    }

    const bytes: number[] = [];
    for (const token of tokens) {
      if (!/^[0-9a-fA-F]{1,2}$/.test(token)) return null;
      const value = parseInt(token, 16);
      if (Number.isNaN(value) || value < 0 || value > 255) return null;
      bytes.push(value);
    }
    return bytes.length > 0 ? bytes : null;
  }
}
