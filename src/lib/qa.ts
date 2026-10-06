/** Question detection for Auto Answer. */

const QUESTION_STARTERS = new RegExp(
  /^(what|whats|how|why|when|where|which|who|whose|could|can|would|will|do|does|did|are|is|was|were|have|has|tell|describe|explain|walk|give|share|talk|say|suppose|imagine|if)\b/i,
);

/**
 * Heuristic: does this transcript segment look like a question someone asked
 * the user? Deliberately cheap and a little permissive — the answer prompt
 * handles imperfect triggers gracefully.
 */
export function looksLikeQuestion(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (t.includes('?')) return true;
  return QUESTION_STARTERS.test(t) && t.split(/\s+/).length >= 4;
}
