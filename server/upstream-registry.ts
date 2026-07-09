/**
 * Registro leve de upstreams HTTP do BFF Express.
 *
 * Hoje só Waves; futuros módulos (integration-core) entram aqui como mais um
 * upstream configurado — sem espalhar fetch/proxy pelo index.
 */
import type { Tenant } from "./tenants.js";

export const UPSTREAM = {
  waves: {
    /** Timeout do proxy /api/waves/* (ms). */
    timeoutMs: Number(process.env.WAVES_PROXY_TIMEOUT_MS || 30_000),
    /** Monta URL upstream a partir do tenant ativo. */
    url(tenant: Tenant, path: string): string {
      const base = tenant.url.replace(/\/+$/, "");
      const p = path.startsWith("/") ? path : `/${path}`;
      return `${base}${p}`;
    },
  },
} as const;
