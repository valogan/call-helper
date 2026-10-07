import type { TranscriptionSettings } from '../types';
import { transcribeBlob } from './transcribe';

export interface TranscriberCallbacks {
  /** Live, uncommitted text for this source (replaces the previous draft). */
  onDraft(text: string): void;
  /** Finalized text — becomes a transcript segment. */
  onCommit(text: string): void;
  onError(message: string): void;
}

export interface TranscriberOptions {
  windowSeconds: number;
  tickSeconds: number;
}

const normalizeWord = (w: string): string => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');

const strip = (w: string): string => (normalizeWord(w) ? w : '');

/**
 * Find how many words of `next` repeat the tail of `prev` — the overlapping
 * region of two consecutive transcription windows. Returns the number of
 * overlapping words (the index where new words begin), or -1 when no
 * alignment was found. Tolerates ~30% word mismatch (ASR nondeterminism).
 */
function overlapStart(prevLower: string[], nextLower: string[]): number {
  if (!prevLower.length || !nextLower.length) return 0;
  const maxK = Math.min(prevLower.length, nextLower.length, 30);
  for (let k = maxK; k >= 3; k--) {
    let same = 0;
    for (let i = 0; i < k; i++) {
      if (prevLower[prevLower.length - k + i] === nextLower[i]) same++;
    }
    if (same / k >= 0.7) return k;
  }
  return -1;
}

function similar(a: string[], b: string[]): boolean {
  if (!a.length || !b.length) return false;
  let same = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] === b[i]) same++;
  return same / Math.max(a.length, b.length) > 0.8;
}

/**
 * Turns overlapping transcription windows into one growing live caption.
 *
 * Every `tickSeconds` a WAV of the last `windowSeconds` arrives; consecutive
 * results overlap by (window - tick), so the new words are the part of the
 * current result after the aligned overlap. Words accumulate in a draft that
 * is committed to the transcript once it is long or old enough (the ring
 * buffer no longer contains anything older than the window anyway).
 */
export class StreamingTranscriber {
  private prevWindowText = '';
  private draft: string[] = [];
  private draftLower: string[] = [];
  private draftStartedAt = 0;
  private busy = false;

  private readonly flushWords = 24;
  private readonly flushAgeMs: number;

  constructor(
    private ts: TranscriptionSettings,
    opts: TranscriberOptions,
    private cb: TranscriberCallbacks,
  ) {
    // Commit a draft once its first words are about to leave the window —
    // they can no longer be revised, and fresher history helps the watcher.
    this.flushAgeMs = opts.windowSeconds * 1000;
  }

  /** True while a window transcription is in flight (used to skip ticks). */
  get processing(): boolean {
    return this.busy;
  }

  async handleWindow(wav: Blob): Promise<void> {
    if (this.busy) return; // drop this tick — the next window covers the gap
    this.busy = true;
    try {
      const text = await transcribeBlob(this.ts, wav);
      this.absorb(text);
    } catch (err) {
      this.cb.onError((err as Error).message);
    } finally {
      this.busy = false;
    }
  }

  private absorb(text: string): void {
    const trimmed = text.trim();
    if (trimmed) {
      const next = trimmed.split(/\s+/).map(strip).filter(Boolean);
      const nextLower = next.map(normalizeWord);
      const prevLower = this.prevWindowText.split(/\s+/).map(normalizeWord).filter(Boolean);
      const overlap = overlapStart(prevLower, nextLower);

      if (overlap === 0) {
        // First window after (re)starting — everything is new.
        this.append(next, nextLower);
      } else if (overlap > 0) {
        this.append(next.slice(overlap), nextLower.slice(overlap));
      } else if (!similar(prevLower, nextLower)) {
        // Alignment failed and content genuinely differs — accept the whole
        // window text. Small duplication risk, but losing words is worse.
        this.append(next, nextLower);
      }
      this.prevWindowText = trimmed;
    }
    this.maybeFlush();
  }

  private append(newWords: string[], newLower: string[]): void {
    if (!newWords.length) return;
    // Dedup guard: skip if these words exactly repeat the draft's tail.
    const n = newWords.length;
    if (this.draftLower.length >= n) {
      const tail = this.draftLower.slice(-n);
      if (tail.every((w, i) => w === newLower[i])) return;
    }
    if (!this.draft.length) this.draftStartedAt = Date.now();
    this.draft.push(...newWords);
    this.draftLower.push(...newLower);
    this.cb.onDraft(this.draft.join(' '));
  }

  private maybeFlush(): void {
    const aged =
      this.draft.length > 0 && Date.now() - this.draftStartedAt > this.flushAgeMs;
    if (this.draft.length >= this.flushWords || aged) this.flushDraft();
  }

  private flushDraft(): void {
    if (!this.draft.length) return;
    const text = this.draft.join(' ');
    this.draft = [];
    this.draftLower = [];
    this.cb.onDraft('');
    this.cb.onCommit(text);
  }

  /** Commit any remaining draft (called when the session ends). */
  flush(): void {
    this.flushDraft();
  }
}
