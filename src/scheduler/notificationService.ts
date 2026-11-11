// ════════════════════════════════════════════════════════════════════════════════
// src/scheduler/notificationService.ts — Unified Notification Delivery Service
// ════════════════════════════════════════════════════════════════════════════════

import { createLogger } from "@utils/logger.js";
import { notifications as osNotifications } from "../mcp/os/osOps.js";

const log = createLogger("scheduler/notificationService");

export interface NotificationPayload {
  title: string;
  body: string;
  reminderTitle?: string;
  scheduledAt?: string | number;
  jobId?: string;
  occurrenceKey?: string;
  isOverdue?: boolean;
  metadata?: Record<string, unknown>;
}

export interface NotificationDeliveryResult {
  success: boolean;
  channel: "desktop_toast" | "in_app" | "mock";
  deliveredAt: number;
  error?: string;
}

export type NotificationAdapter = (payload: NotificationPayload) => Promise<NotificationDeliveryResult>;

export type InAppNotificationListener = (payload: NotificationPayload) => void;

/** Injectable adapter for tests; defaults to null (which uses real desktop toasts) */
let customAdapter: NotificationAdapter | null = null;

/** In-app notification listeners (for TUI, Web UI, etc.) */
const inAppListeners = new Set<InAppNotificationListener>();

/** Ring buffer of recent notifications delivered in-memory */
const notificationHistory: Array<NotificationPayload & { deliveredAt: number; success: boolean }> = [];
const MAX_HISTORY = 100;

/**
 * Configure an injectable notification adapter (e.g., for automated tests).
 * Pass `null` to restore the production desktop toast adapter.
 */
export function setNotificationAdapter(adapter: NotificationAdapter | null): void {
  customAdapter = adapter;
  log.info(`Notification adapter set to ${adapter ? "CUSTOM/MOCK" : "DEFAULT (Desktop Toast)"}`);
}

/**
 * Returns the currently active notification adapter.
 */
export function getNotificationAdapter(): NotificationAdapter | null {
  return customAdapter;
}

/**
 * Subscribes an in-app listener (e.g. TUI or Web UI) to receive notifications.
 * Returns an unsubscribe callback.
 */
export function onInAppNotification(listener: InAppNotificationListener): () => void {
  inAppListeners.add(listener);
  return () => {
    inAppListeners.delete(listener);
  };
}

/**
 * Returns recent notifications for inspection or UI display.
 */
export function getRecentNotifications(): Array<NotificationPayload & { deliveredAt: number; success: boolean }> {
  return [...notificationHistory];
}

/**
 * Clears the in-memory notification history.
 */
export function clearNotificationHistory(): void {
  notificationHistory.length = 0;
}

/**
 * Delivers a notification to the user via desktop toast and active in-app listeners.
 */
export async function deliverNotification(payload: NotificationPayload): Promise<NotificationDeliveryResult> {
  const now = Date.now();
  log.info(`Delivering notification: [${payload.title}] "${payload.body}"`);

  // If a custom or mock adapter is active (e.g. in test suites), delegate to it
  if (customAdapter) {
    try {
      const res = await customAdapter(payload);
      notificationHistory.push({ ...payload, deliveredAt: now, success: res.success });
      if (notificationHistory.length > MAX_HISTORY) notificationHistory.shift();

      // Also trigger in-app listeners
      for (const listener of inAppListeners) {
        try {
          listener(payload);
        } catch (e: any) {
          log.warn("In-app notification listener error:", e);
        }
      }

      return res;
    } catch (err: any) {
      log.error(`Custom notification adapter threw error: ${err.message}`);
      return {
        success: false,
        channel: "mock",
        deliveredAt: now,
        error: err.message || String(err),
      };
    }
  }

  // Default production delivery: Windows Desktop Toast via OS MCP
  let toastSuccess = false;
  let toastError: string | undefined;

  try {
    toastSuccess = await osNotifications(payload.title, payload.body);
  } catch (err: any) {
    toastError = err.message || String(err);
    log.warn(`OS Desktop toast failed: ${toastError}`);
  }

  // Also broadcast to any active in-app listeners (TUI, Web UI, etc.)
  for (const listener of inAppListeners) {
    try {
      listener(payload);
    } catch (e: any) {
      log.warn("In-app notification listener error:", e);
    }
  }

  const success = toastSuccess || inAppListeners.size > 0;
  notificationHistory.push({ ...payload, deliveredAt: now, success });
  if (notificationHistory.length > MAX_HISTORY) notificationHistory.shift();

  return {
    success: true,
    channel: toastSuccess ? "desktop_toast" : "in_app",
    deliveredAt: now,
    error: toastError,
  };
}
