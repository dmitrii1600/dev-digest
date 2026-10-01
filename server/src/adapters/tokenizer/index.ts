/**
 * tokenizer adapter — token counter for the repo-map budget search (T3).
 *
 * The repo-map renderer (pipeline/repo-map.ts) binary-searches the largest set
 * of symbols that fits a token budget; that loop calls `count()` ≤ ~13 times.
 *
 * Default impl: js-tiktoken `cl100k_base` (pure-JS, no natives). The encoder is
 * lazy-initialised (loading the BPE ranks is the heavy part) and any failure
 * falls back to the `ceil(chars / 4)` heuristic — the renderer must never throw.
 *
 * Scope: in-process. Originally repo-intel-only; also used by modules/reviews
 * for per-slot prompt-token accounting (the skills block's token count in the
 * run trace). Swappable in tests via a mock counter (ContainerOverrides.tokenizer).
 */
import { getEncoding, type Tiktoken } from 'js-tiktoken';

export interface Tokenizer {
  count(text: string): number;
}

/** Heuristic fallback used before/instead of a real encoder. */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * js-tiktoken's BPE merge is super-linear on a single whitespace-free piece
 * (a base64 blob, a minified line). Such text is encoded in bounded slices to keep
 * the cost near-linear; the count differs slightly at slice seams.
 */
const ENCODE_SLICE_CHARS = 64;
/** Only text with a whitespace-free run this long is sliced; ordinary prose is encoded whole. */
const LONG_PIECE = /\S{512,}/;

export class TiktokenTokenizer implements Tokenizer {
  private enc?: Tiktoken;
  private broken = false;

  count(text: string): number {
    if (this.broken) return approxTokens(text);
    try {
      this.enc ??= getEncoding('cl100k_base');
      const enc = this.enc;
      if (!LONG_PIECE.test(text)) return enc.encode(text).length;
      let total = 0;
      for (let i = 0; i < text.length; i += ENCODE_SLICE_CHARS) {
        total += enc.encode(text.slice(i, i + ENCODE_SLICE_CHARS)).length;
      }
      return total;
    } catch {
      // BPE load failed once — don't retry per call; stick to the heuristic.
      this.broken = true;
      return approxTokens(text);
    }
  }
}
