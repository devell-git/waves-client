/**
 * Assinatura HMAC pras URLs de upload servidas como `src` de <img> (preview/
 * visão) — onde não dá pra mandar header `Authorization`.
 *
 * A URL `/api/uploads/<id>?o=<owner>&s=<sig>` é INFORJÁVEL: `sig` é
 * `HMAC(<id>|<tenant>|<owner>)`. Sem o segredo (`UPLOADS_SIGNING_SECRET`) não dá
 * pra forjar acesso a arquivo de outro tenant/usuário, mesmo conhecendo o UUID.
 *
 * O tenant NÃO vai na URL — vem do host (ALS) na hora do GET, então a assinatura
 * só confere se o request chega pelo mesmo tenant que gerou o upload.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

function secret(): string {
  const s = process.env.UPLOADS_SIGNING_SECRET?.trim();
  if (!s) {
    throw new Error(
      "UPLOADS_SIGNING_SECRET ausente no .env — necessário pras URLs assinadas de upload.",
    );
  }
  return s;
}

/** Assina (id, tenant, owner) → hex. */
export function signUpload(id: string, tenant: string, owner: number | string): string {
  return createHmac("sha256", secret())
    .update(`${id}|${tenant}|${owner}`)
    .digest("hex");
}

/** Confere a assinatura em tempo constante. */
export function verifyUpload(
  id: string,
  tenant: string,
  owner: number | string,
  sig: string,
): boolean {
  if (!sig || !/^[a-f0-9]{64}$/i.test(sig)) return false;
  const expected = signUpload(id, tenant, owner);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(sig, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
