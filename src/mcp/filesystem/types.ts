// src/mcp/filesystem/types.ts
/**
 * Types and error classes for the Filesystem MCP.
 */
export class FileMCPError extends Error {
  /** Unique error code for identifying the failure type */
  code: string;
  /** Optional extra details */
  details?: unknown;
  constructor(message: string, code: string, details?: unknown) {
    super(message);
    this.name = 'FileMCPError';
    this.code = code;
    this.details = details;
  }
}

/** Result of a file operation */
export interface FileOperationResult {
  /** Absolute path of the affected file */
  path: string;
  /** Indicates the operation succeeded */
  success: true;
}

/** Entry returned by listDirectory / searchFiles */
export interface DirectoryEntry {
  /** File or folder name */
  name: string;
  /** Absolute path */
  path: string;
  /** True if entry is a directory */
  isDirectory: boolean;
}

/** Options for path validation */
export interface ValidatePathOptions {
  /** Must the path exist? */
  mustExist?: boolean;
  /** Must be a file? */
  mustBeFile?: boolean;
  /** Must be a directory? */
  mustBeDirectory?: boolean;
}
