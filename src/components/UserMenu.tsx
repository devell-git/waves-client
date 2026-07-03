import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import type { CSSProperties } from "react";
import type { WavesUser } from "../types/auth";
import { useThemeControls } from "../hooks/use-system-theme";
import { isAdmin } from "../lib/message-meta";
import { useTenantTheme } from "../lib/themes";

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

function isMobileLayout(trigger: HTMLElement): boolean {
  if (trigger.closest(".openui-shell-container--mobile")) return true;
  if (trigger.closest(".chat-shell-body.nav-open")) return true;
  return window.matchMedia("(max-width: 900px)").matches;
}

/** Rail estreito no desktop — popover abre à direita do avatar. */
function isDesktopCollapsedRail(trigger: HTMLElement): boolean {
  if (isMobileLayout(trigger)) return false;
  const sidebar = trigger.closest(".openui-shell-sidebar-container");
  if (!sidebar) return false;
  return (
    sidebar.classList.contains("openui-shell-sidebar-container--collapsed") ||
    sidebar.getAttribute("data-sidebar-visual-state") === "collapsed"
  );
}

function computePopoverStyle(trigger: HTMLElement): CSSProperties {
  const rect = trigger.getBoundingClientRect();
  const pad = 8;
  const viewportW = window.innerWidth;

  if (isDesktopCollapsedRail(trigger)) {
    return {
      position: "fixed",
      left: rect.right + 8,
      bottom: window.innerHeight - rect.bottom,
      minWidth: "11.5rem",
      width: "max-content",
      maxWidth: viewportW - rect.right - 16,
    };
  }

  // Mobile e sidebar expandida: menu acima do botão, largura limitada à tela
  const width = Math.min(rect.width, viewportW - pad * 2);
  const left = Math.min(
    Math.max(pad, rect.left),
    viewportW - width - pad,
  );

  return {
    position: "fixed",
    left,
    width,
    maxWidth: viewportW - pad * 2,
    bottom: window.innerHeight - rect.top + 6,
  };
}

export function UserMenu({ user, onLogout }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>({});
  const { mode, toggle } = useThemeControls();
  const { presetName, allPresets, switchPreset } = useTenantTheme();
  const navigate = useNavigate();
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
        {isAdmin() && (
          <>
            <div className="user-menu-separator" role="separator" />
            <button
              type="button"
              className="user-menu-item"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                navigate("/admin/architecture");
              }}
            >
              <span className="user-menu-item-label">Architecture Explorer</span>
            </button>
            <button
              type="button"
              className="user-menu-item"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                navigate("/admin/soc");
              }}
            >
              <span className="user-menu-item-label">SOC Dashboard</span>
            </button>
            <button
              type="button"
              className="user-menu-item"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                navigate("/admin/tokens");
              }}
            >
              <span className="user-menu-item-label">Consumo de Tokens</span>
            </button>
            <div className="user-menu-separator" role="separator" />
            <div className="user-menu-section-label">Tema visual</div>
            {Object.entries(allPresets).map(([key, p]) => (
              <button
                key={key}
                type="button"
                className={`user-menu-item${key === presetName ? " user-menu-item--active" : ""}`}
                role="menuitemradio"
                aria-checked={key === presetName}
                onClick={() => switchPreset(key)}
              >
                <span
                  className="user-menu-theme-swatch"
                  style={{ background: `linear-gradient(135deg, ${p.dark.primary}, ${p.dark.accent})` }}
                  aria-hidden="true"
                />
                <span className="user-menu-item-label">{p.name}</span>
                <span className="user-menu-item-hint">{p.segment}</span>
              </button>
            ))}
          </>
        )}
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
