/**
 * Polyfill pra `crypto.randomUUID` em contextos não-secure (HTTP em IP
 * que não é localhost). O browser SÓ expõe `crypto.randomUUID` em
 * secure contexts (HTTPS ou localhost) — em HTTP não-localhost ele é
 * `undefined` e quem chama estoura `TypeError: not a function`.
 *
 * `crypto.getRandomValues` está disponível em qualquer contexto, então
 * implementamos UUID v4 usando ele. Se nem isso existir (Node sem WebCrypto),
 * cai num fallback baseado em Math.random — não-criptográfico, mas funcional.
 */
type RandomUuid = () => `${string}-${string}-${string}-${string}-${string}`;

function uuidV4FromBytes(buf: Uint8Array): string {
  buf[6] = (buf[6] & 0x0f) | 0x40; // version 4
  buf[8] = (buf[8] & 0x3f) | 0x80; // variant RFC 4122
  const hex = Array.from(buf, (b) => b.toString(16).padStart(2, "0"));
  return (
    hex.slice(0, 4).join("") +
    "-" +
    hex.slice(4, 6).join("") +
    "-" +
    hex.slice(6, 8).join("") +
    "-" +
    hex.slice(8, 10).join("") +
    "-" +
    hex.slice(10, 16).join("")
  );
}

export function installCryptoPolyfill(): void {
  if (typeof crypto === "undefined") return;
  const c = crypto as Crypto & { randomUUID?: RandomUuid };
  if (typeof c.randomUUID === "function") return;

  const replacement: RandomUuid = function randomUUIDPolyfilled() {
    const buf = new Uint8Array(16);
    if (typeof c.getRandomValues === "function") {
      c.getRandomValues(buf);
    } else {
      for (let i = 0; i < 16; i++) buf[i] = (Math.random() * 256) | 0;
    }
    return uuidV4FromBytes(buf) as ReturnType<RandomUuid>;
  };

  try {
    Object.defineProperty(c, "randomUUID", {
      value: replacement,
      writable: true,
      configurable: true,
    });
  } catch {
    // último recurso — alguns browsers congelam o objeto crypto
    (c as unknown as { randomUUID: RandomUuid }).randomUUID = replacement;
  }
}
