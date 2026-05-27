// src/conversation/engine/ConversationEngine.ts

/**
 * Phase‑1 ConversationEngine – deterministic, self‑contained.
 * It wires together lightweight building blocks and now includes
 * response quality guards and safe streaming support.
 */

import {
  UserMessage,
  RenderedResponse,
  Intent,
  ResponseStrategy,
  PersonalityProfile,
  ConversationState,
  ReasoningBudget,
  ActiveContext,
} from "../types";
import { InputUnderstandingLayer } from "../input/InputUnderstandingLayer";
import { IntentDetector } from "../intent/IntentDetector";
import { ConversationStateEngine } from "../state/ConversationStateEngine";
import { ResponseStrategySelector } from "../strategy/ResponseStrategySelector";
import { PersonalityRenderer } from "../personality/PersonalityRenderer";
import { ContextPrioritizationEngine } from "../memory/ContextPrioritizationEngine";
import { chatStream } from "../../llm/client";
import { QualityGuard } from "../runtime/QualityGuard";
import { StreamingGuard } from "../runtime/StreamingGuard";

export class ConversationEngine {
  private readonly inputLayer: InputUnderstandingLayer;
  private readonly intentDetector: IntentDetector;
  private readonly stateEngine: ConversationStateEngine;
  private readonly selector: ResponseStrategySelector;
  private readonly renderer: PersonalityRenderer;

  constructor() {
    this.inputLayer = new InputUnderstandingLayer();
    this.intentDetector = new IntentDetector();
    this.stateEngine = new ConversationStateEngine();
    this.selector = new ResponseStrategySelector();
    this.renderer = new PersonalityRenderer();
  }

  /** Process a single user turn synchronously (static payload). */
  async processTurn(message: UserMessage): Promise<RenderedResponse> {
    const state = this.prepareState(message);
    const intent = this.intentDetector.detect(state.lastMessage.text);
    const updated = this.stateEngine.updateIntent(state, intent);
    const prioritizationEngine = new ContextPrioritizationEngine();
    const prioritized = prioritizationEngine.prioritize(updated);
    const activeContexts = prioritized.map((w) => ({
      id: w.id,
      relevance: (w as any).relevanceScore ?? 0,
    }));
    const stateWithContext = { ...updated, activeContexts };
    const strategy: ResponseStrategy = this.selector.select(intent, undefined);
    const raw = typeof strategy.payload === "string" ? strategy.payload : "";
    const refined = QualityGuard.apply(raw, stateWithContext.reasoningBudget);
    const finalText = this.renderer.render(refined, stateWithContext.personality);
    return { text: finalText };
  }

  /** Process a turn with streaming LLM output.
   * `onPartial` receives debounced incremental text for UI rendering.
   */
  async processTurnStreaming(
    message: UserMessage,
    onPartial: (text: string) => void
  ): Promise<RenderedResponse> {
    const state = this.prepareState(message);
    const intent = this.intentDetector.detect(state.lastMessage.text);
    const updated = this.stateEngine.updateIntent(state, intent);
    const prioritizationEngine = new ContextPrioritizationEngine();
    const prioritized = prioritizationEngine.prioritize(updated);
    const activeContexts = prioritized.map((w) => ({
      id: w.id,
      relevance: (w as any).relevanceScore ?? 0,
    }));
    const stateWithContext = { ...updated, activeContexts };

    const strategy: ResponseStrategy = this.selector.select(intent, undefined);
    const maxLen = stateWithContext.reasoningBudget?.maxResponseLength;
    const streamingGuard = new StreamingGuard(undefined, maxLen);
    await chatStream(
      {
        model: (strategy as any).model ?? "default",
        messages: [{ role: "user", content: stateWithContext.lastMessage.text }],
      },
      (token) => streamingGuard.onToken(token, onPartial)
    );
    streamingGuard.flush(onPartial);
    const raw = streamingGuard.getFullText();
    const cleaned = QualityGuard.apply(raw, stateWithContext.reasoningBudget);
    const finalText = this.renderer.render(cleaned, stateWithContext.personality);
    return { text: finalText };
  }

  /** Helper to initialise or retrieve conversation state and normalise input. */
  private prepareState(message: UserMessage): ConversationState {
    const normalized = this.inputLayer.process(message.text);
    let state = this.stateEngine.getState(message.id);
    if (!state) {
      state = this.stateEngine.initState(message.id, { ...message, text: normalized });
    } else {
      state.lastMessage = { ...message, text: normalized };
    }
    return state;
  }
}
