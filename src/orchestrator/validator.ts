// src/orchestrator/validator.ts

import * as fs from 'fs';
import * as crypto from 'crypto';
import { retry as baseRetry, type RetryOptions } from '../utils/retry.js';
import { browserSessionManager } from '../mcp/browser/sessionManager.js';

export class ValidationError extends Error {
  /** ISO timestamp when the error was instantiated */
  public readonly timestamp: string = new Date().toISOString();
  public stepId?: string;
  public errorType: string;
  public compensationActions?: string[];

  constructor(options: {
    message: string;
    errorType: string;
    stepId?: string;
    compensationActions?: string[];
  }) {
    super(options.message);
    this.name = 'ValidationError';
    this.stepId = options.stepId;
    this.errorType = options.errorType;
    this.compensationActions = options.compensationActions;
  }
}

export function validateStep(stepId: string, args: Record<string, unknown>): void {
  if (!stepId) {
    throw new ValidationError({
      message: 'Step ID is required',
      errorType: 'INVALID_STEP_ID',
    });
  }
  if (!args) {
    throw new ValidationError({
      message: 'Step arguments are required',
      errorType: 'INVALID_STEP_ARGS',
      stepId,
    });
  }
}

interface SuccessResult {
  success: boolean;
  [key: string]: any;
}

/** Asserts that the result success flag is true */
export function validateSuccess(result: SuccessResult, stepId?: string): void {
  if (!result || result.success !== true) {
    throw new ValidationError({
      message: 'Operation reported success: false',
      errorType: 'SUCCESS_VALIDATION_FAILED',
      stepId,
      compensationActions: ['retry', 'rollback'],
    });
  }
}

/** Asserts that an artifact file exists and matches the optional checksum */
export function validateArtifact(
  filePath: string,
  options?: { expectedChecksum?: string; algorithm?: string; stepId?: string }
): void {
  if (!fs.existsSync(filePath)) {
    throw new ValidationError({
      message: `Artifact file '${filePath}' does not exist`,
      errorType: 'ARTIFACT_MISSING',
      stepId: options?.stepId,
      compensationActions: ['recreate_artifact'],
    });
  }

  if (options?.expectedChecksum) {
    try {
      const algorithm = options.algorithm || 'sha256';
      const fileBuffer = fs.readFileSync(filePath);
      const hashSum = crypto.createHash(algorithm);
      hashSum.update(fileBuffer);
      const hex = hashSum.digest('hex');

      if (hex !== options.expectedChecksum) {
        throw new ValidationError({
          message: `Artifact checksum mismatch. Expected ${options.expectedChecksum}, got ${hex}`,
          errorType: 'CHECKSUM_MISMATCH',
          stepId: options.stepId,
          compensationActions: ['regenerate_artifact'],
        });
      }
    } catch (err: any) {
      if (err instanceof ValidationError) throw err;
      throw new ValidationError({
        message: `Failed to calculate artifact checksum: ${err.message}`,
        errorType: 'CHECKSUM_CALCULATION_FAILED',
        stepId: options?.stepId,
      });
    }
  }
}

/** Asserts that the current browser page state satisfies a predicate */
export async function validateBrowserState(
  tabId: string,
  predicate: (page: any) => Promise<boolean> | boolean,
  stepId?: string
): Promise<void> {
  const page = browserSessionManager.getPage(tabId);
  if (!page) {
    throw new ValidationError({
      message: `Browser page for tab '${tabId}' not found`,
      errorType: 'BROWSER_PAGE_NOT_FOUND',
      stepId,
      compensationActions: ['reopen_tab'],
    });
  }

  try {
    const passed = await predicate(page);
    if (!passed) {
      throw new ValidationError({
        message: 'Browser state predicate returned false',
        errorType: 'BROWSER_STATE_PREDICATE_FAILED',
        stepId,
        compensationActions: ['reload_page', 'navigate_back'],
      });
    }
  } catch (err: any) {
    if (err instanceof ValidationError) throw err;
    throw new ValidationError({
      message: `Browser state validation error: ${err.message}`,
      errorType: 'BROWSER_STATE_EVALUATION_FAILED',
      stepId,
    });
  }
}

/** Re-export the retry function from utils/retry */
export async function retry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions
): Promise<T> {
  return baseRetry(fn, options);
}
