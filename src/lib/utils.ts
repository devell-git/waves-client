/**
 * Utilitário `cn(...)` — combina class names + resolve conflitos Tailwind.
 * Padrão shadcn/ui. Requer `clsx` + `tailwind-merge` (instalados nesta migração).
 */
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
