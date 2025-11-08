import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Cloud, Menu, X, ChevronDown, ChevronRight, Github, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface NavItem {
  title: string;
  href?: string;
  items?: NavItem[];
}

const navigation: NavItem[] = [
  {
    title: "Getting Started",
    href: "/docs/getting-started",
  },
  {
    title: "User Roles & Guides",
    items: [
      { title: "Administrator Guide", href: "/docs/guides/admin" },
      { title: "Partner Guide", href: "/docs/guides/partner" },
      { title: "Agent Guide", href: "/docs/guides/agent" },
      { title: "User Guide", href: "/docs/guides/user" },
    ],
  },
  {
    title: "Core Features",
    items: [
      { title: "Deployment Management", href: "/docs/features/deployments" },
      { title: "Module Management", href: "/docs/features/modules" },
      { title: "Publishing Modules", href: "/docs/features/publishing" },
    ],
  },
  {
    title: "Billing & Credits",
    items: [
      { title: "Credit System", href: "/docs/billing/credits" },
      { title: "Subscription Tiers", href: "/docs/billing/subscriptions" },
      { title: "Transactions", href: "/docs/billing/transactions" },
    ],
  },
  {
    title: "Administration",
    items: [
      { title: "Global Settings", href: "/docs/admin/settings" },
      { title: "User Management", href: "/docs/admin/users" },
      { title: "Notifications", href: "/docs/admin/notifications" },
    ],
  },
  {
    title: "Support",
    href: "/docs/support",
  },
];

function NavSection({ item, level = 0 }: { item: NavItem; level?: number }) {
  const [location] = useLocation();
  const [isOpen, setIsOpen] = useState(true);
  const hasItems = item.items && item.items.length > 0;
  const isActive = item.href === location;

  if (!hasItems && item.href) {
    return (
      <Link href={item.href}>
        <a
          className={cn(
            "block px-3 py-2 rounded-md text-sm transition-colors",
            isActive
              ? "bg-primary text-primary-foreground font-medium"
              : "text-muted-foreground hover:text-foreground hover:bg-muted"
          )}
          style={{ paddingLeft: `${0.75 + level * 0.75}rem` }}
        >
          {item.title}
        </a>
      </Link>
    );
  }

  return (
    <div>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "w-full flex items-center justify-between px-3 py-2 rounded-md text-sm font-medium transition-colors",
          "text-foreground hover:bg-muted"
        )}
        style={{ paddingLeft: `${0.75 + level * 0.75}rem` }}
      >
        {item.title}
        {hasItems && (
          isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />
        )}
      </button>
      {hasItems && isOpen && (
        <div className="mt-1 space-y-1">
          {item.items!.map((subItem, index) => (
            <NavSection key={index} item={subItem} level={level + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
        <div className="container flex h-16 items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
            <Link href="/">
              <a className="flex items-center gap-2">
                <Cloud className="h-6 w-6 text-primary" />
                <span className="font-bold text-xl">RAD Platform</span>
              </a>
            </Link>
          </div>
          <nav className="flex items-center gap-4">
            <Link href="/">
              <Button variant="ghost" size="sm" className="gap-2">
                <Home className="h-4 w-4" />
                <span className="hidden sm:inline">Home</span>
              </Button>
            </Link>
            <a
              href="https://github.com/techequitycloud/rad.github.io"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button variant="ghost" size="sm" className="gap-2">
                <Github className="h-4 w-4" />
                <span className="hidden sm:inline">GitHub</span>
              </Button>
            </a>
          </nav>
        </div>
      </header>

      <div className="flex-1 flex">
        {/* Sidebar */}
        <aside
          className={cn(
            "fixed lg:sticky top-16 left-0 z-40 h-[calc(100vh-4rem)] w-64 border-r bg-background transition-transform lg:translate-x-0",
            sidebarOpen ? "translate-x-0" : "-translate-x-full"
          )}
        >
          <div className="h-full overflow-y-auto py-6 px-4">
            <nav className="space-y-1">
              {navigation.map((item, index) => (
                <NavSection key={index} item={item} />
              ))}
            </nav>
          </div>
        </aside>

        {/* Overlay for mobile */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-30 bg-background/80 backdrop-blur-sm lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto">
          <div className="container max-w-4xl py-8 lg:py-12">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
