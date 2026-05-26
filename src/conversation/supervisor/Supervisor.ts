import { UserMessage, RenderedResponse } from '../types';
import { ConversationEngine } from '../engine/ConversationEngine';

/**
 * Supervisor – entry point for a single user turn.
 * It holds a single instance of ConversationEngine (stateless) and delegates
 * the processing of a raw {@link UserMessage} to it, returning a fully
 * rendered {@link RenderedResponse}.
 */
export class Supervisor {
  private readonly engine: ConversationEngine;

  constructor() {
    this.engine = new ConversationEngine();
  }

  /**
   * Process a user message through the full Phase‑1 pipeline.
   * The method is async because every sub‑module could become async
   * (e.g., LLM calls) in later phases.
   */
  async handleMessage(message: UserMessage): Promise<RenderedResponse> {
    // The engine fully orchestrates the flow and returns the final response.
    return this.engine.processTurn(message);
  }
}
