'use strict';
/**
 * Regras de negócio compartilhadas — Memória de cálculo padrão CAESB.
 * Faixas progressivas de tarifa de água + esgoto de 100%.
 */

// Faixas oficiais CAESB (residencial, DF). A tarifa é progressiva: cada m³
// consome primeiro as faixas mais baratas. Ex.: 12 m³ = 8 m³ na faixa 1 +
// 4 m³ na faixa 2. O fatiamento usa as fronteiras inteiras (ate), que são o
// limite real de consumo de cada faixa.
const TARIFAS_CAESB = [
  { faixa: 1, descricao: '0 a 8 m³',        de: 0,  ate: 8,        aliquota: 4.30 },
  { faixa: 2, descricao: '9 a 14 m³',       de: 8,  ate: 14,       aliquota: 5.15 },
  { faixa: 3, descricao: '15 a 21 m³',      de: 14, ate: 21,       aliquota: 10.21 },
  { faixa: 4, descricao: '22 a 31 m³',      de: 21, ate: 31,       aliquota: 14.81 },
  { faixa: 5, descricao: '32 a 46 m³',      de: 31, ate: 46,       aliquota: 22.22 },
  { faixa: 6, descricao: 'Acima de 46 m³',  de: 46, ate: Infinity, aliquota: 28.88 },
];

function round2(v) {
  return Math.round((Number(v) + Number.EPSILON) * 100) / 100;
}

function round3(v) {
  return Math.round((Number(v) + Number.EPSILON) * 1000) / 1000;
}

/**
 * Fatiamento progressivo do consumo nas faixas.
 * Retorna { valor_agua, valor_esgoto, valor_total, faixas[] }.
 * Esgoto = 100% da água => total = água * 2.
 */
function calcularValorAgua(consumo) {
  const c = Number(consumo) || 0;
  let agua = 0;
  const faixas = TARIFAS_CAESB.map((f) => {
    const tamanho = f.ate === Infinity ? Infinity : f.ate - f.de;
    const m3 = Math.max(0, Math.min(c - f.de, tamanho));
    const valor = round2(m3 * f.aliquota);
    agua += valor;
    return {
      faixa: f.faixa,
      descricao: f.descricao,
      aliquota: f.aliquota,
      m3: round3(m3),
      valor,
    };
  });
  agua = round2(agua);
  return {
    valor_agua: agua,
    valor_esgoto: agua,
    valor_total: round2(agua * 2),
    faixas,
  };
}

function mesAnterior(ref) {
  const [y, m] = ref.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const NOMES_MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

function mesLabel(ref) {
  const [y, m] = ref.split('-').map(Number);
  return `${NOMES_MESES[m - 1]}/${y}`;
}

function refAtual() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function isRefValido(ref) {
  return typeof ref === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(ref);
}

// ---------------- medição diária (acompanhamento, sem cobrança) ----------------
// Regra do alerta de possível vazamento: o consumo do período (m³/dia) precisa
// ficar acima de FATOR_ALERTA × média móvel dos últimos JANELA_DIAS dias.
const DIARIA = {
  FATOR_ALERTA: 1.5,   // 1,5× a média — definido pelo gestor (mais sensível = mais falsos positivos)
  JANELA_DIAS: 30,     // janela da média móvel
  MIN_AMOSTRAS: 5,     // mínimo de leituras anteriores p/ considerar a média
};

function isDataValida(s) {
  return typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s);
}

module.exports = {
  TARIFAS_CAESB,
  DIARIA,
  isDataValida,
  round2,
  round3,
  calcularValorAgua,
  mesAnterior,
  mesLabel,
  refAtual,
  isRefValido,
};
