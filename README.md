# Call Helper

An open-source, real-time call assistant — a self-hostable reimplementation of the core idea
behind [Parakeet AI](https://www.parakeet-ai.com/): it listens to your call, transcribes it live,
detects questions, and drafts answers with **your own AI provider**.

Independent project — not affiliated with Parakeet AI. MIT-licensed, no accounts, no credits,
no server: **bring your own provider, your keys never leave your browser.**

## Features

- **Live transcription** of both sides of the call — your microphone *and* the call's audio
  (via tab/screen sharing) — using either a Whisper-compatible API or Chrome's built-in
  speech recognition.
- **Auto Answer** — detects questions as they're asked and streams a drafted reply.
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
    audio.ts       mic + display capture; chunked MediaRecorder (self-contained blobs)
    transcribe.ts  Whisper endpoint client + Chrome WebSpeech engine
    engine.ts      per-source transcription pipelines for a live session
    llm.ts         streaming OpenAI-compatible chat client (SSE)
    prompts.ts     answer / chat / notes prompt builders
    qa.ts          question-detection heuristic for Auto Answer
    settings.ts    provider presets + local persistence
    storage.ts     session history in localStorage
    export.ts      markdown export
  components/      Home, SettingsView, SessionView (live call), ReviewView
```

Transcription chunks are self-contained files (the recorder restarts each cycle, because
MediaRecorder's timesliced chunks after the first are headerless and APIs can't decode
them). Answers stream over SSE and are rendered with a tiny built-in markdown renderer.

## Limitations & roadmap

- Speaker labels are by *source* (mic vs. call audio), not true diarization.
- Chrome desktop required for call-audio capture and the browser speech engine.
- Rough chunk boundaries can occasionally clip a word — increase chunk length for accuracy.
- Ideas welcome: Electron wrapper (true system-audio capture without tab sharing), PDF
  résumé parsing, WebSocket-based real-time providers, multi-language UI.

## License

[MIT](LICENSE)
