export interface EnvConfig {
  url: string;
  token: string;
}

function readEnv(key: string): string {
  return import.meta.env[key]?.trim() ?? "";
}

/** Ambiente fixo: produção (waves.devell.com.br), configurado via .env */
export const WAVES_ENVIRONMENT = "prod" as const;

export function getEnvConfig(): EnvConfig {
  return {
    url: readEnv("VITE_WAVES_URL") || readEnv("VITE_WAVES_PROD_URL"),
    token: readEnv("VITE_WAVES_TOKEN") || readEnv("VITE_WAVES_PROD_TOKEN"),
  };
}

export function isEnvConfigured(): boolean {
  const cfg = getEnvConfig();
  return cfg.url.length > 0 && cfg.token.length > 0;
}

export function getEnvironmentLabel(): string {
  return "Waves";
}
