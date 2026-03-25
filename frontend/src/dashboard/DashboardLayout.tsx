import React from "react";
import { Navbar } from "./components/Navbar";
import { Sidebar, SidebarItem } from "./components/Sidebar";

export interface DashboardLayoutProps {
  activeHref?: string;
  title?: string;
  userName?: string;
  onNavigate?: (href: string) => void;
  children: React.ReactNode;
}

const SIDEBAR_ITEMS: SidebarItem[] = [
  { label: "Overview", href: "/overview" },
  { label: "Transactions", href: "/transactions" },
  { label: "API Keys", href: "/api-keys" },
  { label: "Settings", href: "/settings" },
];

function useDesktopQuery(minWidth: number) {
  const [isDesktop, setDesktop] = React.useState<boolean>(() => {
    if (typeof window === "undefined") {
      return true;
    }

    return window.innerWidth >= minWidth;
  });

  React.useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const media = window.matchMedia(`(min-width: ${minWidth}px)`);

    const update = () => {
      setDesktop(media.matches);
    };

    update();

    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", update);
      return () => media.removeEventListener("change", update);
    }

    media.addListener(update);
    return () => media.removeListener(update);
  }, [minWidth]);

  return isDesktop;
}

function getCrumbs(activeHref: string): string[] {
  const match = SIDEBAR_ITEMS.find((item) => item.href === activeHref);
  return ["Dashboard", match ? match.label : "Overview"];
}

export function DashboardLayout({
  activeHref = "/overview",
  title,
  userName,
  onNavigate,
  children,
}: DashboardLayoutProps) {
  const isDesktop = useDesktopQuery(1024);
  const [mobileOpen, setMobileOpen] = React.useState(false);

  React.useEffect(() => {
    if (isDesktop) {
      setMobileOpen(false);
    }
  }, [isDesktop]);

  const activeItem = SIDEBAR_ITEMS.find((item) => item.href === activeHref);
  const pageTitle = title || activeItem?.label || "Overview";

  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at 10% 16%, rgba(56, 189, 248, 0.25) 0%, rgba(56, 189, 248, 0) 28%), radial-gradient(circle at 80% 0%, rgba(99, 102, 241, 0.26) 0%, rgba(99, 102, 241, 0) 30%), radial-gradient(circle at 88% 82%, rgba(16, 185, 129, 0.2) 0%, rgba(16, 185, 129, 0) 24%), linear-gradient(145deg, #020617 0%, #0b1120 45%, #111827 100%)",
        padding: isDesktop ? 12 : 8,
        color: "#e2e8f0",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        aria-hidden="true"
        style={{
          position: "fixed",
          width: 420,
          height: 420,
          borderRadius: "50%",
          top: -180,
          right: -120,
          background: "radial-gradient(circle, rgba(56, 189, 248, 0.3) 0%, rgba(56, 189, 248, 0) 70%)",
          filter: "blur(4px)",
          pointerEvents: "none",
        }}
      />

      <div
        aria-hidden="true"
        style={{
          position: "fixed",
          width: 360,
          height: 360,
          borderRadius: "50%",
          bottom: -140,
          left: 120,
          background: "radial-gradient(circle, rgba(129, 140, 248, 0.22) 0%, rgba(129, 140, 248, 0) 70%)",
          filter: "blur(6px)",
          pointerEvents: "none",
        }}
      />

      <Sidebar
        items={SIDEBAR_ITEMS}
        activeHref={activeHref}
        isDesktop={isDesktop}
        isOpen={mobileOpen}
        onClose={() => setMobileOpen(false)}
        onNavigate={onNavigate}
      />

      <div
        style={{
          marginLeft: isDesktop ? 326 : 0,
          transition: "margin 280ms ease",
          padding: isDesktop ? "14px 14px 24px 18px" : "6px",
          maxWidth: 1440,
          marginRight: "auto",
          position: "relative",
          zIndex: 1,
        }}
      >
        <Navbar
          title={pageTitle}
          breadcrumbs={getCrumbs(activeHref)}
          userName={userName}
          showMenuButton={!isDesktop}
          onToggleSidebar={() => setMobileOpen(true)}
        />

        <main
          style={{
            marginTop: isDesktop ? 18 : 14,
            borderRadius: isDesktop ? 28 : 20,
            border: "1px solid rgba(226, 232, 240, 0.14)",
            background:
              "linear-gradient(165deg, rgba(15, 23, 42, 0.58) 0%, rgba(30, 41, 59, 0.5) 100%)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            boxShadow:
              "0 24px 42px rgba(2, 6, 23, 0.44), inset 0 1px 0 rgba(255, 255, 255, 0.08)",
            minHeight: isDesktop ? "calc(100vh - 154px)" : "calc(100vh - 120px)",
            padding: isDesktop ? 26 : 14,
          }}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
