'use strict';
/**
 * Camada de armazenamento — interface única com duas implementações:
 *  - FileStore: documento JSON em disco + fotos em pasta (uso local).
 *  - TursoStore: documento JSON numa tabela do Turso (libSQL/SQLite na nuvem)
 *    e fotos/logos como BLOB noutra tabela. Não exige disco persistente,
 *    ideal para o plano gratuito do Render.
 *
 * Interface:
 *   init()                         -> Promise (cria tabelas / carrega memória)
 *   getDocument()                  -> object | null
 *   saveDocument(obj)              -> Promise (grava o documento inteiro)
 *   getAsset(name)                 -> Buffer | null
 *   putAsset(name, buffer)         -> Promise
 *   deleteAsset(name)              -> Promise
 *   kind                           -> 'file' | 'turso'
 */

const fs = require('fs');
const path = require('path');

// ---------- Arquivo local ----------
class FileStore {
  constructor(dataDir) {
    this.kind = 'file';
    this.dataDir = dataDir;
    this.uploadsDir = path.join(dataDir, 'uploads');
    this.dbFile = path.join(dataDir, 'agua-db.json');
  }
  async init() {
    fs.mkdirSync(this.uploadsDir, { recursive: true });
  }
  getDocument() {
    try { return JSON.parse(fs.readFileSync(this.dbFile, 'utf8')); }
    catch { return null; }
  }
  async saveDocument(obj) {
    fs.mkdirSync(this.dataDir, { recursive: true });
    const tmp = this.dbFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj));
    fs.renameSync(tmp, this.dbFile);
  }
  getAsset(name) {
    try { return fs.readFileSync(path.join(this.uploadsDir, name)); }
    catch { return null; }
  }
  async putAsset(name, buffer) {
    fs.mkdirSync(this.uploadsDir, { recursive: true });
    fs.writeFileSync(path.join(this.uploadsDir, name), buffer);
  }
  async deleteAsset(name) {
    try { fs.unlinkSync(path.join(this.uploadsDir, name)); } catch { /* ignora */ }
  }
}

// ---------- Turso (libSQL na nuvem) ----------
class TursoStore {
  constructor(url, authToken) {
    this.kind = 'turso';
    this.url = url;
    this.authToken = authToken;
    this.client = null;
  }
  async init() {
    const { createClient } = require('@libsql/client');
    this.client = createClient({ url: this.url, authToken: this.authToken });
    await this.client.execute(`CREATE TABLE IF NOT EXISTS kv (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      doc TEXT NOT NULL,
      atualizado_em TEXT NOT NULL
    )`);
    await this.client.execute(`CREATE TABLE IF NOT EXISTS assets (
      nome TEXT PRIMARY KEY,
      dados BLOB NOT NULL,
      mime TEXT,
      criado_em TEXT NOT NULL
    )`);
  }
  async getDocument() {
    const rs = await this.client.execute('SELECT doc FROM kv WHERE id = 1');
    if (!rs.rows.length) return null;
    try { return JSON.parse(rs.rows[0].doc); } catch { return null; }
  }
  async saveDocument(obj) {
    const doc = JSON.stringify(obj);
    await this.client.execute({
      sql: `INSERT INTO kv (id, doc, atualizado_em) VALUES (1, ?, ?)
            ON CONFLICT(id) DO UPDATE SET doc = excluded.doc, atualizado_em = excluded.atualizado_em`,
      args: [doc, new Date().toISOString()],
    });
  }
  async getAsset(name) {
    const rs = await this.client.execute({ sql: 'SELECT dados FROM assets WHERE nome = ?', args: [name] });
    if (!rs.rows.length) return null;
    const v = rs.rows[0].dados;
    return Buffer.isBuffer(v) ? v : Buffer.from(v);
  }
  async putAsset(name, buffer) {
    await this.client.execute({
      sql: `INSERT INTO assets (nome, dados, mime, criado_em) VALUES (?, ?, ?, ?)
            ON CONFLICT(nome) DO UPDATE SET dados = excluded.dados, mime = excluded.mime, criado_em = excluded.criado_em`,
      args: [name, buffer, '', new Date().toISOString()],
    });
  }
  async deleteAsset(name) {
    await this.client.execute({ sql: 'DELETE FROM assets WHERE nome = ?', args: [name] });
  }
}

function createStore() {
  const dataDir = process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.join(__dirname, 'data');
  if (process.env.TURSO_DATABASE_URL) {
    return new TursoStore(process.env.TURSO_DATABASE_URL, process.env.TURSO_AUTH_TOKEN || '');
  }
  return new FileStore(dataDir);
}

module.exports = { createStore, FileStore, TursoStore };
