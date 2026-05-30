import type { ToolResult } from "../toolResult.ts";

export type BrowserWorkerAction =
  | "navigate"
  | "extractText"
  | "screenshot"
  | "closeBrowser"
  | "testBrowserExecution"
  | "testRawBrowserLaunch"
  | "clickAt"
  | "clickSelector"
  | "rightClick"
  | "scrollPage"
  | "hoverAt"
  | "typeText"
  | "pressKey"
  | "keyboardShortcut"
  | "getPageText"
  | "getPageTitle"
  | "findElement"
  | "fillForm"
  | "selectDropdown"
  | "waitForElement";

export interface BrowserWorkerRequest {
  id: string;
  action: BrowserWorkerAction;
  params?: Record<string, unknown>;
}

export interface BrowserWorkerResponse {
  id: string;
  result?: ToolResult;
  error?: string;
}
