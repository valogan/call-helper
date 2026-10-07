import type { TranscriptionSettings } from '../types';

const trimSlash = (s: string) => s.replace(/\/+$/, '');

/** Transcribe one audio chunk against an OpenAI-compatible endpoint. */
export async function transcribeBlob(
  ts: TranscriptionSettings,
  blob: Blob,
  signal?: AbortSignal,
): Promise<string> {
  const form = new FormData();
  // Providers sniff by filename extension — WAV windows vs WebSpeech-era webm.
  form.append('file', blob, blob.type.includes('wav') ? 'audio.wav' : 'audio.webm');
  form.append('model', ts.model);
  if (ts.language) form.append('language', ts.language);

  const res = await fetch(`${trimSlash(ts.baseUrl)}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ts.apiKey}` },
    body: form,
    signal,
  });
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.text()).slice(0, 300);
    } catch {
      // body unavailable
    }
    const hints: Record<number, string> = {
      401: ' — check the transcription API key in Settings.',
      404: ' — check the transcription base URL / model.',
      429: ' — rate limited or out of quota.',
    };
    throw new Error(`Transcription failed (${res.status})${hints[res.status] ?? ''}${detail ? ` · ${detail}` : ''}`);
  }
  const data = (await res.json()) as { text?: string };
  return (data.text ?? '').trim();
}

/* Minimal SpeechRecognition typings — not yet in the standard DOM lib. */
interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: { length: number; [index: number]: SpeechRecognitionResultLike };
}
interface SpeechRecognitionErrorEventLike {
  error: string;
}
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognition(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Browser SpeechRecognition engine (Chrome). Free, real-time, mic-only —
 * no transcription API needed. Chrome restarts recognition periodically;
 * we spin it back up to stay continuous.
 */
export class WebSpeechEngine {
  private recognition: SpeechRecognitionLike | null = null;
  private active = false;
  private restarting = false;

  constructor(
    private lang: string,
    private handlers: {
      onFinal(text: string): void;
      onInterim(text: string): void;
      onError(message: string): void;
    },
  ) {}

  start(): void {
    const SR = getSpeechRecognition();
    if (!SR) {
      this.handlers.onError('SpeechRecognition is not available in this browser — use Chrome, or switch to the Whisper engine.');
      return;
    }
    this.active = true;
    this.spin();
  }

  private spin(): void {
    if (!this.active || this.restarting) return;
    const SR = getSpeechRecognition();
    if (!SR) return;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = this.lang || navigator.language;
    rec.onresult = (e: SpeechRecognitionEventLike) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        const transcript = result[0]?.transcript?.trim();
        if (!transcript) continue;
        if (result.isFinal) {
          this.handlers.onFinal(transcript);
        } else {
          interim += `${transcript} `;
        }
      }
      if (interim.trim()) this.handlers.onInterim(interim.trim());
    };
    rec.onerror = (e: SpeechRecognitionErrorEventLike) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        this.active = false;
        this.handlers.onError('Microphone permission denied for speech recognition.');
      } else if (e.error === 'network') {
        this.handlers.onError('Speech recognition network error (Chrome routes it through a Google service).');
      }
      // 'no-speech' and 'aborted' are benign — onend restarts us.
    };
    rec.onend = () => {
      if (this.active) {
        this.restarting = true;
        window.setTimeout(() => {
          this.restarting = false;
          this.spin();
        }, 250);
      }
    };
    this.recognition = rec;
    try {
      rec.start();
    } catch {
      // start() while already active — harmless, next spin takes over
    }
  }

  stop(): void {
    this.active = false;
    try {
      this.recognition?.stop();
    } catch {
      // noop
    }
    this.recognition = null;
  }
}
