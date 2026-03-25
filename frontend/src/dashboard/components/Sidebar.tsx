import { AnimatePresence, motion } from "framer-motion";
import React from "react";

export interface SidebarItem {
  label: string;
  href: string;
}

interface SidebarProps {
  items: SidebarItem[];
  activeHref: string;
  isDesktop: boolean;
  isOpen: boolean;
  onClose: () => void;
  onNavigate?: (href: string) => void;
}

function getSidebarShellStyle(isDesktop: boolean): React.CSSProperties {
  if (isDesktop) {
    return {
      width: 294,
      height: "calc(100vh - 40px)",
      margin: 20,
      padding: "24px 18px",
      borderRadius: 28,
      background:
        "linear-gradient(160deg, rgba(15, 23, 42, 0.58) 0%, rgba(30, 41, 59, 0.42) 100%)",
      backdropFilter: "blur(20px)",
      WebkitBackdropFilter: "blur(20px)",
      border: "1px solid rgba(226, 232, 240, 0.14)",
      boxShadow:
        "0 26px 60px rgba(2, 6, 23, 0.52), inset 0 1px 0 rgba(255, 255, 255, 0.1)",
      overflow: "hidden",
    };
  }

  return {
    width: "min(86vw, 320px)",
    height: "100vh",
    margin: 0,
    padding: "22px 14px",
    borderRadius: "0 22px 22px 0",
    background:
      "linear-gradient(160deg, rgba(15, 23, 42, 0.84) 0%, rgba(30, 41, 59, 0.8) 100%)",
    backdropFilter: "blur(18px)",
    WebkitBackdropFilter: "blur(18px)",
    borderRight: "1px solid rgba(226, 232, 240, 0.16)",
    boxShadow: "0 18px 36px rgba(2, 6, 23, 0.5)",
    overflow: "hidden",
  };
}

const brandStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  marginBottom: 32,
  color: "#e2e8f0",
  fontWeight: 700,
  letterSpacing: 0.2,
  fontSize: 18,
};

const dotStyle: React.CSSProperties = {
  width: 12,
  height: 12,
  borderRadius: "50%",
  background: "linear-gradient(180deg, #22d3ee 0%, #38bdf8 100%)",
  boxShadow: "0 0 18px rgba(56, 189, 248, 0.9)",
};

const navStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

function itemBaseStyle(active: boolean): React.CSSProperties {
  return {
    width: "100%",
    textAlign: "left",
    border: "1px solid",
    borderColor: active ? "rgba(56, 189, 248, 0.58)" : "rgba(148, 163, 184, 0.08)",
    borderRadius: 16,
    padding: "14px 14px",
    background: active
      ? "linear-gradient(120deg, rgba(8, 145, 178, 0.28) 0%, rgba(59, 130, 246, 0.2) 100%)"
      : "rgba(15, 23, 42, 0.2)",
    color: active ? "#f8fafc" : "rgba(226, 232, 240, 0.8)",
    fontSize: 15,
    fontWeight: active ? 700 : 500,
    cursor: "pointer",
    transition: "all 220ms ease",
    letterSpacing: "0.01em",
  };
}

function SidebarContent({
  items,
  activeHref,
  onNavigate,
  onClose,
  isDesktop,
}: Pick<SidebarProps, "items" | "activeHref" | "onNavigate" | "onClose" | "isDesktop">) {
  const [hovered, setHovered] = React.useState<string | null>(null);

  return (
    <div style={getSidebarShellStyle(isDesktop)}>
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          width: 180,
          height: 180,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(56, 189, 248, 0.2) 0%, rgba(56, 189, 248, 0) 70%)",
          top: -80,
          right: -54,
        }}
      />

      <div style={brandStyle}>
        <span style={dotStyle} />
        <span>Fluid Dashboard</span>
      </div>

      <nav style={navStyle} aria-label="Dashboard sections">
        {items.map((item) => {
          const isActive = activeHref === item.href;
          const isHovered = hovered === item.href;

          return (
            <button
              key={item.href}
              type="button"
              style={{
                ...itemBaseStyle(isActive),
                transform: isHovered ? "translateX(3px)" : "translateX(0)",
                background:
                  !isActive && isHovered
                    ? "linear-gradient(120deg, rgba(30, 41, 59, 0.56) 0%, rgba(51, 65, 85, 0.36) 100%)"
                    : itemBaseStyle(isActive).background,
                boxShadow: isActive
                  ? "0 10px 28px rgba(8, 145, 178, 0.22), inset 0 1px 0 rgba(255, 255, 255, 0.08)"
                  : "none",
              }}
              onMouseEnter={() => setHovered(item.href)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => {
                onNavigate?.(item.href);
                onClose();
              }}
            >
              {item.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

export function Sidebar({
  items,
  activeHref,
  isDesktop,
  isOpen,
  onClose,
  onNavigate,
}: SidebarProps) {
  if (isDesktop) {
    return (
      <aside style={{ position: "fixed", top: 0, left: 0, zIndex: 30 }}>
        <SidebarContent
          items={items}
          activeHref={activeHref}
          onNavigate={onNavigate}
          onClose={onClose}
          isDesktop={isDesktop}
        />
      </aside>
    );
  }

  return (
    <AnimatePresence>
      {isOpen ? (
        <>
          <motion.button
            type="button"
            aria-label="Close sidebar"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 39,
              border: 0,
              background:
                "linear-gradient(160deg, rgba(2, 6, 23, 0.6) 0%, rgba(15, 23, 42, 0.72) 100%)",
              backdropFilter: "blur(4px)",
              cursor: "pointer",
            }}
          />

          <motion.aside
            initial={{ x: -320, opacity: 0.86 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -320, opacity: 0.86 }}
            transition={{ type: "spring", stiffness: 260, damping: 28 }}
            style={{ position: "fixed", top: 0, left: 0, zIndex: 40 }}
          >
            <SidebarContent
              items={items}
              activeHref={activeHref}
              onNavigate={onNavigate}
              onClose={onClose}
              isDesktop={isDesktop}
            />
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
  );
}
