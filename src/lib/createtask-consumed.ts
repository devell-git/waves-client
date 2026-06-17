/**
 * Dedupe do auto-open do modal "nova tarefa".
 *
 * A diretiva `open_create_task: {...}` é uma MENSAGEM persistida no histórico do
 * thread (state.db do Hermes). Sem guarda, o `CreateTaskTrigger` re-dispara o
 * `waves:create-task` toda vez que a mensagem é renderizada — ou seja, a cada
 * reload da página e a cada troca de conversa — reabrindo o modal mesmo depois
 * de o usuário ter fechado (o "modal zumbi").
 *
 * Aqui registramos cada diretiva já consumida → auto-abre 1x por diretiva.
 * Chave = thread + conteúdo: `id`/`timestamp` NÃO são estáveis entre a mensagem
 * AO VIVO (id = uuid aleatório, sem timestamp) e a RESTAURADA (id do servidor),
 * mas o conteúdo é — é a mesma chave que o ThreadRestorer usa pra deduplicar
 * histórico vs. atalhos. Persistido em localStorage pra sobreviver a reload,
 * troca de chat e reabrir a aba.
 */
const LS_KEY = "waves:createtask-consumed";
const MAX_ENTRIES = 200; // FIFO; cada diretiva é minúscula, isto é só anti-crescimento

// Thread ativa (gravada pelo ChatPage no render, igual ao padrão do kanban-context).
let activeThreadKey = "";

export function setCreateTaskThreadKey(key: string): void {
  activeThreadKey = key || "";
}

function load(): string[] {
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(arr) ? (arr as string[]) : [];
  } catch {
    return [];
  }
}

function persist(list: string[]): void {
  try {
    const trimmed =
      list.length > MAX_ENTRIES ? list.slice(list.length - MAX_ENTRIES) : list;
    window.localStorage.setItem(LS_KEY, JSON.stringify(trimmed));
  } catch {
    /* storage cheio/indisponível — dedupe degrada, não quebra o chat */
  }
}

function keyFor(content: string): string {
  return `${activeThreadKey}::${content.trim()}`;
}

/** True se esta diretiva JÁ foi consumida antes (→ não reabrir sozinho). */
export function wasCreateTaskConsumed(content: string): boolean {
  return load().includes(keyFor(content));
}

/** Marca a diretiva como consumida (idempotente). */
export function consumeCreateTask(content: string): void {
  const list = load();
  const k = keyFor(content);
  if (list.includes(k)) return;
  list.push(k);
  persist(list);
}
