/**
 * Info do runtime do server (profile ativo + starters contextuais).
 */
export interface ProfileStarterFormField {
  name: string;
  label: string;
  placeholder?: string;
  type?: "text" | "number" | "email";
  required?: boolean;
}

export interface ProfileStarter {
  displayText: string;
  prompt: string;
  /** Quando presente, click abre form local em vez de mandar prompt direto. */
  formFields?: ProfileStarterFormField[];
  /** Template aplicado após submit do form. `{{name}}` → valor. */
  submitPromptTemplate?: string;
}

export interface RuntimeInfo {
  provider: string;
  profile: string;
  port: string;
  defaultStarters: ProfileStarter[];
  model: string;
}

export async function fetchRuntime(profileId?: string): Promise<RuntimeInfo | null> {
  try {
    const url = profileId
      ? `/api/runtime?profile=${encodeURIComponent(profileId)}`
      : "/api/runtime";
    const r = await fetch(url);
    if (!r.ok) return null;
    return (await r.json()) as RuntimeInfo;
  } catch {
    return null;
  }
}
