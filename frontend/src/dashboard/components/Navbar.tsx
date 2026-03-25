import React from "react";

interface NavbarProps {
  title: string;
  breadcrumbs: string[];
  userName?: string;
  onToggleSidebar: () => void;
  showMenuButton: boolean;
}

const navStyle: React.CSSProperties = {
  position: "sticky",
  top: 14,
  zIndex: 20,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 14,
  padding: "18px 20px",
  border: "1px solid rgba(226, 232, 240, 0.16)",
  borderRadius: 24,
  background:
    "linear-gradient(160deg, rgba(15, 23, 42, 0.56) 0%, rgba(30, 41, 59, 0.42) 100%)",
  backdropFilter: "blur(18px)",
  WebkitBackdropFilter: "blur(18px)",
  boxShadow:
    "0 18px 36px rgba(2, 6, 23, 0.34), inset 0 1px 0 rgba(255, 255, 255, 0.08)",
};

const crumbsStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  color: "rgba(203, 213, 225, 0.8)",
  fontSize: 12,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

const titleStyle: React.CSSProperties = {
  marginTop: 8,
  color: "#f8fafc",
  fontSize: 32,
  lineHeight: 1,
  letterSpacing: "-0.03em",
};

const buttonStyle: React.CSSProperties = {
  border: "1px solid rgba(148, 163, 184, 0.25)",
  borderRadius: 14,
  background: "rgba(15, 23, 42, 0.28)",
  color: "#e2e8f0",
  height: 44,
  minWidth: 42,
  padding: "0 14px",
  cursor: "pointer",
  transition: "transform 180ms ease, background 180ms ease, border-color 180ms ease",
};

const menuItems = ["Profile", "Preferences", "Sign out"];

export function Navbar({
  title,
  breadcrumbs,
  userName = "Operator",
  onToggleSidebar,
  showMenuButton,
}: NavbarProps) {
  const isMobile = showMenuButton;
  const [open, setOpen] = React.useState(() => {
    if (typeof window === "undefined") {
      return false;
    }

    return new URLSearchParams(window.location.search).get("profileMenu") === "open";
  });
  const menuRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <header
      style={{
        ...navStyle,
        padding: isMobile ? "14px" : navStyle.padding,
        borderRadius: isMobile ? 20 : navStyle.borderRadius,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: isMobile ? 10 : 14,
          minWidth: 0,
          flex: 1,
        }}
      >
        {showMenuButton ? (
          <button
            type="button"
            aria-label="Open navigation"
            onClick={onToggleSidebar}
            style={{
              ...buttonStyle,
              minWidth: 48,
              width: 48,
              padding: 0,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M4 7H20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M4 12H20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M4 17H20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        ) : null}

        <div style={{ minWidth: 0 }}>
          <div style={{ ...crumbsStyle, display: isMobile ? "none" : "flex" }} aria-label="Breadcrumb">
            {breadcrumbs.map((crumb, index) => (
              <React.Fragment key={`${crumb}-${index}`}>
                <span>{crumb}</span>
                {index < breadcrumbs.length - 1 ? <span>/</span> : null}
              </React.Fragment>
            ))}
          </div>
          <h1
            style={{
              ...titleStyle,
              fontSize: isMobile ? 24 : titleStyle.fontSize,
              marginTop: isMobile ? 0 : titleStyle.marginTop,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {title}
          </h1>
        </div>
      </div>

      <div ref={menuRef} style={{ position: "relative", flexShrink: 0 }}>
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
          aria-haspopup="menu"
          style={{
            ...buttonStyle,
            minWidth: isMobile ? 46 : 162,
            width: isMobile ? 46 : "auto",
            display: "flex",
            alignItems: "center",
            justifyContent: isMobile ? "center" : "space-between",
            gap: isMobile ? 4 : 10,
            fontSize: 14,
            fontWeight: 600,
            boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.08)",
            padding: isMobile ? 0 : "0 14px",
          }}
        >
          {isMobile ? null : <span>{userName}</span>}
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 16,
              height: 16,
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.8" />
              <path
                d="M5.5 19.5C6.7 16.9 9.1 15.5 12 15.5C14.9 15.5 17.3 16.9 18.5 19.5"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <span
            style={{
              transform: open ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 200ms ease",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              marginLeft: isMobile ? 0 : 8,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M6 9L12 15L18 9"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </button>

        {open ? (
          <div
            role="menu"
            style={{
              position: "absolute",
              right: 0,
              top: "calc(100% + 10px)",
              width: isMobile ? 170 : 198,
              borderRadius: 16,
              border: "1px solid rgba(148, 163, 184, 0.22)",
              background:
                "linear-gradient(170deg, rgba(15, 23, 42, 0.74) 0%, rgba(30, 41, 59, 0.7) 100%)",
              backdropFilter: "blur(16px)",
              WebkitBackdropFilter: "blur(16px)",
              boxShadow: "0 18px 32px rgba(2, 6, 23, 0.45)",
              overflow: "hidden",
            }}
          >
            {menuItems.map((entry, index) => (
              <button
                key={entry}
                type="button"
                role="menuitem"
                onClick={() => setOpen(false)}
                style={{
                  width: "100%",
                  padding: "12px 14px",
                  border: 0,
                  borderBottom:
                    index === menuItems.length - 1
                      ? "none"
                      : "1px solid rgba(148, 163, 184, 0.16)",
                  background: "transparent",
                  textAlign: "left",
                  cursor: "pointer",
                  color: "#e2e8f0",
                  fontWeight: 500,
                }}
              >
                {entry}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </header>
  );
}
