import type { Response } from "express";
import prisma from "../utils/db";

// ── Types ──────────────────────────────────────────────────────────────────

export interface AdminNotification {
  id: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  metadata?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateNotificationInput {
  type: "low_balance" | "incident" | "info" | "warning" | "critical";
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
}

// ── SSE client registry ────────────────────────────────────────────────────

const sseClients = new Set<Response>();

function broadcast(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

// ── Typed model accessor (same pattern as adminDeviceTokens.ts) ────────────

const notificationModel = (prisma as any).adminNotification as {
  findMany: (args: any) => Promise<AdminNotification[]>;
  findUnique: (args: any) => Promise<AdminNotification | null>;
  create: (args: any) => Promise<AdminNotification>;
  update: (args: any) => Promise<AdminNotification>;
  updateMany: (args: any) => Promise<{ count: number }>;
  count: (args: any) => Promise<number>;
};

// ── Public service API ─────────────────────────────────────────────────────

/**
 * Persist a notification to the DB and broadcast it to all connected SSE clients.
 */
export async function createNotification(
  input: CreateNotificationInput
): Promise<AdminNotification> {
  const notification = await notificationModel.create({
    data: {
      type: input.type,
      title: input.title,
      message: input.message,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    },
  });

  broadcast("notification", {
    id: notification.id,
    type: notification.type,
    title: notification.title,
    message: notification.message,
    read: notification.read,
    metadata: notification.metadata,
    createdAt: notification.createdAt,
    updatedAt: notification.updatedAt,
  });

  return notification;
}

/**
 * Return the last `limit` notifications ordered by newest first.
 */
export async function listNotifications(
  limit = 20
): Promise<AdminNotification[]> {
  return notificationModel.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

/**
 * Count unread notifications.
 */
export async function countUnread(): Promise<number> {
  return notificationModel.count({ where: { read: false } });
}

/**
 * Mark a single notification as read.
 */
export async function markAsRead(id: string): Promise<AdminNotification | null> {
  const existing = await notificationModel.findUnique({ where: { id } });
  if (!existing) return null;
  return notificationModel.update({ where: { id }, data: { read: true } });
}

/**
 * Mark all notifications as read. Returns the count updated.
 */
export async function markAllAsRead(): Promise<number> {
  const result = await notificationModel.updateMany({
    where: { read: false },
    data: { read: true },
  });
  if (result.count > 0) {
    broadcast("read-all", { count: result.count });
  }
  return result.count;
}

/**
 * Register an SSE response object and remove it when the client disconnects.
 */
export function registerSseClient(res: Response): void {
  sseClients.add(res);
  res.on("close", () => sseClients.delete(res));
  res.on("error", () => sseClients.delete(res));
}

/**
 * Return the current number of connected SSE clients (useful for testing/health).
 */
export function getSseClientCount(): number {
  return sseClients.size;
}
