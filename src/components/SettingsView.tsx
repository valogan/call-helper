import { useState } from 'react';
import type { Settings, TranscriptionEngine } from '../types';
import {
  LLM_PRESETS,
  TRANSCRIBE_PRESETS,
  loadSettings,
  saveSettings,
} from '../lib/settings';
import { testConnection } from '../lib/llm';

interface Props {
  onBack(): void;
}

function presetIdFor(baseUrl: string, presets: typeof LLM_PRESETS): string {
  return presets.find((p) => p.baseUrl === baseUrl)?.id ?? 'custom';
}

export default function SettingsView({ onBack }: Props) {
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [llmPreset, setLlmPreset] = useState(() => presetIdFor(settings.llm.baseUrl, LLM_PRESETS));
  const [tsPreset, setTsPreset] = useState(() => presetIdFor(settings.transcription.baseUrl, TRANSCRIBE_PRESETS));
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [saved, setSaved] = useState(false);

  const setLlm = (patch: Partial<Settings['llm']>) => {
    setSettings((s) => ({ ...s, llm: { ...s.llm, ...patch } }));
    setSaved(false);
  };
  const setTs = (patch: Partial<Settings['transcription']>) => {
    setSettings((s) => ({ ...s, transcription: { ...s.transcription, ...patch } }));
    setSaved(false);
  };

  const applyLlmPreset = (id: string) => {
    setLlmPreset(id);
    const preset = LLM_PRESETS.find((p) => p.id === id);
    if (preset && preset.id !== 'custom') setLlm({ baseUrl: preset.baseUrl, model: preset.model });
    setTestResult(null);
  };

  const applyTsPreset = (id: string) => {
    setTsPreset(id);
    const preset = TRANSCRIBE_PRESETS.find((p) => p.id === id);
    if (preset && preset.id !== 'custom') setTs({ baseUrl: preset.baseUrl, model: preset.model });
  };

  const save = () => {
    saveSettings(settings);
    setSaved(true);
  };

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const message = await testConnection(settings.llm);
      setTestResult({ ok: true, message });
    } catch (err) {
      setTestResult({ ok: false, message: (err as Error).message });
    } finally {
      setTesting(false);
    }
  };

  const llmNote = LLM_PRESETS.find((p) => p.id === llmPreset)?.note;

  return (
    <div className="page">
      <header className="topbar">
        <div className="topbar-inner">
          <span className="brand">🎙️ Call Helper</span>
          <nav className="nav">
            <button className="btn btn-ghost" onClick={onBack}>
              ← Back
            </button>
          </nav>
        </div>
      </header>

      <main className="container container-narrow">
        <h1>Settings</h1>
        <p className="muted">
          Call Helper speaks the OpenAI-compatible protocol, so it works with hosted providers
          and local runtimes alike. Everything is stored only in this browser's local storage —
          there is no backend.
        </p>

        <section className="card">
          <h2 className="card-title">AI provider (answers, chat, notes)</h2>

          <div className="field">
            <label htmlFor="llm-preset">Preset</label>
            <select id="llm-preset" className="input" value={llmPreset} onChange={(e) => applyLlmPreset(e.target.value)}>
              {LLM_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {llmNote && <p className="hint">{llmNote}</p>}
          </div>

          <div className="field">
            <label htmlFor="llm-base">Base URL</label>
            <input
              id="llm-base"
              className="input"
              placeholder="https://api.example.com/v1"
              value={settings.llm.baseUrl}
              onChange={(e) => setLlm({ baseUrl: e.target.value })}
            />
            <p className="hint">Root of an OpenAI-compatible API (…/v1). Endpoints used: /chat/completions, /models.</p>
          </div>

          <div className="field">
            <label htmlFor="llm-key">API key</label>
            <div className="key-row">
              <input
                id="llm-key"
                className="input"
                type={showKey ? 'text' : 'password'}
                placeholder={llmPreset === 'ollama' || llmPreset === 'lmstudio' ? 'not needed for local runtimes' : 'sk-…'}
                value={settings.llm.apiKey}
                onChange={(e) => setLlm({ apiKey: e.target.value })}
              />
              <button className="btn btn-ghost btn-sm" onClick={() => setShowKey((v) => !v)}>
                {showKey ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          <div className="field-pair">
            <div className="field">
              <label htmlFor="llm-model">Model</label>
              <input
                id="llm-model"
                className="input"
                placeholder="e.g. gpt-5-mini"
                value={settings.llm.model}
                onChange={(e) => setLlm({ model: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="llm-temp">Temperature</label>
              <input
                id="llm-temp"
                className="input"
                type="number"
                min={0}
                max={2}
                step={0.1}
                value={settings.llm.temperature}
                onChange={(e) => setLlm({ temperature: Number(e.target.value) })}
              />
            </div>
          </div>

          <div className="field-actions">
            <button className="btn btn-ghost" onClick={runTest} disabled={testing || !settings.llm.baseUrl.trim()}>
              {testing ? 'Testing…' : 'Test connection'}
            </button>
            {testResult && (
              <span className={testResult.ok ? 'test-ok' : 'test-err'}>{testResult.message}</span>
            )}
          </div>
        </section>

        <section className="card">
          <h2 className="card-title">Transcription</h2>

          <div className="field">
            <label>Engine</label>
            <div className="check-row">
              <label className="check">
                <input
                  type="radio"
                  name="ts-engine"
                  checked={settings.transcription.engine === 'whisper'}
                  onChange={() => setTs({ engine: 'whisper' as TranscriptionEngine })}
                />
                Whisper API — mic + call audio, needs a provider
              </label>
              <label className="check">
                <input
                  type="radio"
                  name="ts-engine"
                  checked={settings.transcription.engine === 'webspeech'}
                  onChange={() => setTs({ engine: 'webspeech' as TranscriptionEngine })}
                />
                Browser built-in — mic only, free (Chrome)
              </label>
            </div>
          </div>

          {settings.transcription.engine === 'whisper' && (
            <>
              <div className="field">
                <label htmlFor="ts-preset">Preset</label>
                <select id="ts-preset" className="input" value={tsPreset} onChange={(e) => applyTsPreset(e.target.value)}>
                  {TRANSCRIBE_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label htmlFor="ts-base">Base URL</label>
                <input
                  id="ts-base"
                  className="input"
                  placeholder="https://api.example.com/v1"
                  value={settings.transcription.baseUrl}
                  onChange={(e) => setTs({ baseUrl: e.target.value })}
                />
                <p className="hint">Endpoint used: POST /audio/transcriptions.</p>
              </div>

              <div className="field-pair">
                <div className="field">
                  <label htmlFor="ts-key">API key</label>
                  <input
                    id="ts-key"
                    className="input"
                    type="password"
                    placeholder="sk-…"
                    value={settings.transcription.apiKey}
                    onChange={(e) => setTs({ apiKey: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="ts-model">Model</label>
                  <input
                    id="ts-model"
                    className="input"
                    placeholder="e.g. whisper-1"
                    value={settings.transcription.model}
                    onChange={(e) => setTs({ model: e.target.value })}
                  />
                </div>
              </div>

              <div className="field">
                <label htmlFor="ts-chunk">
                  Chunk length: {settings.transcription.chunkSeconds}s
                </label>
                <input
                  id="ts-chunk"
                  type="range"
                  min={4}
                  max={20}
                  step={1}
                  value={settings.transcription.chunkSeconds}
                  onChange={(e) => setTs({ chunkSeconds: Number(e.target.value) })}
                />
                <p className="hint">
                  Audio is transcribed in chunks of this length — shorter is more real-time,
                  longer gives better accuracy.
                </p>
              </div>
            </>
          )}

          <div className="field">
            <label htmlFor="ts-lang">Language</label>
            <input
              id="ts-lang"
              className="input"
              placeholder="auto (or e.g. en-US, de-DE, fr-FR)"
              value={settings.transcription.language}
              onChange={(e) => setTs({ language: e.target.value })}
            />
          </div>
        </section>

        <div className="settings-footer">
          {saved && <span className="test-ok">Saved ✓</span>}
          <button className="btn btn-primary" onClick={save}>
            Save settings
          </button>
        </div>
      </main>
    </div>
  );
}
