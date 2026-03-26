"use client";

import { useEffect, useState } from "react";
import { io } from "socket.io-client";

interface Transaction {
  id: string;
  amount: string;
  status: string;
  timestamp: string;
}

export default function Home() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    // 🔗 Connect to the backend WebSockets we built earlier!
    const socket = io("https://silver-goldfish-4jxw4xqqwwv63jr59-3001.app.github.dev/");

    socket.on("connect", () => {
      setIsConnected(true);
      console.log("Connected to WebSockets!");
    });

    socket.on("disconnect", () => {
      setIsConnected(false);
    });

    // 📡 Listen for the "new_transaction" event from the backend!
    socket.on("new_transaction", (newTx: Transaction) => {
      setTransactions((prev) => [newTx, ...prev]); // Slide it into the TOP of the table!
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  return (
    <main style={{ padding: "2rem", fontFamily: "sans-serif" }}>
      <h1>Fluid Admin Dashboard</h1>
      
      {/* 🟢 Live Indicator requested by Acceptance Criteria! */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "2rem" }}>
        <div style={{
          width: "12px", 
          height: "12px", 
          borderRadius: "50%", 
          backgroundColor: isConnected ? "#4caf50" : "#f44336" 
        }} />
        <span>Status: {isConnected ? "Live Connected" : "Disconnected"}</span>
      </div>

      <h2>Live Transactions</h2>
      <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
        <thead>
          <tr style={{ borderBottom: "2px solid #ddd" }}>
            <th style={{ padding: "10px" }}>Transaction ID</th>
            <th style={{ padding: "10px" }}>Amount</th>
            <th style={{ padding: "10px" }}>Status</th>
            <th style={{ padding: "10px" }}>Timestamp</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((tx) => (
            <tr key={tx.id} style={{ borderBottom: "1px solid #eee" }}>
              <td style={{ padding: "10px" }}>{tx.id}</td>
              <td style={{ padding: "10px" }}>{tx.amount}</td>
              <td style={{ padding: "10px" }}>{tx.status}</td>
              <td style={{ padding: "10px" }}>{tx.timestamp}</td>
            </tr>
          ))}
          {transactions.length === 0 && (
            <tr>
              <td colSpan={4} style={{ textAlign: "center", padding: "20px", color: "#888" }}>
                Waiting for live transactions... (Run the test command to send one!)
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </main>
  );
}