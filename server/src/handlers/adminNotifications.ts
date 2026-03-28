import { Request, Response } from "express";
import {
  createNotification,
  listNotifications,
  markAsRead,
  markAllAsRead,
  registerSseClient,
} from "../services/notificationService";

// ── Auth helper (same pattern as other admin handlers) ─────────────────────

function requireAdminToken(req: Request, res: Response): boolean {
  const token = req.header("x-admin-token");
  const expected = process.env.FLUID_ADMIN_TOKEN;
  if (!expected || token !== expected) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

// ── Handlers ───────────────────────────────────────────────────────────────

/**
 * GET /admin/notifications
 * Returns the last 20 notifications, newest first.
 */
export async function listNotificationsHandler(
  req: Request,
  res: Response
): Promise<void> {
  if (!requireAdminToken(req, res)) return;
  try {
    const notifications = await listNotifications(20);
    res.json({ notifications });
  } catch {
    res.status(500).json({ error: "Failed to list notifications" });
  }
}

/**
 * POST /admin/notifications
 * Create a notification manually (or from internal services).
 * Body: { type, title, message, metadata? }
 */
export async function createNotificationHandler(
  req: Request,
  res: Response
): Promise<void> {
  if (!requireAdminToken(req, res)) return;

  const { type, title, message, metadata } = req.body ?? {};

  if (
    typeof type !== "string" ||
    typeof title !== "string" ||
    typeof message !== "string"
  ) {
    res.status(400).json({ error: "type, title and message are required" });
    return;
  }

  const validTypes = ["low_balance", "incident", "info", "warning", "critical"];
  if (!validTypes.includes(type)) {
    res.status(400).json({ error: `type must be one of: ${validTypes.join(", ")}` });
    return;
  }

  try {
    const notification = await createNotification({
      type: type as any,
      title,
      message,
      metadata: typeof metadata === "object" ? metadata : undefined,
    });
    res.status(201).json({ notification });
  } catch {
    res.status(500).json({ error: "Failed to create notification" });
  }
}

/**
 * PATCH /admin/notifications/:id/read
 * Mark a single notification as read.
 */
export async function markReadHandler(
  req: Request,
  res: Response
): Promise<void> {
  if (!requireAdminToken(req, res)) return;
  const { id } = req.params;
  if (!id) {
    res.status(400).json({ error: "id is required" });
    return;
  }
  try {
    const updated = await markAsRead(id);
    if (!updated) {
      res.status(404).json({ error: "Notification not found" });
      return;
    }
    res.json({ notification: updated });
  } catch {
    res.status(500).json({ error: "Failed to mark notification as read" });
  }
}

/**
 * PATCH /admin/notifications/read-all
 * Mark all notifications as read.
 */
export async function markAllReadHandler(
  req: Request,
  res: Response
): Promise<void> {
  if (!requireAdminToken(req, res)) return;
  try {
    const count = await markAllAsRead();
    res.json({ message: `${count} notification(s) marked as read`, count });
  } catch {
    res.status(500).json({ error: "Failed to mark all notifications as read" });
  }
}

/**
 * GET /admin/notifications/sse
 * Server-Sent Events stream. Clients receive real-time notification events.
 * Events emitted:
 *   - "notification" — when a new notification is created
 *   - "read-all"     — when all notifications are marked read
 */
export function notificationSseHandler(req: Request, res: Response): void {
  if (!requireAdminToken(req, res)) return;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // Send a "connected" heartbeat so the client knows the stream is live
  res.write("event: connected\ndata: {}\n\n");

  // Keep-alive ping every 20 seconds to prevent proxy timeouts
  const keepAlive = setInterval(() => {
    try {
      res.write(": keep-alive\n\n");
    } catch {
      clearInterval(keepAlive);
    }
  }, 20_000);

  registerSseClient(res);

  req.on("close", () => clearInterval(keepAlive));
}
