"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode } from "react";
import { Home, ImagePlus, Map, Search, Settings } from "lucide-react";

import { Brand } from "./brand";
import { useConnectivity } from "./use-api-resource";

const destinations = [
  { href: "/home", label: "ホーム", icon: Home },
  { href: "/search", label: "思い出す", icon: Search },
  { href: "/add", label: "追加", icon: ImagePlus },
  { href: "/map", label: "地図", icon: Map },
  { href: "/settings/privacy-ai", label: "設定", icon: Settings },
];

function isCurrent(pathname: string, href: string): boolean {
  if (href === "/home")
    return pathname === href || pathname.startsWith("/memories/");
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const online = useConnectivity();

  return (
    <div className="app-shell">
      {!online ? (
        <div className="offline-banner" role="status">
          オフラインです。サーバー処理は再接続後に行われます。
        </div>
      ) : null}
      <header className="app-header">
        <div className="app-header__inner">
          <Brand compact />
          <nav className="desktop-nav" aria-label="メインナビゲーション">
            {destinations.map(({ href, label, icon: Icon }) => (
              <Link
                className={
                  isCurrent(pathname, href) ? "nav-link is-active" : "nav-link"
                }
                href={href}
                key={href}
                aria-current={isCurrent(pathname, href) ? "page" : undefined}
              >
                <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
                <span>{label}</span>
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="app-main" id="main-content">
        {children}
      </main>
      <nav className="bottom-nav" aria-label="メインナビゲーション">
        {destinations.map(({ href, label, icon: Icon }) => (
          <Link
            className={
              isCurrent(pathname, href)
                ? "bottom-nav__item is-active"
                : "bottom-nav__item"
            }
            href={href}
            key={href}
            aria-current={isCurrent(pathname, href) ? "page" : undefined}
          >
            <Icon aria-hidden="true" size={21} strokeWidth={1.8} />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
