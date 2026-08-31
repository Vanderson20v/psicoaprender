/**
 * Autenticação, sessões e controle de acesso (LGPD / perfis).
 */
const crypto = require('crypto');
const db = require('./db');

const SESSION_HOURS = 12;

function hashSenha(senha, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(senha, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function conferirSenha(senha, armazenado) {
  if (!armazenado || !armazenado.includes(':')) return false;
  const [salt, hash] = armazenado.split(':');
  const calc = crypto.scryptSync(senha, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(calc, 'hex'));
}

function criarSessao(usuario, req) {
  const token = crypto.randomBytes(32).toString('hex');
  const expira = new Date(Date.now() + SESSION_HOURS * 3600e3).toISOString();
  db.sessoes.insert({
    token, usuario_id: usuario.id, expira,
    ip: req.ip, agente: (req.headers['user-agent'] || '').slice(0, 160)
  });
  // limpeza de sessões vencidas
  const agora = new Date().toISOString();
  db.sessoes.removeWhere({ expira: v => v < agora });
  return { token, expira };
}

function usuarioDaRequisicao(req) {
  const token = req.cookies?.pa_sessao
    || (req.headers.authorization || '').replace('Bearer ', '')
    || req.query?.token;   // usado em downloads diretos (<a href>), que não enviam cabeçalhos
  if (!token) return null;
  const sessao = db.sessoes.findOne({ token });
  if (!sessao || sessao.expira < new Date().toISOString()) return null;
  const usuario = db.usuarios.byId(sessao.usuario_id);
  if (!usuario || !usuario.ativo) return null;
  return { ...usuario, _token: token };
}

function registrarLog(req, acao, entidade, entidade_id, detalhe = '') {
  db.logs.insert({
    usuario_id: req.usuario?.id || null,
    usuario_nome: req.usuario?.nome || 'sistema',
    acao, entidade, entidade_id: entidade_id ?? null, detalhe,
    ip: req.ip
  });
}

/** Perfis: admin (total) · profissional (próprios pacientes) · administrativo (agenda/financeiro) */
const PERMISSOES = {
  admin: {
    clinico: true, financeiro: true, agenda: true, pacientes: true,
    documentos: true, profissionais: true, configuracoes: true, todos_pacientes: true
  },
  profissional: {
    clinico: true, financeiro: true, agenda: true, pacientes: true,
    documentos: true, profissionais: false, configuracoes: false, todos_pacientes: false
  },
  administrativo: {
    clinico: false, financeiro: true, agenda: true, pacientes: true,
    documentos: true, profissionais: false, configuracoes: false, todos_pacientes: true
  }
};

const permissoesDe = (u) => PERMISSOES[u?.papel] || PERMISSOES.administrativo;

function exigirLogin(req, res, next) {
  const u = usuarioDaRequisicao(req);
  if (!u) return res.status(401).json({ erro: 'Sessão expirada. Faça login novamente.' });
  req.usuario = u;
  req.perm = permissoesDe(u);
  next();
}

const exigir = (chave) => (req, res, next) =>
  req.perm?.[chave] ? next() : res.status(403).json({ erro: 'Seu perfil não tem acesso a esta área.' });

/** Um paciente é visível se o perfil vê todos ou se o profissional é responsável/atende. */
function podeVerPaciente(usuario, paciente) {
  if (!paciente) return false;
  const perm = permissoesDe(usuario);
  if (perm.todos_pacientes) return true;
  if (paciente.profissional_id === usuario.profissional_id) return true;
  return db.atendimentos.find({ paciente_id: paciente.id, profissional_id: usuario.profissional_id }).length > 0;
}

function pacientesVisiveis(usuario) {
  return db.pacientes.all().filter(p => podeVerPaciente(usuario, p));
}

module.exports = {
  hashSenha, conferirSenha, criarSessao, usuarioDaRequisicao, registrarLog,
  exigirLogin, exigir, permissoesDe, podeVerPaciente, pacientesVisiveis, PERMISSOES
};
