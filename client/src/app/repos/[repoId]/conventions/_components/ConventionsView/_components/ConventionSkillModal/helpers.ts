/** Rough token estimate for the body counter (`length / 4`); the trace counts for real. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
