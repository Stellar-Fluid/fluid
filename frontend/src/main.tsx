import React from "react";
import { createRoot } from "react-dom/client";
import { AnimatePresence, motion } from "framer-motion";
import { WifiOff } from "lucide-react";
import { DashboardLayout } from "./dashboard";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        console.log("PWA Service Worker registered with scope:", registration.scope);
      })
      .catch((error) => {
        console.error("PWA Service Worker registration failed:", error);
      });
  });
}

function OfflineBanner() {
  const [isOffline, setIsOffline] = React.useState(!navigator.onLine);

  React.useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return (
    <AnimatePresence>
      {isOffline && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          style={{
            position: "fixed",
            top: 16,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 9999,
            background: "rgba(220, 38, 38, 0.95)",
            color: "white",
            padding: "8px 16px",
            borderRadius: "999px",
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontSize: 14,
            fontWeight: 500,
            boxShadow: "0 10px 25px -5px rgba(220, 38, 38, 0.4)",
            backdropFilter: "blur(8px)",
          }}
        >
          <WifiOff size={18} />
          You are currently offline. Using cached version.
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function DemoCard({ title, value }: { title: string; value: string }) {
  return (
    <article
      style={{
        border: "1px solid rgba(226, 232, 240, 0.16)",
        borderRadius: 18,
        padding: 16,
        background:
          "linear-gradient(155deg, rgba(15, 23, 42, 0.56) 0%, rgba(30, 41, 59, 0.45) 100%)",
        backdropFilter: "blur(16px)",
        boxShadow: "0 14px 28px rgba(2, 6, 23, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.08)",
      }}
    >
      <p style={{ margin: 0, color: "rgba(203, 213, 225, 0.8)", fontSize: 13 }}>{title}</p>
      <h3 style={{ margin: "10px 0 0", color: "#f8fafc", fontSize: 22 }}>{value}</h3>
    </article>
  );
}

function App() {
  const [active, setActive] = React.useState("/overview");

  return (
    <DashboardLayout
      activeHref={active}
      onNavigate={(href) => setActive(href)}
      userName="Emmo00"
      title="Overview"
    >
      <OfflineBanner />
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(148px, 1fr))",
          gap: 12,
        }}
      >
        <DemoCard title="Sponsored Tx" value="1,284" />
        <DemoCard title="Active API Keys" value="6" />
        <DemoCard title="Success Rate" value="99.2%" />
        <DemoCard title="Avg. Finality" value="4.1s" />
      </section>

      <section
        style={{
          marginTop: 14,
          border: "1px solid rgba(226, 232, 240, 0.15)",
          borderRadius: 20,
          padding: 14,
          background:
            "linear-gradient(170deg, rgba(15, 23, 42, 0.52) 0%, rgba(30, 41, 59, 0.42) 100%)",
        }}
      >
        <h2 style={{ margin: 0, color: "#f8fafc", fontSize: 16 }}>Recent Activity</h2>
        <p style={{ margin: "8px 0 0", color: "rgba(203, 213, 225, 0.8)" }}>
          Fee sponsorship throughput is stable and all monitored keys are healthy.
        </p>
      </section>
    </DashboardLayout>
  );
}

const rootNode = document.getElementById("root");
if (!rootNode) {
  throw new Error("Missing #root element");
}

createRoot(rootNode).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
