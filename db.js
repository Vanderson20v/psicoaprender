'use strict';
/**
 * Camada de persistência — multi-condomínio.
 * Arquivo JSON atômico + fotos em data/uploads/.
 * Toda regra de acesso a dados fica neste módulo (migração futura para
 * SQLite/Postgres exige apenas reimplementar estas funções).
 */

const crypto = require('crypto');
const { calcularValorAgua, round2, mesAnterior, DIARIA, isDataValida } = require('./lib');
const { createStore } = require('./storage');

let store = null;
let db = null;

async function init() {
  store = createStore();
  await store.init();
  db = await store.getDocument();
  if (!db || db.version < 5) {
    if (db && db.version >= 3) {
      // migração cumulativa v3 -> v4 -> v5
      if (db.version === 3) {
        // v3 -> v4: hidrômetros de área comum + flag de troca de senha
        if (!Array.isArray(db.common_meters)) db.common_meters = [];
        if (!Array.isArray(db.common_readings)) db.common_readings = [];
        for (const u of db.users) {
          if (u.must_change_password === undefined) {
            u.must_change_password = u.role !== 'admin';
          }
        }
      }
      // v4 -> v5: links de conferência do condômino
      if (!Array.isArray(db.ver_links)) db.ver_links = [];
      if (!Array.isArray(db.common_meters)) db.common_meters = [];
      if (!Array.isArray(db.common_readings)) db.common_readings = [];
      if (!Array.isArray(db.med_links)) db.med_links = [];
      db.version = 5;
    } else {
      const seedado = seed();
      db = seedado.doc;
      for (const a of seedado.assets) await store.putAsset(a.name, a.buffer);
    }
    await store.saveDocument(db);
  }
  if (db.version === 5) {
    // v5 -> v6: medição diária de acompanhamento (medidor macro + leituras por dia)
    if (!Array.isArray(db.daily_meters)) db.daily_meters = [];
    if (!Array.isArray(db.daily_readings)) db.daily_readings = [];
    db.version = 6;
    await store.saveDocument(db);
  }
  return db;
}

function nowISO() { return new Date().toISOString(); }
function genId(prefix) { return `${prefix}_${crypto.randomBytes(8).toString('hex')}`; }
function r3(v) { return Math.round((Number(v) + Number.EPSILON) * 1000) / 1000; }

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(String(password), salt, 64).toString('hex') };
}
function verifyPassword(password, salt, hash) {
  const h = crypto.scryptSync(String(password), salt, 64);
  const ref = Buffer.from(hash, 'hex');
  return h.length === ref.length && crypto.timingSafeEqual(h, ref);
}

// Gravação "debounced" (no Turso evita write excessivo; em arquivo é instantâneo).
let saveTimer = null;
let saveQueued = false;
function save() {
  if (saveQueued || !store) return;
  saveQueued = true;
  saveTimer = setTimeout(flush, 250);
}
async function flush() {
  saveQueued = false;
  if (!store || !db) return;
  try { await store.saveDocument(db); }
  catch (e) {
    console.error('Erro ao gravar dados:', e && e.message);
    saveQueued = true;
    setTimeout(flush, 1500);
  }
}
async function saveNow() {
  if (saveTimer) clearTimeout(saveTimer);
  saveQueued = false;
  if (store && db) await store.saveDocument(db);
}

// Assets (fotos e logos) ficam na mesma camada (disco local ou BLOB no Turso).
async function putAsset(name, buffer) { if (store) await store.putAsset(name, buffer); }
async function getAsset(name) { return store ? Promise.resolve(store.getAsset(name)) : null; }
async function deleteAsset(name) { if (store) await store.deleteAsset(name); }

function load() { return db; }

function logAction(user, action, details = {}) {
  load().audit_log.push({
    id: genId('log'), ts: nowISO(),
    user_id: user ? user.id : null,
    username: user ? user.username : 'sistema',
    condo: details.condoNome || null,
    action, details: JSON.stringify(details),
  });
  save();
}

// ---------------- usuários / sessões ----------------

function findUserByUsername(username) { return load().users.find((u) => u.username === username) || null; }
function findUserById(id) { return load().users.find((u) => u.id === id) || null; }

function createSession(user) {
  const session = {
    token: crypto.randomBytes(32).toString('hex'),
    user_id: user.id,
    created_at: nowISO(),
    expires_at: new Date(Date.now() + 12 * 3600 * 1000).toISOString(),
  };
  load().sessions.push(session);
  save();
  return session;
}
function getSession(token) {
  if (!token) return null;
  const s = load().sessions.find((x) => x.token === token);
  if (!s) return null;
  if (new Date(s.expires_at).getTime() < Date.now()) {
    db.sessions = db.sessions.filter((x) => x.token !== token);
    save();
    return null;
  }
  return s;
}
function destroySession(token) {
  if (!token) return;
  db.sessions = load().sessions.filter((x) => x.token !== token);
  save();
}

// ---------------- condomínios ----------------

function listCondos() {
  return load().condos.slice().sort((a, b) => a.created_at.localeCompare(b.created_at)).map((c) => {
    const unidades = db.apartments.filter((a) => a.condo_id === c.id).length;
    const meses = db.billing_months.filter((m) => m.condo_id === c.id).length;
    return { ...c, total_unidades: unidades, total_meses: meses };
  });
}
function getCondo(id) { return load().condos.find((c) => c.id === id) || null; }
function getDefaultCondoId() { const cs = listCondos(); return cs.length ? cs[0].id : null; }
function resolveCondo(id) {
  if (id) { const c = getCondo(id); if (c) return c; }
  const did = getDefaultCondoId();
  return did ? getCondo(did) : null;
}

/** Condomínios que um usuário pode enxergar. */
function listCondosForUser(user) {
  const todos = listCondos();
  if (user && user.role === 'admin' && !user.condo_id) return todos;
  return todos.filter((c) => c.id === (user && user.condo_id));
}
/** Resolve o condomínio efetivo do usuário (gestor fica preso ao seu). */
function resolveCondoForUser(user, requestedId) {
  if (user && user.role !== 'admin' && user.condo_id) return getCondo(user.condo_id);
  return resolveCondo(requestedId);
}
// edição do cadastro do condomínio (nome e/ou modo de medição)
function updateCondoInfo(condoId, { nome, medicoes } = {}, user) {
  const c = getCondo(condoId);
  if (!c) return null;
  const changes = {};
  if (nome !== undefined) {
    const n = String(nome).trim().slice(0, 120);
    if (!n) throw Object.assign(new Error('Informe o nome do condomínio.'), { code: 'BADNAME' });
    if (n !== c.nome) { changes.nome = { de: c.nome, para: n }; c.nome = n; }
  }
  if (medicoes && (typeof medicoes.mensal === 'boolean' || typeof medicoes.diaria_macro === 'boolean')) {
    if (!c.medicoes) c.medicoes = { mensal: true, diaria_macro: true };
    const novo = {
      mensal: typeof medicoes.mensal === 'boolean' ? medicoes.mensal : c.medicoes.mensal !== false,
      diaria_macro: typeof medicoes.diaria_macro === 'boolean' ? medicoes.diaria_macro : c.medicoes.diaria_macro !== false,
    };
    if (!novo.mensal && !novo.diaria_macro) {
      throw Object.assign(new Error('Escolha ao menos um tipo de medição (mensal e/ou diária).'), { code: 'NOMED' });
    }
    if (novo.mensal !== (c.medicoes.mensal !== false) || novo.diaria_macro !== (c.medicoes.diaria_macro !== false)) {
      c.medicoes = { ...c.medicoes, ...novo };
      changes.medicoes = novo;
    }
  }
  if (Object.keys(changes).length) logAction(user, 'editar_condominio', { condoNome: c.nome, ...changes });
  save();
  return c;
}

function setCondoLogo(condoId, fileName) {
  const c = getCondo(condoId);
  if (!c) return null;
  c.logo = fileName;
  save();
  return c;
}

function createCondo(nome, unidades, logoFile, user, medicoes) {
  const data = load();
  const condo = {
    id: genId('cond'),
    nome: String(nome).trim().slice(0, 120),
    logo: logoFile || null,
    created_at: nowISO(),
    created_by: user ? user.username : null,
    // o que este condomínio mede (definido no cadastro): cobrança mensal nas unidades e/ou
    // acompanhamento diário do medidor macro. Campos com os mesmos nomes da API diária.
    medicoes: { mensal: !(medicoes && medicoes.mensal === false), diaria_macro: !(medicoes && medicoes.diaria_macro === false) },
  };
  data.condos.push(condo);

  let nextId = data.apartments.reduce((m, a) => Math.max(m, a.id), 0) + 1;
  let criadas = 0;
  for (const u of unidades) {
    const etiqueta = String(u.etiqueta || '').trim();
    if (!etiqueta) continue;
    const torre = (u.torre || etiqueta.slice(-1)).toString().trim().toUpperCase();
    data.apartments.push({
      id: nextId++,
      condo_id: condo.id,
      torre,
      numero: (u.numero || etiqueta.slice(0, -1)).toString().trim(),
      etiqueta,
      hidrometro: u.hidrometro ? String(u.hidrometro).trim() : '',
      ativo: true,
    });
    criadas++;
  }
  logAction(user, 'criar_condominio', { condoNome: condo.nome, unidades: criadas });
  return { condo, criadas };
}

// Impacto da exclusão de um condomínio (mostrado na confirmação antes de apagar).
function condoImpact(condoId) {
  const d = load();
  const aptIds = new Set(d.apartments.filter((a) => a.condo_id === condoId).map((a) => a.id));
  const meses = d.billing_months.filter((m) => m.condo_id === condoId);
  const leituras = d.readings.filter((r) => r.condo_id === condoId);
  const fotos = [...leituras.map((r) => r.foto),
    ...(d.common_readings || []).map((r) => r.foto),
    ...(d.daily_readings || []).map((r) => r.foto)].filter(Boolean).length;
  const condo = getCondo(condoId);
  return {
    unidades: aptIds.size,
    meses: meses.length,
    meses_finalizados: meses.filter((m) => m.status === 'finalizado').length,
    leituras: leituras.filter((r) => r.leitura_atual != null).length,
    fotos: fotos + (condo && condo.logo ? 1 : 0),
    medidores_comuns: (d.common_meters || []).filter((c) => c.condo_id === condoId).length,
    medidores_diarios: (d.daily_meters || []).filter((m) => m.condo_id === condoId).length,
    leituras_diarias: (d.daily_readings || []).filter((r) => r.condo_id === condoId).length,
    links: (d.med_links || []).filter((l) => l.condo_id === condoId).length,
    links_conferencia: (d.ver_links || []).filter((l) => l.condo_id === condoId).length,
    contas_vinculadas: d.users.filter((u) => u.condo_id === condoId && u.ativo !== false).length,
  };
}

// Exclui o condomínio em cascata: unidades, meses, leituras, área comum, links,
// medição diária, fotos (retornadas p/ remover do storage) e desativa contas presas a ele.
function deleteCondo(condoId, user) {
  const d = load();
  const idx = d.condos.findIndex((c) => c.id === condoId);
  if (idx === -1) return null;
  const condo = d.condos[idx];
  const counts = condoImpact(condoId);
  const assets = [];
  if (condo.logo) assets.push(condo.logo);
  for (const r of d.readings) if (r.condo_id === condoId && r.foto) assets.push(r.foto);
  for (const r of (d.common_readings || [])) if (r.condo_id === condoId && r.foto) assets.push(r.foto);
  for (const r of (d.daily_readings || [])) if (r.condo_id === condoId && r.foto) assets.push(r.foto);
  const uids = new Set(d.users.filter((u) => u.condo_id === condoId).map((u) => u.id));
  d.condos.splice(idx, 1);
  d.apartments = d.apartments.filter((a) => a.condo_id !== condoId);
  d.billing_months = d.billing_months.filter((m) => m.condo_id !== condoId);
  d.readings = d.readings.filter((r) => r.condo_id !== condoId);
  d.common_meters = (d.common_meters || []).filter((c) => c.condo_id !== condoId);
  d.common_readings = (d.common_readings || []).filter((r) => r.condo_id !== condoId);
  d.daily_meters = (d.daily_meters || []).filter((m) => m.condo_id !== condoId);
  d.daily_readings = (d.daily_readings || []).filter((r) => r.condo_id !== condoId);
  d.med_links = (d.med_links || []).filter((l) => l.condo_id !== condoId);
  d.ver_links = (d.ver_links || []).filter((l) => l.condo_id !== condoId);
  for (const u of d.users) if (u.condo_id === condoId) { u.ativo = false; u.desativado_motivo = `condomínio "${condo.nome}" excluído`; }
  d.sessions = d.sessions.filter((x) => !uids.has(x.user_id));
  logAction(user, 'excluir_condominio', { condoNome: condo.nome, unidades: counts.unidades, meses: counts.meses, leituras: counts.leituras, fotos: assets.length });
  save();
  return { ok: true, nome: condo.nome, counts, assets };
}

// ---------------- usuários ----------------

function listUsers() {
  return load().users.map((u) => ({
    id: u.id, username: u.username, nome: u.nome, role: u.role,
    condo_id: u.condo_id || null, ativo: u.ativo !== false, created_at: u.created_at,
  }));
}
function createUser({ username, password, nome, condo_id, role }) {
  const data = load();
  const uname = String(username || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,30}$/.test(uname)) {
    throw Object.assign(new Error('Usuário inválido (use 3 a 30 caracteres: letras, números, . _ -)'), { code: 'BADUSER' });
  }
  if (data.users.some((u) => u.username === uname)) {
    throw Object.assign(new Error('Já existe um usuário com este login.'), { code: 'DUPUSER' });
  }
  if (!password || String(password).length < 6) {
    throw Object.assign(new Error('A senha deve ter ao menos 6 caracteres.'), { code: 'BADPASSWORD' });
  }
  if (role !== 'admin' && !getCondo(condo_id)) {
    throw Object.assign(new Error('Condomínio inválido para vínculo.'), { code: 'BADCONDO' });
  }
  const { salt, hash } = hashPassword(password);
  const user = {
    id: genId('usr'),
    username: uname,
    nome: String(nome || uname).trim().slice(0, 80),
    role: role === 'admin' ? 'admin' : 'gestor',
    condo_id: role === 'admin' ? null : condo_id,
    salt, password_hash: hash,
    ativo: true,
    // gestores criados pelo administrador recebem uma senha temporária e
    // são obrigados a trocá-la no primeiro acesso.
    must_change_password: role !== 'admin',
    created_at: nowISO(),
  };
  data.users.push(user);
  save();
  return listUsers().find((u) => u.id === user.id);
}
function setUserActive(id, ativo) {
  const u = load().users.find((x) => x.id === id);
  if (!u) return null;
  u.ativo = !!ativo;
  save();
  return listUsers().find((x) => x.id === id);
}

// Troca da própria senha (exige a senha atual). Limpa o flag de primeiro acesso.
function changeOwnPassword(user, senhaAtual, novaSenha) {
  const u = load().users.find((x) => x.id === user.id);
  if (!u) throw Object.assign(new Error('Usuário não encontrado.'), { code: 'NOT_FOUND' });
  if (!verifyPassword(String(senhaAtual || ''), u.salt, u.password_hash)) {
    throw Object.assign(new Error('A senha atual está incorreta.'), { code: 'BADCURRENT' });
  }
  if (!novaSenha || String(novaSenha).length < 6) {
    throw Object.assign(new Error('A nova senha deve ter ao menos 6 caracteres.'), { code: 'BADPASSWORD' });
  }
  const { salt, hash } = hashPassword(novaSenha);
  u.salt = salt; u.password_hash = hash; u.must_change_password = false;
  save();
  return true;
}
// Atualiza o nome de exibição do próprio usuário.
function updateOwnProfile(user, nome) {
  const u = load().users.find((x) => x.id === user.id);
  if (!u) return null;
  u.nome = String(nome || u.username).trim().slice(0, 80) || u.username;
  save();
  return { id: u.id, username: u.username, nome: u.nome, role: u.role, condo_id: u.condo_id || null };
}
// Administrador redefine a senha de um usuário (nova senha temporária).
function adminResetPassword(adminId, targetUserId, novaSenha) {
  const alvo = load().users.find((x) => x.id === targetUserId);
  if (!alvo) throw Object.assign(new Error('Usuário não encontrado.'), { code: 'NOT_FOUND' });
  if (!novaSenha || String(novaSenha).length < 6) {
    throw Object.assign(new Error('A nova senha deve ter ao menos 6 caracteres.'), { code: 'BADPASSWORD' });
  }
  const { salt, hash } = hashPassword(novaSenha);
  alvo.salt = salt; alvo.password_hash = hash; alvo.must_change_password = true;
  save();
  return listUsers().find((x) => x.id === targetUserId);
}

// ---------------- edição do condomínio / unidades ----------------

function renameCondo(condoId, nome) {
  const c = getCondo(condoId);
  if (!c) return null;
  const n = String(nome || '').trim().slice(0, 120);
  if (!n) throw Object.assign(new Error('Informe o nome do condomínio.'), { code: 'BADNAME' });
  c.nome = n;
  save();
  return c;
}
function updateApartmentMeter(condoId, aptId, hidrometro) {
  const apt = load().apartments.find((a) => a.id === Number(aptId) && a.condo_id === condoId);
  if (!apt) return null;
  apt.hidrometro = String(hidrometro || '').trim().slice(0, 40);
  save();
  return apt;
}

// ---------------- hidrômetros de área comum ----------------

function listCommonMeters(condoId) {
  return load().common_meters
    .filter((m) => m.condo_id === condoId)
    .slice().sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}
function getCommonMeter(id) {
  return load().common_meters.find((m) => m.id === id) || null;
}
function createCommonMeter(condoId, nome, numero) {
  const data = load();
  const n = String(nome || '').trim().slice(0, 80);
  if (!n) throw Object.assign(new Error('Informe uma descrição para o hidrômetro (ex.: Hidrômetro da piscina).'), { code: 'BADNAME' });
  const meter = {
    id: genId('hac'),
    condo_id: condoId,
    nome: n,
    numero: String(numero || '').trim().slice(0, 40),
    ativo: true,
    criado_em: nowISO(),
  };
  data.common_meters.push(meter);
  save();
  return meter;
}
function updateCommonMeter(condoId, id, nome, numero) {
  const m = data_commonMeter(condoId, id);
  if (!m) return null;
  const n = String(nome || '').trim().slice(0, 80);
  if (n) m.nome = n;
  m.numero = String(numero == null ? m.numero : numero).trim().slice(0, 40);
  save();
  return m;
}
function deleteCommonMeter(condoId, id) {
  const data = load();
  const m = data.common_meters.find((x) => x.id === id && x.condo_id === condoId);
  if (!m) return false;
  data.common_meters = data.common_meters.filter((x) => x.id !== id);
  data.common_readings = data.common_readings.filter((r) => r.meter_id !== id);
  save();
  return true;
}
function data_commonMeter(condoId, id) {
  return load().common_meters.find((x) => x.id === id && x.condo_id === condoId) || null;
}
function getCommonReading(meterId, ref) {
  return load().common_readings.find((r) => r.meter_id === meterId && r.ref_month === ref) || null;
}
function listCommonReadings(condoId, ref) {
  const data = load();
  return listCommonMeters(condoId).map((m) => {
    const atual = getCommonReading(m.id, ref);
    const meses = data.billing_months
      .filter((bm) => bm.condo_id === condoId)
      .map((bm) => bm.ref_month).sort();
    const idx = meses.indexOf(ref);
    let anterior = null;
    if (idx > 0) {
      const prevRef = meses[idx - 1];
      const prev = getCommonReading(m.id, prevRef);
      if (prev) anterior = prev.leitura;
    }
    return {
      id: m.id, nome: m.nome, numero: m.numero, ativo: m.ativo,
      leitura: atual ? atual.leitura : null,
      leitura_anterior: anterior,
      data_leitura: atual ? atual.data_leitura : null,
    };
  });
}
function upsertCommonReading(condoId, meterId, ref, leitura, dataLeitura) {
  const m = data_commonMeter(condoId, meterId);
  if (!m) throw Object.assign(new Error('Hidrômetro não encontrado.'), { code: 'NOT_FOUND' });
  const data = load();
  let v = null;
  if (leitura !== '' && leitura != null) {
    v = Number(leitura);
    if (!Number.isFinite(v) || v < 0) throw Object.assign(new Error('Leitura inválida.'), { code: 'BADREAD' });
  }
  let row = data.common_readings.find((r) => r.meter_id === meterId && r.ref_month === ref);
  if (row) {
    row.leitura = v;
    row.data_leitura = dataLeitura || null;
    row.atualizado_em = nowISO();
  } else {
    row = {
      id: genId('hld'), meter_id: meterId, condo_id: condoId, ref_month: ref,
      leitura: v, data_leitura: dataLeitura || null,
      criado_em: nowISO(), atualizado_em: nowISO(),
    };
    data.common_readings.push(row);
  }
  save();
  return row;
}

// ---------------- links de medição delegada ----------------

function medLinks() {
  const d = load();
  if (!Array.isArray(d.med_links)) d.med_links = [];
  return d.med_links;
}

function createMedLink(condoId, ref, respNome, user, escopo) {
  const data = load();
  if (!data.billing_months.some((m) => m.condo_id === condoId && m.ref_month === ref)) {
    throw Object.assign(new Error('Mês não encontrado.'), { code: 'NOT_FOUND' });
  }
  const condo = getCondo(condoId);
  const token = crypto.randomBytes(24).toString('hex');
  const link = {
    id: genId('med'),
    token,
    condo_id: condoId,
    ref_month: ref,
    responsavel: String(respNome || '').trim().slice(0, 80) || 'Medidor',
    ativo: true,
    // restrição de quais torres/unidades o colaborador pode medir
    escopo: {
      torres: Array.isArray(escopo && escopo.torres) ? escopo.torres.map((t) => String(t)).slice(0, 10) : [],
      unidades: Array.isArray(escopo && escopo.unidades) ? escopo.unidades.map(Number).filter(Number.isFinite).slice(0, 2000) : [],
    },
    criado_por: user ? user.username : null,
    criado_em: nowISO(),
    revogado_em: null,
  };
  medLinks().push(link);
  logAction(user, 'criar_link_medicao', { ref_month: ref, responsavel: link.responsavel, condoNome: condo.nome,
    torres: link.escopo.torres.join(', ') || 'todas', unidades: link.escopo.unidades.length || 'todas' });
  return link;
}
// Diz se um link de medição pode acessar determinado apartamento.
function medLinkPermite(link, apt) {
  if (!apt) return false;
  const torres = link.escopo && link.escopo.torres;
  const unidades = link.escopo && link.escopo.unidades;
  const semRestricao = (!torres || !torres.length) && (!unidades || !unidades.length);
  if (semRestricao) return true;
  if (unidades && unidades.length && unidades.includes(Number(apt.id))) return true;
  if (torres && torres.length && torres.includes(apt.torre)) {
    // se só restringiu torres, vale; se também listou unidades, a torre só conta
    // quando não há lista de unidades explícita
    if (!unidades || !unidades.length) return true;
  }
  return false;
}
function listMedLinks(condoId, ref) {
  return medLinks()
    .filter((l) => l.condo_id === condoId && (!ref || l.ref_month === ref))
    .slice().sort((a, b) => b.criado_em.localeCompare(a.criado_em));
}
function revokeMedLink(condoId, id) {
  const l = medLinks().find((x) => x.id === id && x.condo_id === condoId);
  if (!l) return null;
  l.ativo = false;
  l.revogado_em = nowISO();
  save();
  return l;
}
function findMedLink(token) {
  const l = medLinks().find((x) => x.token === token);
  if (!l || !l.ativo) return null;
  return l;
}

// ---------------- links de conferência do condômino ----------------

function verLinks() {
  const d = load();
  if (!Array.isArray(d.ver_links)) d.ver_links = [];
  return d.ver_links;
}
function createVerLink(condoId, aptId, user) {
  const data = load();
  const apt = data.apartments.find((a) => a.id === Number(aptId) && a.condo_id === condoId);
  if (!apt) throw Object.assign(new Error('Unidade não encontrada.'), { code: 'NOT_FOUND' });
  const token = crypto.randomBytes(24).toString('hex');
  const link = {
    id: genId('ver'), token, condo_id: condoId, apartment_id: apt.id,
    ativo: true, criado_por: user ? user.username : null, criado_em: nowISO(), revogado_em: null,
  };
  verLinks().push(link);
  const condo = getCondo(condoId);
  logAction(user, 'criar_link_conferencia', { apartamento: apt.etiqueta, condoNome: condo ? condo.nome : null });
  return link;
}
function findVerLink(token) {
  const l = verLinks().find((x) => x.token === token);
  if (!l || !l.ativo) return null;
  return l;
}
// Retorna o link de conferência ativo da unidade; cria um novo só se não existir.
function getOrCreateVerLink(condoId, aptId, user) {
  const apt = getApartment(aptId);
  if (!apt || apt.condo_id !== condoId) {
    throw Object.assign(new Error('Unidade não encontrada.'), { code: 'NOT_FOUND' });
  }
  const existente = verLinks().find((l) => l.apartment_id === apt.id && l.condo_id === condoId && l.ativo);
  if (existente) return { link: existente, criado_agora: false };
  return { link: createVerLink(condoId, aptId, user), criado_agora: true };
}
function revokeVerLink(condoId, id) {
  const l = verLinks().find((x) => x.id === id && x.condo_id === condoId);
  if (!l) return null;
  l.ativo = false; l.revogado_em = nowISO();
  save();
  return l;
}
// Dados somente-leitura de UMA unidade para o condômino conferir.
function conferenciaUnidade(condoId, aptId) {
  const data = load();
  const apt = data.apartments.find((a) => a.id === Number(aptId) && a.condo_id === condoId);
  if (!apt) return null;
  const condo = getCondo(condoId);
  const registros = data.readings
    .filter((r) => r.condo_id === condoId && r.apartment_id === apt.id && r.leitura_atual != null)
    .sort((a, b) => a.ref_month.localeCompare(b.ref_month))
    .map((r) => {
      const mes = data.billing_months.find((m) => m.condo_id === condoId && m.ref_month === r.ref_month);
      return {
        ref_month: r.ref_month,
        leitura_anterior: r.leitura_anterior,
        leitura_atual: r.leitura_atual,
        data_leitura: r.data_leitura,
        consumo: r.consumo,
        valor_agua: r.valor_agua, valor_esgoto: r.valor_esgoto, valor_total: r.valor_total,
        foto: r.foto, medido_por: r.updated_by || null,
        status_mes: mes ? mes.status : 'rascunho',
      };
    });
  return { apartamento: apt, condominio: { nome: condo ? condo.nome : '', logo: condo ? condo.logo : null }, registros };
}

// ---------------- links de MEDIÇÃO INICIAL (públicos, por unidade) ----------------
function inicialLinks() {
  const d = load();
  if (!Array.isArray(d.inicial_links)) d.inicial_links = [];
  return d.inicial_links;
}
function getOrCreateInicialLink(condoId, aptId, user) {
  const apt = load().apartments.find((a) => a.id === Number(aptId) && a.condo_id === condoId);
  if (!apt) throw Object.assign(new Error('Unidade não encontrada.'), { code: 'NOT_FOUND' });
  const ls = inicialLinks();
  const ex = ls.find((l) => l.apartment_id === apt.id && l.ativo);
  if (ex) return { link: ex, criado_agora: false };
  const link = {
    id: genId('inl'), token: crypto.randomBytes(24).toString('hex'),
    condo_id: condoId, apartment_id: apt.id, ativo: true,
    criado_por: user ? user.username : null, criado_em: nowISO(), revogado_em: null,
  };
  ls.push(link);
  save();
  const condo = getCondo(condoId);
  logAction(user, 'criar_link_inicial', { unidade: apt.etiqueta, condoNome: condo ? condo.nome : null });
  return { link, criado_agora: true };
}
function findInicialLink(token) {
  if (!token) return null;
  return inicialLinks().find((l) => l.token === String(token) && l.ativo) || null;
}
function listAtivosInicialLinks(condoId) {
  const data = load();
  return inicialLinks()
    .filter((l) => l.condo_id === condoId && l.ativo)
    .map((l) => {
      const apt = data.apartments.find((a) => a.id === l.apartment_id);
      return { apartment_id: l.apartment_id, etiqueta: apt ? apt.etiqueta : '?', token: l.token };
    })
    .sort((a, b) => String(a.etiqueta).localeCompare(String(b.etiqueta), 'pt-BR', { numeric: true }));
}

// ---------------- exclusão de lançamento (admin) ----------------

function deleteMonth(condoId, ref, user) {
  const data = load();
  const idx = data.billing_months.findIndex((m) => m.condo_id === condoId && m.ref_month === ref);
  if (idx === -1) throw Object.assign(new Error('Mês não encontrado.'), { code: 'NOT_FOUND' });
  const [removido] = data.billing_months.splice(idx, 1);
  // remove leituras do mês e os assets de foto associados
  const fotosParaApagar = [];
  data.readings = data.readings.filter((r) => {
    if (r.condo_id === condoId && r.ref_month === ref) {
      if (r.foto) fotosParaApagar.push(r.foto);
      return false;
    }
    return true;
  });
  logAction(user, 'excluir_lancamento', { ref_month: ref, condoNome: getCondo(condoId) ? getCondo(condoId).nome : null });
  save();
  return { removido, fotosParaApagar };
}

// ---------------- apartamentos ----------------

function listApartments(condoId) {
  return load().apartments
    .filter((a) => a.condo_id === condoId)
    .sort((a, b) =>
      a.torre === b.torre
        ? a.numero.localeCompare(b.numero, 'pt-BR', { numeric: true })
        : a.torre.localeCompare(b.torre));
}
function getApartment(id) { return load().apartments.find((a) => a.id === Number(id)) || null; }

// ---------------- meses / leituras ----------------

function listMonths(condoId) {
  return load().billing_months.filter((m) => m.condo_id === condoId)
    .slice().sort((a, b) => b.ref_month.localeCompare(a.ref_month));
}
function getMonth(condoId, ref) {
  return load().billing_months.find((m) => m.condo_id === condoId && m.ref_month === ref) || null;
}

function createMonth(condoId, ref, valorGlobal, user, condo) {
  const data = load();
  if (data.billing_months.some((m) => m.condo_id === condoId && m.ref_month === ref)) {
    throw Object.assign(new Error('Mês já existe'), { code: 'EXISTS' });
  }
  const month = {
    condo_id: condoId,
    ref_month: ref,
    valor_global: valorGlobal == null ? null : round2(valorGlobal),
    total_individual: 0,
    valor_area_comum: null,
    status: 'rascunho',
    created_at: nowISO(),
    finalized_at: null,
    created_by: user ? user.username : null,
  };
  data.billing_months.push(month);
  logAction(user, 'criar_mes', { ref_month: ref, valor_global: month.valor_global, condoNome: condo.nome });
  return month;
}

function setValorGlobal(condoId, ref, valor, user, condo) {
  const month = getMonth(condoId, ref);
  if (!month) throw Object.assign(new Error('Mês não encontrado'), { code: 'NOT_FOUND' });
  month.valor_global = valor == null ? null : round2(valor);
  if (month.status === 'finalizado') {
    month.valor_area_comum = month.valor_global == null
      ? null : round2(month.valor_global - month.total_individual);
  }
  logAction(user, 'alterar_valor_global', { ref_month: ref, valor_global: month.valor_global, condoNome: condo.nome });
  return month;
}

// ---------- Medições iniciais (cadastro de hidrômetro + leitura antes da ocupação) ----------
// Sem cobrança: os valores viram a leitura anterior automática do primeiro mês lançado.
function getIniciais(condoId) {
  return load().apartments
    .filter((a) => a.condo_id === condoId && a.ativo !== false)
    .sort((a, b) => String(a.numero).localeCompare(String(b.numero), 'pt-BR', { numeric: true }))
    .map((a) => ({
      apartment_id: a.id,
      etiqueta: a.etiqueta,
      torre: a.torre,
      hidrometro: a.hidrometro || '',
      leitura_inicial: a.leitura_inicial == null ? null : Number(a.leitura_inicial),
      data_leitura_inicial: a.data_leitura_inicial || null,
      foto_inicial: a.foto_inicial || null,
    }));
}

function setIniciais(condoId, itens, user, condo) {
  const data = load();
  let salvos = 0;
  const apagar = [];
  for (const it of (Array.isArray(itens) ? itens : [])) {
    const apt = data.apartments.find((a) => a.id === Number(it.apartment_id) && a.condo_id === condoId);
    if (!apt) continue;
    if (it.hidrometro !== undefined) apt.hidrometro = String(it.hidrometro || '').trim().slice(0, 40);
    if (it.leitura_inicial === undefined && !it.data && it.foto === undefined) { salvos++; continue; }
    if (it.leitura_inicial === '' || it.leitura_inicial === null) {
      apt.leitura_inicial = null;
      apt.data_leitura_inicial = null;
    } else if (it.leitura_inicial !== undefined) {
      const v = Number(it.leitura_inicial);
      if (!Number.isFinite(v) || v < 0) {
        throw Object.assign(new Error(`Leitura inicial inválida (${apt.etiqueta}).`), { code: 'BAD_BASE' });
      }
      apt.leitura_inicial = r3(v);
    }
    if (it.foto !== undefined) {
      if (it.foto === '' || it.foto === null) {
        if (apt.foto_inicial) apagar.push(apt.foto_inicial);
        apt.foto_inicial = null;
      } else {
        if (apt.foto_inicial && apt.foto_inicial !== String(it.foto)) apagar.push(apt.foto_inicial);
        apt.foto_inicial = String(it.foto);
      }
    }
    if (it.data) apt.data_leitura_inicial = String(it.data).slice(0, 10);
    apt.updated_at = nowISO();
    apt.updated_by = user ? user.username : null;
    salvos++;
  }
  save();
  logAction(user, 'medicao_inicial', { condoNome: condo ? condo.nome : condoId, itens: salvos });
  return { salvos, apagar };
}

function getReading(condoId, apartmentId, ref) {
  return load().readings.find(
    (r) => r.condo_id === condoId && r.apartment_id === apartmentId && r.ref_month === ref
  ) || null;
}
function getPreviousReading(condoId, apartmentId, ref) {
  return load().readings
    .filter((r) => r.condo_id === condoId && r.apartment_id === apartmentId
      && r.ref_month < ref && r.leitura_atual != null)
    .sort((a, b) => b.ref_month.localeCompare(a.ref_month))[0] || null;
}

function upsertReading(condoId, ref, apartmentId, leituraAtual, leituraAnteriorInformada, dataLeitura, user, condo) {
  const data = load();
  const apt = data.apartments.find((a) => a.id === apartmentId && a.condo_id === condoId);
  if (!apt) throw Object.assign(new Error('Apartamento inválido'), { code: 'BAD_APT' });

  let prev = getPreviousReading(condoId, apartmentId, ref);

  if (!prev && leituraAnteriorInformada != null && !Number.isNaN(Number(leituraAnteriorInformada))) {
    const refBase = mesAnterior(ref);
    const baseline = {
      id: genId('rdg'), condo_id: condoId, apartment_id: apartmentId, ref_month: refBase,
      leitura_anterior: null, leitura_atual: r3(leituraAnteriorInformada),
      data_leitura: null,
      consumo: null, valor_agua: null, valor_esgoto: null, valor_total: null, faixas: null,
      foto: null, status: 'inicial', updated_at: nowISO(), updated_by: user ? user.username : null,
    };
    data.readings.push(baseline);
    logAction(user, 'leitura_inicial', { apartamento: apt.etiqueta, ref_base: refBase, leitura: baseline.leitura_atual, condoNome: condo.nome });
    prev = baseline;
  }

  let row = data.readings.find((r) => r.condo_id === condoId && r.apartment_id === apartmentId && r.ref_month === ref);
  if (!row) {
    row = {
      id: genId('rdg'), condo_id: condoId, apartment_id: apartmentId, ref_month: ref,
      leitura_anterior: null, leitura_atual: null, data_leitura: null,
      consumo: null, valor_agua: null, valor_esgoto: null, valor_total: null, faixas: null,
      foto: null, status: 'pendente', updated_at: nowISO(), updated_by: null,
    };
    data.readings.push(row);
  }

  const anterior = prev ? Number(prev.leitura_atual)
    : (apt.leitura_inicial != null ? Number(apt.leitura_inicial) : null);
  row.leitura_anterior = anterior;
  if (dataLeitura) row.data_leitura = dataLeitura;

  if (leituraAtual == null || leituraAtual === '' || Number.isNaN(Number(leituraAtual))) {
    row.leitura_atual = null;
    row.consumo = null; row.valor_agua = null; row.valor_esgoto = null;
    row.valor_total = null; row.faixas = null;
    row.status = 'pendente';
  } else {
    const atual = Number(leituraAtual);
    row.leitura_atual = r3(atual);
    if (anterior == null) {
      row.consumo = null; row.valor_total = null; row.faixas = null;
      row.status = 'sem_anterior';
    } else if (atual < anterior) {
      row.consumo = r3(atual - anterior);
      row.valor_agua = null; row.valor_esgoto = null; row.valor_total = null; row.faixas = null;
      row.status = 'anomalia';
    } else {
      const consumo = r3(atual - anterior);
      const calc = calcularValorAgua(consumo);
      row.consumo = consumo;
      row.valor_agua = calc.valor_agua;
      row.valor_esgoto = calc.valor_esgoto;
      row.valor_total = calc.valor_total;
      row.faixas = calc.faixas;
      row.status = consumo > 100 ? 'atencao' : 'lido';
    }
  }
  row.updated_at = nowISO();
  row.updated_by = user ? user.username : null;
  return row;
}

function setReadingPhoto(condoId, ref, apartmentId, fileName, user) {
  const data = load();
  let row = data.readings.find((r) => r.condo_id === condoId && r.apartment_id === apartmentId && r.ref_month === ref);
  const oldFoto = row ? row.foto : null;
  if (!row) {
    row = {
      id: genId('rdg'), condo_id: condoId, apartment_id: apartmentId, ref_month: ref,
      leitura_anterior: null, leitura_atual: null, data_leitura: null,
      consumo: null, valor_agua: null, valor_esgoto: null, valor_total: null, faixas: null,
      foto: fileName, status: 'pendente', updated_at: nowISO(), updated_by: user ? user.username : null,
    };
    data.readings.push(row);
  } else {
    row.foto = fileName;
    row.updated_at = nowISO();
  }
  return { row, oldFoto };
}

function getMonthDetail(condoId, ref) {
  const month = getMonth(condoId, ref);
  if (!month) return null;
  const linhas = listApartments(condoId).map((apt) => {
    const r = getReading(condoId, apt.id, ref);
    const prev = getPreviousReading(condoId, apt.id, ref);
    return {
      apartment_id: apt.id,
      torre: apt.torre,
      numero: apt.numero,
      etiqueta: apt.etiqueta,
      hidrometro: apt.hidrometro,
      leitura_anterior: r ? r.leitura_anterior : (prev ? prev.leitura_atual
        : (apt.leitura_inicial != null ? Number(apt.leitura_inicial) : null)),
      leitura_atual: r ? r.leitura_atual : null,
      data_leitura: r ? r.data_leitura : null,
      consumo: r ? r.consumo : null,
      valor_agua: r ? r.valor_agua : null,
      valor_esgoto: r ? r.valor_esgoto : null,
      valor_total: r ? r.valor_total : null,
      faixas: r ? r.faixas : null,
      foto: r ? r.foto : null,
      medido_por: r ? (r.updated_by || null) : null,
      status: r ? r.status : ((prev || apt.leitura_inicial != null) ? 'pendente' : 'sem_anterior'),
      tem_baseline: !!prev || apt.leitura_inicial != null,
    };
  });
  const lidos = linhas.filter((l) => l.status === 'lido' || l.status === 'atencao').length;
  return { month, linhas, lidos, total: linhas.length };
}

function finalizeMonth(condoId, ref, user, condo, opcoes = {}) {
  const forcar = opcoes.forcar === true;
  const data = load();
  const month = data.billing_months.find((m) => m.condo_id === condoId && m.ref_month === ref);
  if (!month) throw Object.assign(new Error('Mês não encontrado'), { code: 'NOT_FOUND' });
  if (month.status === 'finalizado') throw Object.assign(new Error('Mês já finalizado'), { code: 'LOCKED' });

  const detail = getMonthDetail(condoId, ref);
  const erros = [], avisos = [], pendentes = [], anomalias = [];
  for (const l of detail.linhas) {
    if (l.status === 'pendente' || l.status === 'sem_anterior' || l.leitura_atual == null) pendentes.push(l.etiqueta);
    else if (l.status === 'anomalia') anomalias.push(l.etiqueta);
  }
  // pendências/anomalias são bloqueios duros (não dá para fechar mesmo forçando)
  if (pendentes.length) erros.push({ tipo: 'pendentes', msg: `${pendentes.length} unidade(s) sem leitura`, lista: pendentes });
  if (anomalias.length) erros.push({ tipo: 'anomalias', msg: `${anomalias.length} unidade(s) com leitura atual inferior à anterior`, lista: anomalias });
  if (erros.length) {
    const err = new Error('Não foi possível finalizar: existem pendências.');
    err.code = 'VALIDATION'; err.erros = erros; throw err;
  }

  let totalIndividual = 0;
  for (const l of detail.linhas) {
    const calc = calcularValorAgua(l.consumo);
    totalIndividual += calc.valor_total;
    const row = data.readings.find((r) => r.condo_id === condoId && r.apartment_id === l.apartment_id && r.ref_month === ref);
    if (row) {
      row.valor_agua = calc.valor_agua; row.valor_esgoto = calc.valor_esgoto;
      row.valor_total = calc.valor_total; row.faixas = calc.faixas;
      if (row.status !== 'atencao') row.status = 'lido';
    }
  }
  totalIndividual = round2(totalIndividual);
  let areaComum = null;
  let areaComumNegativa = false;
  if (month.valor_global != null) {
    areaComum = round2(month.valor_global - totalIndividual);
    if (areaComum < 0) {
      areaComumNegativa = true;
      const aviso = { tipo: 'global_negativo',
        msg: `A soma das unidades (R$ ${totalIndividual.toFixed(2)}) é maior que a fatura global (R$ ${month.valor_global.toFixed(2)}). ` +
             `Área comum resultou em R$ ${areaComum.toFixed(2)}. Isso pode acontecer quando o consumo medido é maior que a água que entrou no condomínio no mês (ex.: uso do reservatório).` };
      if (!forcar) {
        const err = new Error('O somatório das cobranças individuais é maior que a fatura global.');
        err.code = 'VALIDATION'; err.erros = [aviso]; err.permiteForcar = true; throw err;
      }
      avisos.push(aviso);
    }
  }
  month.total_individual = totalIndividual;
  month.valor_area_comum = areaComum;
  month.status = 'finalizado';
  month.finalized_at = nowISO();
  month.finalized_by = user ? user.username : null;
  month.finalizado_forcado = forcar && areaComumNegativa;
  logAction(user, forcar && areaComumNegativa ? 'finalizar_mes_forcado' : 'finalizar_mes', {
    ref_month: ref, valor_global: month.valor_global,
    total_individual: totalIndividual, valor_area_comum: areaComum, condoNome: condo.nome,
    observacao: areaComumNegativa ? 'Faturamento fechado com área comum negativa (consumo superior à entrada de água / reservatório).' : undefined,
  });
  return getMonthDetail(condoId, ref);
}

function reopenMonth(condoId, ref, user, condo) {
  const month = getMonth(condoId, ref);
  if (!month) throw Object.assign(new Error('Mês não encontrado'), { code: 'NOT_FOUND' });
  month.status = 'rascunho';
  month.finalized_at = null;
  month.finalized_by = null;
  logAction(user, 'reabrir_mes', { ref_month: ref, condoNome: condo.nome });
  return month;
}

function apartmentHistory(condoId, apartmentId) {
  const apt = getApartment(apartmentId);
  if (!apt || apt.condo_id !== condoId) return null;
  const meses = new Map(listMonths(condoId).map((m) => [m.ref_month, m]));
  const registros = load().readings
    .filter((r) => r.condo_id === condoId && r.apartment_id === apartmentId)
    .sort((a, b) => a.ref_month.localeCompare(b.ref_month))
    .map((r) => ({
      ref_month: r.ref_month,
      leitura_anterior: r.leitura_anterior,
      leitura_atual: r.leitura_atual,
      data_leitura: r.data_leitura,
      consumo: r.consumo,
      valor_agua: r.valor_agua, valor_esgoto: r.valor_esgoto, valor_total: r.valor_total,
      faixas: r.faixas, foto: r.foto, status: r.status,
      medido_por: r.updated_by || null,
      status_mes: meses.get(r.ref_month) ? meses.get(r.ref_month).status : null,
    }));
  return { apartamento: apt, registros };
}

// Registra na auditoria que o gestor enviou/gerou um alerta de consumo
// acima da média para o condômino de uma unidade.
function registrarAlertaConsumo(condoId, apartmentId, user, info) {
  const apt = getApartment(apartmentId);
  if (!apt || apt.condo_id !== condoId) {
    throw Object.assign(new Error('Unidade não encontrada neste condomínio.'), { code: 'NOT_FOUND' });
  }
  const condo = getCondo(condoId);
  logAction(user, 'alerta_consumo', {
    condoNome: condo ? condo.nome : null,
    apartment_id: apartmentId,
    etiqueta: apt.etiqueta,
    torre: apt.torre || null,
    ref_month: info.ref_month || null,
    consumo: info.consumo != null ? info.consumo : null,
    media: info.media != null ? info.media : null,
    canal: info.canal || null, // 'whatsapp' | 'copia'
    msg: `Alerta de consumo acima da média enviado ao condômino da unidade ${apt.etiqueta}`
      + ` (${info.canal === 'whatsapp' ? 'WhatsApp' : 'mensagem copiada'})`
      + (info.ref_month ? ` — ${info.ref_month}.` : '.'),
  });
  return { ok: true };
}

function getAudit(limit = 80) {
  return load().audit_log.slice(-limit).reverse();
}

function resumo(condoId, condo) {
  const data = load();
  const meses = listMonths(condoId);
  const finalizados = meses.filter((m) => m.status === 'finalizado');
  const ultimo = finalizados[0] || null;

  // unidades com consumo acima da média — usa o mês mais recente que tenha
  // leituras (rascunho em andamento; se estiver vazio, cai no último finalizado)
  let maioresConsumos = [];
  let mediaConsumo = null;
  let mesRefUsado = null;
  for (const m of meses) {
    const detail = getMonthDetail(condoId, m.ref_month);
    const comConsumo = detail.linhas.filter((l) => l.consumo != null && l.status !== 'anomalia');
    if (comConsumo.length) {
      const consumos = comConsumo.map((l) => l.consumo);
      mediaConsumo = round2(consumos.reduce((s, v) => s + v, 0) / consumos.length);
      maioresConsumos = detail.linhas
        .filter((l) => l.consumo != null && l.consumo > mediaConsumo && l.status !== 'anomalia')
        .sort((a, b) => b.consumo - a.consumo)
        .slice(0, 12)
        .map((l) => ({
          apartment_id: l.apartment_id,
          etiqueta: l.etiqueta, torre: l.torre, hidrometro: l.hidrometro,
          consumo: l.consumo, valor_total: l.valor_total,
        }));
      mesRefUsado = m.ref_month;
      break;
    }
  }

  return {
    condominio: condo.nome,
    total_apartamentos: data.apartments.filter((a) => a.condo_id === condoId).length,
    total_meses: meses.length,
    meses_finalizados: finalizados.length,
    ultimo_mes: ultimo,
    mes_referencia_consumo: mesRefUsado,
    media_consumo: mediaConsumo,
    maiores_consumos: maioresConsumos,
    serie_meses: finalizados.slice(0, 6).reverse().map((m) => ({
      ref_month: m.ref_month,
      total_individual: m.total_individual,
      valor_area_comum: m.valor_area_comum,
      valor_global: m.valor_global,
    })),
  };
}

// ---------------- seed ----------------

function seed() {
  // Base vazia "de fábrica": só o admin global. Condomínio, unidades e usuários
  // são criados pelas telas (Condomínios / Usuários) — isolamento por condomínio
  // já vem embutido no app.
  const data = {
    version: 6,
    created_at: nowISO(),
    users: [], sessions: [], condos: [], apartments: [],
    billing_months: [], readings: [], audit_log: [],
    med_links: [], ver_links: [],
    common_meters: [], common_readings: [],
    daily_meters: [], daily_readings: [],
  };

  const adminSenha = process.env.ADMIN_PASSWORD || 'admin123';
  const { salt, hash } = hashPassword(adminSenha);
  data.users.push({
    id: 'usr_admin', username: 'admin',
    nome: 'Administrador do Sistema', role: 'admin', condo_id: null,
    salt, password_hash: hash, ativo: true, must_change_password: false, created_at: nowISO(),
  });

  data.audit_log.push({
    id: genId('log'), ts: nowISO(), user_id: null, username: 'sistema',
    condo: null, action: 'inicializacao',
    details: JSON.stringify({ msg: 'Base Vida Samambaia criada. Próximos passos: Condomínios → Cadastrar condomínio (nome, logo, unidades e modo de medição); Usuários → criar os gestores.' }),
  });

  return { doc: data, assets: [] };
}

// ---------------- MEDIÇÃO DIÁRIA DE ACOMPANHAMENTO (sem cobrança) ----------------
// Vigilância dia a dia do medidor macro do prédio. Não toca na fatura mensal.
// Alerta de possível vazamento: consumo do período (m³/dia) >= 1,5 × média móvel de 30 dias.

function dailyData() {
  const d = load();
  if (!Array.isArray(d.daily_meters)) d.daily_meters = [];
  if (!Array.isArray(d.daily_readings)) d.daily_readings = [];
  return d;
}
function dailyTodayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function shiftDate(dateStr, dias) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}
function diasEntre(d1, d2) {
  return Math.max(0, Math.round((new Date(`${d2}T12:00:00Z`) - new Date(`${d1}T12:00:00Z`)) / 86400000));
}
const r3d = (v) => Math.round((Number(v) + Number.EPSILON) * 1000) / 1000;

function listDailyMeters(condoId) {
  return dailyData().daily_meters
    .filter((m) => m.condo_id === condoId)
    .slice().sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}
function data_dailyMeter(condoId, id) {
  return dailyData().daily_meters.find((m) => m.id === String(id) && m.condo_id === condoId) || null;
}
function createDailyMeter(condoId, nome, numero, user) {
  const d = dailyData();
  const n = String(nome || '').trim().slice(0, 80);
  if (!n) throw Object.assign(new Error('Informe o nome do medidor (ex.: Hidrômetro Macro do Prédio).'), { code: 'BADNAME' });
  const meter = {
    id: genId('hmd'), condo_id: condoId, nome: n,
    numero: String(numero || '').trim().slice(0, 40),
    ativo: true, criado_em: nowISO(),
  };
  d.daily_meters.push(meter);
  const condo = getCondo(condoId);
  logAction(user, 'criar_medidor_diario', { medidor: n, condoNome: condo ? condo.nome : null });
  save();
  return meter;
}
function updateDailyMeter(condoId, id, { nome, numero, ativo } = {}, user) {
  const m = data_dailyMeter(condoId, id);
  if (!m) return null;
  if (nome != null) { const n = String(nome).trim().slice(0, 80); if (n) m.nome = n; }
  if (numero != null) m.numero = String(numero).trim().slice(0, 40);
  if (ativo !== undefined) m.ativo = !!ativo;
  save();
  return m;
}
function deleteDailyMeter(condoId, id, user) {
  const d = dailyData();
  const m = d.daily_meters.find((x) => x.id === String(id) && x.condo_id === condoId);
  if (!m) return null;
  const rows = d.daily_readings.filter((r) => r.tipo === 'macro' && String(r.ref_id) === m.id);
  d.daily_meters = d.daily_meters.filter((x) => x.id !== m.id);
  d.daily_readings = d.daily_readings.filter((r) => !(r.tipo === 'macro' && String(r.ref_id) === m.id));
  const condo = getCondo(condoId);
  logAction(user, 'excluir_medidor_diario', { medidor: m.nome, leituras_removidas: rows.length, condoNome: condo ? condo.nome : null });
  save();
  return { ok: true, fotos: rows.map((r) => r.foto).filter(Boolean) };
}

function findDailyRow(d, condoId, ref, date) {
  return d.daily_readings.find((r) => r.condo_id === condoId && r.tipo === 'macro' && String(r.ref_id) === String(ref) && r.date === date) || null;
}
function upsertDailyReading(condoId, medidorId, date, leitura, obs, user) {
  if (!isDataValida(date)) throw Object.assign(new Error('Data inválida.'), { code: 'BADDATE' });
  if (date > dailyTodayStr()) throw Object.assign(new Error('Ainda não é possível registrar leitura de dia futuro.'), { code: 'BADDATE' });
  const m = data_dailyMeter(condoId, medidorId);
  if (!m) throw Object.assign(new Error('Medidor não encontrado.'), { code: 'NOT_FOUND' });
  const d = dailyData();
  let row = findDailyRow(d, condoId, m.id, date);
  const limpo = leitura === '' || leitura == null;
  let v = null;
  if (!limpo) {
    v = Number(String(leitura).replace(',', '.'));
    if (!Number.isFinite(v) || v < 0) throw Object.assign(new Error('Leitura inválida (use número em m³, ex.: 81234.5).'), { code: 'BADREAD' });
    v = r3d(v);
  }
  const quem = user ? (user.nome || user.username) : null;
  if (limpo) {
    if (!row) return { acao: 'nada' };
    row.leitura = null;
    if (obs != null) row.obs = String(obs).trim().slice(0, 240) || null;
    row.atualizado_em = nowISO();
    if (quem) row.medido_por = quem;
    if (!row.foto) {
      d.daily_readings = d.daily_readings.filter((x) => x !== row);
      return { acao: 'apagada', foto: null };
    }
    save();
    return { acao: 'atualizada' };
  }
  if (row) {
    row.leitura = v;
    if (obs != null) row.obs = String(obs).trim().slice(0, 240) || null;
    row.atualizado_em = nowISO();
    if (quem) row.medido_por = quem;
    save();
    return { acao: 'atualizada' };
  }
  row = {
    id: genId('dld'), condo_id: condoId, tipo: 'macro', ref_id: m.id, date,
    leitura: v, obs: obs != null ? String(obs).trim().slice(0, 240) || null : null,
    foto: null, medido_por: quem, criado_em: nowISO(), atualizado_em: nowISO(),
  };
  d.daily_readings.push(row);
  save();
  return { acao: 'criada' };
}
function setDailyReadingPhoto(condoId, medidorId, date, fileName, user) {
  if (!isDataValida(date)) throw Object.assign(new Error('Data inválida.'), { code: 'BADDATE' });
  const m = data_dailyMeter(condoId, medidorId);
  if (!m) throw Object.assign(new Error('Medidor não encontrado.'), { code: 'NOT_FOUND' });
  const d = dailyData();
  let row = findDailyRow(d, condoId, m.id, date);
  let oldFoto = null;
  if (row) {
    oldFoto = row.foto || null;
    row.foto = fileName;
    row.atualizado_em = nowISO();
  } else {
    row = {
      id: genId('dld'), condo_id: condoId, tipo: 'macro', ref_id: m.id, date,
      leitura: null, obs: null, foto: fileName,
      medido_por: user ? (user.nome || user.username) : null,
      criado_em: nowISO(), atualizado_em: nowISO(),
    };
    d.daily_readings.push(row);
  }
  save();
  return { row, oldFoto };
}
function deleteDailyReadingPhoto(condoId, medidorId, date) {
  const d = dailyData();
  const m = data_dailyMeter(condoId, medidorId);
  if (!m) return null;
  const row = findDailyRow(d, condoId, m.id, date);
  if (!row || !row.foto) return null;
  const oldFoto = row.foto;
  row.foto = null;
  row.atualizado_em = nowISO();
  if (row.leitura == null && !row.obs) d.daily_readings = d.daily_readings.filter((x) => x !== row);
  save();
  return oldFoto;
}

// motor de cálculo: consumo por período + média móvel + alerta de possível vazamento
function dailyCompute(condoId, medidorId) {
  const rows = dailyData().daily_readings
    .filter((r) => r.condo_id === condoId && r.tipo === 'macro' && String(r.ref_id) === String(medidorId) && Number.isFinite(r.leitura))
    .sort((a, b) => a.date.localeCompare(b.date));
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const item = {
      date: r.date, leitura: r.leitura, foto: r.foto || null, obs: r.obs || null,
      medido_por: r.medido_por || null,
      consumo: null, dias: null, consumo_dia: null, media: null, alerta: false, motivos: [],
    };
    if (i > 0) {
      const prev = rows[i - 1];
      const dias = Math.max(1, diasEntre(prev.date, r.date));
      const consumo = r3d(r.leitura - prev.leitura);
      item.dias = dias;
      item.consumo = consumo;
      if (consumo < 0) {
        // leitura menor que a anterior: troca de hidrômetro ou engano na medição
        item.alerta = true;
        item.motivos.push('retrocesso');
      } else {
        item.consumo_dia = r3d(consumo / dias);
        const janelaIni = shiftDate(r.date, -DIARIA.JANELA_DIAS);
        const amostras = [];
        for (let j = 0; j < i; j++) {
          const c = out[j];
          if (c.date >= janelaIni && c.consumo_dia != null && c.consumo_dia >= 0) amostras.push(c.consumo_dia);
        }
        if (amostras.length >= DIARIA.MIN_AMOSTRAS) {
          const media = amostras.reduce((s, v) => s + v, 0) / amostras.length;
          item.media = r3d(media);
          if (media > 0 && item.consumo_dia >= media * DIARIA.FATOR_ALERTA) {
            item.alerta = true;
            item.motivos.push('acima_media');
          }
        }
      }
    }
    out.push(item);
  }
  return out;
}

// relatório de acompanhamento: série completa filtrada por período (sem janela)
function dailyRelatorio(condoId, de, ate) {
  return listDailyMeters(condoId).map((m) => ({
    id: m.id, nome: m.nome, numero: m.numero || '', ativo: m.ativo !== false,
    rows: dailyCompute(condoId, m.id).filter((r) => r.date >= de && r.date <= ate),
  }));
}

// painel da aba "Medição Diária": medidor + série + situação do dia selecionado
function dailyPainel(condoId, dias) {
  const hoje = dailyTodayStr();
  const n = Math.min(Math.max(Number(dias) || 45, 7), 180);
  const d = dailyData();
  const medidores = listDailyMeters(condoId).map((m) => {
    const serie = dailyCompute(condoId, m.id);
    const row = findDailyRow(d, condoId, m.id, hoje);
    return {
      id: m.id, nome: m.nome, numero: m.numero || '', ativo: m.ativo !== false,
      ultima: serie.length ? serie[serie.length - 1].date : null,
      hoje: row ? { leitura: row.leitura == null ? null : row.leitura, obs: row.obs || null, foto: row.foto || null } : null,
      serie: serie.slice(-n),
    };
  });
  return { hoje, dias: n, medidores };
}

module.exports = {
  init, load, save, saveNow, logAction,
  listDailyMeters, createDailyMeter, updateDailyMeter, deleteDailyMeter,
  upsertDailyReading, setDailyReadingPhoto, deleteDailyReadingPhoto, dailyPainel, dailyRelatorio,
  putAsset, getAsset, deleteAsset,
  hashPassword, verifyPassword, findUserByUsername, findUserById,
  createSession, getSession, destroySession,
  listCondos, getCondo, getDefaultCondoId, resolveCondo, resolveCondoForUser,
  condoImpact, deleteCondo, updateCondoInfo,
  getIniciais, setIniciais,
  getOrCreateInicialLink, findInicialLink, listAtivosInicialLinks,
  listCondosForUser, setCondoLogo, createCondo,
  listUsers, createUser, setUserActive,
  changeOwnPassword, updateOwnProfile, adminResetPassword,
  // medição diária de acompanhamento
  renameCondo, updateApartmentMeter,
  listCommonMeters, createCommonMeter, updateCommonMeter, deleteCommonMeter,
  listCommonReadings, upsertCommonReading,
  createMedLink, listMedLinks, revokeMedLink, findMedLink, medLinkPermite,
  createVerLink, getOrCreateVerLink, findVerLink, revokeVerLink, conferenciaUnidade,
  deleteMonth,
  listApartments, getApartment,
  listMonths, getMonth, createMonth, setValorGlobal, getMonthDetail,
  getReading, upsertReading, setReadingPhoto,
  finalizeMonth, reopenMonth,
  apartmentHistory, registrarAlertaConsumo, getAudit, resumo,
};
