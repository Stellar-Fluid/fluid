import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import { loadConfig } from "./config";
import { PrismaClient } from "@prisma/client";

const app = express();
const server = http.createServer(app);

// 🌐 1. Initialize Socket.io (The Live Wire!)
const io = new Server(server, {
  cors: {
    origin: "*", // Allows any frontend to connect for local testing
    methods: ["GET", "POST"],
  },
});

const prisma = new PrismaClient();
const config = loadConfig();

app.use(cors());
app.use(express.json());

// 📝 2. Standard test route
app.get("/", (req, res) => {
  res.json({ message: "Fluid Server is Online!", liveWebsockets: true });
});

// ⚡ 3. Listen for Frontend live connections
io.on("connection", (socket) => {
  console.log(`🟢 Client connected to WebSockets: ${socket.id}`);

  // Send a welcome event to the frontend
  socket.emit("status", { connected: true, message: "Live connection established!" });

  socket.on("disconnect", () => {
    console.log(`🔴 Client disconnected: ${socket.id}`);
  });
});

// 🚀 4. A Test route to "Trigger" a fake transaction so you can see it work!
app.post("/test-transaction", (req, res) => {
  const fakeTransaction = {
    id: `tx_${Date.now()}`,
    amount: "100 XLM",
    status: "SUCCESS",
    timestamp: new Date().toISOString(),
  };

  // 🗣️ Broadcast the transaction to everyone connected to the dashboard!
  io.emit("new_transaction", fakeTransaction);

  res.json({ message: "Live event broadcasted!", data: fakeTransaction });
});

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`---------------------------------------------------`);
  console.log(`🚀 Fluid Server running on http://localhost:${PORT}`);
  console.log(`📡 WebSocket Server is Active and listening!`);
  console.log(`---------------------------------------------------`);
});