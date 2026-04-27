// ═══════════════════════════════════════════════════════════
//  SIMULADOR DE AMBIENTE — Multi-quadro, Drag & Drop, Guias
//  Substitui as funções renderWall, checkWall, loadArt, dlWall
//  e adiciona sistema de múltiplos quadros com drag interativo
// ═══════════════════════════════════════════════════════════

/*
MAPA FUNCIONAL (wall_simulator.js)

1) Estado da cena
- Mantem lista de quadros posicionados na parede (wallFrames).
- Controla selecao, drag, resize, guias e render pendente.

2) Modelagem do quadro
- Cada quadro guarda arte, dimensoes fisicas, moldura, passepartout e sombra.

3) Interacao
- Clique para selecionar.
- Drag-and-drop para reposicionar.
- Handles para redimensionar mantendo controles visuais.

4) Renderizacao
- Desenha ambiente + quadros em canvas com escala por cm.
- Aplica sombra, moldura e passepartout durante desenho.

5) Integracao com UI principal
- Le inputs de tamanho/posicao da aba simulador.
- Exporta imagem final e atualiza previews quando estado muda.
*/

// ── Estado dos quadros na parede ──────────────────────────
let wallFrames = [];          // Array de quadros na cena
let wallSelectedIdx = -1;     // Índice do quadro selecionado
let wallGuidesEnabled = true; // Guias de alinhamento on/off
let wallDragging = false;
let wallDragOffX = 0, wallDragOffY = 0;
let wallResizing = false;
let wallResizeHandle = '';
let wallResizeStartX = 0, wallResizeStartY = 0;
let wallResizeStartFrame = null;
let _wallRenderPending = false;
let wallCompositionLocked = false;
let wallGroupDragging = false;
let wallGroupDragState = null;

// Marca d'agua da simulacao de ambiente
let wallWatermarkEnabled = false;
let wallWatermarkText = 'FAST FRAME SOROCABA';
let wallWatermarkSizePct = 5.5; // % da largura do canvas
let wallWatermarkXPct = 50;
let wallWatermarkYPct = 92;
let wallWatermarkRotationDeg = -18;
let wallWatermarkLocked = false;
let wallWatermarkDragging = false;
let wallWatermarkDragOffX = 0;
let wallWatermarkDragOffY = 0;
let wallWatermarkMode = 'text'; // 'text' | 'logo'
let wallWatermarkLogoImg = null;
let wallWatermarkOpacity = 0.68; // 0 a 1

// Estrutura de um quadro:
// { img, xP, yP, wCm, hCm, frameColor, frameW, ppOn, ppColor, ppSize, shadow, id }

function _wallNextId() {
  return Date.now() + Math.random();
}

function _wallGetTargetSizeCm() {
  const wEl = document.getElementById('wW');
  const hEl = document.getElementById('wH');
  const w = parseFloat(wEl?.value);
  const h = parseFloat(hEl?.value);
  return {
    w: Math.max(20, Math.min(300, isFinite(w) ? w : 80)),
    h: Math.max(20, Math.min(300, isFinite(h) ? h : 60)),
  };
}

function _wallUpdateCompositionLockBtn() {
  const btn = document.getElementById('wallCompLockBtn');
  if (!btn) return;
  if (wallCompositionLocked) {
    btn.style.background = 'rgba(178,34,34,0.88)';
    btn.textContent = '🔒 Composição';
    btn.title = 'Travada: move todos os quadros juntos';
  } else {
    btn.style.background = 'rgba(26,48,81,0.85)';
    btn.textContent = '🔓 Composição';
    btn.title = 'Destravada: quadros movem individualmente';
  }
}

function toggleWallCompositionLock() {
  wallCompositionLocked = !wallCompositionLocked;
  _wallUpdateCompositionLockBtn();
  toast(wallCompositionLocked ? 'Composição travada.' : 'Composição destravada.');
}

function _wallDefaultFrame(img) {
  const naturalW = img.naturalWidth || img.width || 800;
  const naturalH = img.naturalHeight || img.height || 600;
  const [mw, mh] = maxPrintCm(naturalW, naturalH);
  const ratio = naturalW / naturalH;
  const target = _wallGetTargetSizeCm();

  // Mantém proporção da arte e usa caixa base do ambiente para nascer em tamanho mais realista.
  let wCm = target.w;
  let hCm = target.h;
  if (ratio >= 1) {
    hCm = wCm / ratio;
    if (hCm > target.h) {
      hCm = target.h;
      wCm = hCm * ratio;
    }
  } else {
    wCm = hCm * ratio;
    if (wCm > target.w) {
      wCm = target.w;
      hCm = wCm / ratio;
    }
  }

  if (mw && mh) {
    wCm = Math.min(wCm, mw);
    hCm = Math.min(hCm, mh);
  }

  wCm = Math.max(5, Math.round(wCm * 2) / 2);
  hCm = Math.max(5, Math.round(hCm * 2) / 2);

  const xEl = document.getElementById('wX');
  const yEl = document.getElementById('wY');
  const xP = parseFloat(xEl?.value);
  const yP = parseFloat(yEl?.value);

  return {
    img,
    xP: isFinite(xP) ? xP : 50,
    yP: isFinite(yP) ? yP : 38,
    wCm,
    hCm,
    frameColor: wallFrameColor || '#3C2F1E',
    frameW: 3,
    ppOn: false,
    ppColor: '#FFFFFF',
    ppSize: 3,
    shadow: 2,
    id: _wallNextId(),
  };
}

// ── API pública ───────────────────────────────────────────

function wallAddFrame(img) {
  const frame = _wallDefaultFrame(img);
  // Deslocar levemente para não sobrepor quadros existentes
  if (wallFrames.length > 0) {
    frame.xP = Math.min(85, 50 + wallFrames.length * 8);
    frame.yP = Math.min(75, 38 + wallFrames.length * 4);
  }
  wallFrames.push(frame);
  wallSelectedIdx = wallFrames.length - 1;
  wArtImg = img; // compatibilidade com código legado
  checkWall();
  _wallRenderPanel();
  _wallUpdatePanelFromSelected();
  toast('Quadro ' + wallFrames.length + ' adicionado!');
}

function wallRemoveSelected() {
  if (wallSelectedIdx < 0 || !wallFrames.length) return;
  wallFrames.splice(wallSelectedIdx, 1);
  wallSelectedIdx = wallFrames.length > 0 ? Math.min(wallSelectedIdx, wallFrames.length - 1) : -1;
  wArtImg = wallFrames[wallSelectedIdx]?.img || null;
  renderWall();
  _wallRenderPanel();
  _wallUpdatePanelFromSelected();
}

function wallSelectFrame(idx) {
  if (idx < 0 || idx >= wallFrames.length) return;
  wallSelectedIdx = idx;
  wArtImg = wallFrames[idx].img;
  _wallUpdatePanelFromSelected();
  renderWall();
  _wallRenderPanel();
}

function wallClearAll() {
  wallFrames = [];
  wallSelectedIdx = -1;
  wArtImg = null;
  renderWall();
  _wallRenderPanel();
  document.getElementById('wControls').style.display = 'none';
}

// ── Painel de quadros (lista lateral) ────────────────────

function _wallRenderPanel() {
  const panel = document.getElementById('wallFramesList');
  if (!panel) return;
  if (!wallFrames.length) {
    panel.innerHTML = '<div style="font-size:12px;color:var(--gray);padding:8px 0;text-align:center">Nenhum quadro adicionado</div>';
    return;
  }
  panel.innerHTML = wallFrames.map((f, i) => {
    const active = i === wallSelectedIdx;
    return `<div onclick="wallSelectFrame(${i})" style="
        display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;cursor:pointer;
        background:${active ? 'var(--gold)' : 'var(--cream2)'};
        border:1.5px solid ${active ? 'var(--gold)' : 'var(--border2)'};
        transition:all .15s;margin-bottom:6px
      ">
      <div style="width:36px;height:28px;border-radius:4px;overflow:hidden;flex-shrink:0;border:1px solid rgba(0,0,0,.1);background:#eee">
        <canvas id="wallThumb${i}" width="36" height="28"></canvas>
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:700;color:${active ? '#fff' : 'var(--brown)'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
          Quadro ${i + 1}
        </div>
        <div style="font-size:10px;color:${active ? 'rgba(255,255,255,.75)' : 'var(--gray)'}">
          ${f.wCm}×${f.hCm}cm
        </div>
      </div>
      <button onclick="event.stopPropagation();wallSelectFrame(${i});wallRemoveSelected()" style="
        background:${active ? 'rgba(255,255,255,.2)' : 'transparent'};border:none;
        color:${active ? '#fff' : 'var(--gray)'};width:22px;height:22px;border-radius:50%;
        cursor:pointer;font-size:13px;display:flex;align-items:center;justify-content:center;
        flex-shrink:0;padding:0;line-height:1
      " title="Remover quadro">✕</button>
    </div>`;
  }).join('');

  // Desenhar thumbnails após render
  requestAnimationFrame(() => {
    wallFrames.forEach((f, i) => {
      const tc = document.getElementById('wallThumb' + i);
      if (!tc || !f.img) return;
      const ctx = tc.getContext('2d');
      ctx.clearRect(0, 0, 36, 28);
      ctx.drawImage(f.img, 0, 0, 36, 28);
    });
  });
}

// ── Sincronizar painel de controles → quadro selecionado ──

function _wallUpdatePanelFromSelected() {
  const f = wallFrames[wallSelectedIdx];
  const ctrl = document.getElementById('wControls');
  if (!ctrl) return;

  if (!f) {
    ctrl.style.display = 'none';
    return;
  }
  ctrl.style.display = 'block';

  // Sliders
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  set('wW', f.wCm); set('wH', f.hCm);
  set('wX', f.xP);  set('wY', f.yP);
  set('wS', f.shadow);

  // Labels
  const lbl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  lbl('wWL', f.wCm + 'cm'); lbl('wHL', f.hCm + 'cm');
  lbl('wXL', Math.round(f.xP) + '%'); lbl('wYL', Math.round(f.yP) + '%');
  const shadowNames = ['Sem sombra','Leve','Média','Forte'];
  lbl('wSL', shadowNames[f.shadow] || 'Média');

  // PP
  const ppCb = document.getElementById('ppEnabled');
  const ppCtrl = document.getElementById('ppControls');
  if (ppCb) ppCb.checked = f.ppOn;
  if (ppCtrl) ppCtrl.style.display = f.ppOn ? 'block' : 'none';

  const ppSzEl = document.getElementById('ppSize');
  if (ppSzEl) ppSzEl.value = f.ppSize;
  const ppPick = document.getElementById('ppColorPicker');
  if (ppPick) ppPick.value = f.ppColor;

  // wallFrameColor legado
  wallFrameColor = f.frameColor;

  // Espessura de moldura
  const fwSlider = document.getElementById('wFrameW');
  const fwLabel  = document.getElementById('wFrameWL');
  const fwInput  = document.getElementById('wFrameWInput');
  if (fwSlider) fwSlider.value = f.frameW || 0;
  if (fwLabel)  fwLabel.textContent = (f.frameW || 0) + 'cm';
  if (fwInput)  fwInput.value = f.frameW || 0;

  // Picker de cor da moldura
  const fColorPick = document.getElementById('wFrameColorPicker');
  if (fColorPick) fColorPick.value = f.frameColor || '#3C2F1E';

  // Inputs numéricos de tamanho
  const wWInput = document.getElementById('wWInput');
  const wHInput = document.getElementById('wHInput');
  if (wWInput) wWInput.value = f.wCm;
  if (wHInput) wHInput.value = f.hCm;
}

function _wallApplyPanelToSelected() {
  const f = wallFrames[wallSelectedIdx];
  if (!f) return;
  const get = (id) => { const el = document.getElementById(id); return el ? el.value : null; };
  f.wCm = parseFloat(get('wW')) || f.wCm;
  f.hCm = parseFloat(get('wH')) || f.hCm;
  f.xP  = parseFloat(get('wX')) || f.xP;
  f.yP  = parseFloat(get('wY')) || f.yP;
  f.shadow = parseInt(get('wS')) ?? f.shadow;
  const ppCb = document.getElementById('ppEnabled');
  if (ppCb) f.ppOn = ppCb.checked;
  const ppSz = document.getElementById('ppSize');
  if (ppSz) f.ppSize = parseFloat(ppSz.value) || f.ppSize;
  const ppPick = document.getElementById('ppColorPicker');
  if (ppPick) f.ppColor = ppPick.value;
  f.frameColor = wallFrameColor;

  // frameW do slider ou do input numérico
  const fwSlider = document.getElementById('wFrameW');
  const fwInput  = document.getElementById('wFrameWInput');
  if (fwInput && fwInput.value !== '') f.frameW = parseFloat(fwInput.value) || 0;
  else if (fwSlider) f.frameW = parseFloat(fwSlider.value) || 0;

  // tamanho numérico direto
  const wWInput = document.getElementById('wWInput');
  const wHInput = document.getElementById('wHInput');
  if (wWInput && wWInput.value) f.wCm = parseFloat(wWInput.value) || f.wCm;
  if (wHInput && wHInput.value) f.hCm = parseFloat(wHInput.value) || f.hCm;
}

// ── Render principal ──────────────────────────────────────

function renderWall() {
  if (!wEnvImg) return;
  if (_wallRenderPending) return;
  _wallRenderPending = true;
  requestAnimationFrame(_wallDoRender);
}

function _wallDoRender() {
  _wallRenderPending = false;
  if (!wEnvImg) return;

  const cvs = document.getElementById('wallCanvas');
  const mw = Math.min(cvs.parentElement.offsetWidth - 32, 900);
  cvs.width = mw;
  cvs.height = Math.round(wEnvImg.naturalHeight * mw / wEnvImg.naturalWidth);
  const ctx = cvs.getContext('2d');
  const ppc = mw / 300; // pixels por cm (escala de display)

  // Fundo — ambiente
  ctx.drawImage(wEnvImg, 0, 0, cvs.width, cvs.height);

  // Desenhar cada quadro
  wallFrames.forEach((f, i) => {
    _wallDrawFrame(ctx, f, cvs.width, cvs.height, ppc, i === wallSelectedIdx);
  });

  // Guias de alinhamento (só ao arrastar)
  if (wallDragging && wallGuidesEnabled && wallSelectedIdx >= 0) {
    _wallDrawGuides(ctx, cvs.width, cvs.height);
  }

  // Marca d'agua acima da simulacao exportada
  _wallDrawWatermark(ctx, cvs.width, cvs.height);

}

let wallWatermarkCustomLogoImg = null; // imagem carregada pelo usuário

function _wallGetLogoImg() {
  // Prioridade 1: logo carregada pelo usuário via upload
  if (wallWatermarkCustomLogoImg && wallWatermarkCustomLogoImg.complete && wallWatermarkCustomLogoImg.naturalWidth) {
    return wallWatermarkCustomLogoImg;
  }
  // Prioridade 2: logo_branco.png (carregada uma vez e cacheada)
  if (!wallWatermarkLogoImg) {
    wallWatermarkLogoImg = new Image();
    wallWatermarkLogoImg.onload = () => { if (wallWatermarkEnabled && wallWatermarkMode === 'logo') renderWall(); };
    wallWatermarkLogoImg.src = '/static/logo_branco.png';
  }
  return wallWatermarkLogoImg;
}

function wallLoadCustomLogoWatermark(e) {
  const file = e.target.files && e.target.files[0];
  if (!file || !file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
    img.onload = () => {
      wallWatermarkCustomLogoImg = img;
      _wallUpdateLogoPreview(img.src);
      if (wallWatermarkEnabled && wallWatermarkMode === 'logo') renderWall();
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
  // Limpar input para permitir recarregar o mesmo arquivo
  e.target.value = '';
}

function wallResetLogoWatermark() {
  wallWatermarkCustomLogoImg = null;
  _wallUpdateLogoPreview(null);
  if (wallWatermarkEnabled && wallWatermarkMode === 'logo') renderWall();
}

function _wallUpdateLogoPreview(src) {
  const el = document.getElementById('wallWmLogoPreview');
  if (!el) return;
  if (src) {
    el.innerHTML = `<img src="${src}" style="max-height:40px;max-width:100%;border-radius:4px;border:1px solid var(--border2);background:#fff;padding:2px">`;
  } else {
    el.innerHTML = '<span style="font-size:10px;color:var(--gray)">Logo padrão do sistema</span>';
  }
}

function _wallDrawWatermark(ctx, cW, cH) {
  if (!wallWatermarkEnabled) return;

  const x = Math.max(0, Math.min(cW, (wallWatermarkXPct / 100) * cW));
  const y = Math.max(0, Math.min(cH, (wallWatermarkYPct / 100) * cH));
  const angle = (wallWatermarkRotationDeg * Math.PI) / 180;

  if (wallWatermarkMode === 'logo') {
    const logoImg = _wallGetLogoImg();
    if (!logoImg || !logoImg.complete || !logoImg.naturalWidth) return;
    const imgW = Math.max(20, Math.round(cW * (Math.max(1.5, wallWatermarkSizePct) / 100)));
    const imgH = Math.round(imgW * (logoImg.naturalHeight / logoImg.naturalWidth));

    // Renderiza logo + sombra num canvas offscreen para que o globalAlpha
    // se aplique ao conjunto (evita sombra visível quando opacidade é baixa)
    const pad = 20;
    const off = document.createElement('canvas');
    off.width  = imgW + pad * 2;
    off.height = imgH + pad * 2;
    const octx = off.getContext('2d');
    octx.filter = 'drop-shadow(0px 0px 4px rgba(0,0,0,0.7)) drop-shadow(0px 0px 8px rgba(0,0,0,0.4))';
    octx.drawImage(logoImg, pad, pad, imgW, imgH);
    octx.filter = 'none';

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.globalAlpha = wallWatermarkOpacity;
    ctx.drawImage(off, -(imgW / 2) - pad, -(imgH / 2) - pad);
    ctx.globalAlpha = 1;
    ctx.restore();
    return;
  }

  // Modo texto
  const txt = String(wallWatermarkText || '').trim();
  if (!txt) return;
  const fontPx = Math.max(14, Math.round(cW * (Math.max(1.5, wallWatermarkSizePct) / 100)));

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.font = `700 ${fontPx}px 'Avenir','Nunito',sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.globalAlpha = wallWatermarkOpacity;
  // Borda clara melhora leitura em paredes escuras
  ctx.lineWidth = Math.max(2, Math.round(fontPx * 0.09));
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.strokeText(txt, 0, 0);

  // Preenchimento para inibir reutilizacao indevida
  ctx.fillStyle = 'rgba(20,36,62,0.9)';
  ctx.fillText(txt, 0, 0);
  ctx.globalAlpha = 1;
  ctx.restore();
}

function _wallGetWatermarkBox(cvs) {
  if (!cvs || !wallWatermarkEnabled) return null;

  const cW = cvs.width;
  const cH = cvs.height;
  const x = Math.max(0, Math.min(cW, (wallWatermarkXPct / 100) * cW));
  const y = Math.max(0, Math.min(cH, (wallWatermarkYPct / 100) * cH));
  const angle = (wallWatermarkRotationDeg * Math.PI) / 180;

  if (wallWatermarkMode === 'logo') {
    const logoImg = _wallGetLogoImg();
    if (!logoImg || !logoImg.naturalWidth) return null;
    const imgW = Math.max(20, Math.round(cW * (Math.max(1.5, wallWatermarkSizePct) / 100)));
    const imgH = Math.round(imgW * (logoImg.naturalHeight / logoImg.naturalWidth));
    const halfW = imgW / 2;
    const halfH = imgH / 2;
    const cosA = Math.abs(Math.cos(angle));
    const sinA = Math.abs(Math.sin(angle));
    const aabbHalfW = (halfW * cosA) + (halfH * sinA);
    const aabbHalfH = (halfW * sinA) + (halfH * cosA);
    return { x, y, left: x - aabbHalfW, right: x + aabbHalfW, top: y - aabbHalfH, bottom: y + aabbHalfH };
  }

  // Modo texto
  const txt = String(wallWatermarkText || '').trim();
  if (!txt) return null;

  const fontPx = Math.max(14, Math.round(cW * (Math.max(1.5, wallWatermarkSizePct) / 100)));
  const ctx = cvs.getContext('2d');
  ctx.save();
  ctx.font = `700 ${fontPx}px 'Avenir','Nunito',sans-serif`;
  const m = ctx.measureText(txt);
  ctx.restore();

  // Fallbacks para navegadores sem actualBoundingBox
  const textW = Math.max(10, m.width || (txt.length * fontPx * 0.55));
  const textH = Math.max(10, (m.actualBoundingBoxAscent || fontPx * 0.72) + (m.actualBoundingBoxDescent || fontPx * 0.28));
  const pad = Math.max(8, Math.round(fontPx * 0.24));

  // Caixa alinhada ao eixo que envolve o texto rotacionado
  const halfW = (textW / 2) + pad;
  const halfH = (textH / 2) + pad;
  const cosA = Math.abs(Math.cos(angle));
  const sinA = Math.abs(Math.sin(angle));
  const aabbHalfW = (halfW * cosA) + (halfH * sinA);
  const aabbHalfH = (halfW * sinA) + (halfH * cosA);

  return {
    x,
    y,
    left: x - aabbHalfW,
    right: x + aabbHalfW,
    top: y - aabbHalfH,
    bottom: y + aabbHalfH,
  };
}

function _wallWatermarkHitTest(px, py, cvs) {
  const b = _wallGetWatermarkBox(cvs);
  if (!b) return false;
  return px >= b.left && px <= b.right && py >= b.top && py <= b.bottom;
}

function _wallUpdateWatermarkUI() {
  const cb = document.getElementById('wallWmEnabled');
  const lockCb = document.getElementById('wallWmLock');
  const txt = document.getElementById('wallWmText');
  const sz = document.getElementById('wallWmSize');
  const xp = document.getElementById('wallWmX');
  const yp = document.getElementById('wallWmY');
  const rot = document.getElementById('wallWmRot');
  const szL = document.getElementById('wallWmSizeL');
  const xL = document.getElementById('wallWmXL');
  const yL = document.getElementById('wallWmYL');
  const rotL = document.getElementById('wallWmRotL');
  const centerBtn = document.getElementById('wallWmCenterBtn');

  if (cb) cb.checked = wallWatermarkEnabled;
  if (lockCb) lockCb.checked = wallWatermarkLocked;
  if (txt) txt.value = wallWatermarkText;
  if (sz) sz.value = String(wallWatermarkSizePct);
  if (xp) xp.value = String(wallWatermarkXPct);
  if (yp) yp.value = String(wallWatermarkYPct);
  if (rot) rot.value = String(wallWatermarkRotationDeg);
  if (szL) szL.textContent = wallWatermarkSizePct.toFixed(1) + '%';
  if (xL) xL.textContent = Math.round(wallWatermarkXPct) + '%';
  if (yL) yL.textContent = Math.round(wallWatermarkYPct) + '%';
  if (rotL) rotL.textContent = Math.round(wallWatermarkRotationDeg) + '°';
  const opc = document.getElementById('wallWmOpacity');
  const opcL = document.getElementById('wallWmOpacityL');
  if (opc) opc.value = String(Math.round(wallWatermarkOpacity * 100));
  if (opcL) opcL.textContent = Math.round(wallWatermarkOpacity * 100) + '%';

  // Sincronizar botões de modo
  const modeText = document.getElementById('wallWmModeText');
  const modeLogo = document.getElementById('wallWmModeLogo');
  const textRow = document.getElementById('wallWmTextRow');
  const logoRow = document.getElementById('wallWmLogoRow');
  const isLogo = (wallWatermarkMode === 'logo');
  if (modeText) modeText.checked = !isLogo;
  if (modeLogo) modeLogo.checked = isLogo;
  if (textRow) textRow.style.display = isLogo ? 'none' : '';
  if (logoRow) logoRow.style.display = isLogo ? '' : 'none';

  const enabled = wallWatermarkEnabled;
  if (txt) txt.disabled = !enabled;
  if (sz) sz.disabled = !enabled;
  if (xp) xp.disabled = !enabled;
  if (yp) yp.disabled = !enabled;
  if (rot) rot.disabled = !enabled;
  if (centerBtn) centerBtn.disabled = !enabled;
  if (centerBtn) centerBtn.style.opacity = enabled ? '1' : '.55';
  if (lockCb) lockCb.disabled = !enabled;
  if (modeText) modeText.disabled = !enabled;
  if (modeLogo) modeLogo.disabled = !enabled;
  const opc2 = document.getElementById('wallWmOpacity');
  if (opc2) opc2.disabled = !enabled;

  const cvs = document.getElementById('wallCanvas');
  if (cvs && enabled && !wallWatermarkLocked) {
    // Cursor fica default; o hover muda para grab quando passa na marca
  }
}

function wallSetWatermarkMode(mode) {
  wallWatermarkMode = (mode === 'logo') ? 'logo' : 'text';
  _wallUpdateWatermarkUI();
  renderWall();
}

function toggleWallWatermark() {
  const cb = document.getElementById('wallWmEnabled');
  wallWatermarkEnabled = !!(cb && cb.checked);
  if (!wallWatermarkEnabled) wallWatermarkDragging = false;
  _wallUpdateWatermarkUI();
  renderWall();
}

function toggleWallWatermarkLock() {
  const cb = document.getElementById('wallWmLock');
  wallWatermarkLocked = !!(cb && cb.checked);
  if (wallWatermarkLocked) wallWatermarkDragging = false;
  _wallUpdateWatermarkUI();
  renderWall();
}

function wallCenterWatermark() {
  wallWatermarkXPct = 50;
  wallWatermarkYPct = 50;
  _wallUpdateWatermarkUI();
  renderWall();
}

function wallSetWatermarkText(v) {
  wallWatermarkText = String(v || '').slice(0, 64);
  _wallUpdateWatermarkUI();
  renderWall();
}

function wallSetWatermarkSize(v) {
  const n = parseFloat(v);
  wallWatermarkSizePct = Math.max(0.5, isFinite(n) ? n : wallWatermarkSizePct);
  _wallUpdateWatermarkUI();
  renderWall();
}

function wallSetWatermarkX(v) {
  const n = parseFloat(v);
  wallWatermarkXPct = Math.max(0, Math.min(100, isFinite(n) ? n : wallWatermarkXPct));
  _wallUpdateWatermarkUI();
  renderWall();
}

function wallSetWatermarkY(v) {
  const n = parseFloat(v);
  wallWatermarkYPct = Math.max(0, Math.min(100, isFinite(n) ? n : wallWatermarkYPct));
  _wallUpdateWatermarkUI();
  renderWall();
}

function wallSetWatermarkRotation(v) {
  const n = parseFloat(v);
  wallWatermarkRotationDeg = Math.max(-60, Math.min(60, isFinite(n) ? n : wallWatermarkRotationDeg));
  _wallUpdateWatermarkUI();
  renderWall();
}

function wallSetWatermarkOpacity(v) {
  const n = parseFloat(v);
  wallWatermarkOpacity = Math.max(0, Math.min(1, isFinite(n) ? n / 100 : wallWatermarkOpacity));
  _wallUpdateWatermarkUI();
  renderWall();
}

function _wallDrawFrame(ctx, f, cW, cH, ppc, isSelected) {
  const xP = f.xP / 100;
  const yP = f.yP / 100;
  // Tamanho da imagem em px
  const fw = Math.round(f.wCm * ppc);
  const fh = Math.round(f.hCm * ppc);
  const fx = Math.round(xP * cW - fw / 2);
  const fy = Math.round(yP * cH - fh / 2);
  const sl = f.shadow;

  // Espessura real da moldura em px (igual ao simulador de quadros)
  const frameWcm = f.frameW || 0;
  const frameWpx = Math.round(frameWcm * ppc);

  // Passepartout em px
  const ppCm = (f.ppOn && f.ppSize) ? f.ppSize : 0;
  const ppPx = Math.round(ppCm * ppc);

  // Caixa total (imagem + pp + moldura)
  const totalX = fx - ppPx - frameWpx;
  const totalY = fy - ppPx - frameWpx;
  const totalW = fw + (ppPx + frameWpx) * 2;
  const totalH = fh + (ppPx + frameWpx) * 2;

  // ── Sombra sobre a caixa total ──
  if (sl > 0) {
    const blurs  = [0, 10, 22, 40][sl];
    const offs   = [0,  5, 12, 24][sl];
    const alphas = [0, .28, .48, .65][sl];
    ctx.save();
    ctx.shadowColor = `rgba(0,0,0,${alphas})`;
    ctx.shadowBlur = blurs;
    ctx.shadowOffsetX = offs;
    ctx.shadowOffsetY = offs;
    ctx.fillStyle = '#000';
    ctx.fillRect(totalX, totalY, totalW, totalH);
    ctx.restore();
  }

  // ── Moldura física (fundo colorido, bisel 3D) ──
  if (frameWpx > 0 && f.frameColor) {
    ctx.fillStyle = f.frameColor;
    ctx.fillRect(totalX, totalY, totalW, totalH);

    // Bisel interno (efeito 3D)
    const bevel = Math.max(2, frameWpx * 0.14);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath();
    ctx.moveTo(totalX, totalY);
    ctx.lineTo(totalX + totalW, totalY);
    ctx.lineTo(totalX + totalW - bevel, totalY + bevel);
    ctx.lineTo(totalX + bevel, totalY + bevel);
    ctx.closePath(); ctx.fill();

    ctx.beginPath();
    ctx.moveTo(totalX, totalY);
    ctx.lineTo(totalX + bevel, totalY + bevel);
    ctx.lineTo(totalX + bevel, totalY + totalH - bevel);
    ctx.lineTo(totalX, totalY + totalH);
    ctx.closePath(); ctx.fill();

    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath();
    ctx.moveTo(totalX + totalW, totalY + totalH);
    ctx.lineTo(totalX, totalY + totalH);
    ctx.lineTo(totalX + bevel, totalY + totalH - bevel);
    ctx.lineTo(totalX + totalW - bevel, totalY + totalH - bevel);
    ctx.closePath(); ctx.fill();

    ctx.beginPath();
    ctx.moveTo(totalX + totalW, totalY + totalH);
    ctx.lineTo(totalX + totalW - bevel, totalY + totalH - bevel);
    ctx.lineTo(totalX + totalW - bevel, totalY + bevel);
    ctx.lineTo(totalX + totalW, totalY);
    ctx.closePath(); ctx.fill();
  }

  // ── Passepartout ──
  if (ppPx > 0) {
    ctx.fillStyle = f.ppColor || '#FFFFFF';
    ctx.fillRect(
      totalX + frameWpx,
      totalY + frameWpx,
      totalW - frameWpx * 2,
      totalH - frameWpx * 2
    );
    // Chanfro sutil na borda interna do passepartout
    if (ppPx > 3) {
      const ppBevel = Math.max(1, ppPx * 0.06);
      ctx.strokeStyle = 'rgba(0,0,0,0.12)';
      ctx.lineWidth = ppBevel;
      ctx.strokeRect(
        fx - ppBevel / 2, fy - ppBevel / 2,
        fw + ppBevel, fh + ppBevel
      );
    }
  }

  // ── Imagem ──
  ctx.drawImage(f.img, fx, fy, fw, fh);

  // ── Linha fina de acabamento (sem moldura física, só traço) ──
  if (frameWpx === 0 && f.frameColor) {
    const bw = Math.max(1.5, fw * 0.012);
    ctx.strokeStyle = f.frameColor;
    ctx.lineWidth = bw;
    ctx.strokeRect(fx + bw / 2, fy + bw / 2, fw - bw, fh - bw);
  }

}

function _wallDrawHandles(ctx, f, cW, cH, ppc) {
  const xP = f.xP / 100, yP = f.yP / 100;
  const fw = Math.round(f.wCm * ppc), fh = Math.round(f.hCm * ppc);
  const ppPx = f.ppOn ? Math.round((f.ppSize || 3) * ppc) : 0;
  const frameWpx = Math.round((f.frameW || 0) * ppc);
  const fx = Math.round(xP * cW - fw / 2) - ppPx - frameWpx;
  const fy = Math.round(yP * cH - fh / 2) - ppPx - frameWpx;
  const bw = fw + (ppPx + frameWpx) * 2, bh = fh + (ppPx + frameWpx) * 2;
  const R = 6;
  const handles = [
    { x: fx,       y: fy,       cursor: 'nw-resize' },
    { x: fx+bw/2,  y: fy,       cursor: 'n-resize'  },
    { x: fx+bw,    y: fy,       cursor: 'ne-resize'  },
    { x: fx+bw,    y: fy+bh/2,  cursor: 'e-resize'   },
    { x: fx+bw,    y: fy+bh,    cursor: 'se-resize'  },
    { x: fx+bw/2,  y: fy+bh,    cursor: 's-resize'   },
    { x: fx,       y: fy+bh,    cursor: 'sw-resize'  },
    { x: fx,       y: fy+bh/2,  cursor: 'w-resize'   },
  ];
  handles.forEach(h => {
    ctx.beginPath();
    ctx.arc(h.x, h.y, R, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.strokeStyle = 'rgba(178,34,34,0.9)';
    ctx.lineWidth = 2;
    ctx.stroke();
  });
}

function _wallDrawGuides(ctx, cW, cH) {
  const f = wallFrames[wallSelectedIdx];
  if (!f) return;
  const ppc = cW / 300;
  const xPx = Math.round(f.xP / 100 * cW);
  const fw = Math.round(f.wCm * ppc), fh = Math.round(f.hCm * ppc);
  const ppPx = f.ppOn ? Math.round((f.ppSize || 3) * ppc) : 0;
  const frameWpx = Math.round((f.frameW || 0) * ppc);
  const fy = Math.round(f.yP / 100 * cH - fh / 2) - ppPx - frameWpx;
  const bh = fh + (ppPx + frameWpx) * 2;
  const yBottom = fy + bh;

  ctx.save();
  ctx.strokeStyle = 'rgba(0, 0, 0, 1)';
  ctx.lineWidth = 0.25;
  ctx.setLineDash([]);

  // Linha vertical pelo centro do quadro
  ctx.beginPath();
  ctx.moveTo(xPx, 0);
  ctx.lineTo(xPx, cH);
  ctx.stroke();

  // Linha horizontal na base do quadro (ajuda no alinhamento lateral)
  ctx.beginPath();
  ctx.moveTo(0, yBottom);
  ctx.lineTo(cW, yBottom);
  ctx.stroke();

  ctx.restore();
}

// ── Hit-test: qual quadro está sob o ponto? ───────────────

function _wallHitTest(px, py, cW, cH, ppc) {
  // Testar do mais novo para o mais velho (topo da pilha)
  for (let i = wallFrames.length - 1; i >= 0; i--) {
    const f = wallFrames[i];
    const xP = f.xP / 100, yP = f.yP / 100;
    const fw = Math.round(f.wCm * ppc), fh = Math.round(f.hCm * ppc);
    const ppPx = f.ppOn ? Math.round((f.ppSize || 3) * ppc) : 0;
    const frameWpx = Math.round((f.frameW || 0) * ppc);
    const fx = Math.round(xP * cW - fw / 2) - ppPx - frameWpx;
    const fy = Math.round(yP * cH - fh / 2) - ppPx - frameWpx;
    const bw = fw + (ppPx + frameWpx) * 2, bh = fh + (ppPx + frameWpx) * 2;
    if (px >= fx && px <= fx + bw && py >= fy && py <= fy + bh) {
      return i;
    }
  }
  return -1;
}

function _wallGetHandle(px, py, f, cW, cH, ppc) {
  const xP = f.xP / 100, yP = f.yP / 100;
  const fw = Math.round(f.wCm * ppc), fh = Math.round(f.hCm * ppc);
  const ppPx = f.ppOn ? Math.round((f.ppSize || 3) * ppc) : 0;
  const frameWpx = Math.round((f.frameW || 0) * ppc);
  const fx = Math.round(xP * cW - fw / 2) - ppPx - frameWpx;
  const fy = Math.round(yP * cH - fh / 2) - ppPx - frameWpx;
  const bw = fw + (ppPx + frameWpx) * 2, bh = fh + (ppPx + frameWpx) * 2;
  const R = 10;
  const handles = [
    { x: fx,       y: fy,       name: 'nw' },
    { x: fx+bw/2,  y: fy,       name: 'n'  },
    { x: fx+bw,    y: fy,       name: 'ne' },
    { x: fx+bw,    y: fy+bh/2,  name: 'e'  },
    { x: fx+bw,    y: fy+bh,    name: 'se' },
    { x: fx+bw/2,  y: fy+bh,    name: 's'  },
    { x: fx,       y: fy+bh,    name: 'sw' },
    { x: fx,       y: fy+bh/2,  name: 'w'  },
  ];
  for (const h of handles) {
    if (Math.abs(px - h.x) < R && Math.abs(py - h.y) < R) return h.name;
  }
  return null;
}

// ── Eventos do canvas ─────────────────────────────────────

function _wallCanvasPos(e, cvs) {
  const rect = cvs.getBoundingClientRect();
  const scaleX = cvs.width / rect.width;
  const scaleY = cvs.height / rect.height;
  const touch = e.touches ? e.touches[0] : e;
  return {
    x: (touch.clientX - rect.left) * scaleX,
    y: (touch.clientY - rect.top)  * scaleY,
  };
}

function wallInitDrag() {
  const cvs = document.getElementById('wallCanvas');
  if (!cvs) return;
  if (cvs._wallDragInited) return;
  cvs._wallDragInited = true;

  function getPPC() { return cvs.width / 300; }

  function onDown(e) {
    if (!wEnvImg) return;
    e.preventDefault();
    const { x, y } = _wallCanvasPos(e, cvs);
    const ppc = getPPC();
    const cW = cvs.width, cH = cvs.height;

    // Prioridade: se clicou na marca d'agua, arrastar marca
    if (_wallWatermarkHitTest(x, y, cvs) && !wallWatermarkLocked) {
      const box = _wallGetWatermarkBox(cvs);
      if (box) {
        wallWatermarkDragging = true;
        wallWatermarkDragOffX = x - box.x;
        wallWatermarkDragOffY = y - box.y;
        cvs.style.cursor = 'grabbing';
        return;
      }
    }

    if (!wallFrames.length) return;

    // Hit-test para selecionar/arrastar
    const hit = _wallHitTest(x, y, cW, cH, ppc);
    if (hit >= 0) {
      wallSelectFrame(hit);
      if (wallCompositionLocked && wallFrames.length > 1) {
        wallGroupDragging = true;
        wallGroupDragState = {
          startX: x,
          startY: y,
          frames: wallFrames.map((fr) => ({ xP: fr.xP, yP: fr.yP })),
        };
        cvs.style.cursor = 'grabbing';
        return;
      }
      const f = wallFrames[hit];
      const fx = f.xP / 100 * cW;
      const fy = f.yP / 100 * cH;
      wallDragOffX = x - fx;
      wallDragOffY = y - fy;
      wallDragging = true;
      cvs.style.cursor = 'grabbing';
    } else {
      // Clique no vazio → desselecionar
      wallSelectedIdx = -1;
      _wallUpdatePanelFromSelected();
      renderWall();
      _wallRenderPanel();
    }
  }

  function onMove(e) {
    if (!wEnvImg) return;
    const { x, y } = _wallCanvasPos(e, cvs);
    const ppc = getPPC();
    const cW = cvs.width, cH = cvs.height;

    if (wallWatermarkDragging) {
      e.preventDefault();
      const nx = x - wallWatermarkDragOffX;
      const ny = y - wallWatermarkDragOffY;
      wallWatermarkXPct = Math.max(0, Math.min(100, (nx / cW) * 100));
      wallWatermarkYPct = Math.max(0, Math.min(100, (ny / cH) * 100));
      _wallUpdateWatermarkUI();
      renderWall();
      return;
    }

    if (wallGroupDragging && wallGroupDragState) {
      e.preventDefault();
      const dxP = ((x - wallGroupDragState.startX) / cW) * 100;
      const dyP = ((y - wallGroupDragState.startY) / cH) * 100;
      wallFrames.forEach((f, i) => {
        const base = wallGroupDragState.frames[i];
        if (!base) return;
        f.xP = Math.max(2, Math.min(98, base.xP + dxP));
        f.yP = Math.max(2, Math.min(98, base.yP + dyP));
      });
      _wallUpdatePanelFromSelected();
      renderWall();
      return;
    }

    if (wallDragging && wallSelectedIdx >= 0) {
      e.preventDefault();
      const f = wallFrames[wallSelectedIdx];
      const newX = x - wallDragOffX;
      const newY = y - wallDragOffY;
      f.xP = Math.max(2, Math.min(98, newX / cW * 100));
      f.yP = Math.max(2, Math.min(98, newY / cH * 100));

      // Snap ao centro (±1.5%)
      if (Math.abs(f.xP - 50) < 1.5) f.xP = 50;
      if (Math.abs(f.yP - 50) < 1.5) f.yP = 50;
      if (Math.abs(f.yP - 38) < 1.5) f.yP = 38;

      _wallUpdatePanelFromSelected();
      renderWall();
      return;
    }

    // Cursor hover
    const hit = _wallHitTest(x, y, cW, cH, ppc);
    if (hit >= 0) {
      cvs.style.cursor = 'grab';
      return;
    }
    if (_wallWatermarkHitTest(x, y, cvs) && !wallWatermarkLocked) {
      cvs.style.cursor = 'grab';
      return;
    }
    cvs.style.cursor = 'default';
  }

  function onUp() {
    if (wallDragging || wallResizing || wallGroupDragging || wallWatermarkDragging) {
      wallDragging = false;
      wallResizing = false;
      wallGroupDragging = false;
      wallWatermarkDragging = false;
      wallGroupDragState = null;
      wallResizeStartFrame = null;
      _wallRenderPanel();
      _wallUpdatePanelFromSelected();
      renderWall();
    }
    const cvs2 = document.getElementById('wallCanvas');
    if (cvs2) cvs2.style.cursor = 'default';
  }

  cvs.addEventListener('mousedown',  onDown, { passive: false });
  cvs.addEventListener('mousemove',  onMove, { passive: false });
  cvs.addEventListener('mouseup',    onUp);
  cvs.addEventListener('mouseleave', onUp);
  cvs.addEventListener('touchstart', onDown, { passive: false });
  cvs.addEventListener('touchmove',  onMove, { passive: false });
  cvs.addEventListener('touchend',   onUp);
}

// ── Funções públicas que o resto do código chama ──────────

function checkWall() {
  const changeBtn = document.getElementById('wChangeEnvBtn');
  if (!wEnvImg) {
    if (changeBtn) changeBtn.style.display = 'none';
    return;
  }
  if (changeBtn) changeBtn.style.display = 'inline-flex';
  document.getElementById('wPh').style.display = 'none';
  document.getElementById('wallCanvas').style.display = 'block';

  if (wallFrames.length > 0) {
    document.getElementById('wControls').style.display = 'block';
    renderWall();
  } else {
    // Só mostra fundo sem quadros
    const c = document.getElementById('wallCanvas');
    const mw = c.parentElement.offsetWidth - 32;
    c.width = mw;
    c.height = Math.round(wEnvImg.naturalHeight * mw / wEnvImg.naturalWidth);
    c.getContext('2d').drawImage(wEnvImg, 0, 0, c.width, c.height);
  }
}

function togglePP() {
  const f = wallFrames[wallSelectedIdx];
  ppActive = document.getElementById('ppEnabled').checked;
  if (f) f.ppOn = ppActive;
  document.getElementById('ppControls').style.display = ppActive ? 'block' : 'none';
  renderWall();
}

function setPPColor(color, idx) {
  ppColor = color;
  document.getElementById('ppColorPicker').value = color;
  for (let i = 0; i < 7; i++) {
    const sw = document.getElementById('ppSw' + i);
    if (sw) sw.classList.toggle('active', i === idx);
  }
  const f = wallFrames[wallSelectedIdx];
  if (f) f.ppColor = color;
  renderWall();
}

function setWallFrameColor(c) {
  wallFrameColor = c;
  const f = wallFrames[wallSelectedIdx];
  if (f) f.frameColor = c;
  // atualizar picker
  const pick = document.getElementById('wFrameColorPicker');
  if (pick) pick.value = c || '#3C2F1E';
  renderWall();
}

function wallSetFrameW(val) {
  const f = wallFrames[wallSelectedIdx];
  if (!f) return;
  f.frameW = parseFloat(val) || 0;
  // sincronizar slider e input
  const sl = document.getElementById('wFrameW');
  const inp = document.getElementById('wFrameWInput');
  const lbl = document.getElementById('wFrameWL');
  if (sl)  sl.value = f.frameW;
  if (inp) inp.value = f.frameW;
  if (lbl) lbl.textContent = f.frameW + 'cm';
  renderWall();
}

function wallSetSizeFromInput() {
  const f = wallFrames[wallSelectedIdx];
  if (!f) return;
  const wInp = document.getElementById('wWInput');
  const hInp = document.getElementById('wHInput');
  const wVal = parseFloat(wInp?.value);
  const hVal = parseFloat(hInp?.value);
  if (wVal > 0) { f.wCm = wVal; const sl = document.getElementById('wW'); if (sl) sl.value = wVal; const lb = document.getElementById('wWL'); if (lb) lb.textContent = wVal + 'cm'; }
  if (hVal > 0) { f.hCm = hVal; const sl = document.getElementById('wH'); if (sl) sl.value = hVal; const lb = document.getElementById('wHL'); if (lb) lb.textContent = hVal + 'cm'; }
  _wallRenderPanel();
  renderWall();
}

function renderWallFromSliders() {
  _wallApplyPanelToSelected();
  renderWall();
  _wallRenderPanel();
}

function toggleWallGuides() {
  wallGuidesEnabled = !wallGuidesEnabled;
  const btn = document.getElementById('wallGuidesBtn');
  if (btn) {
    btn.style.background = wallGuidesEnabled ? 'rgba(178,34,34,0.85)' : 'rgba(26,48,81,0.85)';
    btn.title = wallGuidesEnabled ? 'Guias ativadas (clique para desativar)' : 'Guias desativadas (clique para ativar)';
    btn.textContent = wallGuidesEnabled ? '⊕ Guias ON' : '⊕ Guias OFF';
  }
}

function loadArt(e) {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;

  files.forEach((file) => {
    const run = (blob) => {
      const img = new Image();
      img.onload = () => wallAddFrame(img);
      img.src = URL.createObjectURL(blob);
    };
    (file.type === 'image/heic' || file.type === 'image/heif')
      ? heic2any({ blob: file, toType: 'image/jpeg', quality: .9 }).then(run)
      : run(file);
  });

  // Reset input para permitir carregar mesmo arquivo
  e.target.value = '';
}

function dlWall(fmt) {
  if (!wEnvImg) return toast('Carregue o ambiente primeiro.');
  if (!wallFrames.length) return toast('Adicione ao menos um quadro primeiro.');
  const cvs = document.getElementById('wallCanvas');
  if (fmt === 'pdf') {
    askFileName('simulacao-ambiente', (finalName) => { exportPDFsave(cvs, finalName); toast('PDF de simulação baixado!'); });
  } else {
    askFileName('simulacao-ambiente', (finalName) => {
      cvs.toBlob(b => { _saveAs(b, finalName, 'image/jpeg').then(() => toast('JPEG de simulação baixado!')); }, 'image/jpeg', .93);
    });
  }
}

// ── Compatibilidade com salvar/restaurar atendimento ──────

function _coletarImagemArteAmbienteBase64() {
  // Salva apenas o primeiro quadro por compatibilidade
  const f = wallFrames[0];
  if (!f || !f.img) return '';
  return _imgElementParaBase64(f.img, 0.86);
}

function _restaurarAmbienteDaConsulta(item) {
  if (!item) return;
  const cfg = item.config || {};
  const t = cfg.tamanho || {};

  if (t.pos_x !== undefined) document.getElementById('wX').value = t.pos_x;
  if (t.pos_y !== undefined) document.getElementById('wY').value = t.pos_y;
  if (t.sombra !== undefined) document.getElementById('wS').value = t.sombra;
  if (t.passepartout_ativo !== undefined) document.getElementById('ppEnabled').checked = Boolean(t.passepartout_ativo);
  if (t.passepartout_cm !== undefined) document.getElementById('ppSize').value = t.passepartout_cm;
  if (t.passepartout_cor && typeof ppColor !== 'undefined') ppColor = t.passepartout_cor;
  if (t.moldura_cor && typeof wallFrameColor !== 'undefined') wallFrameColor = t.moldura_cor;
  if (t.largura_cm !== undefined) document.getElementById('wW').value = t.largura_cm;
  if (t.altura_cm !== undefined) document.getElementById('wH').value = t.altura_cm;

  const envBase64 = cfg.imagem_ambiente_base64 || '';
  const artBase64 = cfg.imagem_arte_base64 || '';

  const finalizar = () => {
    if (typeof checkWall === 'function') checkWall();
    if (typeof renderWall === 'function') renderWall();
  };

  if (envBase64 && artBase64) {
    const envImg = new Image();
    const artImg = new Image();
    let okEnv = false, okArt = false;
    const maybeDone = () => {
      if (!okEnv || !okArt) return;
      wEnvImg = envImg;
      wallFrames = [_wallDefaultFrame(artImg)];
      if (t.largura_cm) wallFrames[0].wCm = t.largura_cm;
      if (t.altura_cm) wallFrames[0].hCm = t.altura_cm;
      if (t.pos_x) wallFrames[0].xP = t.pos_x;
      if (t.pos_y) wallFrames[0].yP = t.pos_y;
      wallSelectedIdx = 0;
      wArtImg = artImg;
      finalizar();
      _wallRenderPanel();
      _wallUpdatePanelFromSelected();
    };
    envImg.onload = () => { okEnv = true; maybeDone(); };
    artImg.onload = () => { okArt = true; maybeDone(); };
    envImg.src = envBase64;
    artImg.src = artBase64;
    return;
  }
  finalizar();
}

// ── Copiar estilo do quadro selecionado para todos ─────────

function wallCopyStyleToAll() {
  const src = wallFrames[wallSelectedIdx];
  if (!src) return toast('Selecione um quadro primeiro.');
  if (wallFrames.length < 2) return toast('Adicione ao menos 2 quadros.');

  const isSplitComposition = Boolean(src._ffCompPanel === true && typeof ffSplitScaleWallCompositionFromFrame === 'function');

  wallFrames.forEach((f, i) => {
    if (i === wallSelectedIdx) return;
    f.frameColor = src.frameColor;
    f.frameW     = src.frameW;
    f.ppOn       = src.ppOn;
    f.ppColor    = src.ppColor;
    f.ppSize     = src.ppSize;
    f.shadow     = src.shadow;

    // Em quadro comum, copiar tamanho exato para todos.
    // Em composição split, o tamanho proporcional é aplicado abaixo.
    if (!isSplitComposition) {
      f.wCm = src.wCm;
      f.hCm = src.hCm;
    }
  });

  if (isSplitComposition) {
    try {
      ffSplitScaleWallCompositionFromFrame(src, { preserveCenter: true });
    } catch (_) { }
  }

  _wallUpdatePanelFromSelected();
  _wallRenderPanel();
  renderWall();
  toast('Estilo e tamanho aplicados para todos os ' + wallFrames.length + ' quadros!');
}


// ── Inicialização ─────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  _wallUpdateCompositionLockBtn();
  _wallUpdateWatermarkUI();
  // Inicializar drag após canvas estar visível
  const obs = new MutationObserver(() => {
    const cvs = document.getElementById('wallCanvas');
    if (cvs && cvs.offsetParent !== null) {
      wallInitDrag();
      obs.disconnect();
    }
  });
  obs.observe(document.body, { attributes: true, childList: true, subtree: true });

  // Também inicializa ao trocar para aba simulador
  const origSwitch = window.switchTab;
  if (origSwitch) {
    window.switchTab = function(id, btn) {
      origSwitch(id, btn);
      if (id === 'simulador') {
        setTimeout(() => {
          const cvs = document.getElementById('wallCanvas');
          if (cvs) wallInitDrag();
          renderWall();
        }, 50);
      }
    };
  }
});