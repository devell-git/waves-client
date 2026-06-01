export type UserPersona = "workflows" | "assistants" | "mixed" | "general";

export const PERM = {
  VIEW_WORKFLOW: "view-workflow",
  VIEW_ASSISTANT: "view-assistant",
  VIEW_OWN_ASSISTANT: "view-own-assistant",
  CREATE_BOOKING: "create-booking",
  MANAGE_BOOKING_CALENDAR: "manage-booking-calendar",
  VIEW_CAMPAIGN: "view-campaign",
} as const;

export function hasPermission(
  permissions: readonly string[],
  permission: string,
): boolean {
  return permissions.includes(permission);
}

/** Admin = role ou type contendo "admin" (vem no escopo do login). */
export function isAdminUser(
  roles: readonly string[] | undefined,
  userType?: string,
): boolean {
  return (
    (roles ?? []).some((r) => /admin/i.test(r)) ||
    (userType != null && /admin/i.test(userType))
  );
}

export function canAccessWorkflows(permissions: readonly string[]): boolean {
  return hasPermission(permissions, PERM.VIEW_WORKFLOW);
}

export function canAccessAssistants(permissions: readonly string[]): boolean {
  return (
    hasPermission(permissions, PERM.VIEW_ASSISTANT) ||
    hasPermission(permissions, PERM.VIEW_OWN_ASSISTANT)
  );
}

export function canAccessBookings(permissions: readonly string[]): boolean {
  return (
    hasPermission(permissions, PERM.CREATE_BOOKING) ||
    hasPermission(permissions, PERM.MANAGE_BOOKING_CALENDAR) ||
    permissions.some((p) => p.includes("booking"))
  );
}

export function canAccessCampaigns(permissions: readonly string[]): boolean {
  return hasPermission(permissions, PERM.VIEW_CAMPAIGN);
}

export function derivePersona(permissions: readonly string[]): UserPersona {
  const workflows = canAccessWorkflows(permissions);
  const assistants = canAccessAssistants(permissions);
  if (workflows && assistants) return "mixed";
  if (workflows) return "workflows";
  if (assistants) return "assistants";
  return "general";
}

export function personaLabel(persona: UserPersona): string {
  switch (persona) {
    case "workflows":
      return "Workflows";
    case "assistants":
      return "Assistentes";
    case "mixed":
      return "Workflows + Assistentes";
    default:
      return "Geral";
  }
}
