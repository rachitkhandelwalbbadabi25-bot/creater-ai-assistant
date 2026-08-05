// src/mcp/os/types.ts

export class OsMCPError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = 'OsMCPError';
  }
}

export interface OsMCPResult<T = void> {
  success: boolean;
  data?: T;
  error?: string;
}
