'use strict';
/* Página pública do morador/equipe: medição inicial (hidrômetro + leitura + foto). Sem login. */
const $ = (id) => document.getElementById(id);
const token = new URLSearchParams(location.search).get('token') || '';
let atual = null;
let fotoDataUrl = '';

function mostra(box) { ['box-form','box-ok','box-erro'].forEach((b) => { $(b).style.display = b === box ? '' : 'none'; }); }
function falha(msg) { $('erro').textContent = msg; $('erro').style.display = ''; }

async function carregar() {
  try {
    const r = await fetch('/api/inicial-info?token=' + encodeURIComponent(token));
    const j = await r.json();
    if (!r.ok) { $('erro-txt').textContent = j.error || 'Link inválido.'; return mostra('box-erro'); }
    $('condo-nome').textContent = j.condominio.nome;
    $('unidade-txt').textContent = 'Unidade ' + j.unidade.etiqueta;
    if (j.condominio.logo) { $('logo').src = j.condominio.logo; $('logo').style.display = ''; }
    atual = j.atual;
    $('hid').value = atual.hidrometro || '';
    $('ler').value = atual.leitura_inicial == null ? '' : atual.leitura_inicial;
    $('dt').value = atual.data || new Date().toISOString().slice(0, 10);
    $('foto-aviso').textContent = atual.tem_foto ? 'Já existe uma foto salva para esta unidade — enviar outra substitui.' : '';
    mostra('box-form');
  } catch { $('erro-txt').textContent = 'Sem conexão com o servidor. Tente de novo.'; mostra('box-erro'); }
}

// redimensiona + carimba data/hora e unidade na foto (igual ao app)
function processarFoto(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const MAX = 1280;
        let { width, height } = img;
        if (width > MAX || height > MAX) {
          if (width >= height) { height = Math.round((height * MAX) / width); width = MAX; }
          else { width = Math.round((width * MAX) / height); height = MAX; }
        }
        const c = document.createElement('canvas');
        c.width = width; c.height = height;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        const texto = `${($('unidade-txt').textContent)} · ${new Date().toLocaleString('pt-BR')}`;
        ctx.font = `bold ${Math.max(13, Math.round(width / 40))}px sans-serif`;
        const wTxt = ctx.measureText(texto).width;
        const pad = Math.max(6, Math.round(width / 90));
        ctx.fillStyle = 'rgba(41,37,36,.78)';
        ctx.fillRect(width - wTxt - pad * 3, pad, wTxt + pad * 2, Math.round(width / 26) + pad * 2);
        ctx.fillStyle = '#fff';
        ctx.fillText(texto, width - wTxt - pad * 2, pad + Math.round(width / 34));
        resolve(c.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

$('btn-foto').addEventListener('click', () => $('foto').click());
$('foto').addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  if (f.size > 8 * 1024 * 1024) { $('foto-aviso').textContent = 'Foto muito grande (máx. 8 MB). Tente de mais longe.'; return; }
  try {
    fotoDataUrl = await processarFoto(f);
    const pv = $('foto-prev');
    pv.src = fotoDataUrl; pv.style.display = '';
    $('foto-aviso').textContent = 'Foto pronta ✅ (data, hora e unidade marcadas nela automaticamente)';
  } catch { $('foto-aviso').textContent = 'Não consegui ler a foto. Tente novamente.'; }
});

$('btn-salvar').addEventListener('click', async () => {
  $('erro').style.display = 'none';
  const ler = $('ler').value.trim();
  if (ler === '' || Number(ler) < 0 || !Number.isFinite(Number(ler))) { return falha('Informe a leitura do mostrador (número em m³).'); }
  $('btn-salvar').disabled = true;
  $('btn-salvar').textContent = 'Enviando…';
  try {
    const r = await fetch('/api/inicial-envio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, hidrometro: $('hid').value.trim(), leitura_inicial: Number(ler), data: $('dt').value || null, foto: fotoDataUrl || undefined }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Falha ao enviar.');
    $('ok-titulo').textContent = 'Leitura da ' + $('unidade-txt').textContent.replace('Unidade ', '') + ' registrada!';
    fotoDataUrl = ''; $('foto-prev').style.display = 'none';
    mostra('box-ok');
  } catch (e) {
    falha(e.message || 'Falha ao enviar. Confira a conexão.');
  } finally {
    $('btn-salvar').disabled = false;
    $('btn-salvar').textContent = '✅ Enviar leitura inicial';
  }
});

$('btn-corrigir').addEventListener('click', () => {
  carregar();
});

carregar();
