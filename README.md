# Call Helper

An open-source, real-time call assistant — a self-hostable reimplementation of the core idea
behind [Parakeet AI](https://www.parakeet-ai.com/): it listens to your call, transcribes it live,
detects questions, and drafts answers with **your own AI provider**.

Independent project — not affiliated with Parakeet AI. MIT-licensed, no accounts, no credits,
no server: **bring your own provider, your keys never leave your browser.**

## Features

- **Live captions, word by word** — both sides of the call (your microphone *and* the
  call's audio via tab/screen sharing) stream into the transcript as they're spoken,
  using a rolling-window pipeline over any Whisper-compatible API, or Chrome's built-in
  recognizer for the mic.
- **LLM question watcher** — a second, always-on LLM call reviews the transcript every
  few seconds and detects the latest *open* question from the other side (configurable
  to a small/cheap model).
- **Auto Answer** — when the watcher spots a question, a drafted reply streams in.
- **Answer now** — on-demand drafting of a response to the current exchange.
- **In-call chat** — ask the AI anything about the ongoing conversation.
- **Session context** — paste or attach a résumé/notes/playbook, plus free-form custom
  instructions and interview/regular-call modes.
- **AI notes** — post-call summary, questions asked, key points, next steps.
- **Session history** — past sessions with transcripts, notes, and markdown export.
- **Custom providers** — any OpenAI-compatible endpoint works (see below).

## Use responsibly

This tool is for calls where AI assistance is permitted — practice, accessibility,
note-taking, internal calls, and similar. It deliberately has **no stealth features**:
nothing here hides it from screen sharing, recording, or the other participants.
Using AI assistance where it is not allowed may violate interview policies, terms of
service, or the law — that's on you.

## Quick start

```bash
npm install
npm run dev
```

Open the printed URL (use `localhost` — microphone and screen capture require a secure
context). Then:

1. **Settings** → pick a provider preset (or "Custom…") and paste your API key → *Save*.
2. **Home** → choose a mode, optionally paste your résumé and instructions.
3. **Start session** → allow microphone; to hear the other side, pick the call's browser
   tab in Chrome's share dialog and tick **"Also share tab audio"** (or share the whole
   screen with "Share system audio" on Windows).

Works best in desktop Chrome. The free **browser engine** (mic-only, no API key) is a good
way to try it; the **Whisper engine** handles both audio sources.

## Providers

Call Helper speaks the **OpenAI-compatible protocol** (`/chat/completions`, `/models`,
`/audio/transcriptions`). Built-in presets:

| Provider | Base URL | Notes |
|---|---|---|
| OpenAI | `https://api.openai.com/v1` | chat + `whisper-1` / `gpt-4o-mini-transcribe` |
| Groq | `https://api.groq.com/openai/v1` | fast + cheap `whisper-large-v3` |
| OpenRouter | `https://openrouter.ai/api/v1` | hundreds of models behind one key |
| Together AI | `https://api.together.xyz/v1` | |
| LM Studio | `http://localhost:1234/v1` | fully local, no key |
| Ollama | `http://localhost:11434/v1` | fully local, no key |
| Custom | any OpenAI-compatible `/v1` | vLLM, LiteLLM, Azure gateways, … |

Anthropic's native API is not OpenAI-compatible; use it through OpenRouter or a compatible
gateway. Endpoints must allow browser (CORS) requests — hosted providers above and local
runtimes do.

**Privacy:** settings and session history live in your browser's local storage. Audio and
transcripts go only to the providers *you* configure. Nothing is ever sent anywhere else.

## Architecture

Deliberately boring: a fully static Vite + React + TypeScript SPA, no backend.

```
src/
  lib/
    audio.ts       mic + display capture; AudioWorklet ring buffer → 16 kHz mono
                   WAV windows of the last N seconds, re-sliced every 2 s
    streaming.ts   overlap-aligned merge of consecutive window transcriptions
                   into a live draft that rotates into committed segments
    transcribe.ts  Whisper endpoint client + Chrome WebSpeech engine (interims)
    engine.ts      per-source streaming pipelines for a live session
    watcher.ts     LLM call that spots open questions in the rolling transcript
    llm.ts         streaming OpenAI-compatible chat client (SSE)
    prompts.ts     answer / chat / notes prompt builders
    settings.ts    provider presets + local persistence
    storage.ts     session history in localStorage
    export.ts      markdown export
  components/      Home, SettingsView, SessionView (live call), ReviewView
```

**How live transcription works:** an AudioWorklet taps each audio source into a
ring buffer; every 2 seconds the last ~8 s (configurable) are encoded as WAV and
transcribed. Consecutive windows overlap, and a word-level alignment (tail of the
previous result ↔ head of the next) appends only genuinely new words to a live
draft — so words appear ~2 s after being spoken, with any provider. The draft
rotates into the permanent transcript as it ages. The question watcher runs
separately every ~5 s; point it at a small model in Settings to keep it cheap.

## Limitations & roadmap

- Speaker labels are by *source* (mic vs. call audio), not true diarization.
- Chrome desktop required for call-audio capture and the browser speech engine.
- The overlap merge is heuristic — occasional repeated or clipped words at window
  boundaries; longer windows reduce this (at proportionally higher cost, since each
  tick re-transcribes the whole window: ≈ window÷2 × the provider's audio rate).
- Ideas welcome: WebSocket streaming-ASR providers (Deepgram, OpenAI Realtime) for
  provider-side partials, an Electron wrapper for system-audio capture without tab
  sharing, PDF résumé parsing, multi-language UI.

## License

[MIT](LICENSE)
