// server/src/handlers/events.ts
import { Request, Response } from "express";

// This array keeps a list of every open dashboard connection
let clients: Response[] = [];

/**
 * When the frontend dashboard opens, it connects here to listen for live updates.
 */
export function sseHandler(req: Request, res: Response) {
  // 1. Tell the browser we are keeping this connection open
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
  });

  // 2. Add this browser to our active clients list
  clients.push(res);

  // 3. Send a "welcome" ping so it knows it is connected
  res.write("data: Connected to live metrics\n\n");

  // 4. If the user closes the dashboard, remove them from our list
  req.on("close", () => {
    clients = clients.filter((client) => client !== res);
  });
}

/**
 * When a transaction succeeds, we call this function to blast the message to everyone!
 */
export function broadcastUpdate(data: any) {
  clients.forEach((client) => {
    client.write(`data: ${JSON.stringify(data)}\n\n`);
  });
}