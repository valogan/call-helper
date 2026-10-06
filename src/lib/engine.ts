import type { TranscriptSegment, TranscriptSource, TranscriptionSettings } from '../types';
import { acquireMic, acquireSystemAudio, startChunkPump } from './audio';
import { transcribeBlob, WebSpeechEngine } from './transcribe';

export interface EngineCallbacks {
  onSegment(segment: TranscriptSegment): void;
  onSourceStatus(source: TranscriptSource, status: 'live' | 'ended' | 'error', message?: string): void;
}

/**
 * Owns the audio sources and per-source transcription pipelines for one live
 * session. Pure TypeScript — the React layer just consumes the callbacks.
 */
export class SessionEngine {
  private startedAt = 0;
  private stopped = false;
  private streams: MediaStream[] = [];
  private pumps: Array<ReturnType<typeof startChunkPump>> = [];
  private webspeech: WebSpeechEngine | null = null;
  private chains: Partial<Record<'mic' | 'system', Promise<void>>> = {};

  constructor(
    private ts: TranscriptionSettings,
    private cb: EngineCallbacks,
  ) {}

  /** Starts the requested sources; rejects with a user-facing message on failure. */
  async start(opts: { mic: boolean; system: boolean }): Promise<void> {
    this.startedAt = performance.now();
    const jobs: Array<Promise<void>> = [];

    if (opts.system) {
      jobs.push(this.startSystem());
    }
    if (opts.mic) {
      jobs.push(this.ts.engine === 'webspeech' ? this.startWebspeech() : this.startMic());
    }
    await Promise.all(jobs);
  }

  private async startSystem(): Promise<void> {
    const stream = await acquireSystemAudio();
    if (this.stopped) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    if (stream.getAudioTracks().length === 0) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error(
        'No audio in the shared surface — pick the call\'s tab (or screen) and tick "Also share tab audio".',
      );
    }
    this.streams.push(stream);
    this.cb.onSourceStatus('system', 'live');
    this.pumps.push(
      startChunkPump(
        stream,
        this.ts.chunkSeconds,
        (blob) => this.enqueueBlob('system', blob),
        () => this.cb.onSourceStatus('system', 'ended'),
      ),
    );
  }

  private async startMic(): Promise<void> {
    const stream = await acquireMic();
    if (this.stopped) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    this.streams.push(stream);
    this.cb.onSourceStatus('mic', 'live');
    this.pumps.push(
      startChunkPump(
        stream,
        this.ts.chunkSeconds,
        (blob) => this.enqueueBlob('mic', blob),
        () => this.cb.onSourceStatus('mic', 'ended'),
      ),
    );
  }

  private startWebspeech(): Promise<void> {
    this.webspeech = new WebSpeechEngine(
      this.ts.language,
      (text) => this.emitSegment('mic', text),
      (message) => this.cb.onSourceStatus('mic', 'error', message),
    );
    this.webspeech.start();
    this.cb.onSourceStatus('mic', 'live');
    return Promise.resolve();
  }

  private enqueueBlob(source: 'mic' | 'system', blob: Blob): void {
    this.chains[source] = (this.chains[source] ?? Promise.resolve()).then(async () => {
      if (this.stopped) return;
      try {
        const text = await transcribeBlob(this.ts, blob);
        if (text) this.emitSegment(source, text);
      } catch (err) {
        this.cb.onSourceStatus(source, 'error', (err as Error).message);
      }
    });
  }

  private emitSegment(source: TranscriptSource, text: string): void {
    this.cb.onSegment({
      id: crypto.randomUUID(),
      source,
      text,
      atMs: Math.round(performance.now() - this.startedAt),
    });
  }

  /** Stops capture and waits for in-flight transcription chunks to land. */
  async stop(): Promise<void> {
    this.stopped = true;
    this.webspeech?.stop();
    this.pumps.forEach((p) => p.stop());
    this.streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    await Promise.allSettled(Object.values(this.chains));
  }
}
