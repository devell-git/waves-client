// Interceptor de 401/403 — DESABILITADO.
//
// O interceptor anterior fazia logout automático quando qualquer /api/*
// retornava 401 ou 403. Isso causava logout para usuários com permissões
// limitadas (ex: role Workflows sem create-document recebia 403 do agente).
// Logout agora é apenas manual (botão Sair).

/**
 * No-op. Mantido para compatibilidade com ChatPage que chama esta função.
 */
export function installAuthInterceptor(_onUnauthorized: () => void): () => void {
  return () => {};
}
