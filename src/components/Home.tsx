import { useMemo, useRef, useState } from 'react';
import type { Session, SessionDraft } from '../types';
import {
  isLLMConfigured,
  isTranscriptionConfigured,
  loadSettings,
} from '../lib/settings';
import { deleteSession, loadSessions } from '../lib/storage';
import { downloadSession } from '../lib/export';
import { formatDate, formatDuration } from '../lib/format';

interface Props {
  onOpenSettings(): void;
  onStart(draft: SessionDraft): void;
  onOpenSession(id: string): void;
}

export default function Home({ onOpenSettings, onStart, onOpenSession }: Props) {
  const [settings] = useState(() => loadSettings());
  const [sessions, setSessions] = useState(() => loadSessions());
  const [mode, setMode] = useState<SessionDraft['mode']>('interview');
  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [context, setContext] = useState('');
  const [mic, setMic] = useState(true);
  const [system, setSystem] = useState(true);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const llmOk = useMemo(() => isLLMConfigured(settings), [settings]);
  const tsOk = useMemo(() => isTranscriptionConfigured(settings), [settings]);

  const refreshSessions = () => setSessions(loadSessions());

  const readFile = async (file: File) => {
    if (file.size > 512 * 1024) {
      setError('Context file is larger than 512 KB — paste the relevant part instead.');
      return;
    }
    const text = await file.text();
    setContext((prev) => (prev.trim() ? `${prev.trim()}\n\n${text}` : text));
    setError('');
  };

  const start = () => {
    if (!mic && !system) {
      setError('Pick at least one audio source.');
      return;
    }
    if (!llmOk) {
      setError('Configure an AI provider in Settings first.');
      return;
    }
    if (!tsOk) {
      setError('Configure transcription in Settings (or switch its engine to "Browser built-in").');
      return;
    }
    if (system && settings.transcription.engine === 'webspeech') {
      setError(
        'The browser engine only transcribes your microphone. To also hear the call\'s audio, switch transcription to the "Whisper API" engine in Settings.',
      );
      return;
    }
    setError('');
    onStart({
      title: title.trim() || `${mode === 'interview' ? 'Interview' : 'Call'} — ${new Date().toLocaleDateString()}`,
      mode,
      instructions,
      context,
      mic,
      system,
    });
  };

  const remove = (id: string) => {
    if (!window.confirm('Delete this session?')) return;
    deleteSession(id);
    refreshSessions();
  };

  return (
    <div className="page">
      <header className="topbar">
        <div className="topbar-inner">
          <span className="brand">🎙️ Call Helper</span>
          <nav className="nav">
            <button className="btn btn-ghost" onClick={onOpenSettings}>
              Settings
            </button>
          </nav>
        </div>
      </header>

      <main className="container">
        <section className="hero">
          <h1>Real-time call assistant</h1>
          <p>
            Transcribes your call live, detects questions, and drafts answers with your own
            AI provider. Your keys stay in this browser — there is no server.
          </p>
        </section>

        <div className="setup-grid">
          <section className="card">
            <h2 className="card-title">New session</h2>

            <div className="field">
              <label htmlFor="f-mode">Mode</label>
              <select
                id="f-mode"
                className="input"
                value={mode}
                onChange={(e) => setMode(e.target.value as SessionDraft['mode'])}
              >
                <option value="interview">Interview — answer as the candidate</option>
                <option value="call">Regular call — general assistance</option>
              </select>
            </div>

            <div className="field">
              <label htmlFor="f-title">Title (optional)</label>
              <input
                id="f-title"
                className="input"
                placeholder="e.g. Stripe screening call"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="f-context">Context — résumé, notes, playbook</label>
              <textarea
                id="f-context"
                className="input textarea"
                rows={5}
                placeholder="Paste your résumé or any context the AI should use…"
                value={context}
                onChange={(e) => setContext(e.target.value)}
              />
              <div className="field-actions">
                <button className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()}>
                  Attach .txt / .md
                </button>
                {context && (
                  <button className="btn btn-ghost btn-sm" onClick={() => setContext('')}>
                    Clear
                  </button>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept=".txt,.md,.markdown,text/plain,text/markdown"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void readFile(f);
                    e.target.value = '';
                  }}
                />
              </div>
            </div>

            <div className="field">
              <label htmlFor="f-instructions">Custom instructions (optional)</label>
              <textarea
                id="f-instructions"
                className="input textarea"
                rows={3}
                placeholder="e.g. Keep answers under 60 words. Emphasize my ML project experience."
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
              />
            </div>

            <div className="field">
              <label>Audio sources</label>
              <div className="check-row">
                <label className="check">
                  <input type="checkbox" checked={mic} onChange={(e) => setMic(e.target.checked)} />
                  Your microphone
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={system}
                    onChange={(e) => setSystem(e.target.checked)}
                  />
                  Call audio (share the call's tab)
                </label>
              </div>
              <p className="hint">
                For call audio, Chrome will ask what to share — pick the tab running the call
                and enable <strong>“Also share tab audio”</strong>.
              </p>
            </div>

            {error && <div className="banner banner-error">{error}</div>}
            {!llmOk && (
              <div className="banner banner-warn">
                No AI provider configured yet —{' '}
                <button className="linklike" onClick={onOpenSettings}>
                  open Settings
                </button>{' '}
                to add one (OpenAI, Groq, OpenRouter, local LM Studio/Ollama, or any
                OpenAI-compatible endpoint).
              </div>
            )}

            <button className="btn btn-primary btn-lg" onClick={start}>
              Start session
            </button>
          </section>

          <section className="card">
            <h2 className="card-title">Past sessions</h2>
            {sessions.length === 0 ? (
              <p className="muted">No sessions yet. Finished sessions appear here with their notes.</p>
            ) : (
              <ul className="session-list">
                {sessions.map((s: Session) => (
                  <li key={s.id} className="session-item">
                    <button className="session-main" onClick={() => onOpenSession(s.id)}>
                      <span className="session-title">
                        {s.title} {s.notes ? <span className="dot-notes" title="Has notes" /> : null}
                      </span>
                      <span className="session-meta">
                        {formatDate(s.createdAt)} · {formatDuration(s.createdAt, s.endedAt)} ·{' '}
                        {s.segments.length} lines
                      </span>
                    </button>
                    <span className="session-actions">
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => downloadSession(s)}
                        title="Export as markdown"
                      >
                        Export
                      </button>
                      <button className="btn btn-ghost btn-sm btn-danger-text" onClick={() => remove(s.id)}>
                        Delete
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
