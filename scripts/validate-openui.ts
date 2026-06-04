// E2E do ciclo de specialist: valida que um openui-lang PARSEIA e VALIDA contra
// a shadcnChatLibrary real do waves_client (mesmo caminho do <Renderer>: parse →
// meta.errors enriquecidos pelo JSON Schema da lib). root presente + 0 erros =
// renderiza. Roda contra os artefatos reais do Vigia.
import { createParser } from "@openuidev/react-lang";
import { readFileSync } from "fs";
import { shadcnChatLibrary } from "../src/lib/shadcn-genui";

const schema = (shadcnChatLibrary as { toJSONSchema: () => unknown }).toJSONSchema();
const parser = createParser(schema as never);

function check(name: string, file: string): boolean {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    console.log(`· ${name}: (arquivo ausente — pulado)`);
    return true;
  }
  let res: { root?: unknown; meta?: { errors?: unknown[] }; errors?: unknown[] } | undefined;
  try {
    const p = parser as unknown as ((t: string) => typeof res) & { parse?: (t: string) => typeof res };
    res = typeof p === "function" ? p(text) : p.parse?.(text);
  } catch (e) {
    console.log(`✗ ${name}: parse THREW → ${(e as Error).message?.slice(0, 200)}`);
    return false;
  }
  const errors = res?.meta?.errors ?? res?.errors ?? [];
  const hasRoot = !!res?.root;
  const ok = hasRoot && errors.length === 0;
  console.log(`${ok ? "✓" : "✗"} ${name}: root=${hasRoot} · erros=${errors.length}`);
  if (errors.length) console.log("    ", JSON.stringify(errors.slice(0, 3)).slice(0, 500));
  return ok;
}

console.log("Lib:", Object.keys((shadcnChatLibrary as { components: object }).components).length, "componentes\n");
const a = check("openui DRIFTADO original (label/info/title/Accordion-no-Card)", "/tmp/vigia_ou.txt");
const b = check("openui NOVO do ghost-prompt corrigido (text/trigger/variants válidos)", "/tmp/render2_ou.txt");
process.exit(a && b ? 0 : 1);
