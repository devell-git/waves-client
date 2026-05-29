import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CSSProperties } from "react";
import type { WavesUser } from "../types/auth";
import { useThemeControls } from "../hooks/use-system-theme";

interface UserMenuProps {
  user: WavesUser;
  onLogout: () => void;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function isSidebarCollapsed(trigger: HTMLElement): boolean {
  const sidebar = trigger.closest(".openui-shell-sidebar-container");
  if (!sidebar) return false;
  return (
    sidebar.classList.contains("openui-shell-sidebar-container--collapsed") ||
    sidebar.getAttribute("data-sidebar-visual-state") === "collapsed"
  );
}

function computePopoverStyle(trigger: HTMLElement): CSSProperties {
  const rect = trigger.getBoundingClientRect();
  const collapsed = isSidebarCollapsed(trigger);

  if (collapsed) {
    return {
      position: "fixed",
      left: rect.right + 8,
      bottom: window.innerHeight - rect.bottom,
      minWidth: "11.5rem",
      width: "max-content",
    };
  }

  return {
    position: "fixed",
    left: rect.left,
    width: rect.width,
    bottom: window.innerHeight - rect.top + 6,
  };
}

export function UserMenu({ user, onLogout }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>({});
  const { mode, toggle } = useThemeControls();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;

    const update = () => {
      if (triggerRef.current) {
        setPopoverStyle(computePopoverStyle(triggerRef.current));
      }
    };

    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        popoverRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const isDark = mode === "dark";

  const popover =
    open &&
    createPortal(
      <div
        ref={popoverRef}
        className="user-menu-popover user-menu-popover--portal"
        style={popoverStyle}
        role="menu"
      >
        <button
          type="button"
          className="user-menu-item"
          role="menuitemcheckbox"
          aria-checked={isDark}
          onClick={() => toggle()}
        >
          <span className="user-menu-item-label">
            Tema {isDark ? "dark" : "claro"}
          </span>
          <span className="user-menu-theme-pill" aria-hidden="true">
            <span
              className={`user-menu-theme-thumb ${isDark ? "dark" : "light"}`}
            />
          </span>
        </button>
        <div className="user-menu-separator" role="separator" />
        <button
          type="button"
          className="user-menu-item user-menu-item-danger"
          role="menuitem"
          onClick={() => {
            setOpen(false);
            onLogout();
          }}
        >
          <span className="user-menu-item-label">Sair</span>
        </button>
      </div>,
      document.body,
    );

  return (
    <div className="user-menu">
      {popover}
      <button
        ref={triggerRef}
        type="button"
        className="user-menu-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={user.email ?? user.name}
      >
        <span className="user-menu-avatar" aria-hidden="true">
          {initials(user.name)}
        </span>
        <span className="user-menu-info">
          <span className="user-menu-name">{user.name}</span>
          {user.email && <span className="user-menu-email">{user.email}</span>}
        </span>
        <span className="user-menu-chevron" aria-hidden="true">
          {open ? "▾" : "▴"}
        </span>
      </button>
    </div>
  );
}
