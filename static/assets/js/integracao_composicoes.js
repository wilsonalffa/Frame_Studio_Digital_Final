// ÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉ
// SINCRONIZA├ç├âO DE COMPOSI├ç├òES ENTRE ABAS + HIST├ôRICO DE SIMULA├ç├òES
// ARQUIVO: static/assets/js/integracao_composicoes.js
// ÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉ

let historicoSimulacoes = JSON.parse(sessionStorage.getItem('historicoSimulacoes') || '[]');

// ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
// 1. APLICAR COMPOSI├ç├âO E SINCRONIZAR COM OUTRAS ABAS
// ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

function applicarComposicao() {
  console.log('Ô£à Aplicando composi├º├úo...');
  sincronizarComposicaoParaOutrasAbas();
}

// Mantem compatibilidade com chamadas antigas que usam o typo "applicar".
function aplicarComposicao() {
  return applicarComposicao();
}

function sincronizarComposicaoParaOutrasAbas() {
  // Obter dados da composi├º├úo atual
  const composicao = {
    modo: document.querySelector('[data-mode="grade"]')?.classList.contains('active') ? 'grade' : 'horizontal',
    colunas: parseInt(document.querySelector('input[name="colunas"]')?.value || document.querySelector('.num-parts-row input')?.value || 1),
    linhas: parseInt(document.querySelector('input[name="linhas"]')?.value || 1),
    largura: parseInt(document.querySelector('input[name="largura_total"]')?.value || 100),
    altura: parseInt(document.querySelector('input[name="altura_total"]')?.value || 100),
    imagemBase64: qImg?.src || document.getElementById('qImg')?.src || '',
    timestamp: new Date().toISOString()
  };

  console.log('­ƒôª Composi├º├úo:', composicao);

  // Validar se tem imagem
  if (!composicao.imagemBase64) {
    showToast('ÔØî Nenhuma imagem carregada!');
    return;
  }

  // Salvar na mem├│ria do navegador
  sessionStorage.setItem('composicaoAtual', JSON.stringify(composicao));

  // Mostrar toast
  showToast('Ô£à Composi├º├úo sincronizada! Abra "Simula├º├úo de Quadros" ou "Ambiente"');

  // AUTO-CARREGAR na aba "Simula├º├úo de Quadros" se estiver aberta
  if (document.getElementById('tab-simquadro')?.classList.contains('active')) {
    carregarComposicaoEmQuadros(composicao);
  }

  // AUTO-CARREGAR na aba "Simula├º├úo de Ambiente" se estiver aberta
  if (document.getElementById('tab-simambiente')?.classList.contains('active')) {
    carregarComposicaoEmAmbiente(composicao);
  }

  // Adicionar ao hist├│rico
  adicionarAoHistorico('composicao', composicao);
}

// ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
// 2. CARREGAR COMPOSI├ç├âO EM "SIMULA├ç├âO DE QUADROS"
// ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

function carregarComposicaoEmQuadros(composicao) {
  if (!composicao || !composicao.imagemBase64) {
    console.warn('ÔØî Composi├º├úo inv├ílida');
    return;
  }

  // Carregar imagem em qImg
  const qImg = document.getElementById('qImg') || window.qImg;
  if (qImg) {
    qImg.src = composicao.imagemBase64;
    qImg.style.maxWidth = '100%';
    qImg.style.maxHeight = '600px';
  }

  // Pr├®-preencher dimens├Áes se houver campos
  const larguraInput = document.querySelector('[data-quadro-largura]') || 
                       document.querySelector('input[placeholder*="Largura"]');
  const alturaInput = document.querySelector('[data-quadro-altura]') || 
                      document.querySelector('input[placeholder*="Altura"]');
  
  if (larguraInput) larguraInput.value = composicao.largura;
  if (alturaInput) alturaInput.value = composicao.altura;

  console.log('Ô£à Composi├º├úo carregada em Simula├º├úo de Quadros');
  showToast('Ô£à Composi├º├úo carregada em Simula├º├úo de Quadros');
}

// ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
// 3. CARREGAR COMPOSI├ç├âO EM "SIMULA├ç├âO DE AMBIENTE"
// ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

function carregarComposicaoEmAmbiente(composicao) {
  if (!composicao || !composicao.imagemBase64) {
    console.warn('ÔØî Composi├º├úo inv├ílida');
    return;
  }

  // Carregar imagem no simulador de ambiente
  const ambienteImg = document.getElementById('ambienteImagem') || 
                      document.querySelector('[data-ambiente-imagem]') ||
                      document.querySelector('#wall-simulator img') ||
                      document.querySelector('.wall-simulator img');
  
  if (ambienteImg) {
    ambienteImg.src = composicao.imagemBase64;
    ambienteImg.style.maxWidth = composicao.largura + 'px';
    ambienteImg.style.maxHeight = composicao.altura + 'px';
  }

  console.log('Ô£à Composi├º├úo carregada em Simula├º├úo de Ambiente');
  showToast('Ô£à Composi├º├úo carregada em Simula├º├úo de Ambiente');
}

// ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
// 4. HIST├ôRICO DE SIMULA├ç├òES
// ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

function adicionarAoHistorico(tipo, composicao) {
  const entrada = {
    id: Date.now(),
    tipo: tipo,
    composicao: composicao,
    dataHora: new Date().toLocaleString('pt-BR'),
    timestamp: Date.now()
  };

  historicoSimulacoes.unshift(entrada);

  // Limitar a 20 simula├º├Áes
  if (historicoSimulacoes.length > 20) {
    historicoSimulacoes = historicoSimulacoes.slice(0, 20);
  }

  sessionStorage.setItem('historicoSimulacoes', JSON.stringify(historicoSimulacoes));
  atualizarUIHistorico();

  console.log('Ô£à Adicionado ao hist├│rico:', entrada);
}

function atualizarUIHistorico() {
  const container = document.getElementById('historicoSimulacoes');
  
  if (!container) {
    console.warn('ÔÜá´©Å Container #historicoSimulacoes n├úo encontrado');
    return;
  }

  container.innerHTML = '';

  if (historicoSimulacoes.length === 0) {
    container.innerHTML = '<p style="color: #999; text-align: center; padding: 20px;">Nenhuma simula├º├úo no hist├│rico</p>';
    return;
  }

  historicoSimulacoes.forEach((entrada, index) => {
    const item = document.createElement('div');
    item.className = 'historico-item';
    item.style.cssText = `
      border: 1px solid #ddd;
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 12px;
      display: flex;
      gap: 12px;
      align-items: center;
      background: white;
    `;

    item.innerHTML = `
      <img src="${entrada.composicao.imagemBase64}" 
           style="width: 60px; height: 60px; object-fit: cover; border-radius: 4px;">
      <div style="flex: 1; text-align: left;">
        <strong style="color: #1A3051;">­ƒôï Composi├º├úo</strong><br>
        <small style="color: #666;">${entrada.dataHora}</small><br>
        <small style="color: #999;">${entrada.composicao.largura}x${entrada.composicao.altura}cm</small>
      </div>
      <button onclick="restaurarDoHistorico(${entrada.id})" 
              style="padding: 6px 12px; background: #B22222; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: bold;">
        Ôå║ Restaurar
      </button>
      <button onclick="removerDoHistorico(${entrada.id})" 
              style="padding: 6px 12px; background: #999; color: white; border: none; border-radius: 4px; cursor: pointer;">
        Ô£ò
      </button>
    `;

    container.appendChild(item);
  });
}

function restaurarDoHistorico(id) {
  const entrada = historicoSimulacoes.find(e => e.id === id);
  if (!entrada) return;

  // Carregar em Simula├º├úo de Quadros
  switchTab('simquadro');
  setTimeout(() => {
    carregarComposicaoEmQuadros(entrada.composicao);
  }, 200);

  showToast('Ô£à Simula├º├úo restaurada');
}

function removerDoHistorico(id) {
  historicoSimulacoes = historicoSimulacoes.filter(e => e.id !== id);
  sessionStorage.setItem('historicoSimulacoes', JSON.stringify(historicoSimulacoes));
  atualizarUIHistorico();
  showToast('Ô£à Removido do hist├│rico');
}

// ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
// 5. SALVAR QUADRO ATUAL NA BIBLIOTECA
// ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

function salvarQuadroAtual() {
  const qImg = document.getElementById('qImg') || window.qImg;
  
  if (!qImg || !qImg.src) {
    showToast('ÔØî Nenhuma imagem carregada');
    return;
  }

  const quadro = {
    imagem: qImg.src,
    moldura: document.querySelector('[data-moldura-selecionada]')?.value || 
             document.querySelector('select[name="moldura"]')?.value || '',
    cor: document.querySelector('[data-moldura-cor]')?.value || 
         document.querySelector('input[type="color"][name="cor"]')?.value || '',
    espessura: document.querySelector('[data-moldura-espessura]')?.value || 
               document.querySelector('input[name="espessura"]')?.value || '',
    passepartout: document.querySelector('[data-passepartout-ativo]')?.checked || 
                  document.querySelector('input[name="passepartout"]')?.checked || false,
    timestamp: new Date().toISOString()
  };

  let quadrosSalvos = JSON.parse(sessionStorage.getItem('quadrosSalvos') || '[]');
  quadrosSalvos.unshift(quadro);
  sessionStorage.setItem('quadrosSalvos', JSON.stringify(quadrosSalvos));

  atualizarListaQuadrosSalvos();
  adicionarAoHistorico('quadro', quadro);

  showToast('Ô£à Quadro salvo na sua biblioteca');
  console.log('Ô£à Quadro salvo:', quadro);
}

function atualizarListaQuadrosSalvos() {
  const container = document.getElementById('quadrosSalvosList');
  
  if (!container) {
    console.warn('ÔÜá´©Å Container #quadrosSalvosList n├úo encontrado');
    return;
  }

  const quadrosSalvos = JSON.parse(sessionStorage.getItem('quadrosSalvos') || '[]');
  
  if (quadrosSalvos.length === 0) {
    container.innerHTML = '<p style="color: #999; padding: 20px;">Nenhum quadro salvo</p>';
    return;
  }

  container.innerHTML = quadrosSalvos.map((q, idx) => `
    <div style="display: flex; gap: 12px; padding: 12px; border: 1px solid #ddd; border-radius: 8px; margin-bottom: 12px; background: white;">
      <img src="${q.imagem}" style="width: 60px; height: 60px; object-fit: cover; border-radius: 4px;">
      <div style="flex: 1; text-align: left;">
        <strong style="color: #2E75B6;">­ƒû╝´©Å Quadro #${idx + 1}</strong><br>
        <small style="color: #666;">Moldura: ${q.moldura || 'Padr├úo'}</small><br>
        <small style="color: #999;">Cor: ${q.cor || 'Padr├úo'}</small>
      </div>
      <button onclick="aplicarQuadroSalvo(${idx})" style="padding: 6px 12px; background: #2E75B6; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: bold; white-space: nowrap;">
        Ô£ô Aplicar
      </button>
    </div>
  `).join('');
}

function aplicarQuadroSalvo(index) {
  const quadrosSalvos = JSON.parse(sessionStorage.getItem('quadrosSalvos') || '[]');
  const quadro = quadrosSalvos[index];
  
  if (!quadro) return;

  const qImg = document.getElementById('qImg') || window.qImg;
  if (qImg) {
    qImg.src = quadro.imagem;
  }

  const molduraSelect = document.querySelector('select[name="moldura"]') || 
                        document.querySelector('[data-moldura-selecionada]');
  const corInput = document.querySelector('input[type="color"][name="cor"]') || 
                   document.querySelector('[data-moldura-cor]');
  const espessuraInput = document.querySelector('input[name="espessura"]') || 
                         document.querySelector('[data-moldura-espessura]');
  const passepartoutCheckbox = document.querySelector('input[name="passepartout"]') || 
                               document.querySelector('[data-passepartout-ativo]');

  if (molduraSelect) molduraSelect.value = quadro.moldura;
  if (corInput) corInput.value = quadro.cor;
  if (espessuraInput) espessuraInput.value = quadro.espessura;
  if (passepartoutCheckbox) passepartoutCheckbox.checked = quadro.passepartout;

  showToast('Ô£à Quadro aplicado');
}

// ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
// 6. SALVAR AMBIENTE ATUAL NA BIBLIOTECA
// ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

function salvarAmbienteAtual() {
  const ambiente = {
    imagem: document.getElementById('ambienteImagem')?.src || 
            document.querySelector('[data-ambiente-imagem]')?.src || 
            document.querySelector('#wall-simulator img')?.src || '',
    parede: document.querySelector('select[name="parede"]')?.value || 
            document.querySelector('[data-parede-selecionada]')?.value || '',
    posicaoX: document.querySelector('input[name="posicaoX"]')?.value || '50',
    posicaoY: document.querySelector('input[name="posicaoY"]')?.value || '50',
    tamanho: document.querySelector('input[name="tamanho"]')?.value || '100',
    timestamp: new Date().toISOString()
  };

  if (!ambiente.imagem) {
    showToast('ÔØî Nenhuma imagem carregada');
    return;
  }

  let ambientesSalvos = JSON.parse(sessionStorage.getItem('ambientesSalvos') || '[]');
  ambientesSalvos.unshift(ambiente);
  sessionStorage.setItem('ambientesSalvos', JSON.stringify(ambientesSalvos));

  atualizarListaAmbientesSalvos();
  adicionarAoHistorico('ambiente', ambiente);

  showToast('Ô£à Ambiente salvo na sua biblioteca');
  console.log('Ô£à Ambiente salvo:', ambiente);
}

function atualizarListaAmbientesSalvos() {
  const container = document.getElementById('ambientesSalvosList');
  
  if (!container) {
    console.warn('ÔÜá´©Å Container #ambientesSalvosList n├úo encontrado');
    return;
  }

  const ambientesSalvos = JSON.parse(sessionStorage.getItem('ambientesSalvos') || '[]');
  
  if (ambientesSalvos.length === 0) {
    container.innerHTML = '<p style="color: #999; padding: 20px;">Nenhum ambiente salvo</p>';
    return;
  }

  container.innerHTML = ambientesSalvos.map((a, idx) => `
    <div style="display: flex; gap: 12px; padding: 12px; border: 1px solid #ddd; border-radius: 8px; margin-bottom: 12px; background: white;">
      <img src="${a.imagem}" style="width: 60px; height: 60px; object-fit: cover; border-radius: 4px;">
      <div style="flex: 1; text-align: left;">
        <strong style="color: #2E75B6;">­ƒÅá Ambiente #${idx + 1}</strong><br>
        <small style="color: #666;">Parede: ${a.parede || 'Padr├úo'}</small><br>
        <small style="color: #999;">Tamanho: ${a.tamanho}%</small>
      </div>
      <button onclick="aplicarAmbienteSalvo(${idx})" style="padding: 6px 12px; background: #2E75B6; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: bold; white-space: nowrap;">
        Ô£ô Aplicar
      </button>
    </div>
  `).join('');
}

function aplicarAmbienteSalvo(index) {
  const ambientesSalvos = JSON.parse(sessionStorage.getItem('ambientesSalvos') || '[]');
  const ambiente = ambientesSalvos[index];
  
  if (!ambiente) return;

  const ambienteImg = document.getElementById('ambienteImagem') || 
                      document.querySelector('[data-ambiente-imagem]') ||
                      document.querySelector('#wall-simulator img');
  if (ambienteImg) {
    ambienteImg.src = ambiente.imagem;
  }

  const paredeSelect = document.querySelector('select[name="parede"]') || 
                       document.querySelector('[data-parede-selecionada]');
  const posXInput = document.querySelector('input[name="posicaoX"]') || 
                    document.querySelector('[data-ambiente-x]');
  const posYInput = document.querySelector('input[name="posicaoY"]') || 
                    document.querySelector('[data-ambiente-y]');
  const tamanhoInput = document.querySelector('input[name="tamanho"]') || 
                       document.querySelector('[data-ambiente-tamanho]');

  if (paredeSelect) paredeSelect.value = ambiente.parede;
  if (posXInput) posXInput.value = ambiente.posicaoX;
  if (posYInput) posYInput.value = ambiente.posicaoY;
  if (tamanhoInput) tamanhoInput.value = ambiente.tamanho;

  showToast('Ô£à Ambiente aplicado');
}

// ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
// 7. INICIALIZA├ç├âO NA CARGA DA P├üGINA
// ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

document.addEventListener('DOMContentLoaded', () => {
  console.log('Ô£à Integracao de composi├º├Áes carregada');
  
  // Carregar hist├│rico
  atualizarUIHistorico();
  atualizarListaQuadrosSalvos();
  atualizarListaAmbientesSalvos();

  // Sincronizar ao mudar de aba
  document.querySelectorAll('[data-nav], .nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      setTimeout(() => {
        const composicaoAtual = sessionStorage.getItem('composicaoAtual');
        if (composicaoAtual) {
          const composicao = JSON.parse(composicaoAtual);
          
          const tab = btn.dataset.nav || btn.textContent.toLowerCase();
          
          if (tab.includes('simquadro') || tab.includes('moldura')) {
            carregarComposicaoEmQuadros(composicao);
          }
          
          if (tab.includes('simambiente') || tab.includes('ambiente')) {
            carregarComposicaoEmAmbiente(composicao);
          }
        }
      }, 100);
    });
  });
});

// ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ
// 8. HELPER - TOAST NOTIFICATION
// ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ

function showToast(message) {
  // Procurar por toast existente
  let toast = document.getElementById('toast-notification');
  
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast-notification';
    document.body.appendChild(toast);
  }

  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    bottom: 30px;
    right: 20px;
    background: rgba(0, 0, 0, 0.9);
    color: white;
    padding: 12px 20px;
    border-radius: 6px;
    z-index: 10000;
    font-size: 14px;
    font-weight: bold;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    animation: slideInUp 0.3s ease;
  `;
  
  setTimeout(() => {
    toast.style.animation = 'slideOutDown 0.3s ease';
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 300);
  }, 3000);
}

// ÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉÔòÉ
