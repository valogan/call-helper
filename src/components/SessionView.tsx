import { useEffect, useRef, useState } from 'react';
import type { Session, SessionDraft, Settings, SourceStatus, TranscriptSource } from '../types';
import type { ChatMessage } from '../lib/llm';
import { streamChat } from '../lib/llm';
import { answerMessages, chatMessages } from '../lib/prompts';
import { detectOpenQuestion, sameQuestion } from '../lib/watcher';
import { SessionEngine } from '../lib/engine';
import { persistSession } from '../lib/storage';
import { formatClock, formatTimestamp } from '../lib/format';
import { Markdown } from '../lib/markdown';

interface Props {
  draft: SessionDraft;
  settings: Settings;
  onEnded(session: Session): void;
  onCancel(): void;
}

interface SourceState {
  status: SourceStatus;
  message?: string;
}

const WATCH_INTERVAL_MS = 5_000;
const ANSWER_COOLDOWN_MS = 15_000;
const PERSIST_INTERVAL_MS = 15_000;

export default function SessionView({ draft, settings, onEnded, onCancel }: Props) {
  const [segments, setSegments] = useState<Session['segments']>([]);
  const [drafts, setDrafts] = useState<Partial<Record<TranscriptSource, string>>>({});
  const [statuses, setStatuses] = useState<Partial<Record<TranscriptSource, SourceState>>>({});
  const [answer, setAnswer] = useState<{ text: string; streaming: boolean; error?: string }>({
    text: '',
    streaming: false,
  });
  const [detectedQuestion, setDetectedQuestion] = useState('');
  const [watcherError, setWatcherError] = useState('');
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatStreaming, setChatStreaming] = useState(false);
  const [chatOpen, setChatOpen] = useState(true);
  const [autoAnswer, setAutoAnswer] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const [startError, setStartError] = useState('');
  const [ending, setEnding] = useState(false);
  const [copied, setCopied] = useState(false);

  const engineRef = useRef<SessionEngine | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const watchAbortRef = useRef<AbortController | null>(null);
  const lastAnswerAtRef = useRef(0);
  const lastQuestionRef = useRef('');
  const watchedCountRef = useRef(0);
  const streamingRef = useRef(false);
  const endingRef = useRef(false);
  const autoAnswerRef = useRef(true);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sessionRef = useRef<Session>({
    id: crypto.randomUUID(),
    title: draft.title,
    mode: draft.mode,
    createdAt: Date.now(),
    instructions: draft.instructions,
    context: draft.context,
    segments: [],
    answers: [],
    chat: [],
  });

  autoAnswerRef.current = autoAnswer;

  // Live capture lifecycle.
  useEffect(() => {
    const engine = new SessionEngine(settings.transcription, {
      onSegment: (seg) => {
        sessionRef.current.segments.push(seg);
        setSegments([...sessionRef.current.segments]);
      },
      onDraft: (source, text) => setDrafts((prev) => ({ ...prev, [source]: text })),
      onSourceStatus: (source, status, message) =>
        setStatuses((prev) => ({ ...prev, [source]: { status, message } })),
    });
    engineRef.current = engine;
    engine.start({ mic: draft.mic, system: draft.system }).catch((err: Error) => {
      setStartError(err.message);
    });
    return () => {
      void engine.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Timer + crash-safe periodic persistence.
  useEffect(() => {
    const startedAt = sessionRef.current.createdAt;
    const timer = window.setInterval(() => setElapsed(Date.now() - startedAt), 1000);
    const persist = window.setInterval(() => {
      if (!endingRef.current) persistSession({ ...sessionRef.current });
    }, PERSIST_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(persist);
    };
  }, []);

  // Keep the transcript scrolled to the newest line.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [segments, drafts]);

  async function runAnswer(trigger: 'auto' | 'manual', questionText: string): Promise<void> {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    streamingRef.current = true;
    lastAnswerAtRef.current = Date.now();
    if (questionText) lastQuestionRef.current = questionText;
    setAnswer({ text: '', streaming: true });
    if (trigger === 'auto') setDetectedQuestion(questionText);
    else setDetectedQuestion('');
    try {
      const messages = answerMessages(draft, sessionRef.current.segments, trigger);
      let acc = '';
      for await (const delta of streamChat(settings.llm, messages, controller.signal)) {
        acc += delta;
        setAnswer({ text: acc, streaming: true });
      }
      setAnswer({ text: acc, streaming: false });
      sessionRef.current.answers.push({
        question: trigger === 'auto' ? questionText : '(manual — "Answer now")',
        answer: acc,
        atMs: Date.now() - sessionRef.current.createdAt,
        trigger,
      });
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setAnswer({ text: '', streaming: false, error: (err as Error).message });
      }
    } finally {
      streamingRef.current = false;
    }
  }

  // The watcher: an LLM periodically reviews the transcript for open questions
  // from the other side; a new one triggers a drafted answer.
  async function watchOnce(): Promise<void> {
    if (!autoAnswerRef.current || endingRef.current || streamingRef.current) return;
    const segs = sessionRef.current.segments;
    if (segs.length === 0 || segs.length === watchedCountRef.current) return;
    if (Date.now() - lastAnswerAtRef.current < ANSWER_COOLDOWN_MS) return;
    watchedCountRef.current = segs.length;
    watchAbortRef.current?.abort();
    const controller = new AbortController();
    watchAbortRef.current = controller;
    const watcherLlm = { ...settings.llm, model: settings.llm.watcherModel.trim() || settings.llm.model };
    try {
      const question = await detectOpenQuestion(watcherLlm, segs, controller.signal);
      setWatcherError('');
      if (
        !question ||
        endingRef.current ||
        streamingRef.current ||
        !autoAnswerRef.current ||
        sameQuestion(question, lastQuestionRef.current)
      ) {
        return;
      }
      void runAnswer('auto', question);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setWatcherError((err as Error).message);
    }
  }

  useEffect(() => {
    const timer = window.setInterval(() => void watchOnce(), WATCH_INTERVAL_MS);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function sendChat(): Promise<void> {
    const text = chatInput.trim();
    if (!text || chatStreaming) return;
    setChatInput('');
    setChatStreaming(true);
    const history = [...chat, { role: 'user' as const, content: text }];
    const withPlaceholder: ChatMessage[] = [...history, { role: 'assistant', content: '' }];
    sessionRef.current.chat = withPlaceholder;
    setChat(withPlaceholder);
    try {
      const messages = chatMessages(draft, sessionRef.current.segments, history, text);
      let acc = '';
      for await (const delta of streamChat(settings.llm, messages)) {
        acc += delta;
        const updated = [...withPlaceholder];
        updated[updated.length - 1] = { role: 'assistant', content: acc };
        sessionRef.current.chat = updated;
        setChat(updated);
      }
    } catch (err) {
      const updated = [...sessionRef.current.chat];
      updated[updated.length - 1] = {
        role: 'assistant',
        content: `⚠ ${(err as Error).message}`,
      };
      sessionRef.current.chat = updated;
      setChat(updated);
    } finally {
      setChatStreaming(false);
    }
  }

  const copyAnswer = async () => {
    if (!answer.text) return;
    try {
      await navigator.clipboard.writeText(answer.text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable — ignore
    }
  };

  const handleLeave = () => {
    if (
      sessionRef.current.segments.length > 0 ||
      sessionRef.current.answers.length > 0 ||
      chat.length > 0
    ) {
      if (!window.confirm('Leave now? Captured audio will not be saved.')) return;
    }
    abortRef.current?.abort();
    watchAbortRef.current?.abort();
    onCancel();
  };

  const handleEnd = async () => {
    if (endingRef.current) return;
    if (!window.confirm('End the session and save the transcript?')) return;
    endingRef.current = true;
    setEnding(true);
    abortRef.current?.abort();
    watchAbortRef.current?.abort();
    await engineRef.current?.stop();
    const session: Session = { ...sessionRef.current, endedAt: Date.now() };
    onEnded(session);
  };

  const chip = (source: TranscriptSource, label: string) => {
    const state = statuses[source];
    if (!state) return null;
    const cls =
      state.status === 'live' ? 'dot-live' : state.status === 'error' ? 'dot-err' : 'dot-end';
    const text =
      state.status === 'live'
        ? label
        : state.status === 'error'
          ? `${label}: error`
          : `${label}: ended`;
    return (
      <span className="status-chip" title={state.message ?? ''}>
        <span className={`dot ${cls}`} /> {text}
      </span>
    );
  };

  const activeDrafts = (['mic', 'system'] as const)
    .filter((src) => drafts[src]?.trim())
    .map((src) => ({ src, text: drafts[src]!.trim() }));

  return (
    <div className="page page-live">
      <header className="live-bar">
        <div className="live-bar-left">
          <span className="live-title">{draft.title}</span>
          <span className="live-timer">{formatClock(elapsed)}</span>
          {draft.mic && chip('mic', 'Mic')}
          {draft.system && chip('system', 'Call audio')}
        </div>
        <div className="live-bar-right">
          <label className="toggle">
            <input type="checkbox" checked={autoAnswer} onChange={(e) => setAutoAnswer(e.target.checked)} />
            Auto Answer
          </label>
          <button className="btn btn-ghost" onClick={handleLeave} disabled={ending}>
            Leave
          </button>
          <button className="btn btn-danger" onClick={handleEnd} disabled={ending}>
            {ending ? 'Saving…' : 'End session'}
          </button>
        </div>
      </header>

      {startError && (
        <div className="container">
          <div className="banner banner-error banner-dismiss">
            <span>{startError}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => setStartError('')}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div className="live-grid">
        <section className="transcript" ref={scrollRef}>
          {segments.length === 0 && activeDrafts.length === 0 && (
            <p className="muted transcript-empty">
              Listening… words will appear here as they are spoken.
            </p>
          )}
          {segments.map((seg) => (
            <div key={seg.id} className="seg">
              <span className="seg-time">{formatTimestamp(seg.atMs)}</span>
              <span className={`seg-tag ${seg.source === 'mic' ? 'tag-you' : 'tag-them'}`}>
                {seg.source === 'mic' ? 'You' : 'Them'}
              </span>
              <span className="seg-text">{seg.text}</span>
            </div>
          ))}
          {activeDrafts.map(({ src, text }) => (
            <div key={`draft-${src}`} className="seg seg-interim">
              <span className="seg-time">…</span>
              <span className={`seg-tag ${src === 'mic' ? 'tag-you' : 'tag-them'}`}>
                {src === 'mic' ? 'You' : 'Them'}
              </span>
              <span className="seg-text">{text}</span>
            </div>
          ))}
        </section>

        <aside className="side-panel">
          <section className={`card answer-card ${answer.streaming ? 'streaming' : ''}`}>
            <div className="answer-head">
              <h3>Answer</h3>
              <div className="answer-actions">
                {answer.text && (
                  <button className="btn btn-ghost btn-sm" onClick={copyAnswer}>
                    {copied ? 'Copied ✓' : 'Copy'}
                  </button>
                )}
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => void runAnswer('manual', '')}
                  disabled={answer.streaming || ending}
                >
                  Answer now
                </button>
              </div>
            </div>
            {detectedQuestion && <p className="detected-q">“{detectedQuestion}”</p>}
            {watcherError && (
              <p className="watcher-err">Watcher: {watcherError}</p>
            )}
            {answer.error && <div className="banner banner-error">{answer.error}</div>}
            <div className="answer-body">
              {answer.text ? (
                <Markdown text={answer.text} />
              ) : (
                <p className="muted">
                  {answer.streaming
                    ? 'Thinking…'
                    : 'The watcher LLM reviews the transcript every few seconds and drafts a reply when a question from the other side is detected — or press “Answer now”.'}
                </p>
              )}
            </div>
          </section>

          <section className="card chat-panel">
            <div className="chat-head">
              <h3>Chat</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setChatOpen((v) => !v)}>
                {chatOpen ? 'Hide' : `Show (${chat.length})`}
              </button>
            </div>
            {chatOpen && (
              <>
                <div className="chat-scroll">
                  {chat.length === 0 && (
                    <p className="muted">Ask the AI anything about the ongoing call…</p>
                  )}
                  {chat.map((m, i) => (
                    <div key={i} className={`chat-msg ${m.role === 'user' ? 'me' : 'ai'}`}>
                      {m.content}
                    </div>
                  ))}
                </div>
                <form
                  className="chat-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void sendChat();
                  }}
                >
                  <input
                    className="input"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Ask about the call…"
                  />
                  <button
                    className="btn btn-primary btn-sm"
                    type="submit"
                    disabled={chatStreaming || !chatInput.trim()}
                  >
                    Send
                  </button>
                </form>
              </>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
