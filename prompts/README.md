# Instruções do agente (system prompt)

O arquivo **`waves-system-prompt.md`** contém todas as instruções enviadas à LLM (OpenUI + regras Waves + exemplos + tools).

## Edição

1. Edite `waves-system-prompt.md` e salve.
2. O servidor recarrega o arquivo automaticamente na próxima mensagem de chat (não precisa reiniciar).

## Caminho customizado

No `.env`:

```env
WAVES_SYSTEM_PROMPT_PATH=/caminho/absoluto/meu-prompt.md
```

Se não definido, usa `prompts/waves-system-prompt.md` na raiz do projeto.
