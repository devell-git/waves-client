import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { WavesUser } from "../types/auth";
import { UserMenu } from "./UserMenu";

interface SidebarUserFooterProps {
  user: WavesUser;
  onLogout: () => void;
}

const SIDEBAR_SELECTOR = ".openui-shell-sidebar-container";

/** Garante [data-user-footer] como último filho do sidebar (sem observer em childList). */
function ensureFooterLast(sidebar: HTMLElement, footer: HTMLElement) {
  if (footer.parentElement === sidebar && footer === sidebar.lastElementChild) {
    return;
  }
  sidebar.appendChild(footer);
}

/**
 * Portaliza o UserMenu no rodapé de `.openui-shell-sidebar-container`
 * (header → content → footer). Layout via flex do próprio OpenUI + margin-top: auto.
 */
export function SidebarUserFooter({ user, onLogout }: SidebarUserFooterProps) {
  const [mountNode, setMountNode] = useState<HTMLElement | null>(null);

  useEffect(() => {
    let footerDiv: HTMLDivElement | null = null;
    let bodyObserver: MutationObserver | null = null;
    let sidebarObserver: MutationObserver | null = null;
    let observedSidebar: HTMLElement | null = null;

    const attach = (): boolean => {
      const sidebar = document.querySelector<HTMLElement>(SIDEBAR_SELECTOR);
      if (!sidebar) return false;

      if (!footerDiv) {
        const existing = sidebar.querySelector<HTMLDivElement>(
          ":scope > [data-user-footer]",
        );
        footerDiv =
          existing ??
          (() => {
            const el = document.createElement("div");
            el.setAttribute("data-user-footer", "");
            el.className = "openui-shell-sidebar-user-footer";
            return el;
          })();
        sidebar.classList.add("openui-shell-sidebar-container--with-user-footer");
        setMountNode(footerDiv);
      }

      ensureFooterLast(sidebar, footerDiv);

      if (observedSidebar !== sidebar) {
        sidebarObserver?.disconnect();
        observedSidebar = sidebar;
        sidebarObserver = new MutationObserver(() => {
          if (footerDiv?.parentElement) {
            ensureFooterLast(footerDiv.parentElement, footerDiv);
          }
        });
        sidebarObserver.observe(sidebar, {
          attributes: true,
          attributeFilter: ["class", "data-sidebar-visual-state"],
        });
      }

      return true;
    };

    if (!attach()) {
      bodyObserver = new MutationObserver(() => {
        if (attach() && bodyObserver) {
          bodyObserver.disconnect();
          bodyObserver = null;
        }
      });
      bodyObserver.observe(document.body, { childList: true, subtree: true });
    }

    return () => {
      bodyObserver?.disconnect();
      sidebarObserver?.disconnect();
      if (footerDiv?.parentElement) {
        footerDiv.parentElement.classList.remove(
          "openui-shell-sidebar-container--with-user-footer",
        );
        footerDiv.remove();
      }
      setMountNode(null);
    };
  }, []);

  if (!mountNode) return null;
  return createPortal(<UserMenu user={user} onLogout={onLogout} />, mountNode);
}
