/**
 * Export Normalizers — um por componente OpenUI.
 * Cada normalizer entende a estrutura do seu componente e produz HTML semântico.
 */
export { normalizeCards } from "./card";
export { normalizeAlerts } from "./alert";
export { normalizeChecklists } from "./checklist";
export { normalizeKpis } from "./kpi";
export { normalizeButtons } from "./buttons";
export { normalizeDetails } from "./details";
export { normalizeTables } from "./table";
export { cleanupSvgs } from "./svg";

import { cleanupSvgs } from "./svg";
import { normalizeCards } from "./card";
import { normalizeAlerts } from "./alert";
import { normalizeChecklists } from "./checklist";
import { normalizeKpis } from "./kpi";
import { normalizeButtons } from "./buttons";
import { normalizeDetails } from "./details";
import { normalizeTables } from "./table";

/**
 * Aplica TODOS os normalizers na ordem correta.
 * Chamar no clone DOM antes de enviar ao backend.
 */
export function normalizeForExport(clone: HTMLElement): void {
  // Ordem importa: SVGs primeiro, depois estrutural, depois cleanup
  cleanupSvgs(clone);
  normalizeKpis(clone);
  normalizeCards(clone);
  normalizeAlerts(clone);
  normalizeChecklists(clone);
  normalizeDetails(clone);
  normalizeTables(clone);
  normalizeButtons(clone);  // por último — remove follow-ups
}
