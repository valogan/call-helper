import type { Session } from '../types';
import { formatDuration } from './format';

const SPEAKER_LABEL: Record<Session['segments'][number]['source'], string> = {
  mic: 'You',
  system: 'Them',
};

function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export function sessionToMarkdown(session: Session): string {
  const lines: string[] = [];
  lines.push(`# ${session.title}`);
  lines.push('');
  lines.push(
    `- **Date:** ${new Date(session.createdAt).toLocaleString()}`,
    `- **Mode:** ${session.mode === 'interview' ? 'Interview' : 'Call'}`,
    `- **Duration:** ${formatDuration(session.createdAt, session.endedAt)}`,
  );
  if (session.context.trim()) {
    lines.push('', '## Context provided', '', '```', session.context.trim(), '```');
  }
  lines.push('', '## Transcript', '');
  for (const seg of session.segments) {
    lines.push(`**[${clock(seg.atMs)}] ${SPEAKER_LABEL[seg.source]}:** ${seg.text}`);
  }
  if (session.answers.length) {
    lines.push('', '## Answers given', '');
    for (const a of session.answers) {
      lines.push(`### ${clock(a.atMs)} — ${a.trigger === 'auto' ? 'Auto' : 'Manual'}`);
      lines.push('', `> ${a.question}`, '', a.answer, '');
    }
  }
  if (session.notes?.trim()) {
    lines.push('', '## Notes', '', session.notes.trim(), '');
  }
  return lines.join('\n');
}

export function downloadSession(session: Session): void {
  const blob = new Blob([sessionToMarkdown(session)], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date(session.createdAt).toISOString().slice(0, 10);
  a.href = url;
  a.download = `call-helper-${stamp}-${session.id.slice(0, 6)}.md`;
  a.click();
  URL.revokeObjectURL(url);
}
