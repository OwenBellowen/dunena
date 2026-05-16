// ── RESP2 Parser & Serializer ────────────────────────────────
// Implements the REdis Serialization Protocol (RESP2) for
// compatibility with standard Redis clients.

export type RedisValue = string | number | null | Error | RedisValue[];

export class RESP {
  /** Encode a bulk string (e.g., "$5\r\nhello\r\n") */
  static bulkString(str: string | null): string {
    if (str === null) return "$-1\r\n";
    const buffer = Buffer.from(str);
    return `$${buffer.length}\r\n${str}\r\n`;
  }

  /** Encode a simple string (e.g., "+OK\r\n") */
  static simpleString(str: string): string {
    return `+${str}\r\n`;
  }

  /** Encode an error (e.g., "-ERR unknown command\r\n") */
  static error(msg: string): string {
    return `-${msg}\r\n`;
  }

  /** Encode an integer (e.g., ":1000\r\n") */
  static integer(num: number): string {
    return `:${num}\r\n`;
  }

  /** Encode an array */
  static array(items: string[]): string {
    let out = `*${items.length}\r\n`;
    for (const item of items) out += item;
    return out;
  }

  /** Parse a RESP buffer into an array of commands/arguments */
  static parse(buffer: Buffer): { commands: string[][]; offset: number } {
    const commands: string[][] = [];
    let offset = 0;

    while (offset < buffer.length) {
      if (buffer[offset] !== 42) { // '*'
        // Only array commands are supported for client -> server
        break;
      }
      
      const crlfArray = buffer.indexOf("\r\n", offset);
      if (crlfArray === -1) break; // Incomplete

      const numArgs = parseInt(buffer.toString("utf8", offset + 1, crlfArray), 10);
      let currOffset = crlfArray + 2;
      const args: string[] = [];

      let incomplete = false;
      for (let i = 0; i < numArgs; i++) {
        if (currOffset >= buffer.length) {
          incomplete = true;
          break;
        }

        if (buffer[currOffset] === 36) { // '$'
          const crlfStrLen = buffer.indexOf("\r\n", currOffset);
          if (crlfStrLen === -1) {
            incomplete = true;
            break;
          }
          const strLen = parseInt(buffer.toString("utf8", currOffset + 1, crlfStrLen), 10);
          const strStart = crlfStrLen + 2;
          const strEnd = strStart + strLen;

          if (strEnd + 2 > buffer.length) { // +2 for \r\n
            incomplete = true;
            break;
          }

          args.push(buffer.toString("utf8", strStart, strEnd));
          currOffset = strEnd + 2;
        } else {
          // Unsupported type for client command arg
          incomplete = true;
          break;
        }
      }

      if (incomplete) break;
      
      commands.push(args);
      offset = currOffset;
    }

    return { commands, offset };
  }
}
