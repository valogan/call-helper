import type { SessionDraft, TranscriptSegment } from '../types';
import type { ChatMessage } from './llm';

const SPEAKER_LABEL: Record<TranscriptSegment['source'], string> = {
  mic: 'You',
  system: 'Them',
};

export function transcriptBlock(segments: TranscriptSegment[], windowSize = 20): string {
  return segments
    .slice(-windowSize)
    .map((s) => `[${SPEAKER_LABEL[s.source]}] ${s.text}`)
    .join('\n');
}

export function systemPrompt(draft: Pick<SessionDraft, 'mode' | 'instructions' | 'context'>): string {
  const role =
    draft.mode === 'interview'
      ? 'This is a job interview. Answer as the candidate: first person, confident, concrete. Use the context below (résumé/notes) when relevant.'
      : 'This is a regular call. Be a knowledgeable, helpful partner for the user.';

  return [
    'You are a real-time assistant helping the user during a live call. You see the conversation as a rolling transcript and draft responses on the user\'s behalf.',
    'Style: concise and natural — the user will read your answer aloud or paraphrase it. Lead with the answer. Stay under ~120 words unless the question calls for detail or code. Never mention being an AI or reading a transcript.',
    role,
    draft.instructions.trim() ? `\nUser's custom instructions (follow these closely):\n${draft.instructions.trim()}` : '',
    draft.context.trim() ? `\nContext about the user (résumé/notes):\n"""\n${draft.context.trim()}\n"""` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function answerMessages(
  draft: Pick<SessionDraft, 'mode' | 'instructions' | 'context'>,
  segments: TranscriptSegment[],
  trigger: 'auto' | 'manual',
): ChatMessage[] {
  const transcript = transcriptBlock(segments);
  const ask =
    trigger === 'auto'
      ? 'A question was just asked on the call. Draft the user\'s answer to it.'
      : 'The user pressed "Answer now". Respond to the most recent exchange on the call.';
  return [
    { role: 'system', content: systemPrompt(draft) },
    { role: 'user', content: `Recent transcript:\n${transcript || '(nothing captured yet)'}\n\n${ask}` },
  ];
}

export function chatMessages(
  draft: Pick<SessionDraft, 'mode' | 'instructions' | 'context'>,
  segments: TranscriptSegment[],
  history: ChatMessage[],
  userMessage: string,
): ChatMessage[] {
  return [
    { role: 'system', content: systemPrompt(draft) },
    { role: 'user', content: `Recent call transcript for context:\n${transcriptBlock(segments) || '(nothing captured yet)'}` },
    ...history.slice(-10),
    { role: 'user', content: userMessage },
  ];
}

export function notesMessages(
  draft: Pick<SessionDraft, 'mode' | 'instructions' | 'context'>,
  segments: TranscriptSegment[],
): ChatMessage[] {
  return [
    {
      role: 'system',
      content:
        'You write concise, well-structured call notes. Output GitHub-flavored markdown only — no preamble.',
    },
    {
      role: 'user',
      content: [
        `Full transcript of a ${draft.mode === 'interview' ? 'job interview' : 'call'} the user just finished:`,
        '"""',
        segments.map((s) => `[${SPEAKER_LABEL[s.source]}] ${s.text}`).join('\n') || '(empty)',
        '"""',
        '',
        'Write notes with exactly these markdown sections:',
        '## Summary — 3–6 sentences on how the call went.',
        '## Questions asked — every distinct question asked of the user, as a list.',
        '## Key points — the user\'s strongest statements and moments, as a list.',
        '## Next steps — concrete follow-ups, as a list (say "None identified" if empty).',
      ].join('\n'),
    },
  ];
}
