"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "./theme-toggle";
import { NotificationBell } from "./dashboard/NotificationBell";

export function Navbar() {
    const pathname = usePathname();
    const isAdmin = Boolean(pathname?.startsWith("/admin"));
    const badge =
        pathname === "/" ? "Developer portal" : isAdmin ? "Admin" : null;

    return (
        <header className="sticky top-0 z-50 w-full border-b border-zinc-200/50 bg-white/70 backdrop-blur-xl transition-all dark:border-zinc-800/50 dark:bg-background/70">
            <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
                <div className="flex items-center gap-2">
                    <Link href="/" className="group flex items-center space-x-2 transition-opacity hover:opacity-90">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-950 dark:text-white dark:bg-zinc-50 dark:text-zinc-950 font-black">
                            F
                        </div>
                        <span className="text-xl font-bold tracking-tight text-foreground">
                            Fluid
                        </span>
                        {badge ? (
                        <span className="hidden max-w-[11rem] truncate rounded-full bg-zinc-100 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 sm:inline-block">
                            {badge}
                        </span>
                        ) : null}
                    </Link>
                </div>

                <nav className="flex items-center gap-4 sm:gap-8">
                    <Link
                        href="/plugins"
                        className="hidden text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:inline-block"
                    >
                        Plugins
                    </Link>
                    <Link
                        href="/forum"
                        className="hidden text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:inline-block"
                    >
                        Forum
                    </Link>
                    <Link
                        href="/sdk"
                        className="hidden text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:inline-block"
                    >
                        SDKs
                    </Link>
                    <Link
                        href="/partners"
                        className="hidden text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:inline-block"
                    >
                        Partners
                    </Link>
                    <Link
                        href="/referrals"
                        className="hidden text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:inline-block"
                    >
                        Referrals
                    </Link>
                    <Link
                        href="/roadmap"
                        className="hidden text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:inline-block"
                    >
                        Roadmap
                    </Link>
                    <Link
                        href="/changelog"
                        className="hidden text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:inline-block"
                    >
                        Changelog
                    </Link>
                    <ThemeToggle />
                    {isAdmin && <NotificationBell />}
                </nav>
            </div>
        </header>
    );
}
