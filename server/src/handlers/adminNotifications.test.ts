import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express, { Request, Response } from "express";
import request from "supertest";

// ── Mock Prisma before importing handlers ────────────────────────────────────
// NOTE: vi.mock is hoisted to the top of the file, so we must NOT reference
// any module-level variables inside the factory (they would be TDZ at hoist time).
// Instead, we use vi.fn() stubs and override them per-test in beforeEach.

vi.mock("../utils/db", () => ({
  default: {
    adminNotification: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

// Imports AFTER mock setup
import prisma from "../utils/db";
import {
  listNotificationsHandler,
  createNotificationHandler,
  markReadHandler,
  markAllReadHandler,
} from "./adminNotifications";

// ── Test fixtures ─────────────────────────────────────────────────────────────

const NOTIF_1 = {
  id: "notif-1",
  type: "low_balance",
  title: "Low balance",
  message: "Account GABC… is below threshold",
  read: false,
  metadata: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

const NOTIF_2 = {
  id: "notif-2",
  type: "info",
  title: "Server started",
  message: "Fluid server came online",
  read: true,
  metadata: null,
  createdAt: new Date("2026-01-01T00:01:00Z"),
  updatedAt: new Date("2026-01-01T00:01:00Z"),
};

const MOCK_NOTIFICATIONS = [NOTIF_1, NOTIF_2];

// ── Test app factory ──────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  app.get("/admin/notifications", (req: Request, res: Response) => {
    void listNotificationsHandler(req, res);
  });
  app.post("/admin/notifications", (req: Request, res: Response) => {
    void createNotificationHandler(req, res);
  });
  app.patch("/admin/notifications/read-all", (req: Request, res: Response) => {
    void markAllReadHandler(req, res);
  });
  app.patch("/admin/notifications/:id/read", (req: Request, res: Response) => {
    void markReadHandler(req, res);
  });
  return app;
}

const ADMIN_TOKEN = "test-admin-token";
const notifModel = (prisma as any).adminNotification;

describe("adminNotifications handlers", () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    process.env.FLUID_ADMIN_TOKEN = ADMIN_TOKEN;
    app = buildApp();
    vi.clearAllMocks();

    // Default mock implementations
    notifModel.findMany.mockResolvedValue(MOCK_NOTIFICATIONS);
    notifModel.count.mockResolvedValue(1);
  });

  afterEach(() => {
    delete process.env.FLUID_ADMIN_TOKEN;
  });

  // ── Authentication ──────────────────────────────────────────────────────────

  it("returns 401 when no admin token is provided (GET)", async () => {
    const res = await request(app).get("/admin/notifications");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Unauthorized");
  });

  it("returns 401 when wrong admin token is provided (POST)", async () => {
    const res = await request(app)
      .post("/admin/notifications")
      .set("x-admin-token", "wrong-token")
      .send({ type: "info", title: "T", message: "M" });
    expect(res.status).toBe(401);
  });

  // ── GET /admin/notifications ────────────────────────────────────────────────

  it("returns last 20 notifications in JSON", async () => {
    const res = await request(app)
      .get("/admin/notifications")
      .set("x-admin-token", ADMIN_TOKEN);
    expect(res.status).toBe(200);
    expect(res.body.notifications).toHaveLength(2);
    expect(res.body.notifications[0].id).toBe("notif-1");
    expect(notifModel.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 20 })
    );
  });

  it("returns 500 if DB throws on list", async () => {
    notifModel.findMany.mockRejectedValueOnce(new Error("DB error"));
    const res = await request(app)
      .get("/admin/notifications")
      .set("x-admin-token", ADMIN_TOKEN);
    expect(res.status).toBe(500);
  });

  // ── POST /admin/notifications ───────────────────────────────────────────────

  it("creates a notification and returns 201", async () => {
    const created = {
      id: "notif-new",
      type: "info",
      title: "Hello",
      message: "World",
      read: false,
      metadata: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    notifModel.create.mockResolvedValueOnce(created);

    const res = await request(app)
      .post("/admin/notifications")
      .set("x-admin-token", ADMIN_TOKEN)
      .send({ type: "info", title: "Hello", message: "World" });

    expect(res.status).toBe(201);
    expect(res.body.notification.id).toBe("notif-new");
    expect(notifModel.create).toHaveBeenCalled();
  });

  it("returns 400 for missing required fields", async () => {
    const res = await request(app)
      .post("/admin/notifications")
      .set("x-admin-token", ADMIN_TOKEN)
      .send({ type: "info" }); // missing title and message
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid type", async () => {
    const res = await request(app)
      .post("/admin/notifications")
      .set("x-admin-token", ADMIN_TOKEN)
      .send({ type: "INVALID", title: "T", message: "M" });
    expect(res.status).toBe(400);
  });

  // ── PATCH /admin/notifications/:id/read ────────────────────────────────────

  it("marks a notification as read", async () => {
    const updated = { ...NOTIF_1, read: true };
    notifModel.findUnique.mockResolvedValueOnce(NOTIF_1);
    notifModel.update.mockResolvedValueOnce(updated);

    const res = await request(app)
      .patch(`/admin/notifications/${NOTIF_1.id}/read`)
      .set("x-admin-token", ADMIN_TOKEN);

    expect(res.status).toBe(200);
    expect(res.body.notification.read).toBe(true);
    expect(notifModel.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: NOTIF_1.id } })
    );
  });

  it("returns 404 when notification not found for mark-read", async () => {
    notifModel.findUnique.mockResolvedValueOnce(null);
    const res = await request(app)
      .patch("/admin/notifications/non-existent/read")
      .set("x-admin-token", ADMIN_TOKEN);
    expect(res.status).toBe(404);
  });

  // ── PATCH /admin/notifications/read-all ────────────────────────────────────

  it("marks all notifications as read", async () => {
    notifModel.updateMany.mockResolvedValueOnce({ count: 5 });

    const res = await request(app)
      .patch("/admin/notifications/read-all")
      .set("x-admin-token", ADMIN_TOKEN);

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(5);
    expect(notifModel.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { read: false } })
    );
  });
});
