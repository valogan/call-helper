import { useRef, useState } from 'react';
import type { Session } from '../types';
import { streamChat } from '../lib/llm';
import { notesMessages } from '../lib/prompts';
import { loadSettings } from '../lib/settings';
import { getSession, persistSession, deleteSession } from '../lib/storage';
import { downloadSession } from '../lib/export';
import { formatClock, formatDate, formatDuration } from '../lib/format';
import { Markdown } from '../lib/markdown';

interface Props {
  sessionId: string;
  onBack(): void;
}

export default function ReviewView({ sessionId, onBack }: Props) {
  const [session, setSession] = useState<Session | undefined>(() => getSession(sessionId));
  const [notes, setNotes] = useState<string | null>(() => getSession(sessionId)?.notes ?? null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  if (!session) {
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
          <div className="banner banner-warn">That session no longer exists.</div>
        </main>
      </div>
    );
  }

  const generateNotes = async () => {
    if (generating) return;
    const settings = loadSettings();
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setGenerating(true);
    setError('');
    setNotes('');
    try {
      const messages = notesMessages(session, session.segments);
      let acc = '';
      for await (const delta of streamChat(settings.llm, messages, controller.signal)) {
        acc += delta;
        setNotes(acc);
      }
      const updated: Session = { ...session, notes: acc };
      setSession(updated);
      persistSession(updated);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setError((err as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const remove = () => {
    if (!window.confirm('Delete this session?')) return;
    abortRef.current?.abort();
    deleteSession(session.id);
    onBack();
  };

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
        <h1>{session.title}</h1>
        <p className="muted review-meta">
          {formatDate(session.createdAt)} · {formatDuration(session.createdAt, session.endedAt)} ·{' '}
          {session.mode === 'interview' ? 'Interview' : 'Call'} · {session.segments.length}{' '}
          transcript lines · {session.answers.length} answers drafted
        </p>

        <section className="card">
          <div className="answer-head">
            <h2 className="card-title">AI notes</h2>
            <div className="answer-actions">
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => downloadSession(session)}
              >
                Export .md
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => void generateNotes()}
                disabled={generating || session.segments.length === 0}
              >
                {generating
                  ? 'Writing…'
                  : notes
                    ? 'Regenerate notes'
                    : 'Generate notes'}
              </button>
            </div>
          </div>
          {error && <div className="banner banner-error">{error}</div>}
          {notes ? (
            <div className="notes">
              <Markdown text={notes} />
              {generating && <span className="caret" />}
            </div>
          ) : (
            <p className="muted">
              {session.segments.length === 0
                ? 'This session has no transcript, so there is nothing to summarize.'
                : 'Generate a summary with the questions asked, key points, and next steps.'}
            </p>
          )}
        </section>

        <section className="card">
          <div className="answer-head">
            <h2 className="card-title">Transcript</h2>
            <button className="btn btn-ghost btn-sm btn-danger-text" onClick={remove}>
              Delete session
            </button>
          </div>
          {session.segments.length === 0 ? (
            <p className="muted">Nothing was captured in this session.</p>
          ) : (
            <div className="review-transcript">
              {session.segments.map((seg) => (
                <div key={seg.id} className="seg">
                  <span className="seg-time">{formatClock(seg.atMs)}</span>
                  <span className={`seg-tag ${seg.source === 'mic' ? 'tag-you' : 'tag-them'}`}>
                    {seg.source === 'mic' ? 'You' : 'Them'}
                  </span>
                  <span className="seg-text">{seg.text}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
