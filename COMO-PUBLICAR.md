# Publicar o PsicoAprender — 4 passos

Ao final você terá um **link fixo** (algo como `psicoaprender.onrender.com`) para mandar no grupo
das profissionais. É gratuito. Leva cerca de 15 minutos, só na primeira vez.

Você vai precisar de duas contas gratuitas: **GitHub** (guarda os arquivos) e **Render** (coloca no ar).
Não precisa instalar nada no computador.

---

## Passo 1 — Baixar e descompactar o projeto

1. Baixe o arquivo **`psicoaprender-para-equipe.zip`** que está aqui no workspace.
2. Descompacte (clique com o botão direito → *Extrair tudo*).
3. Vai aparecer uma pasta chamada **`piscoaprender`**. Abra ela: dentro estão as pastas
   `public`, `server` e arquivos como `package.json`. **São esses itens de dentro que você vai enviar** — não a pasta em si.

---

## Passo 2 — Criar a conta no GitHub e enviar os arquivos

1. Acesse **github.com** → *Sign up* → crie a conta (e-mail, senha, confirma o código).
2. Já logada, clique no **+** no canto superior direito → **New repository**.
3. Preencha:
   - **Repository name:** `psicoaprender`
   - Marque **Public**
   - **Não** marque nenhuma das caixinhas de "Initialize this repository"
   - Clique em **Create repository**
4. Na tela seguinte, clique no link **"uploading an existing file"** (fica no meio do texto).
5. Abra a pasta `piscoaprender` no seu computador, **selecione tudo que está dentro dela**
   (Ctrl+A) e **arraste para a área de upload** do navegador.
   - Use o Chrome ou o Edge — eles enviam as subpastas corretamente.
   - Aguarde a lista de arquivos aparecer (pode levar um minuto, tem as fotos da equipe).
6. Clique no botão verde **Commit changes**.

Pronto: seus arquivos estão no GitHub.

---

## Passo 3 — Colocar no ar pelo Render

1. Acesse **render.com** → *Get Started* → escolha **Sign in with GitHub** e autorize.
2. No painel, clique em **New +** → **Web Service**.
3. Escolha o repositório **psicoaprender** e clique em **Connect**.
   - Se ele não aparecer, clique em *Configure account* e libere o acesso ao repositório.
4. O Render lê sozinho o arquivo `render.yaml` e já preenche tudo. Confira apenas:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** `Free`
5. Clique em **Create Web Service** e aguarde 3 a 5 minutos.
   Quando aparecer **"Your service is live"**, o link estará no topo da página, assim:
   `https://psicoaprender.onrender.com`

---

## Passo 4 — Mandar para a equipe

Copie o link e envie no grupo. Sugestão de mensagem pronta:

> Meninas, o sistema da PsicoAprender está no ar para testarmos:
> **https://psicoaprender.onrender.com**
>
> Clique em "Área da profissional", no canto superior direito.
> Seu e-mail é seu primeiro nome @psicoaprender.com.br (ex.: helen@psicoaprender.com.br)
> e a senha de todas é **psico123**.
>
> Podem clicar em tudo à vontade — os pacientes que estão lá são fictícios, criados só para teste.
> ⚠️ Por enquanto **não coloquem dados reais de criança**, é só uma versão de avaliação.
>
> O que eu queria que vocês olhassem:
> 1. Agenda → a visão "Salas" mostra o que precisamos ver no dia a dia?
> 2. Diário de atendimento → dá para preencher em 2 minutos depois da sessão?
> 3. As áreas de evolução fazem sentido? Falta ou sobra alguma?
> 4. Relatórios → o texto que sai é aproveitável para mandar para escola/família?
> 5. Cadastro do paciente → falta algum campo importante? Tem algum inútil?
> 6. No tablet/celular → é fácil de usar ou tem coisa apertada demais?
>
> Anotem tudo que incomodar, por menor que seja. É a hora de mudar.

---

## Detalhes bons de saber

**O primeiro acesso demora.** No plano gratuito, o serviço "dorme" depois de 15 minutos sem uso.
Quando alguém abre o link, leva uns 30 a 50 segundos para acordar. Se parecer travado, é isso — avise a equipe.

**Os dados de teste podem se perder.** No plano gratuito não há disco permanente: a cada nova
publicação o sistema volta com os dados de demonstração. Para a fase de sugestões, tudo bem.

**Para começar a usar de verdade** (com pacientes reais), me chame que eu preparo a migração:
- plano pago do Render (a partir de ~US$ 7/mês) com **disco permanente** — o `render.yaml` já
  tem essa parte pronta, é só remover o `#` das linhas do `disk`;
- troca do armazenamento em arquivo por **PostgreSQL**;
- **backup automático** diário;
- domínio próprio, ex.: `sistema.psicoaprender.com.br`;
- cada profissional trocando a senha inicial.

**Para atualizar o sistema depois:** qualquer arquivo alterado no GitHub faz o Render publicar
a nova versão sozinho, em poucos minutos. O link continua o mesmo.

---

## Acessos

| Profissional | E-mail | Senha |
|---|---|---|
| Vanessa Gomes (administradora) | vanessa@psicoaprender.com.br | psico123 |
| Helen Cristina | helen@psicoaprender.com.br | psico123 |
| Patrícia Monteiro | patricia@psicoaprender.com.br | psico123 |
| Jennifer | jennifer@psicoaprender.com.br | psico123 |
| Josyllene Dias | josyllene@psicoaprender.com.br | psico123 |
| Malu Nogueira | malu@psicoaprender.com.br | psico123 |
| Recepção (administrativo) | recepcao@psicoaprender.com.br | psico123 |


---

## Atualizar o sistema (rotina atual)

Desde 01/09/2026 os dados ficam no **Turso**, um banco fora do servidor. Isso mudou a rotina:

1. Baixe o zip atualizado e suba os arquivos no GitHub
2. Espere o Render publicar
3. Pronto — **os cadastros continuam lá**

Não é mais necessário exportar antes e restaurar depois de cada publicação.
O *Configurações → Segurança → Exportar dados* continua existindo, agora como backup
de segurança (vale fazer de vez em quando e guardar o arquivo).

Como conferir se o banco externo está ativo: no Render, em **Logs**, a primeira linha deve ser
`Dados no Turso (banco externo).` Se disser `Dados em arquivo local`, as variáveis de ambiente
sumiram — veja o `CONECTAR-TURSO.md`.

**Exceção:** documentos anexados (PDFs, laudos) ainda ficam em disco e se perdem numa
publicação. Enquanto ninguém anexar arquivos com frequência, não é um problema.
