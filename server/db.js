/**
 * Camada de persistência – PsicoAprender Gestão
 * ------------------------------------------------
 * Armazenamento em arquivo JSON com escrita atômica (write + rename),
 * organizado em coleções relacionais. A API interna (find/insert/update/remove)
 * foi desenhada para ser trocada por SQLite/Postgres sem alterar as rotas:
 * basta reimplementar os métodos de coleção.
 */
const fs = require('fs');
const path = require('path');

// Em produção, aponte DADOS_DIR para um disco persistente (ex.: /var/dados no Render).
const DATA_DIR = process.env.DADOS_DIR
  ? path.resolve(process.env.DADOS_DIR)
  : path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const UPLOAD_DIR = path.join(DATA_DIR, 'arquivos');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

const COLLECTIONS = [
  'usuarios', 'profissionais', 'pacientes', 'responsaveis', 'atendimentos',
  'bloqueios', 'registros', 'templates', 'pagamentos', 'faltas',
  'documentos', 'relatorios', 'notificacoes', 'logs', 'sessoes'
];

function ensureDirs() {
  for (const d of [DATA_DIR, UPLOAD_DIR, BACKUP_DIR]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
}

let state = null;
let writeTimer = null;

function emptyState() {
  const s = { _seq: {}, config: {} };
  for (const c of COLLECTIONS) s[c] = [];
  return s;
}

function load() {
  ensureDirs();
  if (fs.existsSync(DB_FILE)) {
    try {
      state = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      for (const c of COLLECTIONS) if (!state[c]) state[c] = [];
      if (!state._seq) state._seq = {};
      if (!state.config) state.config = {};
    } catch (err) {
      console.error('Falha ao ler o banco, iniciando vazio:', err.message);
      state = emptyState();
    }
  } else {
    state = emptyState();
  }
  return state;
}

function persistNow() {
  ensureDirs();
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 1));
  fs.renameSync(tmp, DB_FILE);
}

/** Escrita debounced: agrupa gravações em rajada (ex.: geração de recorrências). */
function persist() {
  if (writeTimer) return;
  writeTimer = setTimeout(() => { writeTimer = null; persistNow(); }, 40);
}

function nextId(col) {
  state._seq[col] = (state._seq[col] || 0) + 1;
  return state._seq[col];
}

function matches(row, where) {
  for (const k of Object.keys(where)) {
    const v = where[k];
    if (Array.isArray(v)) { if (!v.includes(row[k])) return false; }
    else if (typeof v === 'function') { if (!v(row[k], row)) return false; }
    else if (row[k] !== v) return false;
  }
  return true;
}

const table = (name) => ({
  all: () => state[name],
  find: (where = {}) => state[name].filter(r => matches(r, where)),
  findOne: (where = {}) => state[name].find(r => matches(r, where)) || null,
  byId: (id) => state[name].find(r => r.id === Number(id)) || null,
  insert(doc) {
    const row = { id: nextId(name), ...doc, criado_em: doc.criado_em || new Date().toISOString() };
    state[name].push(row);
    persist();
    return row;
  },
  update(id, patch) {
    const row = state[name].find(r => r.id === Number(id));
    if (!row) return null;
    Object.assign(row, patch, { atualizado_em: new Date().toISOString() });
    persist();
    return row;
  },
  remove(id) {
    const i = state[name].findIndex(r => r.id === Number(id));
    if (i === -1) return false;
    state[name].splice(i, 1);
    persist();
    return true;
  },
  /** Insere preservando o id original (usado na restauração de um backup). */
  inserirBruto(registro) {
    if (!registro || typeof registro !== 'object') return null;
    const row = { ...registro, id: Number(registro.id) };
    state[name].push(row);
    if (!state._seq) state._seq = {};
    if (row.id > (state._seq[name] || 0)) state._seq[name] = row.id;
    persist();
    return row;
  },
  removeWhere(where) {
    const before = state[name].length;
    state[name] = state[name].filter(r => !matches(r, where));
    persist();
    return before - state[name].length;
  }
});

const db = {
  get raw() { return state; },
  load,
  persist,
  persistNow,
  /** Reposiciona os contadores de id após uma restauração. */
  definirSequencias(seq) {
    state._seq = state._seq || {};
    for (const [k, v] of Object.entries(seq || {})) {
      if (Number(v) > (state._seq[k] || 0)) state._seq[k] = Number(v);
    }
    persist();
  },
  paths: { DATA_DIR, DB_FILE, UPLOAD_DIR, BACKUP_DIR },
  config: {
    get: () => state.config,
    set(patch) { Object.assign(state.config, patch); persist(); return state.config; }
  },
  backup() {
    ensureDirs();
    persistNow();
    const nome = `backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    fs.copyFileSync(DB_FILE, path.join(BACKUP_DIR, nome));
    return nome;
  },
  backups: () => (fs.existsSync(BACKUP_DIR) ? fs.readdirSync(BACKUP_DIR).sort().reverse() : [])
};

for (const c of COLLECTIONS) db[c] = table(c);

module.exports = db;
