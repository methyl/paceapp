declare module "@garmin/fitsdk" {
  export class Stream {
    static fromBuffer(buffer: Buffer): Stream;
    static fromArrayBuffer(buffer: ArrayBuffer): Stream;
    static fromByteArray(bytes: number[]): Stream;
  }
  export class Decoder {
    constructor(stream: Stream);
    isFIT(): boolean;
    checkIntegrity(): boolean;
    read(): { messages: Record<string, unknown[]>; errors: unknown[] };
  }
  export class Encoder {
    constructor(options?: Record<string, unknown>);
    writeMesg(mesg: Record<string, unknown>): this;
    close(): Uint8Array;
  }
  export const Profile: unknown;
  export const Utils: unknown;
}
