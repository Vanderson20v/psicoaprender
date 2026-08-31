# PsicoAprender Gestão
**Organização para cuidar melhor.**

Sistema de gestão para clínica de psicopedagogia e desenvolvimento infantil, com site institucional público.
Feito para uso diário no computador e, principalmente, no tablet durante o atendimento.

---

## Como executar

```bash
cd piscoaprender
npm install      # express + cookie-parser (sem dependências nativas)
npm start        # http://localhost:3000
```

| Endereço | Conteúdo |
|---|---|
| `/` | Site institucional público |
| `/entrar.html` | Login do sistema |
| `/sistema.html` | Painel de gestão (SPA) |

### Acessos de demonstração (senha `psico123`)

| Perfil | E-mail | Acesso |
|---|---|---|
| Administrador | vanessa@psicoaprender.com.br | Total |
| Profissional | marina@psicoaprender.com.br | Apenas seus pacientes e registros |
| Administrativo | recepcao@psicoaprender.com.br | Agenda e financeiro; sem dados clínicos |

Os dados de demonstração (10 pacientes, ~6 meses de agenda, diários, faltas, financeiro, documentos)
são criados na primeira execução. Para recomeçar do zero: apague `data/db.json`.

---

## Arquitetura

```
server/
  index.js   API REST (Express 5) — rotas de todos os módulos
  db.js      Camada de persistência: JSON transacional com escrita atômica
  auth.js    Sessões, hash scrypt, perfis de acesso, auditoria
  seed.js    Carga inicial e dados de demonstração
public/
  index.html          site institucional
  entrar.html         login / recuperação de senha
  sistema.html        casca da SPA
  assets/sistema.css  identidade visual e sistema de componentes
  app/core.js               API, utilidades, layout, busca global, rotas
  app/paginas-clinicas.js   dashboard, agenda, pacientes, perfil, diário, evolução
  app/paginas-gestao.js     atendimentos, relatórios, financeiro, documentos, equipe, config
data/
  db.json    banco  ·  arquivos/  documentos anexados  ·  backups/  cópias geradas
teste-fumaca.js  percorre todas as telas e modais em jsdom (node teste-fumaca.js)
```

Front-end sem framework nem build: carrega instantaneamente no tablet e não depende de CDN.
A camada `db.js` isola o armazenamento — trocar por PostgreSQL/SQLite exige reimplementar apenas
`find/insert/update/remove`, sem tocar nas rotas.

---

## Modelo de dados

| Entidade | Campos principais | Relações |
|---|---|---|
| `usuarios` | nome, email, senha (scrypt), papel, profissional_id, ativo, ultimo_acesso | 1:1 profissional |
| `profissionais` | nome, profissão, registro, contato, cor, status | 1:N pacientes/atendimentos |
| `pacientes` | dados básicos, status, organização do atendimento (frequência, dia, horário, valor, vencimento), campos pedagógicos, reavaliação | N:1 profissional |
| `responsaveis` | nome, parentesco, telefone, whatsapp, e-mail, principal | N:1 paciente |
| `atendimentos` | data, hora, duração, tipo, status, recorrencia_id, valor | N:1 paciente e profissional |
| `registros` | diário da sessão: objetivo, atividades, recursos, comportamento, desempenho, evolução, dificuldades, orientações + `areas{}` (11 áreas × 4 níveis) | 1:1 atendimento |
| `bloqueios` | data, intervalo, tipo (férias, reunião, almoço, feriado) | N:1 profissional (ou clínica) |
| `pagamentos` | competência, descrição, sessões, valor, vencimento, pago_em, forma, status | N:1 paciente |
| `faltas` | motivo, aviso prévio, reposição, cobrado | 1:1 atendimento |
| `documentos` | nome, categoria, tipo, tamanho, referência do arquivo, enviado_por | N:1 paciente |
| `relatorios` | tipo, período, conteúdo por seção, status | N:1 paciente/profissional |
| `templates` | modelos de registro de sessão | N:1 profissional |
| `logs` | usuário, ação, entidade, detalhe, IP, data/hora | auditoria |
| `sessoes` | token, expiração, IP, agente | controle de login |

---

## Módulos

- **Dashboard** — próximo atendimento em destaque, agenda do dia, resumo (agendados/realizados/faltas/cancelamentos/horários livres), financeiro do mês e alertas. Sem gráficos decorativos.
- **Agenda** — visões dia, semana e mês; criação de série recorrente (semanal/quinzenal, até 60 sessões); bloqueios; confirmação, falta, cancelamento, reagendamento e registro do atendimento no mesmo modal.
- **Pacientes / Perfil** — abas Resumo, Agenda, Diário, Evolução, Documentos e Financeiro. O Resumo mostra "antes do atendimento": objetivo, queixa e o último registro completo.
- **Diário de atendimento** — formulário rápido: 11 áreas em botões de toque (Não trabalhado / Em desenvolvimento / Evoluindo / Consolidado) + campos de texto, com modelos reutilizáveis e aviso ao sair com alterações não salvas.
- **Evolução** — linha do tempo filtrável (30/90/180 dias ou período livre) e indicadores por área calculados só a partir do que foi registrado. O sistema não redige nem infere conteúdo clínico.
- **Relatórios** — as seções vêm pré-preenchidas com os textos já registrados no período, revisáveis antes de gerar; documento com marca, dados do paciente, registro profissional, assinatura, rodapé e exportação em PDF (impressão A4 com folha de estilo própria).
- **Financeiro** — competência mensal, lançamentos, baixa de pagamento, faturamento por profissional e série de 6 meses; cobrança em atraso com mensagem pronta de WhatsApp.
- **Faltas e cancelamentos** — histórico com motivo, aviso prévio, reposição e cobrança editáveis na própria lista.
- **Documentos e consentimentos** — upload por paciente, categorias, status "Documentação completa/pendente" no perfil e na lista.
- **Profissionais e acessos** — cadastro da equipe, criação de login e definição de perfil.
- **Configurações** — dados da clínica, jornada, política de faltas, modelos de mensagem do WhatsApp, usuários, backup, exportação e registro de auditoria.
- **Busca global** — por criança ou responsável (insensível a acentos), mostrando próximo/último atendimento, situação financeira e profissional. Atalho `Ctrl/⌘ + K`.

## Automações

Alertas calculados a cada acesso, sem inventar dados: atendimentos realizados sem diário, pagamentos em atraso,
reavaliação prevista nos próximos 30 dias, paciente sem atendimento há mais de 30 dias, documentação pendente e aniversários da semana.

## Segurança e LGPD

Senhas com scrypt + salt; sessão em cookie httpOnly com expiração de 12 horas; permissões por perfil
(o administrativo não acessa diários, evolução nem relatórios, e os campos clínicos são removidos da resposta da API);
profissional enxerga apenas os próprios pacientes; auditoria de consulta, alteração, exclusão, download e exportação;
documentos gravados fora da pasta pública e servidos apenas por rota autenticada; backup manual e exportação completa dos dados.

## Identidade visual

Papel quente (#f6f4f0), verde-profundo (#2f5d52) como cor institucional, areia (#e3b981) como acento e
terracota/vinho apenas para estados de atenção. Tipografia do sistema, muito espaço em branco, tabelas densas
e sem cartões coloridos. Símbolo: três pontos em progressão ascendente — o percurso de aprendizagem.
No tablet, alvos de toque de 42–44 px, menu inferior fixo e formulários com seleção em vez de digitação.


---

## Atualização — identidade visual e salas de atendimento

**Logomarca oficial.** A marca aparece em `/assets/logo.png` (logo completa) e `/assets/marca.png` (símbolo do elefante). Está aplicada no favicon, na barra lateral do sistema, na tela de login, no site público e no cabeçalho dos relatórios em PDF. A paleta do sistema foi refeita a partir da logo: creme `#f5f3ec`, roxo `#6f5493` e verde-sálvia `#6f9c72`.

**Equipe cadastrada** (senha inicial de todas: `psico123`):

| Profissional | E-mail | Perfil |
|---|---|---|
| Vanessa Gomes | vanessa@psicoaprender.com.br | Administradora |
| Helen Cristina | helen@psicoaprender.com.br | Profissional |
| Patrícia Monteiro | patricia@psicoaprender.com.br | Profissional |
| Jennifer | jennifer@psicoaprender.com.br | Profissional |
| Josyllene Dias | josyllene@psicoaprender.com.br | Profissional |
| Malu Nogueira | malu@psicoaprender.com.br | Profissional |
| Recepção | recepcao@psicoaprender.com.br | Administrativo |

Cada uma tem foto, formação e especializações, exibidas em **Profissionais** e na seção “Quem atende” do site público.

**Duas salas de atendimento.** As salas ficam em Configurações (`config.salas`) e podem ser renomeadas ou ampliadas — a agenda cria uma coluna por sala automaticamente.

- **Visão geral “Salas”** (padrão da Agenda): colunas Sala 1 / Sala 2 com os atendimentos de *todas* as profissionais, hora a hora.
- **Trava de conflito no servidor**: ao criar ou reagendar, o sistema recusa (HTTP 409) quando a sala já está ocupada, quando a profissional já tem atendimento no horário ou quando há bloqueio, sempre informando *quem* está agendado. Sessões canceladas e faltas não bloqueiam.
- **Mapa de disponibilidade no modal**: mostra em tempo real as vagas livres e ocupadas das duas salas no dia escolhido; basta tocar em uma vaga livre para preencher horário e sala.
- Em recorrências, o sistema valida todas as datas e oferece “criar apenas as datas livres”.
