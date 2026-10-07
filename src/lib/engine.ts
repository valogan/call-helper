import type { TranscriptSegment, TranscriptSource, TranscriptionSettings } from '../types';
import { acquireMic, acquireSystemAudio, startWindowPump } from './audio';
import { WebSpeechEngine } from './transcribe';
import { StreamingTranscriber } from './streaming';

export interface EngineCallbacks {
  onSegment(segment: TranscriptSegment): void;
  /** Live (uncommitted) caption text for a source; '' clears it. */
  onDraft(source: TranscriptSource, text: string): void;
  onSourceStatus(source: TranscriptSource, status: 'live' | 'ended' | 'error', message?: string): void;
}

const TICK_SECONDS = 2;

/**
 * Owns the audio sources and per-source streaming transcription pipelines for
 * one live session. Pure TypeScript — the React layer just consumes the
 * callbacks. Words appear within ~TICK_SECONDS of being spoken: a rolling
 * window of audio is re-transcribed every tick and merged by overlap
 * alignment, so each source shows a live draft that rotates into segments.
 */
export class SessionEngine {
  private stopped = false;
  private startedAtMs = 0;
  private streams: MediaStream[] = [];
  private pumps: Array<ReturnType<typeof startWindowPump>> = [];
  private webspeech: WebSpeechEngine | null = null;
  private transcribers: StreamingTranscriber[] = [];
  private chains = new Map<StreamingTranscriber, Promise<void>>();

  constructor(
    private ts: TranscriptionSettings,
    private cb: EngineCallbacks,
  ) {}

  /** Starts the requested sources; rejects with a user-facing message on failure. */
  async start(opts: { mic: boolean; system: boolean }): Promise<void> {
    this.startedAtMs = performance.now();
    const jobs: Array<Promise<void>> = [];
    if (opts.system) jobs.push(this.startSource('system', acquireSystemAudio));
    if (opts.mic) {
      jobs.push(this.ts.engine === 'webspeech' ? this.startWebspeech() : this.startSource('mic', acquireMic));
    }
    await Promise.all(jobs);
  }

  private async startSource(
    source: 'mic' | 'system',
    acquire: () => Promise<MediaStream>,
  ): Promise<void> {
    const stream = await acquire();
    if (this.stopped) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    if (source === 'system' && stream.getAudioTracks().length === 0) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error(
        'No audio in the shared surface — pick the call\'s tab (or screen) and tick "Also share tab audio".',
      );
    }
    this.streams.push(stream);
    this.cb.onSourceStatus(source, 'live');

    const transcriber = new StreamingTranscriber(
      this.ts,
      { windowSeconds: this.ts.chunkSeconds, tickSeconds: TICK_SECONDS },
      {
        onDraft: (text) => this.cb.onDraft(source, text),
        onCommit: (text) => this.emitSegment(source, text),
        onError: (message) => this.cb.onSourceStatus(source, 'error', message),
      },
    );
    this.transcribers.push(transcriber);

    const pump = startWindowPump(
      stream,
      { windowSeconds: this.ts.chunkSeconds, tickSeconds: TICK_SECONDS },
      (wav) => this.enqueueWindow(transcriber, wav),
      () => this.cb.onSourceStatus(source, 'ended'),
    );
    this.pumps.push(pump);
  }

  private startWebspeech(): Promise<void> {
    this.webspeech = new WebSpeechEngine(this.ts.language, {
      onFinal: (text) => {
        this.emitSegment('mic', text);
        this.cb.onDraft('mic', '');
      },
      onInterim: (text) => this.cb.onDraft('mic', text),
      onError: (message) => this.cb.onSourceStatus('mic', 'error', message),
    });
    this.webspeech.start();
    this.cb.onSourceStatus('mic', 'live');
    return Promise.resolve();
  }

  private enqueueWindow(transcriber: StreamingTranscriber, wav: Blob): void {
    const chain = (this.chains.get(transcriber) ?? Promise.resolve())
      .then(() => transcriber.handleWindow(wav))
      .catch(() => undefined); // handleWindow reports its own errors
    this.chains.set(transcriber, chain);
  }

  private emitSegment(source: TranscriptSource, text: string): void {
    this.cb.onSegment({
      id: crypto.randomUUID(),
      source,
      text,
      atMs: Math.round(performance.now() - this.startedAtMs),
    });
  }

  /** Stops capture, lets in-flight windows land, and commits remaining drafts. */
  async stop(): Promise<void> {
    this.stopped = true;
    this.webspeech?.stop();
    this.pumps.forEach((p) => p.stop());
    this.streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    // pump.stop() enqueues one final window synchronously, so a single
    // settle of the chains covers all in-flight transcription.
    await Promise.allSettled([...this.chains.values()]);
    this.transcribers.forEach((t) => t.flush());
  }
}
