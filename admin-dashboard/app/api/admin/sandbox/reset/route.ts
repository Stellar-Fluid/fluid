/**
 * Dashboard proxy: POST /api/admin/sandbox/reset
 * Forwards the reset request to the Fluid server using the sandbox API key
 * supplied in the request body.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { fluidServerUrl } from "@/lib/server-env";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { sandboxApiKey } = await req.json();
  if (!sandboxApiKey || typeof sandboxApiKey !== "string") {
    return NextResponse.json(
      { error: "sandboxApiKey required" },
      { status: 400 },
    );
  }

  const upstream = await fetch(`${fluidServerUrl}/sandbox/reset`, {
    method: "POST",
    headers: {
      "x-api-key": sandboxApiKey,
      "Content-Type": "application/json",
    },
  });

  const body = await upstream.json();
  return NextResponse.json(body, { status: upstream.status });
}
