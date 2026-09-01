# Conectar o sistema ao Turso (dados que não se perdem)

Depois disto, publicar uma atualização **deixa de apagar** os cadastros das profissionais.
São 5 passos, uma vez só. Custo: zero (plano gratuito do Turso).

---

## Por que isso é necessário

Hoje os dados ficam num arquivo **dentro do servidor** do Render. No plano gratuito, cada
publicação monta um servidor novo do zero — e o arquivo vai junto.

Com o Turso, os dados ficam num banco **fora** do servidor. O Render pode ser recriado quantas
vezes for: ele volta a se conectar ao mesmo banco e tudo continua lá.

---

## Passo 1 — Criar o banco no Turso

1. Acesse **turso.tech** e entre na sua conta
2. Crie um novo banco (*Create Database*) com o nome **`psicoaprender`**
3. Escolha a região mais próxima (`gru` — São Paulo, se disponível)

## Passo 2 — Copiar os dois dados de conexão

No painel do banco recém-criado:

1. Copie a **URL** — parece com `libsql://psicoaprender-seuusuario.turso.io`
2. Gere um **token de acesso** (*Create Token* / *Generate Token*) e copie o texto longo

> Guarde os dois num bloco de notas por enquanto. O token só aparece uma vez.

## Passo 3 — Informar isso ao Render

1. No painel do Render, abra o serviço **psicoaprender**
2. Menu da esquerda → **Environment**
3. Clique em **Add Environment Variable** e crie as duas:

| Key | Value |
|---|---|
| `TURSO_DATABASE_URL` | a URL copiada (`libsql://...`) |
| `TURSO_AUTH_TOKEN` | o token copiado |

4. Clique em **Save Changes**

O Render republica sozinho ao salvar.

## Passo 4 — Conferir se pegou

Ainda no Render, abra **Logs** e procure a primeira linha:

```
Dados no Turso (banco externo) — banco iniciado agora.
```

- Se aparecer **"Dados no Turso"** → deu certo
- Se aparecer **"Dados em arquivo local"** → as variáveis não foram lidas; confira se os nomes
  estão escritos exatamente como na tabela acima

## Passo 5 — Restaurar o que já existir

Se as profissionais já tiverem cadastrado algo antes desta mudança:

1. Antes de configurar, entre como administradora → **Configurações → Segurança → Exportar dados**
2. Depois que o log mostrar "Dados no Turso", volte e use **Restaurar de um arquivo exportado**

Do dia seguinte em diante, não precisa mais exportar antes de cada atualização.

---

## O que muda no dia a dia

| Antes | Depois |
|---|---|
| Cada publicação apagava os cadastros | Publicação não afeta os dados |
| Precisava exportar/restaurar toda vez | Exportar vira só um backup de segurança |
| Reinício do servidor perdia tudo | Reinício não afeta nada |

O exportar/restaurar continua existindo — agora como backup de verdade, não como remendo.

---

## Detalhes técnicos (para referência futura)

- A pasta de dados local (`data/db.json`) continua sendo escrita, funcionando como cache
  e como origem dos backups. O Turso é a fonte oficial.
- Sem as variáveis de ambiente, o sistema volta sozinho ao modo arquivo — útil para rodar
  na máquina de casa, sem internet.
- Documentos anexados (PDFs, laudos) **continuam em disco**, não vão para o Turso. No plano
  gratuito do Render eles ainda se perdem a cada publicação. Se as profissionais começarem a
  anexar documentos com frequência, me avise que eu passo os anexos para o banco também.
- Limite do plano gratuito do Turso: 500 MB e 1 bilhão de leituras por mês — muito acima do
  que esta clínica vai usar.
