/**
 * Relatórios demo em openui-lang — retornados pelo Express quando o user
 * envia uma mensagem especial (ex.: `__demo_cnpj__`). Pula o LLM totalmente.
 *
 * Servem 2 propósitos:
 *  1. Demo da renderização rica (visual modelo IBRACEM) sem depender da
 *     pipeline de busca (Bing/DuckDuckGo bloqueiam por CAPTCHA hoje).
 *  2. Few-shot canônico — mesmo conteúdo está no SOUL do profile, então
 *     o agente "vê" como deve ser e reproduz quando tiver dados reais.
 *
 * Base: PDF `modelo_relatorio_de_medias.pdf` do profile ybrax-negative-media
 *       (caso Nuno Coelho — Operação Gotham City, ago/2017).
 */

/**
 * Relatório completo do caso Nuno Coelho em openui-lang.
 * Estrutura segue o modelo do PDF: header + kpis + sumario + Accordion(12) +
 * cronograma + envolvidos + alerta monitoramento + classificação final +
 * followups.
 */
export const DEMO_RELATORIO_NUNO = `
root = Card([header, kpis, sumario, partI, partII, alertaMon, classFinal, followUps])

header = CardHeader("RELATÓRIO DE MÍDIA ADVERSA", "Avaliação de Risco Reputacional · Metodologia IBRACEM")

kpis = TagBlock([tConsultado, tCpf, tSolicitante, tData, tValidade, tRisco])
tConsultado  = Tag("Consultado: Nuno Canhão Bernardes Gonçalves Coelho", "default")
tCpf         = Tag("CPF: 005.344.469-81", "secondary")
tSolicitante = Tag("Solicitante: Tribeca Capital Intl · CNPJ 57.080.815/0001-45", "outline")
tData        = Tag("Análise: 25/05/2026", "outline")
tValidade    = Tag("Validade: 23/08/2026", "outline")
tRisco       = Tag("Risco: CRÍTICO", "destructive")

sumario = Card([sumHeader, alertRisco, sumText])
sumHeader = CardHeader("Sumário Executivo")
alertRisco = Alert("RISCO CONSOLIDADO: CRÍTICO", "Concentração em eixo único de gravidade máxima: prisão preventiva por lavagem de dinheiro (Operação Gotham City — desdobramento da Lava Jato/RJ).", "destructive")
sumText = TextContent("Foram identificadas **5 notícias adversas relevantes** que mencionam diretamente o nome do consultado. Padrão: evento isolado de alta densidade midiática, sem recorrência posterior. Atualidade moderada (ago/2017) mas natureza crítica preserva relevância para PLD/FT, KYC e Due Diligence.", "default")

partI = Card([partIHeader, acc])
partIHeader = CardHeader("PARTE 1 — Notícia de Maior Risco")
acc = Accordion([ac1, ac2, ac3, ac4, ac5, ac6, ac7, ac8, ac9, ac10, ac11, ac12], "single")
ac1  = AccordionItemDef("1",  "1. Nome do Consultado",          [tc1])
ac2  = AccordionItemDef("2",  "2. Título da Notícia",            [tc2])
ac3  = AccordionItemDef("3",  "3. Nome do Veículo",              [tc3])
ac4  = AccordionItemDef("4",  "4. Data de Publicação",           [tc4])
ac5  = AccordionItemDef("5",  "5. Classificação do Risco",       [alert5])
ac6  = AccordionItemDef("6",  "6. Análise do Risco (5 pilares)", [tc6])
ac7  = AccordionItemDef("7",  "7. Cronograma dos Fatos",         [cronoTable])
ac8  = AccordionItemDef("8",  "8. Histórico de Conduta",          [tc8])
ac9  = AccordionItemDef("9",  "9. Manifestação do Consultado",   [tc9])
ac10 = AccordionItemDef("10", "10. Envolvidos na Notícia",        [envolvidosTable])
ac11 = AccordionItemDef("11", "11. Resumo da Matéria",            [tc11])
ac12 = AccordionItemDef("12", "12. Link da Notícia",              [linkBtn])

tc1  = TextContent("Empresário, sócio das empresas VCG Empreendimentos Imobiliários e Koios Participações. Codinome \\"Batman\\" na investigação. **Tipificação**: alvo direto de mandado de prisão preventiva expedido pelo juiz federal Marcelo Bretas (7ª Vara Criminal Federal/RJ). Investigado como operador de esquema de lavagem de dinheiro em benefício de agente público corrupto.", "default")
tc2  = Blockquote("\\"Empresários alvos da Gotham City lavavam dinheiro para esquema de propina dos ônibus no Rio\\"")
tc3  = TextContent("**Jovem Pan News** — confirmação cruzada no G1/Globo (fonte primária da prisão).", "default")
tc4  = TextContent("09/08/2017", "default")
alert5 = Alert("CRÍTICO", "Prisão preventiva decretada por juiz federal da Lava Jato/RJ + crime de lavagem de dinheiro + magnitude da operação (R$ 500 mi em propinas).", "destructive")
tc6  = TextContent("(a) **Tipificação**: prisão preventiva decretada por juiz federal — embora sem trânsito em julgado, a decretação por Marcelo Bretas indica provas suficientes para custódia cautelar.\\n\\n(b) **Tipo de crime**: lavagem de dinheiro — um dos crimes mais graves sob ótica de PLD/FT/KYC/compliance. Esquema envolveu subavaliação dolosa de imóveis em cartório (declarados 50% do valor real), configurando fraude documental + ocultação de patrimônio ilícito.\\n\\n(c) **Magnitude**: parte de operação que apurou **R$ 500 milhões em propinas** pagas a agentes públicos do RJ (R$ 144,7mi a Sérgio Cabral; R$ 43,4mi a Rogério Onofre).\\n\\n(d) **Comprovação**: alta — prisão executada + denúncia do MPF + cobertura nacional ampla.\\n\\n(e) **Impacto potencial**: máximo — restrição direta a relacionamento financeiro, contratual e societário.", "default")
cronoTable = Table([colData, colEvento])
colData   = Col("Data", "string", ["2010–2016", "Jul/2017", "08/08/2017", "09/08/2017"])
colEvento = Col("Evento", "string", ["Período investigado pela Operação Ponto Final: R$ 500 mi em propinas pagas por empresários de ônibus a agentes públicos do RJ", "Deflagração da Operação Ponto Final — megaoperação Lava Jato/RJ. Prisão de Lélis Teixeira (Fetranspor), Rogério Onofre e outros", "Sérgio Cabral vira réu pela 14ª vez na Lava Jato. MPF denuncia 23 pessoas", "Prisão preventiva do consultado em Curitiba/PR no âmbito da Operação Gotham City"])
tc8  = TextContent("**Evento isolado** — múltiplas notícias do mesmo eixo temático (Op. Gotham City/ago-2017) sem recorrência em outros períodos. Não há indícios de novos episódios adversos pós-2017 na cobertura analisada.", "default")
tc9  = TextContent("Não foi localizada manifestação pública do consultado ou de sua defesa sobre os fatos reportados nesta notícia.", "default")
envolvidosTable = Table([colNome, colQualif, colTipif])
colNome   = Col("Nome / Entidade", "string", ["Nuno Coelho (Batman)", "Guilherme Vialle (Robin)", "Rogério Onofre", "Marcelo Bretas", "Sérgio Cabral"])
colQualif = Col("Qualificação", "string", ["Empresário, sócio VCG/Koios", "Empresário, sócio VCG/Koios", "Ex-diretor Detro/RJ", "Juiz Federal — 7ª Vara Criminal/RJ", "Ex-governador do RJ"])
colTipif  = Col("Tipificação da Conduta", "string", ["Alvo direto. Preso em 09/08/2017 em Curitiba/PR. Lavagem de dinheiro em benefício de Onofre", "Alvo do 2º mandado de prisão. Foragido no exterior. Difusão Vermelha Interpol acionada", "Investigado por receber R$ 43,4 mi em propinas", "Magistrado que expediu o mandado de prisão preventiva", "Réu pela 14ª vez na Lava Jato (R$ 144,7 mi em propinas)"])
tc11 = TextContent("Os mandados de prisão foram expedidos pelo juiz Marcelo Bretas a partir de pedido do MPF. **Nuno Coelho foi preso em Curitiba/PR na manhã de 09/08/2017**. **Guilherme Vialle** não foi encontrado em nenhum dos endereços — Difusão Vermelha da Interpol acionada. Os dois empresários são sócios das empresas VCG Empreendimentos Imobiliários e Koios Participações. Segundo as investigações, **Rogério Onofre e esposa adquiriram 11 imóveis** pertencentes ao grupo dos empresários, declarando em cartório apenas **50% do custo real** — mecanismo de ocultação e lavagem do patrimônio ilícito acumulado com propinas.", "default")
linkBtn = Button("Abrir notícia original (Jovem Pan)", { type: "open_url", payload: "https://jovempan.com.br/noticias/brasil/empresarios-gotham-city-lavavam-dinheiro-onibus.html" }, "link", "default")

partII = Card([partIIHeader, demaisTable])
partIIHeader = CardHeader("PARTE 2 — Demais Notícias", "4 notícias adicionais sobre o mesmo eixo (Operação Gotham City)")
demaisTable = Table([dN, dTitulo, dVeic, dData, dRisco])
dN      = Col("#",       "number", [1, 2, 3, 4])
dTitulo = Col("Título",  "string", ["Lava Jato no Rio prende empresários por lavagem", "Operação Gotham City mira propina de ônibus no RJ", "Empresário 'Batman' é preso em Curitiba", "MPF denuncia 23 por esquema do Detro"])
dVeic   = Col("Veículo", "string", ["G1", "Folha de S.Paulo", "Gazeta do Povo", "O Globo"])
dData   = Col("Data",    "string", ["09/08/2017", "09/08/2017", "10/08/2017", "08/08/2017"])
dRisco  = Col("Risco",   "string", ["CRÍTICO", "CRÍTICO", "ALTO", "ALTO"])

alertaMon = Alert("Alerta de monitoramento judicial", "Bases públicas (Escavador/Jusbrasil) registram **81 processos judiciais** envolvendo o consultado — 64 no TJPR, 12 em SP e processos trabalhistas no TRT-9. Parte mais recorrente: Guilherme Neves Vialle (54 processos) e VCG Empreendimentos (39). Recomenda-se consulta periódica.", "warning")

classFinal = Alert("CLASSIFICAÇÃO FINAL: 🔴 RISCO CRÍTICO", "Relatório gerado em 25/05/2026 · Validade 90 dias (até 23/08/2026) · Metodologia IBRACEM", "destructive")

followUps = FollowUpBlock([fu1, fu2, fu3])
fu1 = FollowUpItem("Detalhar Guilherme Vialle (Robin) — foragido Interpol")
fu2 = FollowUpItem("Listar os 81 processos judiciais do Escavador")
fu3 = FollowUpItem("Exportar relatório como PDF")
`.trim();

/**
 * Form OpenUI Lang minimalista pra captura de CNPJ — renderizado via
 * shadcnChatLibrary. Button "Analisar" usa `continue_conversation` —
 * envia o context com os valores do form como nova mensagem pro agente.
 */
export const DEMO_FORM_CNPJ = `
root = Card([header, form])

header = CardHeader("Consultar CNPJ", "Informe o CNPJ alvo da análise de mídia adversa")

form = Form("cnpj-lookup", btns, [cnpjField])
cnpjField = FormControl("CNPJ", cnpjInput)
cnpjInput = Input("cnpj", "00.000.000/0001-00", "text", { required: true, minLength: 14 })

btns = Buttons([analyzeBtn])
analyzeBtn = Button("Analisar", { type: "continue_conversation", context: "Analise o CNPJ informado no formulário (campo cnpj) seguindo a metodologia IBRACEM completa. Use as skills do pipeline (skill_negative_media_*). Renderize o relatório em openui-lang conforme a seção RENDERIZAÇÃO POR CANAL do SOUL." }, "default")
`.trim();

/**
 * Form OpenUI Lang minimalista pra captura de CPF + nome (desambigua homônimos).
 */
export const DEMO_FORM_CPF = `
root = Card([header, form])

header = CardHeader("Consultar CPF", "Informe CPF e nome do consultado para análise de mídia adversa")

form = Form("cpf-lookup", btns, [cpfField, nameField])
cpfField = FormControl("CPF", cpfInput)
cpfInput = Input("cpf", "000.000.000-00", "text", { required: true, minLength: 11 })
nameField = FormControl("Nome completo", nameInput)
nameInput = Input("nome", "Nome do consultado", "text", { required: true, minLength: 3 })

btns = Buttons([analyzeBtn])
analyzeBtn = Button("Analisar", { type: "continue_conversation", context: "Analise o CPF informado no formulário (campo cpf) referente ao nome informado (campo nome) seguindo a metodologia IBRACEM completa. Aplique verificação de homônimos. Use as skills do pipeline (skill_negative_media_*). Renderize em openui-lang conforme RENDERIZAÇÃO POR CANAL do SOUL." }, "default")
`.trim();

/**
 * Dispatch: detecta mensagens especiais e retorna o openui-lang correspondente
 * direto (sem LLM). Retorna null se não for uma mensagem reconhecida.
 */
export function getDemoReport(userMessage: string): string | null {
  const m = userMessage.trim().toLowerCase();
  switch (m) {
    case "__demo_cnpj__":
    case "__demo_cpf__":
    case "__demo_ibracem__":
      return DEMO_RELATORIO_NUNO;
    default:
      return null;
  }
}
