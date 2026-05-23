declare module "node-record-lpcm16";
declare module "play-sound";
declare module "nodejs-whisper";

declare module "@picovoice/porcupine-node" {
  export const BuiltinKeyword: Record<string, string>;
  export class Porcupine {
    frameLength: number;
    constructor(accessKey: string, keywords: string[], sensitivities: number[]);
    process(pcm: Int16Array | number[]): number;
    release(): void;
  }
}

declare module "@picovoice/pvrecorder-node" {
  export class PvRecorder {
    constructor(frameLength: number);
    start(): void;
    read(): Promise<Int16Array>;
    stop(): void;
    release(): void;
  }
}
