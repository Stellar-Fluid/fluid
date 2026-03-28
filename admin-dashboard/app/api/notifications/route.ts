import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";

const FLUID_SERVER_URL =
  process.env.FLUID_SERVER_URL?.trim() ?? "http://localhost:3000";
const FLUID_ADMIN_TOKEN = process.env.FLUID_ADMIN_TOKEN?.trim() ?? "";

function adminHeaders() {
  return {
    "Content-Type": "application/json",
    "x-admin-token": FLUID_ADMIN_TOKEN,
  };
}

/** GET /api/notifications — proxy to Fluid server */
export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const response = await fetch(`${FLUID_SERVER_URL}/admin/notifications`, {
      headers: adminHeaders(),
      cache: "no-store",
    });
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch {
    return NextResponse.json(
      { error: "Failed to reach notification service" },
      { status: 502 }
    );
  }
}

/** POST /api/notifications — create a notification manually */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const response = await fetch(`${FLUID_SERVER_URL}/admin/notifications`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify(body),
    });
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch {
    return NextResponse.json(
      { error: "Failed to create notification" },
      { status: 502 }
    );
  }
}
