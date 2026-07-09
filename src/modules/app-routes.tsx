/**
 * Registro de módulos/rotas do WebApp — gated por permissão da Waves.
 *
 * Ponto de extensão pro Integration Manager e futuros módulos admin sem
 * espalhar `<Route>` soltos no App.tsx.
 */
import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { ArchitectureExplorer } from "../components/architecture/ArchitectureExplorer";
import { SOCDashboard } from "../components/soc/SOCDashboard";
import { TokenDashboard } from "../components/tokens/TokenDashboard";
import { isAdminUser } from "../lib/permissions";
import type { AuthSession } from "../types/auth";

export interface AppRouteDef {
  path: string;
  /** Se definido, exige admin (role/type). Futuro: permissão granular da Waves. */
  adminOnly?: boolean;
  /** Permissão Waves futura (ex.: integration.manage) — reservado. */
  permission?: string;
  element: (session: AuthSession) => ReactNode;
}

export const APP_ROUTES: AppRouteDef[] = [
  {
    path: "/admin/architecture",
    adminOnly: true,
    element: (s) => <ArchitectureExplorer session={s} />,
  },
  {
    path: "/admin/soc",
    adminOnly: true,
    element: (s) => <SOCDashboard session={s} />,
  },
  {
    path: "/admin/tokens",
    adminOnly: true,
    element: (s) => <TokenDashboard session={s} />,
  },
  // Reservado — Integration Manager (Fase futura):
  // { path: "/admin/integrations", permission: "integration.manage", element: ... }
];

export function renderGuardedRoute(
  def: AppRouteDef,
  session: AuthSession | null,
): ReactNode {
  if (!session) return <Navigate to="/login" replace />;
  if (def.adminOnly && !isAdminUser(session.roles, session.user.type)) {
    return <Navigate to="/chat" replace />;
  }
  // TODO: quando waves-core expuser permission, checar def.permission aqui.
  return def.element(session);
}
