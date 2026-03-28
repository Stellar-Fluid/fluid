import { auth } from "@/auth";

const FLUID_SERVER_URL =
  process.env.FLUID_SERVER_URL?.trim() ?? "http://localhost:3000";
const FLUID_ADMIN_TOKEN = process.env.FLUID_ADMIN_TOKEN?.trim() ?? "";

/**
 * GET /api/notifications/sse
 *
 * Pass-through SSE proxy: opens an EventSource connection to the Fluid Express
 * server and streams the events verbatim to the browser client.  This avoids
 * exposing the FLUID_ADMIN_TOKEN and FLUID_SERVER_URL to the frontend.
 */
export async function GET() {
  const session = await auth();
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const upstreamUrl = `${FLUID_SERVER_URL}/admin/notifications/sse`;

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(upstreamUrl, {
      headers: {
        "x-admin-token": FLUID_ADMIN_TOKEN,
        Accept: "text/event-stream",
        "Cache-Control": "no-cache",
      },
      // @ts-expect-error – Node 18+ fetch supports duplex streaming
      duplex: "half",
    });
  } catch {
    return new Response("Notification service unavailable", { status: 502 });
  }

  if (!upstreamResponse.ok || !upstreamResponse.body) {
    return new Response("Notification SSE stream unavailable", { status: 502 });
  }

  return new Response(upstreamResponse.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
