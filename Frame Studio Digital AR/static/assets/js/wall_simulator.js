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
    if (!wEnvImg || !wallFrames.length) return;
    e.preventDefault();
    const { x, y } = _wallCanvasPos(e, cvs);
    const ppc = getPPC();
    const cW = cvs.width, cH = cvs.height;

    // Hit-test para selecionar/arrastar
    const hit = _wallHitTest(x, y, cW, cH, ppc);
    if (hit >= 0) {
      wallSelectFrame(hit);
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
    cvs.style.cursor = hit >= 0 ? 'grab' : 'default';
  }

  function onUp() {
    if (wallDragging || wallResizing) {
      wallDragging = false;
      wallResizing = false;
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
  wallFrames.forEach((f, i) => {
    if (i === wallSelectedIdx) return;
    f.frameColor = src.frameColor;
    f.frameW     = src.frameW;
    f.ppOn       = src.ppOn;
    f.ppColor    = src.ppColor;
    f.ppSize     = src.ppSize;
    f.shadow     = src.shadow;
  });
  renderWall();
  toast('Estilo copiado para todos os ' + wallFrames.length + ' quadros!');
}


// ── Inicialização ─────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
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