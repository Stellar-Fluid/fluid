import { NextResponse } from "next/server";
import { auth } from "@/auth";

const FLUID_SERVER_URL =
  process.env.FLUID_SERVER_URL?.trim() ?? "http://localhost:3000";
const FLUID_ADMIN_TOKEN = process.env.FLUID_ADMIN_TOKEN?.trim() ?? "";

/** PATCH /api/notifications/read-all — mark all notifications as read */
export async function PATCH() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const response = await fetch(
      `${FLUID_SERVER_URL}/admin/notifications/read-all`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-admin-token": FLUID_ADMIN_TOKEN,
        },
      }
    );
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch {
    return NextResponse.json(
      { error: "Failed to mark all notifications as read" },
      { status: 502 }
    );
  }
}
