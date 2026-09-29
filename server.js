'use strict';
/**
 * Servidor HTTP — Faturamento de Água (multi-condomínio).
 * Zero dependências externas (Node.js puro).
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const { TARIFAS_CAESB, isRefValido } = require('./lib');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp',
};

function sendJSON(res, status, obj, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(obj));
}

function readBody(req, limit = 12 * 1024 * 1024) {
  if (req._parsedBody !== undefined) return Promise.resolve(req._parsedBody);
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('Payload muito grande'), { code: 'PAYLOAD' }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        req._parsedBody = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
        resolve(req._parsedBody);
      }
      catch { reject(Object.assign(new Error('JSON inválido'), { code: 'BADJSON' })); }
    });
    req.on('error', reject);
  });
}

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function extractToken(req) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7).trim();
  if (req.headers['x-auth-token']) return String(req.headers['x-auth-token']).trim();
  const c = parseCookies(req).sid;
  if (c) return c;
  try { return new URL(req.url, 'http://localhost').searchParams.get('token'); } catch { return null; }
}

function authUser(req) {
  const token = extractToken(req);
  const session = db.getSession(token);
  if (session) {
    const u = db.findUserById(session.user_id);
    if (!u || u.ativo === false) return null;
    return u;
  }
  // link de medição delegada: acesso somente à tela de medição
  const med = db.findMedLink(token);
  if (med) {
    const condo = db.getCondo(med.condo_id);
    return {
      id: `med_${med.id}`,
      username: med.responsavel,
      nome: med.responsavel,
      role: 'medidor',
      condo_id: med.condo_id,
      ativo: true,
      med: {
        token: med.token, ref_month: med.ref_month,
        condo_nome: condo ? condo.nome : '',
        responsavel: med.responsavel,
        escopo: med.escopo || { torres: [], unidades: [] },
      },
    };
  }
  // link de conferência do condômino: acesso somente-leitura à própria unidade
  const ver = db.findVerLink(token);
  if (ver) {
    return {
      id: `ver_${ver.id}`,
      username: 'condomino',
      nome: 'Condômino',
      role: 'conferidor',
      condo_id: ver.condo_id,
      ativo: true,
      ver: { token: ver.token, apartment_id: ver.apartment_id },
    };
  }
  return null;
}
function isAdmin(user) { return user && user.role === 'admin' && !user.condo_id; }

function currentCondo(req, user) {
  const id = req.headers['x-condo-id'] ? String(req.headers['x-condo-id']) : null;
  return db.resolveCondoForUser(user, id);
}

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; Path=/; Max-Age=${12 * 3600}; SameSite=Lax`);
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax');
}

// Converte uma data URL em { fileName, buffer }. O arquivo é persistido via db.putAsset.
function dadosDataUrl(dataUrl, prefixo) {
  const m = /^data:image\/(png|jpeg|jpg|webp|svg\+xml);base64,(.+)$/.exec(String(dataUrl || ''));
  if (!m) throw Object.assign(new Error('Imagem inválida (use PNG, JPG, WEBP ou SVG).'), { code: 'BADIMG' });
  let ext = m[1];
  if (ext === 'jpeg') ext = 'jpg';
  if (ext === 'svg+xml') ext = 'svg';
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 8 * 1024 * 1024) throw Object.assign(new Error('Imagem muito grande (máx. 8 MB).'), { code: 'BIGIMG' });
  const fileName = `${prefixo}_${crypto.randomBytes(6).toString('hex')}.${ext}`;
  return { fileName, buffer: buf };
}

// Apaga o asset antigo se não for a logo de seed.
async function removerAsset(nome) {
  if (nome && nome !== 'orion-logo.svg') { try { await db.deleteAsset(nome); } catch { /* ignora */ } }
}

const loginAttempts = new Map();
function registerLoginFail(key) {
  const rec = loginAttempts.get(key) || { count: 0, until: 0 };
  rec.count += 1;
  if (rec.count >= 5) rec.until = Date.now() + 60 * 1000;
  loginAttempts.set(key, rec);
  return rec;
}
const loginBlocked = (key) => { const r = loginAttempts.get(key); return r && r.until > Date.now(); };

// ---------------- handlers da API ----------------
const api = {};

// ================================================================
// MEDIÇÃO DIÁRIA DE ACOMPANHAMENTO — medidor macro (sem cobrança)
// ================================================================

api.diariaPainel = async (req, res, user, condo) => {
  const dias = new URL(req.url, 'http://localhost').searchParams.get('dias');
  sendJSON(res, 200, db.dailyPainel(condo.id, dias));
};

api.diariaMedidorCriar = async (req, res, user, condo) => {
  const body = await readBody(req);
  try {
    const medidor = db.createDailyMeter(condo.id, body.nome, body.numero, user);
    db.save();
    sendJSON(res, 201, { medidor });
  } catch (e) {
    if (e.code === 'BADNAME') return sendJSON(res, 400, { error: e.message });
    throw e;
  }
};

api.diariaMedidorAtualizar = async (req, res, user, condo, id) => {
  const body = await readBody(req);
  const m = db.updateDailyMeter(condo.id, id, body, user);
  if (!m) return sendJSON(res, 404, { error: 'Medidor não encontrado.' });
  db.save();
  sendJSON(res, 200, { medidor: m });
};

api.diariaMedidorExcluir = async (req, res, user, condo, id) => {
  const r = db.deleteDailyMeter(condo.id, id, user);
  if (!r) return sendJSON(res, 404, { error: 'Medidor não encontrado.' });
  for (const f of r.fotos) await removerAsset(f);
  db.save();
  sendJSON(res, 200, { ok: true });
};

api.diariaLeitura = async (req, res, user, condo) => {
  const body = await readBody(req);
  try {
    const r = db.upsertDailyReading(condo.id, body.medidor_id, String(body.date || ''), body.leitura, body.obs, user);
    db.save();
    sendJSON(res, 200, { ok: true, acao: r.acao, foto_apagada: r.foto || null });
  } catch (e) {
    if (e.code === 'BADDATE' || e.code === 'BADREAD' || e.code === 'NOT_FOUND') return sendJSON(res, 400, { error: e.message });
    throw e;
  }
};

// foto do hidrômetro macro (com carimbo de data/hora, como na leitura mensal)
api.diariaFoto = async (req, res, user, condo) => {
  const body = await readBody(req);
  const m = /^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/.exec(String(body.foto || ''));
  if (!m) return sendJSON(res, 400, { error: 'Imagem inválida. Envie JPEG, PNG ou WEBP.' });
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  let buf;
  try { buf = Buffer.from(m[2], 'base64'); } catch { return sendJSON(res, 400, { error: 'Imagem corrompida.' }); }
  if (buf.length > 8 * 1024 * 1024) return sendJSON(res, 413, { error: 'Imagem muito grande (máx. 8 MB).' });
  const fileName = `diaria_${condo.id}_macro_${body.medidor_id}_${String(body.date || '').replace(/-/g, '')}_${crypto.randomBytes(4).toString('hex')}.${ext}`;
  await db.putAsset(fileName, buf);
  let r;
  try {
    r = db.setDailyReadingPhoto(condo.id, body.medidor_id, String(body.date || ''), fileName, user);
  } catch (e) {
    await removerAsset(fileName);
    if (e.code === 'BADDATE' || e.code === 'NOT_FOUND') return sendJSON(res, 400, { error: e.message });
    throw e;
  }
  db.save();
  if (r.oldFoto) await removerAsset(r.oldFoto);
  sendJSON(res, 200, { ok: true, foto: fileName });
};

api.diariaLancamentos = async (req, res, user, condo) => {
  const body = await readBody(req);
  const itens = Array.isArray(body.itens) ? body.itens : [];
  if (!itens.length) return sendJSON(res, 400, { error: 'Nenhuma leitura enviada.' });
  if (itens.length > 62) return sendJSON(res, 400, { error: 'Máximo de 62 dias por lançamento em lote.' });
  let salvos = 0;
  const erros = [];
  for (const it of itens) {
    try {
      const r = db.upsertDailyReading(condo.id, body.medidor_id, String(it.date || ''), it.leitura, it.obs, user);
      if (r.acao !== 'nada') salvos++;
    } catch (e) {
      if (e.code === 'BADDATE' || e.code === 'BADREAD' || e.code === 'NOT_FOUND') erros.push({ date: it.date, error: e.message });
      else throw e;
    }
  }
  db.save();
  sendJSON(res, 200, { ok: true, salvos, erros });
};

// ---- relatório imprimível de medição diária (tabela + gráfico por medidor) ----
function diariaReportSVG(rows) {
  const pts = rows.filter((r) => r.consumo_dia != null);
  if (pts.length < 2) return '<p style=\"color:#64748b;font-size:12px;margin:6px 0 14px;\">O gráfico aparece a partir de 2 leituras com consumo calculável no período.</p>';
  const W = 780, H = 235, padL = 48, padR = 16, padT = 16, padB = 34;
  const w = W - padL - padR, h = H - padT - padB;
  const maxV = Math.max(...pts.map((p) => p.consumo_dia), 0.5);
  const niceMax = Math.ceil(maxV * 1.15 * 10) / 10;
  const x = (i) => (pts.length === 1 ? padL + w / 2 : padL + (i / (pts.length - 1)) * w);
  const y = (v) => padT + h - (v / niceMax) * h;
  const fmt = (v) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  let grid = '';
  for (let g = 0; g <= 4; g++) {
    const val = (niceMax / 4) * g;
    grid += `<line x1=\"${padL}\" y1=\"${y(val)}\" x2=\"${W - padR}\" y2=\"${y(val)}\" stroke=\"#e2e8f0\"/>`;
    grid += `<text x=\"${padL - 7}\" y=\"${y(val) + 4}\" text-anchor=\"end\" font-size=\"11\" fill=\"#94a3b8\">${fmt(val)}</text>`;
  }
  const step = Math.max(1, Math.ceil(pts.length / 16));
  let labels = '';
  pts.forEach((p, i) => {
    if (i % step === 0 || i === pts.length - 1) {
      labels += `<text x=\"${x(i)}\" y=\"${H - 12}\" text-anchor=\"middle\" font-size=\"10.5\" fill=\"#64748b\">${p.date.slice(8)}/${p.date.slice(5, 7)}</text>`;
    }
  });
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.consumo_dia).toFixed(1)}`).join(' ');
  const area = `${path} L${x(pts.length - 1).toFixed(1)},${padT + h} L${x(0).toFixed(1)},${padT + h} Z`;
  const dots = pts.map((p, i) => `<circle cx=\"${x(i).toFixed(1)}\" cy=\"${y(p.consumo_dia).toFixed(1)}\" r=\"3.4\" fill=\"${p.alerta ? '#dc2626' : '#ea580c'}\"><title>${p.date}: ${fmt(p.consumo_dia)} m³/dia${p.alerta ? ' — ALERTA' : ''}</title></circle>`).join('');
  return `<svg viewBox=\"0 0 ${W} ${H}\" style=\"width:100%;height:auto;border:1px solid #e2e8f0;border-radius:10px;background:#fff;margin:6px 0 14px;\" role=\"img\" aria-label=\"consumo diário no período\">${grid}<path d=\"${area}\" fill=\"#ea580c\" opacity=\"0.08\"/><path d=\"${path}\" fill=\"none\" stroke=\"#ea580c\" stroke-width=\"2.2\" stroke-linejoin=\"round\"/>${dots}${labels}</svg>`;
}

api.diariaRelatorio = async (req, res, user, condo) => {
  const q = new URL(req.url, 'http://localhost').searchParams;
  const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;
  const hoje = new Date(); const hojeStr = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
  let de = String(q.get('de') || ''); let ate = String(q.get('ate') || '');
  if (!RE_DATA.test(ate) || ate > hojeStr) ate = hojeStr;
  if (!RE_DATA.test(de) || de > ate) de = `${ate.slice(0, 7)}-01`;
  const piso = new Date(); piso.setUTCDate(piso.getUTCDate() - 366);
  if (de < piso.toISOString().slice(0, 10)) de = piso.toISOString().slice(0, 10);
  const medidores = db.dailyRelatorio(condo.id, de, ate);
  const brData2 = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
  const num = (v, d = 2) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const logo = await imgDataUrl(condo.logo);
  const situacao = (r) => ((r.motivos || []).includes('retrocesso') ? '<span style=\"color:#b91c1c;font-weight:bold;\">Retrocesso</span>'
    : r.alerta ? '<span style=\"color:#b91c1c;font-weight:bold;\">🚨 1,5× média</span>'
    : r.leitura != null ? '<span style=\"color:#15803d;\">Normal</span>' : '—');

  const secoes = medidores.map((m) => {
    const lidos = m.rows.filter((r) => r.leitura != null);
    const total = lidos.length >= 2 ? lidos[lidos.length - 1].leitura - lidos[0].leitura : null;
    const spanDias = lidos.length >= 2
      ? Math.max(1, Math.round((new Date(`${lidos[lidos.length - 1].date}T12:00:00Z`) - new Date(`${lidos[0].date}T12:00:00Z`)) / 86400000))
      : null;
    const media = total != null && spanDias ? total / spanDias : null;
    const alertas = m.rows.filter((r) => r.alerta).length;
    const linhas = m.rows.slice().reverse().map((r) => `<tr>
      <td style=\"font-weight:bold;color:#292524;\">${brData2(r.date)}</td>
      <td class=\"n\">${num(r.leitura, 3)}</td>
      <td class=\"n\">${num(r.consumo, 3)}</td>
      <td class=\"n\">${num(r.consumo_dia, 2)}</td>
      <td class=\"n\">${num(r.media, 2)}</td>
      <td>${situacao(r)}</td>
      <td style=\"color:#64748b;font-size:11px;\">${escHtml(r.obs || '')}</td>
    </tr>`).join('');
    return `
    <h2 style=\"margin:22px 0 4px;font-size:15px;color:#292524;\">💧 ${escHtml(m.nome)}${m.numero ? ` <span style=\"color:#64748b;font-weight:normal;font-size:12px;\">(hidrômetro ${escHtml(m.numero)})</span>` : ''}${m.ativo ? '' : ' — inativo'}</h2>
    <p style=\"margin:0 0 8px;color:#64748b;font-size:12px;\">${m.rows.length ? `${lidos.length} dia(s) com leitura registrada` : 'nenhuma leitura neste período'}${spanDias ? ` · ritmo médio: ${num(media, 2)} m³/dia` : ''}${alertas ? ` · <b style=\"color:#b91c1c;\">${alertas} alerta(s)</b>` : ''}</p>
    ${diariaReportSVG(m.rows)}
    ${linhas ? `<table><thead><tr><th>Dia</th><th class=\"n\">Leitura (m³)</th><th class=\"n\">Consumo (m³)</th><th class=\"n\">m³/dia</th><th class=\"n\">Média 30d (m³/d)</th><th>Situação</th><th>Observação</th></tr></thead><tbody>${linhas}</tbody>
    ${total != null ? `<tfoot><tr><td colspan=\"2\">CONSUMO NO PERÍODO (m³)</td><td class=\"n\">${num(total, 3)}</td><td class=\"n\">${num(media, 2)}</td><td colspan=\"3\">média m³/dia entre a 1ª e a última leitura</td></tr></tfoot>` : ''}</table>` : '<p style=\"color:#64748b;font-size:12px;\">Sem registros entre ' + brData2(de) + ' e ' + brData2(ate) + '.</p>'}`;
  }).join('');

  const html = `<!DOCTYPE html><html lang=\"pt-BR\"><head><meta charset=\"utf-8\">
<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">
<title>Relatório diário — ${escHtml(condo.nome)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1e293b; margin: 0; padding: 24px; font-size: 12px; }
  .cabecalho { display: flex; align-items: center; gap: 18px; border-bottom: 3px solid #ea580c; padding-bottom: 14px; margin-bottom: 16px; }
  .cabecalho img.logo { width: 84px; height: 84px; object-fit: contain; border-radius: 12px; border: 1px solid #e2e8f0; }
  .cabecalho h1 { font-size: 20px; margin: 0 0 4px; color: #292524; }
  .cabecalho p { margin: 2px 0; color: #64748b; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #f1f5f9; text-align: left; padding: 7px 8px; font-size: 10px; text-transform: uppercase; color: #475569; border-bottom: 2px solid #cbd5e1; }
  td { padding: 6px 8px; border-bottom: 1px solid #eef2f7; }
  td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; }
  tfoot td { font-weight: bold; background: #f8fafc; border-top: 2px solid #cbd5e1; }
  .rodape { margin-top: 22px; color: #64748b; font-size: 11px; display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  .acoes { margin-bottom: 14px; text-align: right; }
  .acoes button { background: #ea580c; color: #fff; border: none; padding: 10px 20px; border-radius: 8px; font-weight: bold; font-size: 13px; cursor: pointer; }
  @media print { .acoes { display: none; } body { padding: 8px; } svg { break-inside: avoid; } table { break-inside: auto; } h2 { break-after: avoid; } }
</style></head><body>
  <div class=\"acoes\"><button onclick=\"window.print()\">🖨️ Imprimir / Salvar PDF</button></div>
  <div class=\"cabecalho\">
    ${logo ? `<img class=\"logo\" src=\"${logo}\" alt=\"logo\"/>` : ''}
    <div>
      <h1>${escHtml(condo.nome)}</h1>
      <p>Medição diária de acompanhamento (medidor macro) — <b>${brData2(de)} a ${brData2(ate)}</b></p>
      <p style=\"font-size:11px;\">Regra de alerta: consumo ≥ 1,5× a média móvel de 30 dias · Este relatório não gera cobrança — é vigilância de consumo</p>
    </div>
  </div>
  ${medidores.length ? secoes : '<p style=\"color:#64748b;\">Nenhum medidor macro cadastrado neste condomínio.</p>'}
  <div class=\"rodape\"><span>Gerado em ${new Date().toLocaleString('pt-BR')}</span><span>Faturamento de Água — Condomínio</span></div>
</body></html>`;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
};

api.diariaFotoExcluir = async (req, res, user, condo) => {
  const body = await readBody(req);
  const oldFoto = db.deleteDailyReadingPhoto(condo.id, body.medidor_id, String(body.date || ''));
  if (!oldFoto) return sendJSON(res, 404, { error: 'Não há foto neste dia.' });
  db.save();
  await removerAsset(oldFoto);
  sendJSON(res, 200, { ok: true });
};

api.login = async (req, res) => {
  const body = await readBody(req);
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  const ip = req.socket.remoteAddress || '?';
  const key = `${ip}:${username}`;
  if (loginBlocked(key)) return sendJSON(res, 429, { error: 'Muitas tentativas. Aguarde 1 minuto.' });
  const user = db.findUserByUsername(username);
  if (!user || !db.verifyPassword(password, user.salt, user.password_hash)) {
    const rec = registerLoginFail(key);
    return sendJSON(res, 401, { error: rec.count >= 5 ? 'Credenciais inválidas. Aguarde 1 minuto.' : 'Usuário ou senha inválidos.' });
  }
  loginAttempts.delete(key);
  const session = db.createSession(user);
  setSessionCookie(res, session.token);
  db.logAction(user, 'login', { ip });
  sendJSON(res, 200, {
    user: { id: user.id, username: user.username, nome: user.nome, role: user.role, condo_id: user.condo_id || null,
      must_change_password: user.must_change_password === true },
    token: session.token,
    condos: db.listCondosForUser(user),
    default_condo: user.condo_id || db.getDefaultCondoId(),
    is_admin: user.role === 'admin' && !user.condo_id,
  });
};

api.logout = (req, res, user) => {
  db.destroySession(extractToken(req));
  db.logAction(user, 'logout', {});
  clearSessionCookie(res);
  sendJSON(res, 200, { ok: true });
};

api.me = (req, res) => {
  const token = extractToken(req);
  const session = db.getSession(token);
  if (session) {
    const user = db.findUserById(session.user_id);
    if (!user || user.ativo === false) return sendJSON(res, 401, { error: 'Usuário inativo.' });
    // gestor abrindo a tela de medição ("Iniciar medição"): responde no modo medidor
    const params = new URL(req.url, 'http://localhost').searchParams;
    if (params.get('med') === '1') {
      const ref = params.get('ref') || '';
      let condo = null;
      try { condo = db.resolveCondoForUser(user, req.headers['x-condo-id'] || null); } catch { condo = null; }
      if (condo && isRefValido(ref) && db.getMonth(condo.id, ref)) {
        return sendJSON(res, 200, {
          user: { id: user.id, username: user.username, nome: user.nome || user.username, role: 'medidor', condo_id: condo.id },
          med: { ref_month: ref, condo_nome: condo.nome },
        });
      }
      return sendJSON(res, 404, { error: 'Mês não encontrado para medição.' });
    }
    return sendJSON(res, 200, {
      user: { id: user.id, username: user.username, nome: user.nome, role: user.role, condo_id: user.condo_id || null,
        must_change_password: user.must_change_password === true },
      condos: db.listCondosForUser(user),
      default_condo: user.condo_id || db.getDefaultCondoId(),
      is_admin: user.role === 'admin' && !user.condo_id,
    });
  }
  const med = db.findMedLink(token);
  if (med) {
    const condo = db.getCondo(med.condo_id);
    return sendJSON(res, 200, {
      user: { id: `med_${med.id}`, username: med.responsavel, nome: med.responsavel, role: 'medidor', condo_id: med.condo_id },
      med: { ref_month: med.ref_month, condo_nome: condo ? condo.nome : '', responsavel: med.responsavel,
        escopo: med.escopo || { torres: [], unidades: [] } },
    });
  }
  const ver = db.findVerLink(token);
  if (ver) {
    const condo = db.getCondo(ver.condo_id);
    const apt = db.getApartment(ver.apartment_id);
    return sendJSON(res, 200, {
      user: { id: `ver_${ver.id}`, username: 'condomino', nome: 'Condômino', role: 'conferidor', condo_id: ver.condo_id },
      ver: { apartment_id: ver.apartment_id, etiqueta: apt ? apt.etiqueta : '', condo_nome: condo ? condo.nome : '' },
    });
  }
  return sendJSON(res, 401, { error: 'Não autenticado.' });
};

api.config = (req, res) => sendJSON(res, 200, { tarifas: TARIFAS_CAESB });

api.condominios = (req, res, user) => sendJSON(res, 200, { condominios: db.listCondosForUser(user) });

api.criarCondominio = async (req, res, user) => {
  const body = await readBody(req);
  const nome = String(body.nome || '').trim();
  if (!nome) return sendJSON(res, 400, { error: 'Informe o nome do condomínio.' });
  if (!body.logo) return sendJSON(res, 400, { error: 'A logo do condomínio é obrigatória.' });
  let logoFile;
  try {
    const { fileName, buffer } = dadosDataUrl(body.logo, 'logo');
    logoFile = fileName;
    await db.putAsset(fileName, buffer);
  } catch (e) { return sendJSON(res, 400, { error: e.message }); }

  const medeMensal = !(body.medicoes && body.medicoes.mensal === false);
  const medeDiaria = !(body.medicoes && body.medicoes.diaria_macro === false);
  if (!medeMensal && !medeDiaria) return sendJSON(res, 400, { error: 'Escolha ao menos um tipo de medição (mensal e/ou diária).' });
  let unidades = [];
  if (medeMensal && Array.isArray(body.unidades)) {
    for (const u of body.unidades) {
      const etiqueta = String(u.etiqueta || '').trim().toUpperCase();
      if (!etiqueta) continue;
      unidades.push({
        etiqueta,
        torre: String(u.torre || etiqueta.slice(-1)).trim().toUpperCase(),
        numero: String(u.numero || etiqueta.slice(0, -1)).trim(),
        hidrometro: u.hidrometro ? String(u.hidrometro).trim() : '',
      });
    }
  }
  if (medeMensal && !unidades.length) return sendJSON(res, 400, { error: 'Cadastre ao menos uma unidade.' });
  const vistos = new Set();
  const unicas = [];
  for (const u of unidades) {
    if (vistos.has(u.etiqueta)) continue;
    vistos.add(u.etiqueta);
    unicas.push(u);
  }
  const { condo, criadas } = db.createCondo(nome, unicas, logoFile, user, { mensal: medeMensal, diaria_macro: medeDiaria });
  db.save();
  sendJSON(res, 201, { condo: { ...condo, total_unidades: criadas, total_meses: 0 }, criadas });
};

api.trocarLogoCondominio = async (req, res, user, condoId) => {
  const condo = db.getCondo(condoId);
  if (!condo) return sendJSON(res, 404, { error: 'Condomínio não encontrado.' });
  const body = await readBody(req);
  if (!body.logo) return sendJSON(res, 400, { error: 'Selecione uma imagem para a logo.' });
  let logoFile;
  try {
    const d = dadosDataUrl(body.logo, 'logo');
    logoFile = d.fileName;
    await db.putAsset(d.fileName, d.buffer);
  } catch (e) { return sendJSON(res, 400, { error: e.message }); }
  const logoAntiga = condo.logo;
  db.setCondoLogo(condo.id, logoFile);
  await removerAsset(logoAntiga);
  db.logAction(user, 'trocar_logo', { condoNome: condo.nome });
  db.save();
  sendJSON(res, 200, { ok: true, logo: logoFile, condominio: { ...condo, logo: logoFile } });
};

api.usuarios = (req, res) => {
  const users = db.listUsers().map((u) => {
    const c = db.getCondo(u.condo_id);
    return { ...u, condominio: c ? c.nome : null };
  });
  sendJSON(res, 200, { usuarios: users, condominios: db.listCondos() });
};

api.criarUsuario = async (req, res, user) => {
  const body = await readBody(req);
  try {
    const novo = db.createUser({
      username: body.username,
      password: body.password,
      nome: body.nome,
      condo_id: body.condo_id,
      role: body.role,
    });
    db.logAction(user, 'criar_usuario', { username: novo.username, role: novo.role, condo: body.condo_id ? (db.getCondo(body.condo_id) || {}).nome : null });
    db.save();
    sendJSON(res, 201, { usuario: novo });
  } catch (e) {
    if (e.code === 'BADUSER') return sendJSON(res, 400, { error: e.message });
    if (e.code === 'DUPUSER') return sendJSON(res, 409, { error: e.message });
    if (e.code === 'BADPASSWORD' || e.code === 'BADCONDO') return sendJSON(res, 400, { error: e.message });
    throw e;
  }
};

api.ativarUsuario = (req, res, user, id) => {
  const u = new URL(req.url, 'http://localhost').searchParams.get('ativo');
  const ativo = !(u === '0' || u === 'false');
  const atualizado = db.setUserActive(id, ativo);
  if (!atualizado) return sendJSON(res, 404, { error: 'Usuário não encontrado.' });
  db.logAction(user, ativo ? 'ativar_usuario' : 'desativar_usuario', { id });
  sendJSON(res, 200, { usuario: atualizado });
};

api.resumo = (req, res, user, condo) => sendJSON(res, 200, db.resumo(condo.id, condo));
api.auditoria = (req, res, user) => {
  if (!isAdmin(user)) return sendJSON(res, 403, { error: 'A trilha de auditoria é restrita ao administrador.' });
  sendJSON(res, 200, { eventos: db.getAudit(120) });
};
api.apartamentos = (req, res, user, condo) => sendJSON(res, 200, { apartamentos: db.listApartments(condo.id) });

api.historico = (req, res, user, condo, id) => {
  const hist = db.apartmentHistory(condo.id, Number(id));
  if (!hist) return sendJSON(res, 404, { error: 'Apartamento não encontrado.' });
  sendJSON(res, 200, hist);
};

api.listaMeses = (req, res, user, condo) => {
  const meses = db.listMonths(condo.id).map((m) => {
    let lidos = 0;
    if (m.status === 'rascunho') lidos = db.getMonthDetail(condo.id, m.ref_month).lidos;
    else lidos = db.listApartments(condo.id).length;
    return { ...m, lidos, total_apartamentos: db.listApartments(condo.id).length };
  });
  sendJSON(res, 200, { meses });
};

api.criarMes = async (req, res, user, condo) => {
  const body = await readBody(req);
  const ref = String(body.ref_month || '');
  if (!isRefValido(ref)) return sendJSON(res, 400, { error: 'Mês de referência inválido (use AAAA-MM).' });
  let valor = null;
  if (body.valor_global !== '' && body.valor_global != null) {
    valor = Number(body.valor_global);
    if (!Number.isFinite(valor) || valor < 0) return sendJSON(res, 400, { error: 'Valor global inválido.' });
  }
  try {
    const month = db.createMonth(condo.id, ref, valor, user, condo);
    db.save();
    sendJSON(res, 201, { month });
  } catch (e) {
    if (e.code === 'EXISTS') return sendJSON(res, 409, { error: 'Já existe um lançamento para este mês.' });
    throw e;
  }
};

api.detalheMes = (req, res, user, condo, ref) => {
  const detail = db.getMonthDetail(condo.id, ref);
  if (!detail) return sendJSON(res, 404, { error: 'Mês não encontrado.' });
  sendJSON(res, 200, { ...detail, condo: { id: condo.id, nome: condo.nome, logo: condo.logo } });
};

api.getIniciais = (req, res, user, condo) => {
  if (!condo) return sendJSON(res, 400, { error: 'Nenhum condomínio disponível para este usuário.' });
  sendJSON(res, 200, { unidades: db.getIniciais(condo.id) });
};

// resolve dataURLs de foto para assets antes de gravar
async function prepararFotosIniciais(condoId, itens) {
  for (const it of itens) {
    if (typeof it.foto === 'string' && it.foto.startsWith('data:image/')) {
      const d = dadosDataUrl(it.foto, `inicial_${condoId}_${it.apartment_id}`);
      await db.putAsset(d.fileName, d.buffer);
      it.foto = d.fileName;
    }
  }
}

api.setIniciais = async (req, res, user, condo) => {
  if (!condo) return sendJSON(res, 400, { error: 'Nenhum condomínio disponível para este usuário.' });
  const body = await readBody(req);
  try {
    const itens = Array.isArray(body && body.itens) ? body.itens : [];
    await prepararFotosIniciais(condo.id, itens);
    const out = db.setIniciais(condo.id, itens, user, condo);
    for (const f of out.apagar) await removerAsset(f);
    sendJSON(res, 200, { ok: true, salvos: out.salvos, foto: (itens[0] && itens[0].foto && !String(itens[0].foto).startsWith('data:')) ? itens[0].foto : null });
  } catch (e) {
    sendJSON(res, 400, { error: e.message || 'Falha ao salvar.' });
  }
};

api.criarLinkInicial = async (req, res, user, condo, aptId) => {
  if (!condo) return sendJSON(res, 400, { error: 'Nenhum condomínio disponível para este usuário.' });
  try {
    const { link, criado_agora } = db.getOrCreateInicialLink(condo.id, Number(aptId), user);
    sendJSON(res, criado_agora ? 201 : 200, { link, criado_agora });
  } catch (e) {
    if (e.code === 'NOT_FOUND') return sendJSON(res, 404, { error: e.message });
    throw e;
  }
};

api.gerarLinksIniciais = (req, res, user, condo) => {
  if (!condo) return sendJSON(res, 400, { error: 'Nenhum condomínio disponível para este usuário.' });
  const units = db.getIniciais(condo.id);
  for (const u of units) {
    try { db.getOrCreateInicialLink(condo.id, u.apartment_id, user); } catch { /* unidade pulou */ }
  }
  sendJSON(res, 200, { links: db.listAtivosInicialLinks(condo.id) });
};

// ------- páginas/endpoint PÚBLICO do link de medição inicial -------
api.inicialInfo = async (req, res) => {
  const q = new URL(req.url, 'http://localhost').searchParams;
  const l = db.findInicialLink(q.get('token'));
  if (!l) return sendJSON(res, 404, { error: 'Link inválido ou revogado.' });
  const apt = db.getApartment(l.apartment_id);
  const condo = db.getCondo(l.condo_id);
  if (!apt || !condo) return sendJSON(res, 404, { error: 'Cadastro não encontrado.' });
  let logo = null;
  try {
    if (condo.logo) {
      const buf = await db.getAsset(condo.logo);
      if (buf) logo = `data:image/${String(condo.logo).endsWith('.png') ? 'png' : 'jpeg'};base64,${buf.toString('base64')}`;
    }
  } catch { /* logo é decorativa */ }
  sendJSON(res, 200, {
    condominio: { nome: condo.nome, logo },
    unidade: { etiqueta: apt.etiqueta, torre: apt.torre },
    atual: {
      hidrometro: apt.hidrometro || '',
      leitura_inicial: apt.leitura_inicial == null ? null : Number(apt.leitura_inicial),
      data: apt.data_leitura_inicial || null,
      tem_foto: !!apt.foto_inicial,
    },
  });
};

api.inicialEnvio = async (req, res) => {
  const body = await readBody(req);
  const l = db.findInicialLink(body && body.token);
  if (!l) return sendJSON(res, 404, { error: 'Link inválido ou revogado.' });
  if (body.leitura_inicial === undefined || body.leitura_inicial === null || body.leitura_inicial === '') {
    return sendJSON(res, 400, { error: 'Informe a leitura do hidrômetro (m³).' });
  }
  const item = {
    apartment_id: l.apartment_id,
    hidrometro: body.hidrometro != null ? String(body.hidrometro) : undefined,
    leitura_inicial: body.leitura_inicial,
    data: body.data || null,
    foto: typeof body.foto === 'string' && body.foto.startsWith('data:image/') ? body.foto : undefined,
  };
  const userLink = { id: 'link_inicial', username: 'medição via link', nome: 'Equipe (link)', role: 'link', condo_id: l.condo_id };
  await prepararFotosIniciais(l.condo_id, [item]);
  const out = db.setIniciais(l.condo_id, [item], userLink, db.getCondo(l.condo_id));
  for (const f of out.apagar) await removerAsset(f);
  sendJSON(res, 200, { ok: true });
};

api.salvarMes = async (req, res, user, condo, ref) => {
  const month = db.getMonth(condo.id, ref);
  if (!month) return sendJSON(res, 404, { error: 'Mês não encontrado.' });
  if (month.status === 'finalizado') return sendJSON(res, 409, { error: 'Mês finalizado. Reabra o lançamento para editar.' });
  const body = await readBody(req);

  if (body.valor_global !== undefined) {
    const v = body.valor_global === '' || body.valor_global == null ? null : Number(body.valor_global);
    if (v !== null && (!Number.isFinite(v) || v < 0)) return sendJSON(res, 400, { error: 'Valor global inválido.' });
    db.setValorGlobal(condo.id, ref, v, user, condo);
  }

  const leituras = Array.isArray(body.leituras) ? body.leituras : [];
  for (const item of leituras) {
    const aptId = Number(item.apartment_id);
    const apt = db.getApartment(aptId);
    if (!apt || apt.condo_id !== condo.id) continue;
    let atual = null;
    if (item.leitura_atual !== '' && item.leitura_atual != null) {
      atual = Number(item.leitura_atual);
      if (!Number.isFinite(atual) || atual < 0) return sendJSON(res, 400, { error: `Leitura inválida (${apt.etiqueta}).` });
    }
    let anterior = null;
    if (item.leitura_anterior !== '' && item.leitura_anterior != null) {
      anterior = Number(item.leitura_anterior);
      if (!Number.isFinite(anterior) || anterior < 0) return sendJSON(res, 400, { error: `Leitura anterior inválida (${apt.etiqueta}).` });
    }
    const dataLeitura = typeof item.data_leitura === 'string' && item.data_leitura ? item.data_leitura : null;
    db.upsertReading(condo.id, ref, aptId, atual, anterior, dataLeitura, user, condo);
  }
  db.save();
  sendJSON(res, 200, { ok: true, salvos: leituras.length, ...db.getMonthDetail(condo.id, ref) });
};

api.finalizarMes = async (req, res, user, condo, ref) => {
  let body = {};
  try { body = await readBody(req); } catch { body = {}; }
  const forcar = body.forcar === true;
  try {
    const detail = db.finalizeMonth(condo.id, ref, user, condo, { forcar });
    db.save();
    sendJSON(res, 200, { ok: true, ...detail });
  } catch (e) {
    if (e.code === 'NOT_FOUND') return sendJSON(res, 404, { error: e.message });
    if (e.code === 'LOCKED') return sendJSON(res, 409, { error: e.message });
    if (e.code === 'VALIDATION') return sendJSON(res, 422, { error: e.message, erros: e.erros, permite_forcar: !!e.permiteForcar });
    throw e;
  }
};

api.reabrirMes = (req, res, user, condo, ref) => {
  try {
    const month = db.reopenMonth(condo.id, ref, user, condo);
    db.save();
    sendJSON(res, 200, { ok: true, month });
  } catch (e) {
    if (e.code === 'NOT_FOUND') return sendJSON(res, 404, { error: e.message });
    throw e;
  }
};

// Fotos: upload (base64 JSON) e servir arquivo
api.uploadFoto = async (req, res, user, condo, ref, id) => {
  const month = db.getMonth(condo.id, ref);
  if (!month) return sendJSON(res, 404, { error: 'Mês não encontrado.' });
  const apt = db.getApartment(Number(id));
  if (!apt || apt.condo_id !== condo.id) return sendJSON(res, 404, { error: 'Unidade não encontrada.' });
  const body = await readBody(req);
  const m = /^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/.exec(String(body.foto || ''));
  if (!m) return sendJSON(res, 400, { error: 'Imagem inválida. Envie JPEG, PNG ou WEBP.' });
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  let buf;
  try { buf = Buffer.from(m[2], 'base64'); } catch { return sendJSON(res, 400, { error: 'Imagem corrompida.' }); }
  if (buf.length > 8 * 1024 * 1024) return sendJSON(res, 413, { error: 'Imagem muito grande (máx. 8 MB).' });

  const fileName = `${condo.id}_${apt.id}_${ref}_${crypto.randomBytes(4).toString('hex')}.${ext}`;
  await db.putAsset(fileName, buf);

  const { oldFoto } = db.setReadingPhoto(condo.id, ref, apt.id, fileName, user);
  db.save();
  await removerAsset(oldFoto);

  db.logAction(user, 'upload_foto', { apartamento: apt.etiqueta, ref_month: ref, condoNome: condo.nome });
  db.save();
  sendJSON(res, 200, { ok: true, foto: fileName });
};

api.condominioImpacto = (req, res, condoId) => {
  const c = db.getCondo(condoId);
  if (!c) return sendJSON(res, 404, { error: 'Condomínio não encontrado.' });
  sendJSON(res, 200, { nome: c.nome, impacto: db.condoImpact(condoId) });
};

api.excluirCondominio = async (req, res, user, condoId) => {
  const r = db.deleteCondo(condoId, user);
  if (!r) return sendJSON(res, 404, { error: 'Condomínio não encontrado.' });
  for (const f of r.assets) await removerAsset(f);
  db.save();
  sendJSON(res, 200, { ok: true, nome: r.nome, removidos: r.counts });
};

// Exclui a foto de uma leitura
api.excluirFoto = async (req, res, user, condo, ref, id) => {
  const month = db.getMonth(condo.id, ref);
  if (!month) return sendJSON(res, 404, { error: 'Mês não encontrado.' });
  const apt = db.getApartment(Number(id));
  if (!apt || apt.condo_id !== condo.id) return sendJSON(res, 404, { error: 'Unidade não encontrada.' });
  const reading = db.getReading(condo.id, apt.id, ref);
  const fotoAtual = reading ? reading.foto : null;
  if (!fotoAtual) return sendJSON(res, 404, { error: 'Não há foto nesta leitura.' });
  db.setReadingPhoto(condo.id, ref, apt.id, null, user);
  db.save();
  await removerAsset(fotoAtual);
  db.logAction(user, 'excluir_foto', { apartamento: apt.etiqueta, ref_month: ref, condoNome: condo.nome });
  db.save();
  sendJSON(res, 200, { ok: true });
};

async function servirFoto(req, res, fileName) {
  // só aceita nome de arquivo simples (proteção contra path traversal)
  if (!/^[a-zA-Z0-9_.-]+\.(jpg|jpeg|png|webp|svg)$/.test(fileName)) {
    res.writeHead(400); return res.end('Arquivo inválido');
  }
  const data = await db.getAsset(fileName);
  if (!data) { res.writeHead(404); return res.end('Foto não encontrada'); }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(fileName).toLowerCase()] || 'image/jpeg',
    'Cache-Control': 'private, max-age=3600',
  });
  res.end(data);
}

function csvMes(req, res, condo, ref) {
  const { mesLabel } = require('./lib');
  const detail = db.getMonthDetail(condo.id, ref);
  if (!detail) return sendJSON(res, 404, { error: 'Mês não encontrado.' });
  const sep = ';';
  const linhas = [
    ['Condomínio', condo.nome],
    ['Mês de Referência', mesLabel(ref)],
    [],
    ['Unidade', 'Torre', 'Hidrômetro', 'Leitura Anterior (m³)', 'Leitura Atual (m³)', 'Data Leitura',
     'Consumo (m³)', 'Valor Água (R$)', 'Valor Esgoto (R$)', 'Valor Total (R$)', 'Medição feita por', 'Situação', 'Foto'],
  ];
  const n = (v) => (v == null ? '' : String(v).replace('.', ','));
  for (const l of detail.linhas) {
    linhas.push([
      l.etiqueta, l.torre, l.hidrometro, n(l.leitura_anterior), n(l.leitura_atual),
      l.data_leitura || '', n(l.consumo), n(l.valor_agua), n(l.valor_esgoto), n(l.valor_total),
      l.medido_por || '', l.status, l.foto ? 'sim' : 'nao',
    ]);
  }
  linhas.push([]);
  linhas.push(['', '', '', '', '', '', '', '', 'TOTAL INDIVIDUAL (R$)', n(detail.month.total_individual)]);
  linhas.push(['', '', '', '', '', '', '', '', 'ÁREA COMUM (R$)', n(detail.month.valor_area_comum)]);
  linhas.push(['', '', '', '', '', '', '', '', 'FATURA GLOBAL (R$)', n(detail.month.valor_global)]);
  const csv = linhas.map((r) => r.join(sep)).join('\r\n');
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="faturamento-${ref}.csv"`,
  });
  res.end('﻿' + csv);
}

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function imgDataUrl(fileName) {
  if (!fileName) return null;
  try {
    const buf = await db.getAsset(fileName);
    if (!buf) return null;
    const ext = path.extname(fileName).slice(1).toLowerCase();
    const type = ext === 'jpg' ? 'jpeg' : ext;
    return `data:image/${type};base64,${Buffer.from(buf).toString('base64')}`;
  } catch { return null; }
}

// Condomínios em URLs abertas em aba nova (relatórios/CSV): o header X-Condo-Id não
// existe nessas requisições, então o alvo vem do query ?condo= (gestor continua preso ao seu).
function condoAlvoQuery(req, res, user, condo) {
  const q = new URL(req.url, 'http://localhost').searchParams.get('condo');
  if (q && !db.getCondo(q)) { sendJSON(res, 404, { error: 'Condomínio não encontrado.' }); return null; }
  return db.resolveCondoForUser(user, q || (condo && condo.id));
}

async function relatorioHTML(req, res, condo, ref) {
  const detail = db.getMonthDetail(condo.id, ref);
  if (!detail) { res.writeHead(404); return res.end('Mês não encontrado'); }
  const { mesLabel } = require('./lib');
  const m = detail.month;
  const logo = await imgDataUrl(condo.logo);
  const brl = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
  const num = (v, d = 2) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const STATUS = { lido: 'Lido', atencao: 'Consumo elevado', anomalia: 'Inválida', pendente: 'Pendente', sem_anterior: 'Sem anterior' };

  const fotos = await Promise.all(detail.linhas.map((l) => imgDataUrl(l.foto)));
  const linhas = detail.linhas.map((l, i) => {
    const foto = fotos[i];
    return `<tr>
      <td class="e">${escHtml(l.etiqueta)}</td>
      <td>${escHtml(l.hidrometro || '—')}</td>
      <td class="n">${num(l.leitura_anterior)}</td>
      <td class="n">${num(l.leitura_atual)}</td>
      <td class="n">${num(l.consumo)}</td>
      <td class="n">${brl(l.valor_agua)}</td>
      <td class="n">${brl(l.valor_esgoto)}</td>
      <td class="n"><b>${brl(l.valor_total)}</b></td>
      <td class="c">${foto ? `<img class="foto" src="${foto}" alt="foto ${escHtml(l.etiqueta)}"/>` : '—'}</td>
      <td>${escHtml(l.medido_por || '—')}</td>
      <td>${escHtml(STATUS[l.status] || l.status)}</td>
    </tr>`;
  }).join('');

  const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
<title>Relatório ${escHtml(mesLabel(ref))} — ${escHtml(condo.nome)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1e293b; margin: 0; padding: 24px; font-size: 12px; }
  .cabecalho { display: flex; align-items: center; gap: 18px; border-bottom: 3px solid #ea580c; padding-bottom: 14px; margin-bottom: 18px; }
  .cabecalho img.logo { width: 84px; height: 84px; object-fit: contain; border-radius: 12px; border: 1px solid #e2e8f0; }
  .cabecalho h1 { font-size: 20px; margin: 0 0 4px; color: #292524; }
  .cabecalho p { margin: 2px 0; color: #64748b; font-size: 13px; }
  .resumo { display: flex; gap: 12px; margin-bottom: 16px; }
  .quadro { flex: 1; border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 14px; }
  .quadro .t { font-size: 10px; text-transform: uppercase; color: #64748b; letter-spacing: .04em; font-weight: bold; }
  .quadro .v { font-size: 17px; font-weight: bold; color: #292524; margin-top: 3px; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #f1f5f9; text-align: left; padding: 7px 8px; font-size: 10px; text-transform: uppercase; color: #475569; border-bottom: 2px solid #cbd5e1; }
  td { padding: 5px 8px; border-bottom: 1px solid #eef2f7; }
  td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; }
  td.c, th.c { text-align: center; }
  td.e { font-weight: bold; color: #292524; }
  img.foto { width: 40px; height: 40px; object-fit: cover; border-radius: 5px; border: 1px solid #cbd5e1; }
  tfoot td { font-weight: bold; background: #f8fafc; border-top: 2px solid #cbd5e1; }
  .rodape { margin-top: 20px; color: #64748b; font-size: 11px; display: flex; justify-content: space-between; }
  .acoes { margin-bottom: 16px; text-align: right; }
  .acoes button { background: #ea580c; color: #fff; border: none; padding: 10px 20px; border-radius: 8px; font-weight: bold; font-size: 13px; cursor: pointer; }
  @media print { .acoes { display: none; } body { padding: 8px; } }
</style></head><body>
  <div class="acoes"><button onclick="window.print()">🖨️ Imprimir / Salvar PDF</button></div>
  <div class="cabecalho">
    ${logo ? `<img class="logo" src="${logo}" alt="logo"/>` : ''}
    <div>
      <h1>${escHtml(condo.nome)}</h1>
      <p>Relatório de faturamento de água — <b>${escHtml(mesLabel(ref))}</b></p>
      <p>Situação: ${m.status === 'finalizado' ? 'Finalizado' : 'Rascunho'}${m.finalized_at ? ' · Fechado em ' + escHtml(new Date(m.finalized_at).toLocaleString('pt-BR')) : ''}</p>
    </div>
  </div>
  <div class="resumo">
    <div class="quadro"><div class="t">Total das unidades (água + esgoto)</div><div class="v">${brl(m.total_individual)}</div></div>
    <div class="quadro"><div class="t">Área comum (saldo)</div><div class="v">${brl(m.valor_area_comum)}</div></div>
    <div class="quadro"><div class="t">Fatura global</div><div class="v">${brl(m.valor_global)}</div></div>
    <div class="quadro"><div class="t">Unidades</div><div class="v">${detail.lidos}/${detail.total}</div></div>
  </div>
  <table>
    <thead><tr>
      <th>Unidade</th><th>Hidrômetro</th><th class="n">Anterior</th><th class="n">Atual</th>
      <th class="n">Consumo (m³)</th><th class="n">Água</th><th class="n">Esgoto</th><th class="n">Total</th>
      <th class="c">Foto</th><th>Medição feita por</th><th>Situação</th>
    </tr></thead>
    <tbody>${linhas}</tbody>
    <tfoot>
      <tr><td colspan="8">TOTAL DAS UNIDADES</td><td class="n">${brl(m.total_individual)}</td><td colspan="2"></td></tr>
      <tr><td colspan="8">ÁREA COMUM</td><td class="n">${brl(m.valor_area_comum)}</td><td colspan="2"></td></tr>
      <tr><td colspan="8">FATURA GLOBAL</td><td class="n">${brl(m.valor_global)}</td><td colspan="2"></td></tr>
    </tfoot>
  </table>
  <div class="rodape"><span>Memória de cálculo CAESB · faixas progressivas · esgoto 100% (água × 2)</span>
  <span>Emitido em ${escHtml(new Date().toLocaleString('pt-BR'))}</span></div>
</body></html>`;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end(html);
}

// ---------------- roteamento ----------------

// Rotas de delegação de medição (gestor/admin do condomínio)
api.criarLinkMedicao = async (req, res, user, condo) => {
  const body = await readBody(req);
  const ref = String(body.ref_month || '');
  if (!isRefValido(ref)) return sendJSON(res, 400, { error: 'Mês de referência inválido.' });
  try {
    const link = db.createMedLink(condo.id, ref, body.responsavel, user,
      { torres: body.torres || [], unidades: body.unidades || [] });
    db.save();
    sendJSON(res, 201, { link });
  } catch (e) {
    if (e.code === 'NOT_FOUND') return sendJSON(res, 404, { error: e.message });
    throw e;
  }
};
api.listaLinksMedicao = (req, res, user, condo, ref) => {
  sendJSON(res, 200, { links: db.listMedLinks(condo.id, ref || null) });
};
api.revogarLinkMedicao = (req, res, user, condo, id) => {
  const l = db.revokeMedLink(condo.id, id);
  if (!l) return sendJSON(res, 404, { error: 'Link não encontrado.' });
  db.logAction(user, 'revogar_link_medicao', { ref_month: l.ref_month, responsavel: l.responsavel, condoNome: condo.nome });
  sendJSON(res, 200, { ok: true });
};

// Exclusão de lançamento (somente admin global)
api.excluirMes = async (req, res, user, condo, ref) => {
  if (!isAdmin(user)) return sendJSON(res, 403, { error: 'Somente o administrador pode excluir lançamentos.' });
  try {
    const { fotosParaApagar } = db.deleteMonth(condo.id, ref, user);
    db.save();
    for (const f of fotosParaApagar) await removerAsset(f);
    sendJSON(res, 200, { ok: true });
  } catch (e) {
    if (e.code === 'NOT_FOUND') return sendJSON(res, 404, { error: e.message });
    throw e;
  }
};

// Link de conferência do condômino (somente leitura da própria unidade)
api.criarLinkConferencia = async (req, res, user, condo, aptId) => {
  try {
    const { link, criado_agora } = db.getOrCreateVerLink(condo.id, Number(aptId), user);
    db.save();
    sendJSON(res, criado_agora ? 201 : 200, { link, criado_agora });
  } catch (e) {
    if (e.code === 'NOT_FOUND') return sendJSON(res, 404, { error: e.message });
    throw e;
  }
};
api.conferenciaUnidade = (req, res, userVer) => {
  const dados = db.conferenciaUnidade(userVer.condo_id, userVer.ver.apartment_id);
  if (!dados) return sendJSON(res, 404, { error: 'Unidade não encontrada.' });
  sendJSON(res, 200, dados);
};

// registra o envio do alerta de consumo acima da média ao condômino
api.registrarAlertaConsumo = async (req, res, user, condo, aptId) => {
  const body = await readBody(req);
  try {
    db.registrarAlertaConsumo(condo.id, Number(aptId), user, {
      ref_month: body.ref_month || null,
      consumo: body.consumo != null ? Number(body.consumo) : null,
      media: body.media != null ? Number(body.media) : null,
      canal: body.canal === 'whatsapp' ? 'whatsapp' : 'copia',
    });
    db.save();
    sendJSON(res, 200, { ok: true });
  } catch (e) {
    if (e.code === 'NOT_FOUND') return sendJSON(res, 404, { error: e.message });
    throw e;
  }
};

// ---- conta do próprio usuário ----
api.trocarSenha = async (req, res, user) => {
  const body = await readBody(req);
  try {
    db.changeOwnPassword(user, body.senha_atual, body.nova_senha);
  } catch (e) {
    if (e.code === 'BADCURRENT') return sendJSON(res, 400, { error: e.message });
    if (e.code === 'BADPASSWORD') return sendJSON(res, 400, { error: e.message });
    throw e;
  }
  db.logAction(user, 'trocar_senha', { msg: 'Senha alterada pelo próprio usuário.' });
  sendJSON(res, 200, { ok: true });
};
api.meuPerfil = async (req, res, user) => {
  const body = await readBody(req);
  const atualizado = db.updateOwnProfile(user, body.nome);
  sendJSON(res, 200, { user: atualizado });
};
api.adminRedefinirSenha = async (req, res, user, id) => {
  const body = await readBody(req);
  try {
    db.adminResetPassword(user.id, id, body.nova_senha);
  } catch (e) {
    if (e.code === 'NOT_FOUND') return sendJSON(res, 404, { error: e.message });
    if (e.code === 'BADPASSWORD') return sendJSON(res, 400, { error: e.message });
    throw e;
  }
  const alvo = db.findUserById(id);
  db.logAction(user, 'redefinir_senha_usuario', { username: alvo ? alvo.username : id });
  sendJSON(res, 200, { ok: true });
};

// ---- edição do condomínio (admin global ou gestor do próprio condomínio) ----
function podeEditarCondo(user, condo) {
  if (isAdmin(user)) return true;
  return user.role === 'gestor' && user.condo_id && condo && user.condo_id === condo.id;
}
api.editarCondo = async (req, res, user, condo) => {
  if (!podeEditarCondo(user, condo)) return sendJSON(res, 403, { error: 'Sem permissão para editar este condomínio.' });
  const body = await readBody(req);
  try {
    db.updateCondoInfo(condo.id, { nome: body.nome, medicoes: body.medicoes }, user);
  } catch (e) { if (e.code === 'BADNAME' || e.code === 'NOMED') return sendJSON(res, 400, { error: e.message }); throw e; }
  db.save();
  sendJSON(res, 200, { condominio: db.getCondo(condo.id) });
};
api.editarHidrometroUnidade = async (req, res, user, condo, aptId) => {
  if (!podeEditarCondo(user, condo)) return sendJSON(res, 403, { error: 'Sem permissão.' });
  const body = await readBody(req);
  const apt = db.updateApartmentMeter(condo.id, Number(aptId), body.hidrometro);
  if (!apt) return sendJSON(res, 404, { error: 'Unidade não encontrada.' });
  db.logAction(user, 'editar_hidrometro', { apartamento: apt.etiqueta, hidrometro: apt.hidrometro, condoNome: condo.nome });
  sendJSON(res, 200, { apartamento: apt });
};

// ---- hidrômetros de área comum ----
api.listaHidrometrosComuns = (req, res, user, condo, ref) => {
  sendJSON(res, 200, { medidores: db.listCommonMeters(condo.id), leituras: db.listCommonReadings(condo.id, ref || null) });
};
api.criarHidrometroComum = async (req, res, user, condo) => {
  if (!podeEditarCondo(user, condo)) return sendJSON(res, 403, { error: 'Sem permissão.' });
  const body = await readBody(req);
  try {
    const meter = db.createCommonMeter(condo.id, body.nome, body.numero);
    db.logAction(user, 'criar_hidrometro_comum', { nome: meter.nome, numero: meter.numero, condoNome: condo.nome });
    sendJSON(res, 201, { medidor: meter });
  } catch (e) {
    if (e.code === 'BADNAME') return sendJSON(res, 400, { error: e.message });
    throw e;
  }
};
api.editarHidrometroComum = async (req, res, user, condo, id) => {
  if (!podeEditarCondo(user, condo)) return sendJSON(res, 403, { error: 'Sem permissão.' });
  const body = await readBody(req);
  const m = db.updateCommonMeter(condo.id, id, body.nome, body.numero);
  if (!m) return sendJSON(res, 404, { error: 'Hidrômetro não encontrado.' });
  db.logAction(user, 'editar_hidrometro_comum', { nome: m.nome, condoNome: condo.nome });
  sendJSON(res, 200, { medidor: m });
};
api.excluirHidrometroComum = (req, res, user, condo, id) => {
  if (!podeEditarCondo(user, condo)) return sendJSON(res, 403, { error: 'Sem permissão.' });
  const ok = db.deleteCommonMeter(condo.id, id);
  if (!ok) return sendJSON(res, 404, { error: 'Hidrômetro não encontrado.' });
  db.logAction(user, 'excluir_hidrometro_comum', { id, condoNome: condo.nome });
  sendJSON(res, 200, { ok: true });
};
api.salvarLeituraComum = async (req, res, user, condo, ref) => {
  if (!podeEditarCondo(user, condo)) return sendJSON(res, 403, { error: 'Sem permissão.' });
  const month = db.getMonth(condo.id, ref);
  if (!month) return sendJSON(res, 404, { error: 'Mês não encontrado. Crie o lançamento do mês antes de lançar a leitura da área comum.' });
  const body = await readBody(req);
  const item = body.leitura || body;
  try {
    db.upsertCommonReading(condo.id, String(item.meter_id), ref, item.leitura,
      item.data_leitura || new Date().toISOString().slice(0, 10));
  } catch (e) {
    if (e.code === 'NOT_FOUND') return sendJSON(res, 404, { error: e.message });
    if (e.code === 'BADREAD') return sendJSON(res, 400, { error: e.message });
    throw e;
  }
  db.save();
  sendJSON(res, 200, { ok: true });
};

async function handleApi(req, res, user) {
  const { pathname } = new URL(req.url, 'http://localhost');
  const m = req.method;

  // ---- condômino conferindo: somente leitura da própria unidade ----
  if (user && user.role === 'conferidor') {
    if (m === 'GET' && pathname === '/api/me') return api.me(req, res);
    if (m === 'GET' && pathname === '/api/conferencia') return api.conferenciaUnidade(req, res, user);
    let mt = pathname.match(/^\/api\/uploads\/([^/]+)$/);
    if (m === 'GET' && mt) return servirFoto(req, res, mt[1]);
    return sendJSON(res, 403, { error: 'Este link só permite conferir a sua unidade.' });
  }

  // ---- medidor delegado: acesso somente à tela de medição do seu mês ----
  if (user && user.role === 'medidor') {
    const ref = user.med.ref_month;
    const condo = db.getCondo(user.condo_id);
    const link = db.findMedLink(extractToken(req));
    let mt = pathname.match(/^\/api\/meses\/(\d{4}-\d{2})\/unidades\/(\d+)\/foto$/);
    if ((m === 'POST' || m === 'DELETE') && mt && mt[1] === ref) {
      const apt = db.getApartment(Number(mt[2]));
      if (link && !db.medLinkPermite(link, apt)) return sendJSON(res, 403, { error: 'Esta unidade não está liberada para o seu link.' });
      if (m === 'POST') return api.uploadFoto(req, res, user, condo, mt[1], mt[2]);
      return api.excluirFoto(req, res, user, condo, mt[1], mt[2]);
    }
    mt = pathname.match(/^\/api\/meses\/(\d{4}-\d{2})$/);
    if (mt && mt[1] === ref) {
      if (m === 'GET') {
        // filtra as linhas conforme o escopo (torres/unidades) do link
        const detail = db.getMonthDetail(condo.id, mt[1]);
        if (!detail) return sendJSON(res, 404, { error: 'Mês não encontrado.' });
        if (link) {
          const permitidas = detail.linhas.filter((l) => {
            const apt = db.getApartment(l.apartment_id);
            return db.medLinkPermite(link, apt);
          });
          detail.linhas = permitidas;
          detail.lidos = permitidas.filter((l) => l.status === 'lido' || l.status === 'atencao').length;
          detail.total = permitidas.length;
        }
        return sendJSON(res, 200, { ...detail, condo: { id: condo.id, nome: condo.nome, logo: condo.logo },
          escopo: link ? link.escopo : null });
      }
      if (m === 'PUT') {
        // garante que só salva unidades do escopo
        const body = await readBody(req);
        if (link && Array.isArray(body.leituras)) {
          for (const it of body.leituras) {
            const apt = db.getApartment(Number(it.apartment_id));
            if (!db.medLinkPermite(link, apt)) {
              return sendJSON(res, 403, { error: 'Uma das unidades não está liberada para o seu link.' });
            }
          }
        }
        return api.salvarMes(req, res, user, condo, mt[1]);
      }
    }
    mt = pathname.match(/^\/api\/uploads\/([^/]+)$/);
    if (m === 'GET' && mt) return servirFoto(req, res, mt[1]);
    if (m === 'GET' && pathname === '/api/me') return api.me(req, res);
    return sendJSON(res, 403, { error: 'Este link só permite a medição.' });
  }

  if (m === 'POST' && pathname === '/api/login') return api.login(req, res);
  if (m === 'POST' && pathname === '/api/logout') return api.logout(req, res, user);
  if (m === 'GET' && pathname === '/api/me') return api.me(req, res);
  if (m === 'GET' && pathname === '/api/config') return api.config(req, res);
  if (m === 'POST' && pathname === '/api/me/senha') return api.trocarSenha(req, res, user);
  if (m === 'POST' && pathname === '/api/me/perfil') return api.meuPerfil(req, res, user);
  if (m === 'GET' && pathname === '/api/condominios') return api.condominios(req, res, user);
  if (m === 'POST' && pathname === '/api/condominios') {
    if (!isAdmin(user)) return sendJSON(res, 403, { error: 'Somente o administrador pode cadastrar condomínios.' });
    return api.criarCondominio(req, res, user);
  }

  let mt;
  // fotos/logo (auth via token na URL)
  mt = pathname.match(/^\/api\/uploads\/([^/]+)$/);
  if (m === 'GET' && mt) return servirFoto(req, res, mt[1]);

  // impacto + exclusão de condomínio: somente admin global, com confirmação na UI
  mt = pathname.match(/^\/api\/condominios\/([^/]+)\/impacto$/);
  if (m === 'GET' && mt) {
    if (!isAdmin(user)) return sendJSON(res, 403, { error: 'Acesso restrito ao administrador.' });
    return api.condominioImpacto(req, res, mt[1]);
  }
  mt = pathname.match(/^\/api\/condominios\/([^/]+)$/);
  if (m === 'DELETE' && mt) {
    if (!isAdmin(user)) return sendJSON(res, 403, { error: 'Acesso restrito ao administrador.' });
    return api.excluirCondominio(req, res, user, mt[1]);
  }

  // administração de usuários: somente admin global
  if (m === 'GET' && pathname === '/api/usuarios') {
    if (!isAdmin(user)) return sendJSON(res, 403, { error: 'Acesso restrito ao administrador.' });
    return api.usuarios(req, res);
  }
  if (m === 'POST' && pathname === '/api/usuarios') {
    if (!isAdmin(user)) return sendJSON(res, 403, { error: 'Acesso restrito ao administrador.' });
    return api.criarUsuario(req, res, user);
  }
  mt = pathname.match(/^\/api\/usuarios\/([^/]+)\/ativo$/);
  if (m === 'POST' && mt) {
    if (!isAdmin(user)) return sendJSON(res, 403, { error: 'Acesso restrito ao administrador.' });
    return api.ativarUsuario(req, res, user, mt[1]);
  }
  mt = pathname.match(/^\/api\/usuarios\/([^/]+)\/senha$/);
  if (m === 'POST' && mt) {
    if (!isAdmin(user)) return sendJSON(res, 403, { error: 'Acesso restrito ao administrador.' });
    return api.adminRedefinirSenha(req, res, user, mt[1]);
  }

  // daqui para baixo tudo é escopado por condomínio
  const condo = currentCondo(req, user);
  if (!condo) return sendJSON(res, 400, { error: 'Nenhum condomínio disponível para este usuário.' });

  // relatório para impressão/PDF (HTML, com logo e fotos)
  mt = pathname.match(/^\/api\/meses\/(\d{4}-\d{2})\/relatorio$/);
  if (m === 'GET' && mt) {
    const alvo = condoAlvoQuery(req, res, user, condo);
    if (!alvo) return;
    return relatorioHTML(req, res, alvo, mt[1]);
  }

  if (m === 'GET' && pathname === '/api/resumo') return api.resumo(req, res, user, condo);
  if (m === 'GET' && pathname === '/api/auditoria') return api.auditoria(req, res, user);
  if (m === 'GET' && pathname === '/api/apartamentos') return api.apartamentos(req, res, user, condo);

  mt = pathname.match(/^\/api\/apartamentos\/(\d+)\/historico$/);
  if (m === 'GET' && mt) return api.historico(req, res, user, condo, mt[1]);

  if (m === 'GET' && pathname === '/api/meses') return api.listaMeses(req, res, user, condo);
  if (m === 'POST' && pathname === '/api/meses') return api.criarMes(req, res, user, condo);

  mt = pathname.match(/^\/api\/meses\/(\d{4}-\d{2})\/csv$/);
  if (m === 'GET' && mt) {
    const alvo = condoAlvoQuery(req, res, user, condo);
    if (!alvo) return;
    return csvMes(req, res, alvo, mt[1]);
  }
  mt = pathname.match(/^\/api\/meses\/(\d{4}-\d{2})\/unidades\/(\d+)\/foto$/);
  if (m === 'POST' && mt) return api.uploadFoto(req, res, user, condo, mt[1], mt[2]);
  if (m === 'DELETE' && mt) return api.excluirFoto(req, res, user, condo, mt[1], mt[2]);
  mt = pathname.match(/^\/api\/meses\/(\d{4}-\d{2})\/finalizar$/);
  if (m === 'POST' && mt) return api.finalizarMes(req, res, user, condo, mt[1]);
  mt = pathname.match(/^\/api\/meses\/(\d{4}-\d{2})\/reabrir$/);
  if (m === 'POST' && mt) return api.reabrirMes(req, res, user, condo, mt[1]);
  // exclusão de lançamento: somente admin
  mt = pathname.match(/^\/api\/meses\/(\d{4}-\d{2})$/);
  if (m === 'DELETE' && mt) return api.excluirMes(req, res, user, condo, mt[1]);
  // link de conferência do condômino (gera para uma unidade)
  mt = pathname.match(/^\/api\/apartamentos\/(\d+)\/link-conferencia$/);
  if (m === 'POST' && mt) return api.criarLinkConferencia(req, res, user, condo, mt[1]);
  // alerta de consumo acima da média enviado ao condômino (registra na auditoria)
  mt = pathname.match(/^\/api\/apartamentos\/(\d+)\/alerta-consumo$/);
  if (m === 'POST' && mt) return api.registrarAlertaConsumo(req, res, user, condo, mt[1]);

  // links de medição delegada
  if (m === 'POST' && pathname === '/api/med-links') return api.criarLinkMedicao(req, res, user, condo);
  mt = pathname.match(/^\/api\/med-links\/(\d{4}-\d{2})$/);
  if (m === 'GET' && mt) return api.listaLinksMedicao(req, res, user, condo, mt[1]);
  mt = pathname.match(/^\/api\/med-links\/id\/([^/]+)\/revogar$/);
  if (m === 'POST' && mt) return api.revogarLinkMedicao(req, res, user, condo, mt[1]);


  // troca de logo: admin global ou gestor do próprio condomínio
  mt = pathname.match(/^\/api\/condominios\/([^/]+)\/logo$/);
  if (m === 'POST' && mt) {
    const condoLogo = db.getCondo(mt[1]);
    if (!condoLogo) return sendJSON(res, 404, { error: 'Condomínio não encontrado.' });
    const proprio = user.role === 'gestor' && user.condo_id === condoLogo.id;
    if (!isAdmin(user) && !proprio) return sendJSON(res, 403, { error: 'Sem permissão para alterar esta logo.' });
    return api.trocarLogoCondominio(req, res, user, mt[1]);
  }
  // edição dos dados do condomínio (nome, modo de medição) — admin edita qualquer um
  mt = pathname.match(/^\/api\/condominios\/([^/]+)$/);
  if (m === 'PUT' && mt) {
    const alvo = db.getCondo(mt[1]) || (mt[1] === condo.id ? condo : null);
    if (!alvo) return sendJSON(res, 404, { error: 'Condomínio não encontrado.' });
    return api.editarCondo(req, res, user, alvo);
  }
  // edição do número do hidrômetro de uma unidade
  mt = pathname.match(/^\/api\/apartamentos\/(\d+)\/hidrometro$/);
  if (m === 'PUT' && mt) return api.editarHidrometroUnidade(req, res, user, condo, mt[1]);

  // hidrômetros de área comum
  mt = pathname.match(/^\/api\/hidrometros-comuns\/(\d{4}-\d{2})$/);
  if (m === 'GET' && mt) return api.listaHidrometrosComuns(req, res, user, condo, mt[1]);
  if (m === 'POST' && pathname === '/api/hidrometros-comuns') return api.criarHidrometroComum(req, res, user, condo);
  mt = pathname.match(/^\/api\/hidrometros-comuns\/id\/([^/]+)$/);
  if (m === 'PUT' && mt) return api.editarHidrometroComum(req, res, user, condo, mt[1]);

  // medição diária de acompanhamento (medidor macro)
  if (pathname === '/api/diaria' || pathname.startsWith('/api/diaria/')) {
    if (condo.medicoes && condo.medicoes.diaria_macro === false) {
      return sendJSON(res, 409, { error: 'Este condomínio não usa medição diária — ative em Condomínios → Editar.' });
    }
  }
  if (m === 'GET' && pathname === '/api/diaria') return api.diariaPainel(req, res, user, condo);
  if (m === 'GET' && pathname === '/api/diaria/relatorio') {
    const alvo = condoAlvoQuery(req, res, user, condo);
    if (!alvo) return;
    return api.diariaRelatorio(req, res, user, alvo);
  }
  if (m === 'POST' && pathname === '/api/diaria/medidor') return api.diariaMedidorCriar(req, res, user, condo);
  mt = pathname.match(/^\/api\/diaria\/medidor\/([^/]+)$/);
  if (m === 'PUT' && mt) return api.diariaMedidorAtualizar(req, res, user, condo, mt[1]);
  if (m === 'DELETE' && mt) return api.diariaMedidorExcluir(req, res, user, condo, mt[1]);
  if (m === 'POST' && pathname === '/api/diaria/leitura') return api.diariaLeitura(req, res, user, condo);
  if (m === 'POST' && pathname === '/api/diaria/lancamentos') return api.diariaLancamentos(req, res, user, condo);
  if (m === 'POST' && pathname === '/api/diaria/foto') return api.diariaFoto(req, res, user, condo);
  if (m === 'POST' && pathname === '/api/diaria/foto-excluir') return api.diariaFotoExcluir(req, res, user, condo);
  if (m === 'DELETE' && mt) return api.excluirHidrometroComum(req, res, user, condo, mt[1]);
  mt = pathname.match(/^\/api\/hidrometros-comuns\/leitura\/(\d{4}-\d{2})$/);
  if (m === 'POST' && mt) return api.salvarLeituraComum(req, res, user, condo, mt[1]);

  mt = pathname.match(/^\/api\/meses\/(\d{4}-\d{2})$/);
  if (m === 'GET' && mt) return api.detalheMes(req, res, user, condo, mt[1]);
  if (m === 'PUT' && mt) return api.salvarMes(req, res, user, condo, mt[1]);

  if (m === 'GET' && pathname === '/api/medicao-inicial') return api.getIniciais(req, res, user, condo);
  if (m === 'PUT' && pathname === '/api/medicao-inicial') return api.setIniciais(req, res, user, condo);
  if (m === 'GET' && pathname === '/api/medicao-inicial/links') return api.gerarLinksIniciais(req, res, user, condo);
  mt = pathname.match(/^\/api\/apartamentos\/(\d+)\/link-inicial$/);
  if (m === 'POST' && mt) return api.criarLinkInicial(req, res, user, condo, mt[1]);

  sendJSON(res, 404, { error: 'Rota não encontrada.' });
}

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (urlPath === '/') urlPath = '/index.html';
  if (urlPath === '/c' || urlPath === '/conferencia') urlPath = '/conferencia.html';
  if (urlPath === '/i' || urlPath === '/inicial') urlPath = '/inicial.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Acesso negado'); }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Página não encontrada'); }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob:");

  const { pathname } = new URL(req.url, 'http://localhost');
  try {
    if (pathname.startsWith('/api/')) {
      const user = authUser(req);
      const publico = pathname === '/api/login' || pathname === '/api/inicial-info' || pathname === '/api/inicial-envio';
      if (!user && !publico) return sendJSON(res, 401, { error: 'Não autenticado.' });
      if (pathname === '/api/inicial-info') return api.inicialInfo(req, res);
      if (pathname === '/api/inicial-envio') return api.inicialEnvio(req, res);
      return await handleApi(req, res, user);
    }
    return serveStatic(req, res);
  } catch (e) {
    if (e.code === 'PAYLOAD') return sendJSON(res, 413, { error: e.message });
    if (e.code === 'BADJSON') return sendJSON(res, 400, { error: 'JSON inválido.' });
    console.error('Erro:', e);
    sendJSON(res, 500, { error: 'Erro interno do servidor.' });
  }
});

(async () => {
  try {
    await db.init();
  } catch (e) {
    console.error('✗ Falha ao iniciar o banco:', e && e.message);
    process.exit(1);
  }
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`✓ Servidor de faturamento de água rodando em http://0.0.0.0:${PORT}`);
    console.log(process.env.ADMIN_PASSWORD
      ? '  Login admin: usuário "admin" com a senha definida em ADMIN_PASSWORD'
      : '  Login: admin / admin123 (defina ADMIN_PASSWORD em produção)');
  });
})();
