import { Writable } from 'node:stream';

export type CapturedLog = Record<string, any>;

/**
 * Destination для pino: копит NDJSON-строки в памяти и отдаёт их разобранными.
 */
export class CaptureStream extends Writable {
  private readonly chunks: string[] = [];

  _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(chunk.toString());
    callback();
  }

  get logs(): CapturedLog[] {
    return this.chunks
      .join('')
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as CapturedLog);
  }

  get last(): CapturedLog {
    const { logs } = this;

    return logs[logs.length - 1];
  }

  clear(): void {
    this.chunks.length = 0;
  }
}
