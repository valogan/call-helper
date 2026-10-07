/** Core shared types. */

export type TranscriptSource = 'mic' | 'system';

export type SourceStatus = 'connecting' | 'live' | 'ended' | 'error';

export interface TranscriptSegment {
  id: string;
  source: TranscriptSource;
  text: string;
  /** Milliseconds since session start. */
  atMs: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AnswerRecord {
  /** What triggered the answer: the detected question, or the manual prompt. */
  question: string;
  answer: string;
  atMs: number;
  trigger: 'auto' | 'manual';
}

export interface SessionDraft {
  title: string;
  mode: 'interview' | 'call';
  instructions: string;
  context: string;
  mic: boolean;
  system: boolean;
}

export interface Session {
  id: string;
  title: string;
  mode: 'interview' | 'call';
  createdAt: number;
  endedAt?: number;
  instructions: string;
  context: string;
  segments: TranscriptSegment[];
  answers: AnswerRecord[];
  chat: ChatMessage[];
  notes?: string;
}

export interface LLMSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  /** Optional smaller model for the always-on question watcher; blank = model. */
  watcherModel: string;
}

export type TranscriptionEngine = 'whisper' | 'webspeech';

export interface TranscriptionSettings {
  engine: TranscriptionEngine;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Seconds of audio per transcription chunk (whisper engine). */
  chunkSeconds: number;
  /** BCP-47 tag, e.g. "en-US"; empty = auto / browser default. */
  language: string;
}

export interface Settings {
  llm: LLMSettings;
  transcription: TranscriptionSettings;
}
