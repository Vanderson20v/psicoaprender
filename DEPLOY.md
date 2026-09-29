# Como publicar — GitHub + Turso + Render

O sistema usa Node.js puro. O banco e as **fotos/logos ficam no Turso** (SQLite na
nuvem), então **não precisa de disco** no Render — o plano gratuito funciona.

## 1. Criar o banco no Turso
1. Entre em https://turso.tech (dashboard) → **Create Database**.
2. Dê um nome (ex.: `agua-orion`) e escolha uma região próxima.
3. No banco criado, copie:
   - a **URL** (algo como `libsql://agua-orion-<seu-user>.turso.io`)
   - o **token**: botão **Create Token** (ou "Generate Auth Token") — copie o token.

Guarde esses dois valores.

## 2. Publicar o código no GitHub
1. Crie um repositório (pode ser privado).
2. Envie os arquivos da pasta `agua-condominio/` (inclui `package.json`,
   `render.yaml`, `server.js`, etc.). Exemplo:
   ```bash
   git init && git add . && git commit -m "Sistema de faturamento de água"
   git branch -M main
   git remote add origin https://github.com/<seu-usuario>/<seu-repo>.git
   git push -u origin main
   ```

## 3. Subir no Render
1. https://render.com → **New + → Blueprint** e conecte o repositório
   (o arquivo `render.yaml` já configura o serviço). Se preferir manual:
   **New + → Web Service**, Build Command `npm install`, Start Command
   `node server.js`.
2. Em **Environment**, adicione as variáveis:
   | Variável | Valor |
   |---|---|
   | `TURSO_DATABASE_URL` | a URL do Turso (`libsql://...`) |
   | `TURSO_AUTH_TOKEN` | o token do Turso |
   | `ADMIN_PASSWORD` | uma senha forte para o usuário `admin` |
   | `DEMO_GESTOR` | `0` (desliga o usuário de teste `orion`) |
3. **Create / Deploy.** Em 1–2 minutos você recebe um link
   `https://agua-condominio.onrender.com`.

> Na primeira inicialização o sistema cria automaticamente as tabelas no Turso e
> cadastra o ORION (296 unidades + medição de agosto/2026) e a logo de exemplo.

## 4. Primeiro acesso e gestores
- Entre como `admin` com a senha definida em `ADMIN_PASSWORD`.
- Na aba **Usuários**, crie o login do gestor do Orion (nome, login, senha e
  condomínio). Ele só verá o próprio condomínio.
- A logo de exemplo pode ser trocada em **Condomínios → Trocar logo**.

## Variáveis de ambiente
| Variável | Obrigatória | Descrição |
|---|---|---|
| `TURSO_DATABASE_URL` | sim (em produção) | URL `libsql://` do banco Turso |
| `TURSO_AUTH_TOKEN` | sim | Token de acesso ao Turso |
| `ADMIN_PASSWORD` | recomendada | Senha do admin no 1º acesso |
| `DEMO_GESTOR` | não | `0` desliga o usuário de teste |
| `PORT` | não | Definida pelo Render |
| `DATA_DIR` | só modo local | Pasta do banco em arquivo (sem Turso) |

> Sem `TURSO_DATABASE_URL`, o sistema usa arquivo local (`./data`) — útil para
> desenvolver na sua máquina.

## Backup
No Turso o backup é automático (plano gerencia replicas/versões). Você também pode
exportar a qualquer momento com a CLI do Turso (`turso db dump`).
