import { createContext, useContext } from "react";

/**
 * Thread (curta) que está sendo EXIBIDA no momento. Provida pelo ChatPage em
 * volta do Shell, dentro do ChatProvider. Permite que componentes renderizados
 * pela lib (ThinkingIndicator no `loader`, JobProgressCard nas mensagens) saibam
 * a qual thread pertencem — sem isso o estado da lib é global e vaza entre chats.
 */
export const ActiveThreadContext = createContext<string>("");

export function useActiveThreadId(): string {
  return useContext(ActiveThreadContext);
}
