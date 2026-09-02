/* =======================================================================
   PsicoAprender Gestão — núcleo do cliente
   API, sessão, utilitários, layout, navegação e busca global
   ======================================================================= */

const App = {
  sessao: null, permissoes: {}, config: {}, alertas: [], cache: {}, paginas: {}, rota: null
};

/* ------------------------------ API ------------------------------ */
/* O token vive PRIMEIRO em memória: dentro de iframes com origem opaca o
   navegador bloqueia cookies e localStorage. O armazenamento é só um bônus
   para manter a sessão ao recarregar a página quando ele estiver disponível. */
const Token = {
  memoria: '',
  get() {
    if (this.memoria) return this.memoria;
    try { this.memoria = localStorage.getItem('pa_token') || ''; } catch (_) { }
    return this.memoria;
  },
  set(t) { this.memoria = t || ''; try { localStorage.setItem('pa_token', t); } catch (_) { } },
  limpar() { this.memoria = ''; try { localStorage.removeItem('pa_token'); } catch (_) { } }
};
/** Acrescenta o token a URLs abertas diretamente pelo navegador (downloads). */
const comToken = (url) => url + (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(Token.get());

/** fetch com limite de tempo: evita a tela travada em "Entrando…" se a rede não responder. */
async function buscar(url, opcoes = {}, segundos = 20) {
  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), segundos * 1000);
  try {
    return await fetch(url, { ...opcoes, signal: controle.signal });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('O servidor não respondeu a tempo. Verifique a conexão e tente novamente.');
    throw new Error('Falha de conexão com o servidor.');
  } finally { clearTimeout(relogio); }
}

async function req(metodo, url, corpo) {
  const cabecalhos = {};
  if (corpo) cabecalhos['Content-Type'] = 'application/json';
  const t = Token.get();
  if (t) cabecalhos.Authorization = 'Bearer ' + t;
  // O token vai TAMBÉM na URL: alguns proxies removem cabeçalhos personalizados
  // e cookies de terceiros, e nesses casos o cabeçalho Authorization não chega.
  const alvo = t ? comToken(url) : url;
  const r = await buscar(alvo, {
    method: metodo,
    headers: cabecalhos,
    body: corpo ? JSON.stringify(corpo) : undefined,
    credentials: 'same-origin'
  });
  if (r.status === 401 && !url.includes('/login')) { encerrarSessao(); throw new Error('Sessão encerrada.'); }
  const dados = r.headers.get('content-type')?.includes('json') ? await r.json() : null;
  if (!r.ok) {
    const erro = new Error(dados?.erro || 'Não foi possível concluir a operação.');
    erro.status = r.status; Object.assign(erro, dados || {});
    throw erro;
  }
  return dados;
}
const api = {
  get: (u, p) => req('GET', u + (p ? '?' + new URLSearchParams(Object.entries(p).filter(([, v]) => v !== undefined && v !== '' && v !== null)) : '')),
  post: (u, c) => req('POST', u, c),
  put: (u, c) => req('PUT', u, c),
  del: (u) => req('DELETE', u)
};

/* --------------------------- Utilitários --------------------------- */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hojeISO = () => new Date().toLocaleDateString('en-CA');
const dataBR = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');
const dataCurta = (iso) => (iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) : '—');
const moeda = (v) => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const somaDias = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toLocaleDateString('en-CA'); };
const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const DIAS_CURTO = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const diaSemana = (iso) => new Date(iso + 'T12:00:00').getDay();
const porExtenso = (iso) => { const d = new Date(iso + 'T12:00:00'); return `${DIAS[d.getDay()]}, ${d.getDate()} de ${MESES[d.getMonth()]}`; };
const iniciais = (nome) => (nome || '').trim().split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase();
const primeiroNome = (n) => (n || '').split(' ')[0];
const ROTULO_STATUS = { agendado: 'Agendado', confirmado: 'Confirmado', realizado: 'Realizado', cancelado: 'Cancelado', falta: 'Falta' };
const ROTULO_PAGTO = { pago: 'Pago', pendente: 'Pendente', em_atraso: 'Em atraso', cancelado: 'Cancelado' };
const AREAS = [
  ['atencao', 'Atenção'], ['concentracao', 'Concentração'], ['memoria', 'Memória'], ['linguagem', 'Linguagem'],
  ['leitura', 'Leitura'], ['escrita', 'Escrita'], ['raciocinio_logico', 'Raciocínio lógico'],
  ['coordenacao_motora', 'Coordenação motora'], ['organizacao', 'Organização'],
  ['interacao_social', 'Interação social'], ['autonomia', 'Autonomia']
];
const SALAS_PADRAO = ['Sala de atendimento 1', 'Sala de atendimento 2'];
/** Salas configuradas na clínica (lidas da configuração do servidor). */
Object.defineProperty(window, 'SALAS', { get: () => App.config?.salas || SALAS_PADRAO });
const salaClasse = (sala) => 'sala-' + ((SALAS.indexOf(sala) + 1) || 1);
const salaTag = (sala) => (sala ? `<span class="sala-tag ${salaClasse(sala)}">${esc(sala.replace('Sala de atendimento ', 'Sala '))}</span>` : '');
const NIVEIS = [['nao_trabalhado', 'Não trabalhado'], ['em_desenvolvimento', 'Em desenvolvimento'], ['evoluindo', 'Evoluindo'], ['consolidado', 'Consolidado']];
const nivelRotulo = (v) => (NIVEIS.find(n => n[0] === v) || [, '—'])[1];
const tag = (status, mapa = ROTULO_STATUS) => `<span class="tag t-${status}">${mapa[status] || status}</span>`;
const idadeTexto = (i) => (i === '' || i === null || i === undefined ? '—' : `${i} anos`);

/* ------------------------------ Ícones ------------------------------ */
const ico = (nome, cls = '') => {
  const p = {
    painel: '<path d="M3 3h7v8H3zM14 3h7v5h-7zM14 11h7v10h-7zM3 14h7v7H3z"/>',
    agenda: '<rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
    pacientes: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 20c.6-3.4 3-5.2 5.5-5.2s4.9 1.8 5.5 5.2"/><path d="M17 11.5a2.6 2.6 0 100-5.2 2.6 2.6 0 000 5.2M17 14.2c2 0 3.6 1.4 4 4"/>',
    responsaveis: '<path d="M12 21s-7-4.4-7-9.4A4 4 0 0112 9a4 4 0 017 2.6c0 5-7 9.4-7 9.4z"/>',
    diario: '<path d="M5 3.5h11l4 4v13H5z"/><path d="M15 3.5v5h5M8.5 12.5h7M8.5 16h5"/>',
    evolucao: '<path d="M3.5 17.5l5.5-6 4 3.6 7-8.6"/><path d="M15.5 6.5h5v5"/>',
    relatorios: '<path d="M6 3.5h8l4 4v13H6z"/><path d="M13 3.5v5h5M9.5 13h5M9.5 16.5h3"/>',
    financeiro: '<rect x="3" y="6" width="18" height="12.5" rx="2"/><circle cx="12" cy="12.2" r="2.6"/><path d="M6.5 12.2h.01M17.5 12.2h.01"/>',
    documentos: '<path d="M4 5.5A1.5 1.5 0 015.5 4h4l2 2.5h7A1.5 1.5 0 0120 8v10.5a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 18.5z"/>',
    profissionais: '<circle cx="12" cy="7.5" r="3.4"/><path d="M5 20c.8-4 3.6-6 7-6s6.2 2 7 6"/>',
    config: '<circle cx="12" cy="12" r="3"/><path d="M19.4 14.5a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-2.7 1.1V21a2 2 0 11-4 0v-.1a1.6 1.6 0 00-2.7-1.1l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00-1.1-2.7H3a2 2 0 110-4h.1a1.6 1.6 0 001.1-2.7l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 002.7-1.1V3a2 2 0 114 0v.1a1.6 1.6 0 002.7 1.1l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 001.1 2.7H21a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1z"/>',
    lupa: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-3.6-3.6"/>',
    sino: '<path d="M18 8.5a6 6 0 10-12 0c0 6-2 7.5-2 7.5h16s-2-1.5-2-7.5"/><path d="M13.7 20a2 2 0 01-3.4 0"/>',
    mais: '<path d="M12 5v14M5 12h14"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    fechar: '<path d="M6 6l12 12M18 6L6 18"/>',
    voltar: '<path d="M15 5l-7 7 7 7"/>',
    checar: '<path d="M4 12.5l5 5L20 6.5"/>',
    whatsapp: '<path d="M3.5 20.5l1.3-4.6A8.2 8.2 0 1112 20.2a8.4 8.4 0 01-4-1z"/><path d="M9 9.5c0 3 2.5 5.5 5.4 5.5.6-.6.9-1.2.6-1.7l-1.5-.7-.9.9c-1-.4-1.9-1.3-2.3-2.3l.9-.9-.7-1.5c-.5-.3-1.1 0-1.5.7z"/>',
    imprimir: '<path d="M7 9V3.5h10V9M7 18H5a1.5 1.5 0 01-1.5-1.5v-5A1.5 1.5 0 015 10h14a1.5 1.5 0 011.5 1.5v5A1.5 1.5 0 0119 18h-2"/><path d="M7 14.5h10v6H7z"/>',
    lixeira: '<path d="M4.5 6.5h15M9.5 6.5V4h5v2.5M6.5 6.5l1 13.5h9l1-13.5"/>',
    editar: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
    relogio: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5.3l3.3 2"/>',
    alerta: '<path d="M12 3.5L21 19.5H3z"/><path d="M12 9.5v4M12 16.5h.01"/>',
    saida: '<path d="M9 4.5H5.5A1.5 1.5 0 004 6v12a1.5 1.5 0 001.5 1.5H9"/><path d="M15 8l4 4-4 4M19 12H9"/>',
    upload: '<path d="M12 16V4.5M7.5 9L12 4.5 16.5 9"/><path d="M4 16v2.5A1.5 1.5 0 005.5 20h13a1.5 1.5 0 001.5-1.5V16"/>',
    baixar: '<path d="M12 4v11.5M7.5 11L12 15.5 16.5 11"/><path d="M4 17v2.5A1.5 1.5 0 005.5 21h13a1.5 1.5 0 001.5-1.5V17"/>'
  }[nome] || '';
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
};

/* --------------------------- Feedback UI --------------------------- */
function aviso(msg, tipo = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + tipo;
  el.textContent = msg;
  let caixa = document.getElementById('toasts');
  if (!caixa) {           // telas fora do layout (login, troca de senha)
    caixa = document.createElement('div');
    caixa.id = 'toasts';
    document.body.appendChild(caixa);
  }
  caixa.appendChild(el);
  setTimeout(() => el.remove(), 3600);
}
const erroAviso = (e) => aviso(e?.message || 'Erro inesperado.', 'erro');

/* ------------------------------ Modal ------------------------------ */
let modalAtual = null;
/* Impressão em PDF: o navegador imprime a página inteira por padrão, e a lista
   que está atrás do modal saía como primeira folha. Aqui isolamos o documento:
   tudo fica invisível, menos ele. */
function imprimirDocumento(escopo) {
  const doc = (escopo || document).querySelector('.documento') || document.querySelector('.documento');
  if (!doc) return window.print();
  const limpar = () => {
    document.body.classList.remove('imprimindo');
    doc.classList.remove('folha-impressa');
  };
  doc.classList.add('folha-impressa');
  document.body.classList.add('imprimindo');
  window.addEventListener('afterprint', limpar, { once: true });
  setTimeout(() => window.print(), 40);
  setTimeout(limpar, 4000);   // rede de segurança: nem todo navegador dispara afterprint
}

function abrirModal({ titulo, corpo, rodape = '', largo = false, aoAbrir, aoFechar }) {
  fecharModal(true);
  const fundo = document.createElement('div');
  fundo.className = 'modal-fundo';
  fundo.innerHTML = `
    <div class="modal ${largo ? 'largo' : ''}" role="dialog" aria-modal="true">
      <div class="modal-topo">
        <h2>${esc(titulo)}</h2>
        <button class="btn btn-sutil btn-icone" style="margin-left:auto" data-fechar>${ico('fechar')}</button>
      </div>
      <div class="modal-corpo">${corpo}</div>
      ${rodape ? `<div class="modal-rodape">${rodape}</div>` : ''}
    </div>`;
  document.body.appendChild(fundo);
  document.body.style.overflow = 'hidden';
  fundo.addEventListener('mousedown', (e) => { if (e.target === fundo) confirmarSaida(); });
  fundo.querySelectorAll('[data-fechar]').forEach(b => b.addEventListener('click', () => confirmarSaida()));
  modalAtual = { fundo, aoFechar, sujo: false };
  fundo.addEventListener('input', () => { modalAtual.sujo = true; });
  aoAbrir?.(fundo);
  return fundo;
}
function confirmarSaida() {
  if (modalAtual?.sujo && !confirm('Há alterações não salvas. Deseja fechar mesmo assim?')) return;
  fecharModal();
}
function fecharModal(silencioso) {
  if (!modalAtual) return;
  const { fundo, aoFechar } = modalAtual;
  fundo.remove(); modalAtual = null;
  document.body.style.overflow = '';
  if (!silencioso) aoFechar?.();
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') confirmarSaida(); });

function confirmar(texto, aoConfirmar, textoBotao = 'Confirmar') {
  abrirModal({
    titulo: 'Confirmação',
    corpo: `<p style="margin:0">${esc(texto)}</p>`,
    rodape: `<button class="btn" data-fechar>Cancelar</button><button class="btn btn-primario" id="ok">${esc(textoBotao)}</button>`,
    aoAbrir: (f) => f.querySelector('#ok').addEventListener('click', async () => { fecharModal(true); await aoConfirmar(); })
  });
}

/* ------------------------------ WhatsApp ------------------------------ */
function montarMensagem(modelo, dados) {
  return (App.config.mensagens?.[modelo] || '')
    .replace(/{responsavel}/g, primeiroNome(dados.responsavel) || 'tudo bem')
    .replace(/{paciente}/g, primeiroNome(dados.paciente) || '')
    .replace(/{quando}/g, dados.quando || '')
    .replace(/{horario}/g, dados.horario || '')
    .replace(/{valor}/g, dados.valor || '')
    .replace(/{vencimento}/g, dados.vencimento || '');
}
function abrirWhatsapp(telefone, texto) {
  const fone = String(telefone || '').replace(/\D/g, '');
  if (!fone) return aviso('Responsável sem telefone cadastrado.', 'erro');
  window.open(`https://wa.me/55${fone}?text=${encodeURIComponent(texto)}`, '_blank');
}

function modalWhatsapp(paciente, contexto = {}) {
  const resp = paciente.responsaveis || [];
  if (!resp.length) return aviso('Nenhum responsável cadastrado.', 'erro');
  const modelos = [['confirmacao', 'Confirmação de atendimento'], ['lembrete', 'Lembrete'], ['cobranca', 'Cobrança'],
  ['reagendamento', 'Reagendamento'], ['ausencia', 'Aviso de ausência'], ['relatorio', 'Envio de relatório']];
  abrirModal({
    titulo: 'Enviar mensagem por WhatsApp',
    corpo: `
      <div class="campo"><label>Responsável</label>
        <select id="w-resp">${resp.map((r, i) => `<option value="${i}">${esc(r.nome)} — ${esc(r.parentesco || '')} (${esc(r.whatsapp || r.telefone || 'sem telefone')})</option>`).join('')}</select>
      </div>
      <div class="campo"><label>Modelo de mensagem</label>
        <div class="escolhas" id="w-modelos">${modelos.map((m, i) => `<div class="escolha ${i === 0 ? 'ativa' : ''}" data-m="${m[0]}">${m[1]}</div>`).join('')}</div>
      </div>
      <div class="campo"><label>Mensagem</label><textarea id="w-texto" rows="5"></textarea>
        <div class="ajuda">Revise o texto antes de enviar. O WhatsApp abrirá em uma nova aba com a mensagem pronta.</div></div>`,
    rodape: `<button class="btn" data-fechar>Cancelar</button>
             <button class="btn btn-primario" id="w-enviar">${ico('whatsapp')} Abrir WhatsApp</button>`,
    aoAbrir: (f) => {
      const texto = f.querySelector('#w-texto');
      const atualizar = (modelo) => {
        const r = resp[f.querySelector('#w-resp').value];
        texto.value = montarMensagem(modelo, { responsavel: r?.nome, paciente: paciente.nome, ...contexto });
      };
      atualizar('confirmacao');
      f.querySelector('#w-resp').addEventListener('change', () => atualizar(f.querySelector('#w-modelos .ativa').dataset.m));
      f.querySelectorAll('#w-modelos .escolha').forEach(el => el.addEventListener('click', () => {
        f.querySelectorAll('#w-modelos .escolha').forEach(o => o.classList.remove('ativa'));
        el.classList.add('ativa'); atualizar(el.dataset.m);
      }));
      f.querySelector('#w-enviar').addEventListener('click', () => {
        const r = resp[f.querySelector('#w-resp').value];
        abrirWhatsapp(r?.whatsapp || r?.telefone, texto.value);
        fecharModal(true);
      });
    }
  });
}

/* ------------------------------ Layout ------------------------------ */
/* O menu segue a ordem real do trabalho: o que se faz hoje, quem é atendido,
   como o caso evolui e, por último, a gestão da clínica. Os títulos existem
   para que a profissional encontre pela etapa, não pelo nome da tela. */
const VERSAO = '29';

const MENU = [
  { grupo: 'O dia' },
  { rota: 'dashboard', nome: 'Hoje', icone: 'painel' },
  { rota: 'agenda', nome: 'Agenda', icone: 'agenda' },
  { rota: 'atendimentos', nome: 'Atendimentos', icone: 'diario', perm: 'clinico' },

  { grupo: 'Quem atendemos' },
  { rota: 'pacientes', nome: 'Pacientes', icone: 'pacientes' },
  { rota: 'responsaveis', nome: 'Responsáveis', icone: 'responsaveis' },

  { grupo: 'Acompanhamento' },
  { rota: 'evolucao', nome: 'Evolução', icone: 'evolucao', perm: 'clinico' },
  { rota: 'relatorios', nome: 'Relatórios', icone: 'relatorios', perm: 'clinico' },
  { rota: 'documentos', nome: 'Documentos', icone: 'documentos', perm: 'documentos' },

  { grupo: 'Clínica' },
  { rota: 'financeiro', nome: 'Financeiro', icone: 'financeiro', perm: 'financeiro' },
  { rota: 'profissionais', nome: 'Profissionais', icone: 'profissionais' },
  { rota: 'configuracoes', nome: 'Configurações', icone: 'config' }
];
const MENU_MOVEL = ['dashboard', 'agenda', 'pacientes', 'atendimentos'];

const marcaSVG = `<img class="marca-simbolo" src="/assets/marca.png" alt="PsicoAprender">`;
/** Avatar: usa a foto da profissional quando houver, senão as iniciais. */
const avatar = (nome, foto, classe = '') =>
  foto ? `<img class="avatar avatar-foto ${classe}" src="${esc(foto)}" alt="${esc(nome)}">`
       : `<div class="avatar ${classe}">${iniciais(nome)}</div>`;

function montarLayout() {
  const u = App.sessao;
  document.getElementById('raiz').innerHTML = `
  <div class="app">
    <aside class="lateral" id="lateral">
      <div class="lateral-topo">
        <div class="marca">${marcaSVG}
          <div><div class="marca-texto">Psico<span>Aprender</span></div><div class="marca-sub">Espaço de Aprendizagem</div></div>
        </div>
      </div>
      <nav class="nav" id="menu"></nav>
      <div class="lateral-rodape">
        <button class="usuario-box" id="btn-usuario">
          ${avatar(u.nome, u.profissional?.foto)}
          <div style="min-width:0">
            <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(u.nome)}</div>
            <div style="font-size:11.5px;color:var(--tinta-3)">${({ admin: 'Administrador', profissional: 'Profissional', administrativo: 'Administrativo' })[u.papel]}</div>
          </div>
          <span style="margin-left:auto;opacity:.5">${ico('saida')}</span>
        </button>
        <div class="versao-sistema" title="Use este número para conferir se está na versão mais recente">versão ${VERSAO}</div>
      </div>
    </aside>
    <div class="conteudo">
      <header class="topo">
        <button class="btn btn-sutil btn-icone abrir-menu" id="btn-menu">${ico('menu')}</button>
        <div class="busca-global">
          ${ico('lupa', 'lupa')}
          <input type="search" id="busca" placeholder="Buscar paciente ou responsável…" autocomplete="off">
          <div id="resultados"></div>
        </div>
        <button class="btn btn-sutil btn-icone" id="btn-alertas" title="Alertas" style="margin-left:auto;position:relative">
          ${ico('sino')}<span id="ponto-alerta" style="display:none;position:absolute;top:6px;right:7px;width:7px;height:7px;background:var(--terra);border-radius:50%"></span>
        </button>
      </header>
      <main id="pagina"></main>
    </div>
  </div>`;

  /* Os títulos vêm do próprio MENU; um grupo sem nenhum item visível para o
     perfil da usuária não aparece (a recepção, por exemplo, não vê o clínico). */
  const menu = document.getElementById('menu');
  const visivel = (m) => !m.perm || App.permissoes[m.perm];
  let html = '';
  MENU.forEach((m, i) => {
    if (m.grupo) {
      const seguintes = MENU.slice(i + 1);
      const fim = seguintes.findIndex(x => x.grupo);
      const itens = (fim === -1 ? seguintes : seguintes.slice(0, fim)).filter(visivel);
      if (itens.length) html += `<div class="nav-grupo">${m.grupo}</div>`;
      return;
    }
    if (visivel(m)) html += itemMenu(m);
  });
  menu.innerHTML = html;

  document.body.insertAdjacentHTML('beforeend',
    `<nav class="nav-inferior">${MENU.filter(m => MENU_MOVEL.includes(m.rota) && (!m.perm || App.permissoes[m.perm]))
      .map(m => `<a href="#/${m.rota}" data-rota="${m.rota}">${ico(m.icone)}<span>${m.nome}</span></a>`).join('')}
      <a href="#" id="mais-movel">${ico('menu')}<span>Mais</span></a></nav>`);

  document.getElementById('btn-menu').addEventListener('click', alternarMenu);
  document.getElementById('mais-movel').addEventListener('click', (e) => { e.preventDefault(); alternarMenu(); });
  document.getElementById('btn-usuario').addEventListener('click', menuUsuario);
  document.getElementById('btn-alertas').addEventListener('click', painelAlertas);
  configurarBusca();
}
const itemMenu = (m) => `<a href="#/${m.rota}" data-rota="${m.rota}">${ico(m.icone)}<span>${m.nome}</span></a>`;

function alternarMenu() {
  const l = document.getElementById('lateral');
  l.classList.toggle('aberta');
  document.querySelector('.fundo-menu')?.remove();
  if (l.classList.contains('aberta')) {
    const f = document.createElement('div');
    f.className = 'fundo-menu';
    f.addEventListener('click', alternarMenu);
    document.body.appendChild(f);
  }
}

function modalAlterarSenha() {
  abrirModal({
    titulo: 'Alterar minha senha',
    corpo: `<form id="form-troca">
        <div class="campo"><label>Senha atual</label>
          <input type="password" name="atual" required autocomplete="current-password"></div>
        <div class="campo"><label>Nova senha</label>
          <input type="password" name="nova" required minlength="6" autocomplete="new-password"
            placeholder="Ao menos 6 caracteres"></div>
        <div class="campo"><label>Repita a nova senha</label>
          <input type="password" name="repetir" required minlength="6" autocomplete="new-password"></div>
        <div id="msg-troca"></div>
      </form>`,
    rodape: `<button class="btn" data-fechar>Cancelar</button>
      <button class="btn btn-primario" id="salvar-troca">Salvar nova senha</button>`,
    aoAbrir: (f) => {
      f.querySelector('#salvar-troca').addEventListener('click', async () => {
        const d = Object.fromEntries(new FormData(f.querySelector('#form-troca')));
        const msg = f.querySelector('#msg-troca');
        if (d.nova !== d.repetir) {
          msg.innerHTML = '<div class="aviso erro">As duas senhas novas não são iguais.</div>';
          return;
        }
        try {
          await api.post('/api/minha-senha', { atual: d.atual, nova: d.nova });
          fecharModal(true);
          aviso('Senha alterada. Use a nova senha no próximo acesso.');
        } catch (err) {
          msg.innerHTML = `<div class="aviso erro">${esc(err.message)}</div>`;
        }
      });
    }
  });
}

function menuUsuario() {
  abrirModal({
    titulo: 'Conta',
    corpo: `<div style="display:flex;gap:14px;align-items:center;margin-bottom:18px">
        ${avatar(App.sessao.nome, App.sessao.profissional?.foto, 'grande')}
        <div><div style="font-weight:600;font-size:16px">${esc(App.sessao.nome)}</div>
        <div style="color:var(--tinta-3);font-size:13px">${esc(App.sessao.email)}</div>
        <div style="color:var(--tinta-3);font-size:13px">${esc(App.sessao.profissional?.profissao || 'Equipe administrativa')}</div></div>
      </div>
      <div class="aviso info">Sessão encerra automaticamente após 12 horas. Dados de crianças e adolescentes: uso restrito conforme a LGPD.</div>`,
    rodape: `<button class="btn" data-fechar>Fechar</button>
      <button class="btn" id="trocar-senha">Alterar senha</button>
      <button class="btn btn-perigo" id="sair">Sair do sistema</button>`,
    aoAbrir: (f) => {
      f.querySelector('#sair').addEventListener('click', async () => {
        try { await api.post('/api/logout'); } catch (_) { }
        fecharModal(true); encerrarSessao('Sessão encerrada com segurança.');
      });
      f.querySelector('#trocar-senha').addEventListener('click', () => {
        fecharModal(true); modalAlterarSenha();
      });
    }
  });
}

async function painelAlertas() {
  const alertas = await api.get('/api/alertas');
  App.alertas = alertas;
  abrirModal({
    titulo: `Alertas do sistema (${alertas.length})`,
    corpo: alertas.length ? `<div style="margin:-20px">${alertas.map(itemAlerta).join('')}</div>`
      : `<div class="vazio-estado">${ico('checar')}<div>Nenhuma pendência no momento.</div></div>`,
    aoAbrir: (f) => f.querySelectorAll('.alerta-item').forEach(el => el.addEventListener('click', () => {
      fecharModal(true); location.hash = el.dataset.link.replace('#', '');
    }))
  });
}
const itemAlerta = (a) => `
  <div class="alerta-item ${a.prioridade}" data-link="${esc(a.link)}">
    <div class="alerta-marca"></div>
    <div style="min-width:0"><div class="titulo">${esc(a.titulo)}</div><div class="detalhe">${esc(a.detalhe)}</div></div>
  </div>`;

/* ------------------------------ Busca global ------------------------------ */
function configurarBusca() {
  const input = document.getElementById('busca');
  const caixa = document.getElementById('resultados');
  let t;
  const fechar = () => { caixa.innerHTML = ''; };
  input.addEventListener('input', () => {
    clearTimeout(t);
    const q = input.value.trim();
    if (q.length < 2) return fechar();
    t = setTimeout(async () => {
      const r = await api.get('/api/busca', { q });
      caixa.innerHTML = `<div class="resultados">${r.length ? r.map(p => `
        <div class="item" data-id="${p.id}">
          <div style="display:flex;gap:8px;align-items:center">
            <strong>${esc(p.nome)}</strong>
            <span class="tag simples t-neutro">${esc(p.status)}</span>
            ${p.financeiro ? `<span class="tag simples ${p.financeiro === 'Em atraso' ? 't-em_atraso' : p.financeiro === 'Pendente' ? 't-pendente' : 't-pago'}">${p.financeiro}</span>` : ''}
          </div>
          <div class="td-secundario">${idadeTexto(p.idade)} · ${esc(p.profissional || '—')} · Resp.: ${esc(p.responsavel || '—')}</div>
          <div class="td-secundario">Próximo: ${p.proximo ? dataBR(p.proximo.data) + ' às ' + p.proximo.hora : '—'} · Último: ${p.ultimo ? dataBR(p.ultimo.data) : '—'}</div>
        </div>`).join('') : '<div class="vazio">Nenhum resultado encontrado.</div>'}</div>`;
      caixa.querySelectorAll('.item').forEach(el => el.addEventListener('click', () => {
        location.hash = '/paciente/' + el.dataset.id; input.value = ''; fechar();
      }));
    }, 180);
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.busca-global')) fechar(); });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); input.focus(); }
  });
}

/* ------------------------------ Navegação ------------------------------ */
function analisarRota() {
  const bruto = (location.hash || '#/dashboard').slice(2);
  const [caminho, consulta] = bruto.split('?');
  const partes = caminho.split('/').filter(Boolean);
  return { nome: partes[0] || 'dashboard', param: partes[1], query: Object.fromEntries(new URLSearchParams(consulta || '')) };
}

async function navegar() {
  const rota = analisarRota();
  App.rota = rota;
  const alvo = document.getElementById('pagina');
  if (!alvo) return;
  document.querySelectorAll('[data-rota]').forEach(a => a.classList.toggle('ativo',
    a.dataset.rota === rota.nome || (rota.nome === 'paciente' && a.dataset.rota === 'pacientes')));
  document.getElementById('lateral')?.classList.remove('aberta');
  document.querySelector('.fundo-menu')?.remove();
  const pagina = App.paginas[rota.nome] || App.paginas.dashboard;
  alvo.innerHTML = `<div class="pagina"><div class="vazio-estado">Carregando…</div></div>`;
  try {
    await pagina(alvo, rota);
    rotularTabelas(alvo);
    window.scrollTo(0, 0);
  } catch (e) {
    alvo.innerHTML = `<div class="pagina"><div class="aviso erro">${esc(e.message)}</div></div>`;
  }
}

/* --------------------- Helpers de construção de tela --------------------- */
const cabecalho = (titulo, descricao, acoes = '') => `
  <div class="pagina-cabecalho">
    <div><h1>${esc(titulo)}</h1>${descricao ? `<div class="descricao">${esc(descricao)}</div>` : ''}</div>
    ${acoes ? `<div class="cabecalho-acoes">${acoes}</div>` : ''}
  </div>`;

const indicador = (rotulo, valor, nota = '', classe = '') => `
  <div class="painel indicador ${classe}">
    <div class="rotulo-ind">${esc(rotulo)}</div>
    <div class="valor">${valor}</div>
    ${nota ? `<div class="nota">${esc(nota)}</div>` : ''}
  </div>`;

const vazio = (texto) => `<div class="vazio-estado">${ico('checar')}<div>${esc(texto)}</div></div>`;

/**
 * Copia o texto do cabeçalho para cada célula (data-rotulo).
 * No celular a tabela vira lista de cartões e usa esse rótulo como legenda.
 */
function rotularTabelas(raiz = document) {
  raiz.querySelectorAll('table').forEach(t => {
    const titulos = [...t.querySelectorAll('thead th')].map(th => th.textContent.trim());
    if (!titulos.length) return;
    t.querySelectorAll('tbody tr').forEach(tr => {
      [...tr.children].forEach((td, i) => {
        if (titulos[i] && !td.dataset.rotulo) td.dataset.rotulo = titulos[i];
      });
    });
  });
}

function tabela(colunas, linhas, opcoes = {}) {
  if (!linhas.length) return vazio(opcoes.vazio || 'Nenhum registro encontrado.');
  return `<div class="tabela-rolagem"><table>
    <thead><tr>${colunas.map(c => `<th>${c}</th>`).join('')}</tr></thead>
    <tbody>${linhas.join('')}</tbody></table></div>`;
}

const campo = (rotulo, html, ajuda = '') => `<div class="campo"><label>${esc(rotulo)}</label>${html}${ajuda ? `<div class="ajuda">${esc(ajuda)}</div>` : ''}</div>`;
const entrada = (nome, valor = '', tipo = 'text', extra = '') => `<input type="${tipo}" name="${nome}" value="${esc(valor)}" ${extra}>`;
const area = (nome, valor = '', linhas = 3) => `<textarea name="${nome}" rows="${linhas}">${esc(valor)}</textarea>`;
const selecao = (nome, opcoes, valor, extra = '') => `<select name="${nome}" ${extra}>${opcoes.map(o => {
  const [v, r] = Array.isArray(o) ? o : [o, o];
  return `<option value="${esc(v)}" ${String(v) === String(valor ?? '') ? 'selected' : ''}>${esc(r)}</option>`;
}).join('')}</select>`;

const dadosFormulario = (form) => {
  const d = {};
  new FormData(form).forEach((v, k) => { d[k] = v; });
  return d;
};

window.App = App;
