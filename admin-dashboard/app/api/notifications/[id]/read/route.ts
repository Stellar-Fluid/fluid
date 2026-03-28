import { NextResponse } from "next/server";
import { auth } from "@/auth";

const FLUID_SERVER_URL =
  process.env.FLUID_SERVER_URL?.trim() ?? "http://localhost:3000";
const FLUID_ADMIN_TOKEN = process.env.FLUID_ADMIN_TOKEN?.trim() ?? "";

/** PATCH /api/notifications/[id]/read — mark single notification as read */
export async function PATCH(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const response = await fetch(
      `${FLUID_SERVER_URL}/admin/notifications/${id}/read`,
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
      { error: "Failed to mark notification as read" },
      { status: 502 }
    );
  }
}
