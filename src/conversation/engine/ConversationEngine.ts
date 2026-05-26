// packages/convo/src/engine/ConversationEngine.ts

/**
 * Phase‑1 ConversationEngine – deterministic, self‑contained.
 * It wires together the lightweight building blocks that already exist in the
 * `convo` package:
 *   - InputUnderstandingLayer (normalises raw text)
 *   - IntentDetector (keyword‑based detection)
 *   - ConversationStateEngine (in‑memory turn store)
 *   - ResponseStrategySelector (maps intent → static payload)
 *   - PersonalityRenderer (applies tone/style)
 *
 * The engine is deliberately synchronous/async‑ready so later phases can replace
 * any component with an LLM call without changing the public API.
 */

import { UserMessage, RenderedResponse, Intent, ResponseStrategy, PersonalityProfile } from "../types";
import { InputUnderstandingLayer } from "../input/InputUnderstandingLayer";
import { IntentDetector } from "../intent/IntentDetector";
import { ConversationStateEngine } from "../state/ConversationStateEngine";
import { ResponseStrategySelector } from "../strategy/ResponseStrategySelector";
import { PersonalityRenderer } from "../personality/PersonalityRenderer";
import { ContextPrioritizationEngine } from "../memory/ContextPrioritizationEngine";

export class ConversationEngine {
  private readonly inputLayer: InputUnderstandingLayer;
  private readonly intentDetector: IntentDetector;
  private readonly stateEngine: ConversationStateEngine;
  private readonly selector: ResponseStrategySelector;
  private readonly renderer: PersonalityRenderer;

  constructor() {
    // Phase‑1 uses the default implementations – no external config needed.
    this.inputLayer = new InputUnderstandingLayer();
    this.intentDetector = new IntentDetector();
    this.stateEngine = new ConversationStateEngine();
    this.selector = new ResponseStrategySelector();
    this.renderer = new PersonalityRenderer();
  }

  /**
   * Process a single user turn and return a fully rendered response.
   * The method is async to stay compatible with future async components.
   */
  async processTurn(message: UserMessage): Promise<RenderedResponse> {
    // Normalise the incoming text.
    const normalized = this.inputLayer.process(message.text);

    // Retrieve or initialise conversation state for this user.
    let state = this.stateEngine.getState(message.id);
    if (!state) {
      state = this.stateEngine.initState(message.id, { ...message, text: normalized });
    } else {
      // Update the lastMessage with the newly normalised text.
      state.lastMessage = { ...message, text: normalized };
    }

    // Detect intent.
    const intent: Intent = this.intentDetector.detect(normalized);

    // Store intent in state (creates a new turn id).
    const updatedState: ConversationState = this.stateEngine.updateIntent(state, intent);

    // ----- Context prioritization -----
    // Generate a list of prioritized context windows.
    const prioritized = ContextPrioritizationEngine.prioritize(updatedState);
    // Convert to ActiveContext shape (id + relevance score).
    const activeContexts = prioritized.map((w) => ({ id: w.id, relevance: w.relevanceScore ?? 0 }));
    // Merge into state for downstream components.
    const stateWithContext = { ...updatedState, activeContexts };

    // Choose a response strategy based on intent and optional personality.
    const strategy: ResponseStrategy = this.selector.select(intent, stateWithContext.personality);

    // In Phase‑1 the payload is a plain string.
    const raw = typeof strategy.payload === "string" ? strategy.payload : "";

    // Apply personality tone / style.
    const finalText = this.renderer.render(raw, stateWithContext.personality);

    // Return the final response object.
    return { text: finalText };
  }
    // Normalise the incoming text.
    const normalized = this.inputLayer.process(message.text);

    // Retrieve or initialise conversation state for this user.
    let state = this.stateEngine.getState(message.id);
    if (!state) {
      state = this.stateEngine.initState(message.id, { ...message, text: normalized });
    } else {
      // Update the lastMessage with the newly normalised text.
      state.lastMessage = { ...message, text: normalized };
    }

    // Detect intent.
    const intent: Intent = this.intentDetector.detect(normalized);

    // Store intent in state (creates a new turn id).
    const updatedState: ConversationState = this.stateEngine.updateIntent(state, intent);

    // Choose a response strategy based on intent and optional personality.
    const strategy: ResponseStrategy = this.selector.select(intent, updatedState.personality);

    // In Phase‑1 the payload is a plain string.
    const raw = typeof strategy.payload === "string" ? strategy.payload : "";

    // Apply personality tone / style.
    const finalText = this.renderer.render(raw, updatedState.personality);

    // Return the final response object.
    return { text: finalText };
  }
}
