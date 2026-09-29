# Status — Vida Samambaia

- 23/09/2026 — Plataforma criada como clone limpo do ORION (água-condominio @ rodada 15j2):
  REMOVIDOS: seed ORION, importador de histórico + flag + dados embutidos, ocr.js/eng.traineddata,
  docs do ORION. RECORADO com a identidade Vida Samambaia (laranja #ea580c/#f97316 sobre
  grafite quente; logo oficial no login e na sidebar; títulos trocados).
- Banco: vazio de fábrica — condomínio/unidades/gestores entram pelas telas.
- Endereço alvo: https://agua-vidasamambaia.onrender.com (via render.yaml).
- Manutenção: melhorias do ORION são portadas por zip quando pedidas pelo Vanderson.

## Teste E2E de fábrica (29/09, porta 3002, banco descartado depois)
login admin ✓ · criar condomínio com logo jpeg + 3 unidades + modo duplo ✓ · criar mês ✓ · leituras com cálculo por faixa (101: 12,5 m³ → R$ 115,16) ✓ · bloqueio correto de área comum negativa (global < soma) ✓ · global 400 → finalizar (comum R$ 157,56) ✓ · medidor+3 leituras diárias ✓ · relatório diário com título "VIDA SAMBAIA" e SVG ✓ · logo servida como asset (26.644 b) ✓ · resumo ✓.
Obs.: o insucesso inicial de login nos testes era MASCARAMENTO da ferramenta do ambiente (a senha 'admin…' virava '***' no comando) — não é bug do app.

## Correção (29/09) — tela congelada em banco 100% vazio
Bug: em `route()` (public/js/app.js), admin sem NENHUM condomínio caía em redirecionamento morto para `#/condominios` (o guard `!state.condo` bloqueava a própria tela de cadastro) → tudo parecia desabilitado. ORION nunca mostrou o bug porque sempre teve condomínio.
Fix: liberar a view `condominios` para admin sem condomínio: `if (!state.condo && !(state.isAdmin && view === 'condominios')) { ... }`.
Verificado com jsdom contra o servidor local (banco vazio): os 4 hashes (#/usuarios, #/lancamento, #/dashboard, #/condominios) renderizam a tela de cadastro (nc-salvar presente); clique em Cadastrar sem logo é corretamente barrado (logo obrigatória).
zip `agua-vidasamambaia-inicial.zip` atualizado com a correção; arquivo único p/ upload no GitHub em /home/user/para-subir/app.js.
Pendência futura (combinar c/ usuário): portar o mesmo fix ao ORION (inofensivo lá, mas o clone é que recebe melhorias — manter os dois iguais).

## Melhoria (29/09) — cadastro de torres com TRECHOS variáveis
Pedido do usuário (Samambaia real: térreo 11 unidades; pavimentos-tipo 12; Torre C tem 3º com 5 e andares 4-11; garagem sem unidades).
`public/js/app.js`: cada torre agora aceita N trechos "faixa de andares + unidades/andar" (botão "+ Adicionar trecho", ✕ remove, aceita piso único "3" e térreo "0"); default da primeira torre passou a ser A com linha VAZIA (antes já nascia "A 2-15×6" e contaminava a contagem). Coleta por trecho em `coletarUnidades`; etiquetas `${andar}${NN}${torre}` (convenção aprovada: 001A..011A térreo, 101A.., 1012A).
Teste jsdom E2E com o layout real A/B/C → **363 unidades configuradas** (131+131+101), primeiras etiquetas 001A,002A,003A,004A ✔; node --check ✔.
zip `agua-vidasamambaia-inicial.zip` atualizado; arquivo p/ update no GitHub em /home/user/para-subir/app.js.
Pendência (combinar): portar p/ ORION — trechos + fix do banco vazio.

## Nova função (29/09) — MEDIÇÃO INICIAL (hidrômetro + leitura antes da ocupação, sem cobrança)
Pedido: prédio novo (Samambaia), mudança 02/10; precisa colher 1ª leitura sem faturar e cadastrar nº do hidrômetro junto.
- db.js: campos `leitura_inicial`/`data_leitura_inicial` no apartamento + `getIniciais()/setIniciais()` (valida ≥0, salva hidrômetro, logAction 'medicao_inicial'); `upsertReading` e `getMonthDetail`: na falta de mês anterior, leitura_anterior cai automaticamente na medição inicial (`tem_baseline` reflete); status vira `pendente` (não `sem_anterior`) quando há inicial.
- server.js: `GET/PUT /api/medicao-inicial` (escopo por condomínio via condo padrão).
- app.html: botão sidebar "Medição Inicial" (desktop+mobile).
- app.js: `renderIniciais()` — tabela Unidade | Nº hidrômetro | Leitura m³ | Situação, data única no topo, autosave on-change, progresso "X de N preenchidas" (contagem inicial via dados — corrigido bug de calcular antes do innerHTML); aba oculta em condomínio só-diário (mesmo guard de mensal).
Testes (banco limpo :3002): PUT 3 iniciais → mês 2026-10 criado SEM valor global → lançamento sem anterior manual → 001A ant 12.3/atual 25.3/cons 13/R$120,30 lido; 101A ant 100 → 18 m³ R$212,28; 102A pendente com ant 80,55; PUT negativa → 400 com mensagem; auditoria medicao_inicial ✓. jsdom: botão presente, tabela 3 linhas, progresso 3/3, autosave persiste 81 ✓.
Zip atualizado; para-subir/ com os 4 arquivos (db.js, server.js, public/app.html, public/js/app.js).
Pendência (combinar): portar p/ ORION tudo acumulado (fix banco vazio + trechos de torre + medição inicial).

## Expansão MEDIÇÃO INICIAL (29/09) — foto-prova + modo guiado + link público
Pedido: (1) foto na 1ª medição como prova; (2) link para DEMANDAR a medição inicial (morador/equipe, sem login); (3) modo guiado apartamento a apartamento, com escolha de início e sentido baixo→cima / cima→baixo.
- db.js: `apt.foto_inicial` (asset) no set/getIniciais; setIniciais retorna {salvos, apagar} (assets substituídos são apagados); skip foto-only corrigido; tabela `inicial_links` (getOrCreate/find/listAtivos), logações criar_link_inicial/medicao_inicial.
- server.js: PUT /api/medicao-inicial aceita `foto` dataURL→asset (prefixo inicial_<condo>_<apt>_) e devolve nome; POST /api/apartamentos/:id/link-inicial; GET /api/medicao-inicial/links (massa); PÚBLICO: GET /api/inicial-info?token + POST /api/inicial-envio (token no corpo) — added to `publico`; serveStatic: /i e /inicial → inicial.html.
- public/inicial.html + public/js/inicial.js: página do morador (mobile-first, laranja, logo embutida via dataURL, sem login): nº hidrômetro + leitura m³ + data + foto com CARIMBO (canvas, reusa padrão do app) → envio; ecrã de sucesso + "corrigir".
- app.js renderIniciais v2: lista ganhou colunas Foto (📷/) e Link (🔗 abre modal com URL + copiar + botão WhatsApp), toolbar [🧭 Modo guiado][🔗 Gerar links de todas as unidades (TXT)]. Guiado: sentido (baixo→cima/cima→baixo por torre+número), "começar de" (datalist), "só pendentes", cartão único por unidade com validação e auto-avanço; fim = tela de conclusão.
Testes (banco limpo :3002, 3 un.): foto-only PUT → asset 200; link → info/envio SEM login gravam leitura+hid+foto+data; link inválido 404; massa → 3 links; /inicial e js 200; auditoria criar_link_inicial×3 medicao_inicial×2. jsdom: guiado 001A→salvou 33.4/S7000101→avançou 101A; página pública enviou 55.6 p/ 102A. Regressão: out/2026 sem anterior manual → ant 33.4, cons 8 m³, R$ 68,80, lido. node --check ×3.
