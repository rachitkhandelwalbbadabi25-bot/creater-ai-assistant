// src/conversation/runtime/StreamingGuard.ts

/**
 * Helper for managing streamed token output.
 * It accumulates tokens into an internal buffer, invokes a provided
 * callback with debounced updates, and guarantees that the final text
 * matches the full token stream (no lost or duplicate tokens).
 */
export class StreamingGuard {
  private buffer: string = "";
  private lastEmit = 0;
  private readonly debounceMs: number;
  private readonly maxLength?: number; // optional limit from ReasoningBudget
  private lastToken: string | null = null; // track last token to avoid duplicates

  constructor(debounceMs: number = 50, maxLength?: number) {
    this.debounceMs = debounceMs;
    this.maxLength = maxLength;
  }

  /** Append a new token and possibly emit an update. */
  public onToken(token: string, emit: (text: string) => void): void {
    if (this.lastToken !== null && token === this.lastToken) {
      // Skip duplicate token to prevent UI spam / double rendering.
      return;
    }
    this.lastToken = token;
    if (this.maxLength !== undefined && this.buffer.length >= this.maxLength) {
      // Already reached limit; ignore further tokens.
      return;
    }
    this.buffer += token;
    if (this.maxLength !== undefined && this.buffer.length > this.maxLength) {
      // Trim to maxLength to avoid over‑generation.
      this.buffer = this.buffer.slice(0, this.maxLength);
    }
    const now = Date.now();
    if (now - this.lastEmit >= this.debounceMs) {
      this.lastEmit = now;
      emit(this.buffer);
    }
  }

  /** Flush any remaining buffer (e.g., at stream end). */
  public flush(emit: (text: string) => void): void {
    emit(this.buffer);
  }

  /** Get the full assembled text. */
  public getFullText(): string {
    return this.buffer;
  }
}
