/**
 * Dashboard proxy: POST /api/admin/sandbox/create-key
 * Creates a new sandbox API key for a tenant via the Fluid server.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { fluidServerUrl, fluidAdminToken } from "@/lib/server-env";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session || session.user?.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();

  const upstream = await fetch(`${fluidServerUrl}/admin/sandbox/api-keys`, {
    method: "POST",
    headers: {
      "x-admin-token": fluidAdminToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await upstream.json();
  return NextResponse.json(data, { status: upstream.status });
}
