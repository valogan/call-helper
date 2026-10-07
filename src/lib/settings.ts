import type { Settings } from '../types';

const KEY = 'call-helper:settings:v1';

export const DEFAULT_SETTINGS: Settings = {
  llm: {
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-5-mini',
    temperature: 0.4,
    watcherModel: '',
  },
  transcription: {
    engine: 'whisper',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'whisper-1',
    chunkSeconds: 8,
    language: '',
  },
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      llm: { ...DEFAULT_SETTINGS.llm, ...(parsed.llm ?? {}) },
      transcription: { ...DEFAULT_SETTINGS.transcription, ...(parsed.transcription ?? {}) },
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable (private mode etc.) — settings just won't persist.
  }
}

export interface ProviderPreset {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  /** Shown as a hint next to the preset picker. */
  note?: string;
}

/** OpenAI-compatible chat providers the settings page offers as one-click fills. */
export const LLM_PRESETS: ProviderPreset[] = [
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5-mini' },
  { id: 'groq', name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
  { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini' },
  { id: 'together', name: 'Together AI', baseUrl: 'https://api.together.xyz/v1', model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo' },
  { id: 'lmstudio', name: 'LM Studio (local)', baseUrl: 'http://localhost:1234/v1', model: '', note: 'Start the local server in LM Studio; no API key needed.' },
  { id: 'ollama', name: 'Ollama (local)', baseUrl: 'http://localhost:11434/v1', model: '', note: 'Run e.g. `ollama serve`; no API key needed.' },
  { id: 'custom', name: 'Custom…', baseUrl: '', model: '', note: 'Any OpenAI-compatible /v1 endpoint.' },
];

/** Presets for the Whisper-style transcription endpoint. */
export const TRANSCRIBE_PRESETS: ProviderPreset[] = [
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'whisper-1' },
  { id: 'openai-transcribe', name: 'OpenAI (gpt-4o-mini-transcribe)', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini-transcribe' },
  { id: 'groq', name: 'Groq (whisper-large-v3)', baseUrl: 'https://api.groq.com/openai/v1', model: 'whisper-large-v3' },
  { id: 'groq-turbo', name: 'Groq (whisper-large-v3-turbo)', baseUrl: 'https://api.groq.com/openai/v1', model: 'whisper-large-v3-turbo' },
  { id: 'custom', name: 'Custom…', baseUrl: '', model: '', note: 'Any OpenAI-compatible /v1/audio/transcriptions endpoint.' },
];

export function isLLMConfigured(settings: Settings): boolean {
  const { baseUrl, model } = settings.llm;
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)/.test(baseUrl.trim());
  return Boolean(baseUrl.trim() && model.trim() && (settings.llm.apiKey.trim() || local));
}

export function isTranscriptionConfigured(settings: Settings): boolean {
  if (settings.transcription.engine === 'webspeech') return true;
  const { baseUrl, model } = settings.transcription;
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)/.test(baseUrl.trim());
  return Boolean(baseUrl.trim() && model.trim() && (settings.transcription.apiKey.trim() || local));
}
