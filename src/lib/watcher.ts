import type { LLMSettings, TranscriptSegment } from '../types';
import { streamChat } from './llm';

const SYSTEM_PROMPT = [
  'You monitor the rolling transcript of a live call in real time.',
  'Lines starting with [Them] are spoken by the other participants; lines starting with [You] are the user\'s own words.',
  'The transcript is live and may cut off mid-sentence — judge intent, not completeness.',
  'Your single job: find the most recent question asked BY [Them] that the user has NOT yet answered.',
  'If the latest [Them] utterance is a question (even an unfinished one), that is the one — reply with it verbatim, exactly as written, and nothing else.',
  'If there is no open question from [Them] (none was asked, or the user already answered it), reply exactly: NONE',
  'Questions the user asked of them do not count.',
].join('\n');

/**
 * Ask the watcher LLM whether there is an open question for the user in the
 * recent transcript. Returns the question text, or null if there is none.
 */
export async function detectOpenQuestion(
  llm: LLMSettings,
  segments: TranscriptSegment[],
  signal?: AbortSignal,
): Promise<string | null> {
  const lines = segments
    .slice(-30)
    .map((s) => `[${s.source === 'mic' ? 'You' : 'Them'}] ${s.text}`)
    .join('\n');
  if (!lines.trim()) return null;

  let out = '';
  for await (const delta of streamChat(llm, [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: lines },
  ], signal)) {
    out += delta;
  }
  const text = out.trim().replace(/^["“”']+|["“”']+$/g, '').trim();
  if (!text || /^none\b/i.test(text)) return null;
  return text;
}

/** Loose comparison so a re-detected repeat of the same question is ignored. */
export function sameQuestion(a: string, b: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N} ]/gu, '')
      .split(/\s+/)
      .filter(Boolean)
      .join(' ');
  return norm(a) === norm(b);
}
