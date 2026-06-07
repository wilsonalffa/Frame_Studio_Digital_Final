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
let wallVisibleWidthCm = 300; // largura real (cm) da parede visível na foto
let wallVisibleHeightCm = 260; // altura real (cm) da parede entre teto e piso visíveis
let wallLeftXPct = 2; // borda esquerda da parede visível (% horizontal)
let wallRightXPct = 98; // borda direita da parede visível (% horizontal)
let wallCeilingYPct = 8; // topo da parede na foto (% vertical)
let wallFloorYPct = 82; // piso na foto (% vertical)
let wallFurnitureHeightCm = 0; // 0 = sem referência de móvel
let wallFurnitureTopYPct = 58;
let wallFurnitureBottomYPct = 78;
let wallFurnitureLeftXPct = 20;  // extremidade esquerda do móvel (%)
let wallFurnitureRightXPct = 80; // extremidade direita do móvel (%)
let wallSuggestMode = 'auto'; // auto|furniture|wall
let wallGoldenTargetPct = 67; // alvo dentro da regra de ouro (60-75%)
let wallCalibMarkMode = ''; // left|right|ceiling|floor|furnitureTop|furnitureBottom|furnitureLeft|furnitureRight
let wallCalibrationMarksVisible = true; // exibe/oculta marcações de calibração
let wallCalibMarks = {
  left: null,
  right: null,
  ceiling: null,
  floor: null,
  furnitureTop: null,
  furnitureBottom: null,
  furnitureLeft: null,
  furnitureRight: null,
};
const WALL_ESSENTIAL_MARKS = ['left', 'right', 'ceiling', 'floor'];
const WALL_GUIDED_MARKS = ['left', 'right', 'ceiling', 'floor', 'furnitureTop', 'furnitureBottom', 'furnitureLeft', 'furnitureRight'];
const WALL_GOLDEN_MIN_PCT = 60;
const WALL_GOLDEN_MAX_PCT = 75;
const WALL_AUTO_WALL_TARGET_PCT = 70;

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

function _wallClamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function _wallParseInputNum(id, min, max) {
  const el = document.getElementById(id);
  const val = parseFloat(el?.value);
  if (!isFinite(val)) return null;
  return _wallClamp(val, min, max);
}

function _wallCurrentCalibState(useInputValues = false) {
  const fromInput = (id, min, max, fallback) => {
    if (!useInputValues) return fallback;
    const parsed = _wallParseInputNum(id, min, max);
    return parsed == null ? fallback : parsed;
  };

  return {
    widthCm: fromInput('wallVisibleWidthCm', 80, 1200, wallVisibleWidthCm),
    heightCm: fromInput('wallVisibleHeightCm', 80, 600, wallVisibleHeightCm),
    leftX: fromInput('wallLeftXPct', 0, 95, wallLeftXPct),
    rightX: fromInput('wallRightXPct', 5, 100, wallRightXPct),
    ceilingY: fromInput('wallCeilingYPct', 0, 95, wallCeilingYPct),
    floorY: fromInput('wallFloorYPct', 5, 100, wallFloorYPct),
    furnitureCm: fromInput('wallFurnitureHeightCm', 0, 300, wallFurnitureHeightCm),
    furnitureTopY: fromInput('wallFurnitureTopYPct', 0, 99, wallFurnitureTopYPct),
    furnitureBottomY: fromInput('wallFurnitureBottomYPct', 1, 100, wallFurnitureBottomYPct),
    furnitureLeftX: fromInput('wallFurnitureLeftXPct', 0, 95, wallFurnitureLeftXPct),
    furnitureRightX: fromInput('wallFurnitureRightXPct', 5, 100, wallFurnitureRightXPct),
  };
}

function _wallGetScaleCandidates(cW, cH, useInputValues = false) {
  const cfg = _wallCurrentCalibState(useInputValues);
  const candidates = [];

  const wallWidthSpanPct = Math.max(0, cfg.rightX - cfg.leftX);
  if (cfg.widthCm > 0 && wallWidthSpanPct >= 5 && cW > 0) {
    const wallWidthSpanPx = (wallWidthSpanPct / 100) * cW;
    candidates.push({ label: 'largura', ppc: wallWidthSpanPx / cfg.widthCm });
  }

  const wallSpanPct = Math.max(0, cfg.floorY - cfg.ceilingY);
  if (cfg.heightCm > 0 && wallSpanPct >= 5 && cH > 0) {
    const wallSpanPx = (wallSpanPct / 100) * cH;
    candidates.push({ label: 'altura', ppc: wallSpanPx / cfg.heightCm });
  }

  const furnitureSpanPct = Math.max(0, cfg.furnitureBottomY - cfg.furnitureTopY);
  if (cfg.furnitureCm > 0 && furnitureSpanPct >= 3 && cH > 0) {
    const furnitureSpanPx = (furnitureSpanPct / 100) * cH;
    candidates.push({ label: 'móvel', ppc: furnitureSpanPx / cfg.furnitureCm });
  }

  return candidates.filter((c) => isFinite(c.ppc) && c.ppc > 0);
}

function _wallComputePpc(cW, cH, useInputValues = false) {
  const candidates = _wallGetScaleCandidates(cW, cH, useInputValues);
  if (!candidates.length) return { ppc: cW / 300, candidates: [] };

  const sorted = [...candidates].sort((a, b) => a.ppc - b.ppc);
  const mid = Math.floor(sorted.length / 2);
  const ppc = sorted.length % 2
    ? sorted[mid].ppc
    : (sorted[mid - 1].ppc + sorted[mid].ppc) / 2;

  return { ppc, candidates };
}

function _wallUpdateScaleInfo(ppc, candidates = []) {
  const info = document.getElementById('wallScaleInfo');
  if (!info) return;
  const pxCm = isFinite(ppc) && ppc > 0 ? ppc.toFixed(2) : '0.00';
  if (!candidates.length) {
    info.textContent = `Escala ativa: 1cm = ${pxCm}px (base padrão)`;
    return;
  }
  const src = candidates.map((c) => `${c.label} ${c.ppc.toFixed(2)}px/cm`).join(' · ');
  info.textContent = `Escala ativa: 1cm = ${pxCm}px | referências: ${src}`;
}

function _wallSyncCalibrationLabels() {
  const setText = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = `${Math.round(val)}%`;
  };
  setText('wallLeftXL', wallLeftXPct);
  setText('wallRightXL', wallRightXPct);
  setText('wallCeilingYL', wallCeilingYPct);
  setText('wallFloorYL', wallFloorYPct);
  setText('wallFurnitureTopYL', wallFurnitureTopYPct);
  setText('wallFurnitureBottomYL', wallFurnitureBottomYPct);
}

function _wallMarkModeLabel(mode) {
  switch (mode) {
    case 'left':          return 'borda esquerda da parede';
    case 'right':         return 'borda direita da parede';
    case 'ceiling':       return 'teto';
    case 'floor':         return 'piso';
    case 'furnitureTop':  return 'topo do móvel';
    case 'furnitureBottom': return 'base do móvel';
    case 'furnitureLeft': return 'extremidade esquerda do móvel';
    case 'furnitureRight': return 'extremidade direita do móvel';
    default: return '';
  }
}

// ppc derivado apenas do eixo vertical (piso-teto ou móvel)
function _wallGetVerticalPpc(cW, cH) {
  const cfg = _wallCurrentCalibState(false);
  const heightSpanPct = Math.max(0, cfg.floorY - cfg.ceilingY);
  if (cfg.heightCm > 0 && heightSpanPct >= 5 && cH > 0)
    return (heightSpanPct / 100) * cH / cfg.heightCm;
  const furSpanPct = Math.max(0, cfg.furnitureBottomY - cfg.furnitureTopY);
  if (cfg.furnitureCm > 0 && furSpanPct >= 3 && cH > 0)
    return (furSpanPct / 100) * cH / cfg.furnitureCm;
  return _wallComputePpc(cW, cH, false).ppc;
}

// ppc derivado apenas do eixo horizontal (largura da parede)
function _wallGetHorizontalPpc(cW, cH) {
  const cfg = _wallCurrentCalibState(false);
  const widthSpanPct = Math.max(0, cfg.rightX - cfg.leftX);
  if (cfg.widthCm > 0 && widthSpanPct >= 5 && cW > 0)
    return (widthSpanPct / 100) * cW / cfg.widthCm;
  return _wallComputePpc(cW, cH, false).ppc;
}

function _wallGetSelectedRatio() {
  if (wallSelectedIdx >= 0 && wallSelectedIdx < wallFrames.length) {
    const f = wallFrames[wallSelectedIdx];
    if (f && isFinite(f.wCm) && isFinite(f.hCm) && f.wCm > 0 && f.hCm > 0) {
      return f.wCm / f.hCm;
    }
  }
  return 3 / 2;
}

function _wallGetSuggestMode(useInputValues = false) {
  if (!useInputValues) return wallSuggestMode;
  const el = document.getElementById('wallSuggestMode');
  const val = String(el?.value || '').trim();
  if (val === 'furniture' || val === 'wall' || val === 'auto') return val;
  return wallSuggestMode;
}

function _wallGetGoldenTargetPct(useInputValues = false) {
  if (!useInputValues) return wallGoldenTargetPct;
  const parsed = _wallParseInputNum('wallGoldenTargetPct', WALL_GOLDEN_MIN_PCT, WALL_GOLDEN_MAX_PCT);
  return parsed == null ? wallGoldenTargetPct : parsed;
}

function _wallBuildSizeSuggestionForRatio(baseWidthCm, baseHeightCm, ratio, targetPct) {
  if (!isFinite(baseWidthCm) || !isFinite(baseHeightCm) || baseWidthCm <= 0 || baseHeightCm <= 0 || !isFinite(ratio) || ratio <= 0) {
    return null;
  }

  const minW = Math.round(Math.min(baseWidthCm * (WALL_GOLDEN_MIN_PCT / 100), baseHeightCm * (WALL_GOLDEN_MIN_PCT / 100) * ratio));
  const maxW = Math.round(Math.min(baseWidthCm * (WALL_GOLDEN_MAX_PCT / 100), baseHeightCm * (WALL_GOLDEN_MAX_PCT / 100) * ratio));
  const preferredW = Math.round(Math.min(baseWidthCm * (targetPct / 100), baseHeightCm * (targetPct / 100) * ratio));

  const safeMinW = Math.max(20, minW);
  const safeMaxW = Math.max(safeMinW, maxW);
  const safePreferredW = _wallClamp(preferredW, safeMinW, safeMaxW);
  const preferredH = Math.max(20, Math.round(safePreferredW / ratio));

  return {
    minWidthCm: safeMinW,
    maxWidthCm: safeMaxW,
    preferredWidthCm: safePreferredW,
    preferredHeightCm: preferredH,
  };
}

function _wallGetFurnitureSuggestion(cW, cH) {
  const fL = wallCalibMarks.furnitureLeft;
  const fR = wallCalibMarks.furnitureRight;
  if (!fL || !fR) return null;

  const hPpc = _wallGetHorizontalPpc(cW, cH);
  if (!isFinite(hPpc) || hPpc <= 0) return null;

  const xL = Math.round((fL.xPct / 100) * cW);
  const xR = Math.round((fR.xPct / 100) * cW);
  const yRef = Math.round(((fL.yPct + fR.yPct) / 2) / 100 * cH) + 14;
  const furnitureWidthCm = Math.round(Math.abs(xR - xL) / hPpc);
  if (!isFinite(furnitureWidthCm) || furnitureWidthCm <= 0) return null;

  const suggestedWidthCm = Math.max(28, Math.round(furnitureWidthCm * 0.70));
  const suggestedHeight3x2 = Math.max(20, Math.round(suggestedWidthCm * 2 / 3));
  const suggestedHeight4x3 = Math.max(20, Math.round(suggestedWidthCm * 3 / 4));
  const selectedRatio = _wallGetSelectedRatio();
  const suggestedHeightCurrentCm = Math.max(20, Math.round(suggestedWidthCm / selectedRatio));

  return {
    kind: 'furniture',
    xL,
    xR,
    yRef,
    furnitureWidthCm,
    suggestedWidthCm,
    suggestedHeight3x2,
    suggestedHeight4x3,
    suggestedHeightCurrentCm,
    panelText: `Móvel ≈ ${furnitureWidthCm} cm → Arte: ${suggestedWidthCm}×${suggestedHeight3x2}cm (3:2) ou ${suggestedWidthCm}×${suggestedHeight4x3}cm (4:3)`,
    overlayText: `📐 Móvel ≈ ${furnitureWidthCm}cm  →  Arte sugerida: ${suggestedWidthCm}×${suggestedHeight3x2}cm (3:2)  ou  ${suggestedWidthCm}×${suggestedHeight4x3}cm (4:3)`,
  };
}

function _wallGetWallGoldenSuggestion(cW, cH, useInputValues = false, forcedTargetPct = null) {
  const cfg = _wallCurrentCalibState(useInputValues);
  if (!isFinite(cfg.widthCm) || cfg.widthCm <= 0 || !isFinite(cfg.heightCm) || cfg.heightCm <= 0) return null;

  const rawTargetPct = forcedTargetPct == null
    ? _wallGetGoldenTargetPct(useInputValues)
    : forcedTargetPct;
  const targetPct = _wallClamp(rawTargetPct, WALL_GOLDEN_MIN_PCT, WALL_GOLDEN_MAX_PCT);
  const ratioCurrent = _wallGetSelectedRatio();
  const sCurrent = _wallBuildSizeSuggestionForRatio(cfg.widthCm, cfg.heightCm, ratioCurrent, targetPct);
  const s3x2 = _wallBuildSizeSuggestionForRatio(cfg.widthCm, cfg.heightCm, 3 / 2, targetPct);
  const s4x3 = _wallBuildSizeSuggestionForRatio(cfg.widthCm, cfg.heightCm, 4 / 3, targetPct);
  if (!sCurrent || !s3x2 || !s4x3) return null;

  const leftMark = wallCalibMarks.left;
  const rightMark = wallCalibMarks.right;
  const xL = leftMark ? Math.round((leftMark.xPct / 100) * cW) : Math.round((cfg.leftX / 100) * cW);
  const xR = rightMark ? Math.round((rightMark.xPct / 100) * cW) : Math.round((cfg.rightX / 100) * cW);
  const yLBase = leftMark ? Math.round((leftMark.yPct / 100) * cH) : Math.round((cfg.floorY / 100) * cH);
  const yRBase = rightMark ? Math.round((rightMark.yPct / 100) * cH) : Math.round((cfg.floorY / 100) * cH);
  const yLeftRef = _wallClamp(yLBase + 14, 0, cH - 1);
  const yRightRef = _wallClamp(yRBase + 14, 0, cH - 1);
  const yRef = Math.round((yLeftRef + yRightRef) / 2);
  const rangeText = `${sCurrent.minWidthCm}-${sCurrent.maxWidthCm}cm`;

  return {
    kind: 'wall',
    xL,
    xR,
    yLeftRef,
    yRightRef,
    yRef,
    wallWidthCm: Math.round(cfg.widthCm),
    wallHeightCm: Math.round(cfg.heightCm),
    suggestedWidthCm: sCurrent.preferredWidthCm,
    suggestedHeightCurrentCm: sCurrent.preferredHeightCm,
    suggestedHeight3x2: s3x2.preferredHeightCm,
    suggestedHeight4x3: s4x3.preferredHeightCm,
    minWidthCm: sCurrent.minWidthCm,
    maxWidthCm: sCurrent.maxWidthCm,
    targetPct,
    panelText: `Parede ${Math.round(cfg.widthCm)}×${Math.round(cfg.heightCm)} cm · Regra ${WALL_GOLDEN_MIN_PCT}-${WALL_GOLDEN_MAX_PCT}%: ${rangeText} · Sugestão (${Math.round(targetPct)}%): ${sCurrent.preferredWidthCm}×${sCurrent.preferredHeightCm}cm`,
    overlayText: `📏 Parede ${Math.round(cfg.widthCm)}×${Math.round(cfg.heightCm)}cm  ·  Regra ${WALL_GOLDEN_MIN_PCT}-${WALL_GOLDEN_MAX_PCT}%: ${rangeText}  ·  Sugestão ${sCurrent.preferredWidthCm}×${sCurrent.preferredHeightCm}cm`,
  };
}

function _wallGetActiveSuggestion(cW, cH, useInputValues = false) {
  const mode = _wallGetSuggestMode(useInputValues);
  if (mode === 'furniture') return _wallGetFurnitureSuggestion(cW, cH);
  if (mode === 'wall') return _wallGetWallGoldenSuggestion(cW, cH, useInputValues);
  return _wallGetFurnitureSuggestion(cW, cH)
    || _wallGetWallGoldenSuggestion(cW, cH, useInputValues, WALL_AUTO_WALL_TARGET_PCT);
}

function _wallGetVisibleBoundsPct() {
  const left = _wallClamp(Math.min(wallLeftXPct, wallRightXPct - 1), 0, 99);
  const right = _wallClamp(Math.max(wallRightXPct, left + 1), 1, 100);
  const top = _wallClamp(Math.min(wallCeilingYPct, wallFloorYPct - 1), 0, 99);
  const bottom = _wallClamp(Math.max(wallFloorYPct, top + 1), 1, 100);
  return { left, right, top, bottom };
}

function _wallClampFrameIntoVisibleWall(frame, cW, cH, ppc) {
  if (!frame || !isFinite(cW) || !isFinite(cH) || cW <= 0 || cH <= 0 || !isFinite(ppc) || ppc <= 0) return;

  const b = _wallGetVisibleBoundsPct();
  const leftPx = (b.left / 100) * cW;
  const rightPx = (b.right / 100) * cW;
  const topPx = (b.top / 100) * cH;
  const bottomPx = (b.bottom / 100) * cH;

  const fw = Math.max(1, Math.round(frame.wCm * ppc));
  const fh = Math.max(1, Math.round(frame.hCm * ppc));
  const ppPx = frame.ppOn ? Math.round((frame.ppSize || 3) * ppc) : 0;
  const frameWpx = Math.round((frame.frameW || 0) * ppc);
  const bw = fw + (ppPx + frameWpx) * 2;
  const bh = fh + (ppPx + frameWpx) * 2;
  const halfW = bw / 2;
  const halfH = bh / 2;

  const wallMidXPx = (leftPx + rightPx) / 2;
  const wallMidYPx = (topPx + bottomPx) / 2;

  let xPx = (frame.xP / 100) * cW;
  let yPx = (frame.yP / 100) * cH;

  const minX = leftPx + halfW;
  const maxX = rightPx - halfW;
  const minY = topPx + halfH;
  const maxY = bottomPx - halfH;

  xPx = minX <= maxX ? _wallClamp(xPx, minX, maxX) : wallMidXPx;
  yPx = minY <= maxY ? _wallClamp(yPx, minY, maxY) : wallMidYPx;

  frame.xP = _wallClamp((xPx / cW) * 100, 0, 100);
  frame.yP = _wallClamp((yPx / cH) * 100, 0, 100);
}

function _wallCenterSelectedFrameInVisibleWall() {
  if (!wallFrames.length) return false;
  const idx = (wallSelectedIdx >= 0 && wallSelectedIdx < wallFrames.length)
    ? wallSelectedIdx
    : 0;
  const f = wallFrames[idx];
  if (!f) return false;

  const b = _wallGetVisibleBoundsPct();
  f.xP = (b.left + b.right) / 2;
  f.yP = (b.top + b.bottom) / 2;

  const cvs = document.getElementById('wallCanvas');
  if (cvs && cvs.width > 0 && cvs.height > 0) {
    const ppc = _wallComputePpc(cvs.width, cvs.height, false).ppc;
    _wallClampFrameIntoVisibleWall(f, cvs.width, cvs.height, ppc);
  }

  wallSelectedIdx = idx;
  _wallUpdatePanelFromSelected();
  return true;
}

function _wallCenterSelectedFrameOnFurnitureWidth() {
  const fL = wallCalibMarks.furnitureLeft;
  const fR = wallCalibMarks.furnitureRight;
  if (!fL || !fR || !wallFrames.length) return false;

  const idx = (wallSelectedIdx >= 0 && wallSelectedIdx < wallFrames.length)
    ? wallSelectedIdx
    : 0;
  const f = wallFrames[idx];
  if (!f) return false;

  const centerXPct = _wallClamp((fL.xPct + fR.xPct) / 2, 0, 100);
  f.xP = centerXPct;
  wallSelectedIdx = idx;
  _wallUpdatePanelFromSelected();
  return true;
}

function _wallGetIdealCenterYPctFromFloor() {
  const floor = wallCalibMarks.floor;
  const cvs = document.getElementById('wallCanvas');
  if (!floor || !cvs || cvs.width <= 0 || cvs.height <= 0) return null;

  const vPpc = _wallGetVerticalPpc(cvs.width, cvs.height);
  if (!isFinite(vPpc) || vPpc <= 0) return null;

  const floorYPx = (floor.yPct / 100) * cvs.height;
  const idealCenterYPx = floorYPx - (155 * vPpc);
  return _wallClamp((idealCenterYPx / cvs.height) * 100, 0, 100);
}

function _wallCenterSelectedFrameOnIdealHeight() {
  if (!wallFrames.length) return false;
  const centerYPct = _wallGetIdealCenterYPctFromFloor();
  if (!isFinite(centerYPct)) return false;

  const idx = (wallSelectedIdx >= 0 && wallSelectedIdx < wallFrames.length)
    ? wallSelectedIdx
    : 0;
  const f = wallFrames[idx];
  if (!f) return false;

  f.yP = centerYPct;

  const cvs = document.getElementById('wallCanvas');
  if (cvs && cvs.width > 0 && cvs.height > 0) {
    const ppc = _wallComputePpc(cvs.width, cvs.height, false).ppc;
    _wallClampFrameIntoVisibleWall(f, cvs.width, cvs.height, ppc);
  }

  wallSelectedIdx = idx;
  _wallUpdatePanelFromSelected();
  return true;
}

function _wallEssentialProgressState() {
  const done = WALL_GUIDED_MARKS.filter((mode) => !!wallCalibMarks[mode]);
  const next = WALL_GUIDED_MARKS.find((mode) => !wallCalibMarks[mode]) || '';
  return {
    doneCount: done.length,
    total: WALL_GUIDED_MARKS.length,
    next,
  };
}

function _wallIsAutoAdvanceEnabled() {
  const cb = document.getElementById('wallCalibAutoAdvance');
  return !cb || !!cb.checked;
}

function _wallNextMarkModeFrom(currentMode) {
  const idx = WALL_GUIDED_MARKS.indexOf(currentMode);
  if (idx < 0) return '';
  for (let i = idx + 1; i < WALL_GUIDED_MARKS.length; i++) {
    const mode = WALL_GUIDED_MARKS[i];
    if (!wallCalibMarks[mode]) return mode;
  }
  return '';
}

function _wallUpdateCalibProgressUi() {
  const progressEl = document.getElementById('wallCalibProgress');
  const nextEl = document.getElementById('wallCalibNext');
  const state = _wallEssentialProgressState();

  if (progressEl) {
    progressEl.textContent = `Progresso: ${state.doneCount}/${state.total} pontos da marcação guiada`;
  }
  if (nextEl) {
    if (state.next) {
      nextEl.textContent = `Próximo sugerido: ${_wallMarkModeLabel(state.next)}`;
    } else {
      nextEl.textContent = 'Marcação guiada completa. Você pode ajustar livremente se quiser refinar o resultado.';
    }
  }
}

function wallStartGuidedCalibration() {
  const state = _wallEssentialProgressState();
  const mode = state.next || WALL_GUIDED_MARKS[0];
  _wallCenterSelectedFrameInVisibleWall();
  renderWall();
  wallStartMarkCalibration(mode);
}

function wallRefreshCalibrationGuideUi() {
  _wallUpdateCalibMarkUi();
}

function _wallEnsureMarkButtonLabels() {
  document.querySelectorAll('[data-wall-mark-mode]').forEach((btn) => {
    if (!btn.dataset.wallBaseLabel) {
      btn.dataset.wallBaseLabel = (btn.textContent || '').trim();
    }
  });
}

function _wallUpdateCalibMarkUi() {
  const hint = document.getElementById('wallCalibMarkHint');
  const state = _wallEssentialProgressState();
  _wallEnsureMarkButtonLabels();
  if (hint) {
    hint.textContent = wallCalibMarkMode
      ? `Marcação ativa: clique no ${_wallMarkModeLabel(wallCalibMarkMode)} no canvas.`
      : state.next
        ? `Modo guiado: clique no ${_wallMarkModeLabel(state.next)} no canvas.`
        : 'Marcação guiada concluída. Faça ajustes finos se necessário.';
  }

  document.querySelectorAll('[data-wall-mark-mode]').forEach((btn) => {
    const mode = btn.getAttribute('data-wall-mark-mode') || '';
    const active = mode === wallCalibMarkMode;
    const done = !!wallCalibMarks[mode];
    const baseLabel = btn.dataset.wallBaseLabel || (btn.textContent || '').trim();

    btn.textContent = done
      ? `✅ ${baseLabel.replace(/^📌\s*/, '').replace(/^✅\s*/, '')}`
      : baseLabel;

    if (active) {
      btn.style.background = 'var(--gold)';
      btn.style.color = '#fff';
      btn.style.borderColor = 'var(--gold)';
      return;
    }

    if (done) {
      btn.style.background = 'rgba(46,125,82,0.10)';
      btn.style.color = '#2E7D52';
      btn.style.borderColor = 'rgba(46,125,82,0.45)';
      return;
    }

    btn.style.background = '#fff';
    btn.style.color = 'var(--brown)';
    btn.style.borderColor = 'var(--border2)';
  });

  _wallUpdateCalibProgressUi();
}

function wallStartMarkCalibration(mode) {
  wallCalibMarkMode = mode || '';
  _wallUpdateCalibMarkUi();
  const cvs = document.getElementById('wallCanvas');
  if (cvs) cvs.style.cursor = wallCalibMarkMode ? 'crosshair' : 'default';
}

function wallStopMarkCalibration() {
  wallCalibMarkMode = '';
  _wallUpdateCalibMarkUi();
  const cvs = document.getElementById('wallCanvas');
  if (cvs) cvs.style.cursor = 'default';
}

function toggleWallCalibrationMarks() {
  const cb = document.getElementById('wallCalibMarksVisible');
  wallCalibrationMarksVisible = !!(cb && cb.checked);
  if (!wallCalibrationMarksVisible && wallCalibMarkMode) {
    wallStopMarkCalibration();
  }
  renderWall();
}

function wallClearCalibrationMarks() {
  wallCalibMarks = {
    left: null,
    right: null,
    ceiling: null,
    floor: null,
    furnitureTop: null,
    furnitureBottom: null,
    furnitureLeft: null,
    furnitureRight: null,
  };

  // Voltar para posições padrão para recalibração do zero.
  wallLeftXPct = 2;
  wallRightXPct = 98;
  wallCeilingYPct = 8;
  wallFloorYPct = 82;
  wallFurnitureTopYPct = 58;
  wallFurnitureBottomYPct = 78;
  wallFurnitureLeftXPct = 20;
  wallFurnitureRightXPct = 80;

  const setVal = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.value = String(Math.round(v));
  };
  setVal('wallLeftXPct', wallLeftXPct);
  setVal('wallRightXPct', wallRightXPct);
  setVal('wallCeilingYPct', wallCeilingYPct);
  setVal('wallFloorYPct', wallFloorYPct);
  setVal('wallFurnitureTopYPct', wallFurnitureTopYPct);
  setVal('wallFurnitureBottomYPct', wallFurnitureBottomYPct);
  setVal('wallFurnitureLeftXPct', wallFurnitureLeftXPct);
  setVal('wallFurnitureRightXPct', wallFurnitureRightXPct);

  const info = document.getElementById('wallSuggestInfo');
  if (info) info.style.display = 'none';

  wallStopMarkCalibration();
  wallApplyScaleCalibration(false);
  _wallUpdateCalibProgressUi();
  toast('Marcacoes de calibracao limpas.');
}

function _wallApplyMarkPoint(xPct, yPct) {
  if (!wallCalibMarkMode) return;
  const currentMode = wallCalibMarkMode;

  wallCalibMarks[wallCalibMarkMode] = {
    xPct: _wallClamp(xPct, 0, 100),
    yPct: _wallClamp(yPct, 0, 100),
  };

  switch (wallCalibMarkMode) {
    case 'left':
      wallLeftXPct = _wallClamp(xPct, 0, 95);
      break;
    case 'right':
      wallRightXPct = _wallClamp(xPct, 5, 100);
      break;
    case 'ceiling':
      wallCeilingYPct = _wallClamp(yPct, 0, 95);
      break;
    case 'floor':
      wallFloorYPct = _wallClamp(yPct, 5, 100);
      break;
    case 'furnitureTop':
      wallFurnitureTopYPct = _wallClamp(yPct, 0, 99);
      break;
    case 'furnitureBottom':
      wallFurnitureBottomYPct = _wallClamp(yPct, 1, 100);
      break;
    case 'furnitureLeft':
      wallFurnitureLeftXPct = _wallClamp(xPct, 0, 95);
      break;
    case 'furnitureRight':
      wallFurnitureRightXPct = _wallClamp(xPct, 5, 100);
      break;
    default:
      return;
  }

  const setVal = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.value = String(Math.round(v));
  };
  setVal('wallLeftXPct', wallLeftXPct);
  setVal('wallRightXPct', wallRightXPct);
  setVal('wallCeilingYPct', wallCeilingYPct);
  setVal('wallFloorYPct', wallFloorYPct);
  setVal('wallFurnitureTopYPct', wallFurnitureTopYPct);
  setVal('wallFurnitureBottomYPct', wallFurnitureBottomYPct);
  setVal('wallFurnitureLeftXPct', wallFurnitureLeftXPct);
  setVal('wallFurnitureRightXPct', wallFurnitureRightXPct);

  const shouldCenterOnFurniture = currentMode === 'furnitureLeft' || currentMode === 'furnitureRight';
  if (shouldCenterOnFurniture) {
    const centered = _wallCenterSelectedFrameOnFurnitureWidth();
    if (centered) {
      toast('Quadro centralizado no comprimento do movel.');
    }
  }

  if (currentMode === 'floor') {
    const centeredY = _wallCenterSelectedFrameOnIdealHeight();
    if (centeredY) {
      toast('Centro do quadro alinhado na faixa ideal de 1,50-1,60 m.');
    }
  }

  wallApplyScaleCalibration();

  const nextMode = _wallIsAutoAdvanceEnabled() ? _wallNextMarkModeFrom(currentMode) : '';
  if (nextMode) {
    wallStartMarkCalibration(nextMode);
  } else {
    const guidedState = _wallEssentialProgressState();
    if (guidedState.doneCount >= guidedState.total) {
      toast('Marcacao guiada concluida.');
    }
    wallStopMarkCalibration();
  }
}

function wallApplyScaleCalibration(shouldAutoResize = false) {
  const widthCm = _wallParseInputNum('wallVisibleWidthCm', 80, 1200);
  const heightCm = _wallParseInputNum('wallVisibleHeightCm', 80, 600);
  const leftX = _wallParseInputNum('wallLeftXPct', 0, 95);
  const rightX = _wallParseInputNum('wallRightXPct', 5, 100);
  const ceilingY = _wallParseInputNum('wallCeilingYPct', 0, 95);
  const floorY = _wallParseInputNum('wallFloorYPct', 5, 100);
  const furnitureCm = _wallParseInputNum('wallFurnitureHeightCm', 0, 300);
  const furnitureTopY = _wallParseInputNum('wallFurnitureTopYPct', 0, 99);
  const furnitureBottomY = _wallParseInputNum('wallFurnitureBottomYPct', 1, 100);
  const furnitureLeftX = _wallParseInputNum('wallFurnitureLeftXPct', 0, 95);
  const furnitureRightX = _wallParseInputNum('wallFurnitureRightXPct', 5, 100);
  const suggestModeEl = document.getElementById('wallSuggestMode');
  const suggestMode = String(suggestModeEl?.value || '').trim();
  const goldenTargetPct = _wallParseInputNum('wallGoldenTargetPct', WALL_GOLDEN_MIN_PCT, WALL_GOLDEN_MAX_PCT);

  if (widthCm != null) wallVisibleWidthCm = widthCm;
  if (heightCm != null) wallVisibleHeightCm = heightCm;
  if (leftX != null) wallLeftXPct = leftX;
  if (rightX != null) wallRightXPct = rightX;
  if (ceilingY != null) wallCeilingYPct = ceilingY;
  if (floorY != null) wallFloorYPct = floorY;
  if (furnitureCm != null) wallFurnitureHeightCm = furnitureCm;
  if (furnitureTopY != null) wallFurnitureTopYPct = furnitureTopY;
  if (furnitureBottomY != null) wallFurnitureBottomYPct = furnitureBottomY;
  if (furnitureLeftX != null) wallFurnitureLeftXPct = furnitureLeftX;
  if (furnitureRightX != null) wallFurnitureRightXPct = furnitureRightX;
  if (suggestMode === 'auto' || suggestMode === 'furniture' || suggestMode === 'wall') wallSuggestMode = suggestMode;
  if (goldenTargetPct != null) wallGoldenTargetPct = goldenTargetPct;

  // Garantir ordem dos intervalos horizontais
  if (wallRightXPct <= wallLeftXPct + 3) {
    wallRightXPct = _wallClamp(wallLeftXPct + 3, 5, 100);
  }

  // Garantir ordem dos intervalos verticais
  if (wallFloorYPct <= wallCeilingYPct + 3) {
    wallFloorYPct = _wallClamp(wallCeilingYPct + 3, 5, 100);
  }
  if (wallFurnitureBottomYPct <= wallFurnitureTopYPct + 2) {
    wallFurnitureBottomYPct = _wallClamp(wallFurnitureTopYPct + 2, 1, 100);
  }
  if (wallFurnitureRightXPct <= wallFurnitureLeftXPct + 2) {
    wallFurnitureRightXPct = _wallClamp(wallFurnitureLeftXPct + 2, 5, 100);
  }

  const setVal = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.value = String(Math.round(v));
  };
  setVal('wallVisibleWidthCm', wallVisibleWidthCm);
  setVal('wallVisibleHeightCm', wallVisibleHeightCm);
  setVal('wallLeftXPct', wallLeftXPct);
  setVal('wallRightXPct', wallRightXPct);
  setVal('wallCeilingYPct', wallCeilingYPct);
  setVal('wallFloorYPct', wallFloorYPct);
  setVal('wallFurnitureHeightCm', wallFurnitureHeightCm);
  setVal('wallFurnitureTopYPct', wallFurnitureTopYPct);
  setVal('wallFurnitureBottomYPct', wallFurnitureBottomYPct);
  setVal('wallFurnitureLeftXPct', wallFurnitureLeftXPct);
  setVal('wallFurnitureRightXPct', wallFurnitureRightXPct);
  setVal('wallGoldenTargetPct', wallGoldenTargetPct);
  if (suggestModeEl) suggestModeEl.value = wallSuggestMode;
  _wallSyncCalibrationLabels();

  _wallCenterSelectedFrameOnIdealHeight();
  if (wallSelectedIdx >= 0 && wallSelectedIdx < wallFrames.length) {
    const cvs = document.getElementById('wallCanvas');
    if (cvs && cvs.width > 0 && cvs.height > 0) {
      const ppc = _wallComputePpc(cvs.width, cvs.height, false).ppc;
      _wallClampFrameIntoVisibleWall(wallFrames[wallSelectedIdx], cvs.width, cvs.height, ppc);
    }
  }
  _wallUpdateCalibProgressUi();

  if (shouldAutoResize) {
    const cvs = document.getElementById('wallCanvas');
    if (cvs && cvs.width > 0 && wallFrames.length > 0) {
      const suggestion = _wallGetActiveSuggestion(cvs.width, cvs.height, false);
      if (suggestion) {
        const idx = (wallSelectedIdx >= 0 && wallSelectedIdx < wallFrames.length)
          ? wallSelectedIdx
          : 0;
        const f = wallFrames[idx];

        f.wCm = suggestion.suggestedWidthCm;
        f.hCm = suggestion.suggestedHeightCurrentCm
          ? suggestion.suggestedHeightCurrentCm
          : suggestion.suggestedHeight3x2;

        wallSelectedIdx = idx;
        _wallUpdatePanelFromSelected();
        const modeLabel = suggestion.kind === 'wall' ? 'regra 60-75% da parede' : 'móvel';
        toast(`Quadro ajustado para ${f.wCm}x${f.hCm}cm (base: ${modeLabel}).`);
      } else if (_wallGetSuggestMode(false) === 'furniture') {
        toast('Para usar o modo com móvel, marque as extremidades esquerda e direita do móvel.');
      }
    }
  }

  renderWall();
}

function wallPreviewScaleCalibration() {
  const cvs = document.getElementById('wallCanvas');
  if (cvs && cvs.width > 0) {
    const { ppc, candidates } = _wallComputePpc(cvs.width, cvs.height, true);
    _wallUpdateScaleInfo(ppc, candidates);
  } else {
    const fallback = _wallCurrentCalibState(true);
    _wallUpdateScaleInfo(0, [
      { label: 'largura', ppc: 0 / Math.max(1, fallback.widthCm) }
    ].filter((c) => isFinite(c.ppc) && c.ppc > 0));
  }
}

function _wallDrawCalibrationOverlay(ctx, cW, cH) {
  const colorByMode = {
    left:            'rgba(32, 82, 149, 0.95)',
    right:           'rgba(32, 82, 149, 0.95)',
    ceiling:         'rgba(178, 34, 34, 0.95)',
    floor:           'rgba(178, 34, 34, 0.95)',
    furnitureTop:    'rgba(46, 125, 82, 0.98)',
    furnitureBottom: 'rgba(46, 125, 82, 0.98)',
    furnitureLeft:   'rgba(130, 60, 180, 0.95)',
    furnitureRight:  'rgba(130, 60, 180, 0.95)',
  };

  const labelByMode = {
    left:            'E',
    right:           'D',
    ceiling:         'T',
    floor:           'P',
    furnitureTop:    'M+',
    furnitureBottom: 'M-',
    furnitureLeft:   'ML',
    furnitureRight:  'MR',
  };

  ctx.save();
  Object.entries(wallCalibMarks).forEach(([mode, mark]) => {
    if (!mark) return;
    const x = Math.round((mark.xPct / 100) * cW);
    const y = Math.round((mark.yPct / 100) * cH);
    const color = colorByMode[mode] || 'rgba(26,48,81,0.9)';
    const label = labelByMode[mode] || '';

    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.stroke();

    if (label) {
      ctx.font = "700 10px 'Avenir','Nunito',sans-serif";
      ctx.fillStyle = 'rgba(255,255,255,0.98)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, x, y + 0.5);
    }
  });

  // Indicador discreto da marcação ativa
  if (wallCalibMarkMode) {
    ctx.font = "700 11px 'Avenir','Nunito',sans-serif";
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(255, 193, 7, 0.98)';
    ctx.fillText('📌 Marcando: ' + _wallMarkModeLabel(wallCalibMarkMode), 10, 10);
  }

  // ── Faixa de altura ideal (1,50–1,60 m do piso) ──
  // Usa ppc VERTICAL puro (piso-teto), evitando distorção do ppc de largura.
  const floorMark = wallCalibMarks.floor;
  if (floorMark) {
    const vPpc = _wallGetVerticalPpc(cW, cH);
    if (vPpc > 0) {
      const yFloorPx  = Math.round((floorMark.yPct / 100) * cH);
      const y160 = yFloorPx - Math.round(160 * vPpc);
      const y150 = yFloorPx - Math.round(150 * vPpc);

      if (y160 >= 0 && y150 <= cH && y150 > y160) {
        ctx.save();
        ctx.fillStyle = 'rgba(184, 144, 60, 0.18)';
        ctx.fillRect(0, y160, cW, y150 - y160);

        const yMid = Math.round((y160 + y150) / 2);
        ctx.setLineDash([10, 5]);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(184, 144, 60, 0.85)';
        ctx.beginPath();
        ctx.moveTo(0, yMid);
        ctx.lineTo(cW, yMid);
        ctx.stroke();
        ctx.setLineDash([]);

        const labelText = '👁 Altura ideal (1,50–1,60 m)';
        ctx.font = "700 11px 'Avenir','Nunito',sans-serif";
        const tw = ctx.measureText(labelText).width;
        const lx = cW - tw - 14;
        const ly = y160 - 16 < 4 ? y150 + 4 : y160 - 16;
        ctx.fillStyle = 'rgba(255,255,255,0.90)';
        ctx.fillRect(lx - 4, ly - 1, tw + 8, 15);
        ctx.fillStyle = 'rgba(140, 100, 20, 1)';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(labelText, lx, ly);
        ctx.restore();
      }
    }
  }

  // ── Indicador de referência e sugestão de tamanho ──
  const suggestion = _wallGetActiveSuggestion(cW, cH, false);
  if (suggestion) {
    const xL = suggestion.xL;
    const xR = suggestion.xR;
    const yRef = suggestion.yRef;
    const yL = (typeof suggestion.yLeftRef === 'number') ? suggestion.yLeftRef : yRef;
    const yR = (typeof suggestion.yRightRef === 'number') ? suggestion.yRightRef : yRef;
    const yMid = Math.round((yL + yR) / 2);

      // Linha de cota
      ctx.save();
      const isWallMode = suggestion.kind === 'wall';
      ctx.strokeStyle = isWallMode ? 'rgba(184, 144, 60, 0.88)' : 'rgba(130, 60, 180, 0.85)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(xL, yL - 5); ctx.lineTo(xL, yL + 5); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(xR, yR - 5); ctx.lineTo(xR, yR + 5); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(xL, yL); ctx.lineTo(xR, yR); ctx.stroke();

      const sugText = suggestion.overlayText;
      ctx.font = "600 11px 'Avenir','Nunito',sans-serif";
      const stw = ctx.measureText(sugText).width;
      const xMid = Math.round((xL + xR) / 2);
      const sx = Math.max(4, Math.min(xMid - Math.round(stw / 2), cW - stw - 12));
      const sy = yMid + 6;
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fillRect(sx - 4, sy - 1, stw + 8, 15);
      ctx.fillStyle = isWallMode ? 'rgba(140, 100, 20, 1)' : 'rgba(90, 20, 140, 1)';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(sugText, sx, sy);

      // Atualizar painel
      const info = document.getElementById('wallSuggestInfo');
      if (info) {
        info.textContent = suggestion.panelText;
        info.style.color = isWallMode ? 'rgba(140,100,20,1)' : 'rgba(90,20,140,1)';
        info.style.background = isWallMode ? 'rgba(184,144,60,0.10)' : 'rgba(130,60,180,0.08)';
        info.style.borderColor = isWallMode ? 'rgba(184,144,60,0.35)' : 'rgba(130,60,180,0.30)';
        info.style.display = 'block';
      }
      ctx.restore();
  } else {
    const info = document.getElementById('wallSuggestInfo');
    if (info) {
      if (_wallGetSuggestMode(false) === 'furniture') {
        info.textContent = 'Modo com móvel ativo: marque as extremidades esquerda e direita do móvel para gerar a sugestão.';
        info.style.color = 'rgba(90,20,140,1)';
        info.style.background = 'rgba(130,60,180,0.08)';
        info.style.borderColor = 'rgba(130,60,180,0.30)';
        info.style.display = 'block';
      } else {
        info.style.display = 'none';
      }
    }
  }

  ctx.restore();
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
    yP: isFinite(yP) ? yP : 46,
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
    frame.xP = Math.min(78, 50 + wallFrames.length * 5);
    frame.yP = Math.min(66, 46 + wallFrames.length * 3);
  }

  const cvs = document.getElementById('wallCanvas');
  if (cvs && cvs.width > 0 && cvs.height > 0) {
    const ppc = _wallComputePpc(cvs.width, cvs.height, false).ppc;
    _wallClampFrameIntoVisibleWall(frame, cvs.width, cvs.height, ppc);
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

function wallSyncControlsPaneHeight() {
  const leftCol = document.getElementById('wallSimCanvasCol');
  const rightCol = document.getElementById('wallSimControlsCol');
  if (!leftCol || !rightCol) return;

  if (window.matchMedia && window.matchMedia('(max-width: 900px)').matches) {
    rightCol.style.maxHeight = 'none';
    rightCol.style.overflowY = 'visible';
    return;
  }

  const leftH = Math.round(leftCol.getBoundingClientRect().height || 0);
  if (leftH <= 0) return;
  rightCol.style.maxHeight = leftH + 'px';
  rightCol.style.overflowY = 'auto';
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
  const { ppc, candidates } = _wallComputePpc(cvs.width, cvs.height, false);
  _wallUpdateScaleInfo(ppc, candidates);

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

  if (wallCalibrationMarksVisible) {
    _wallDrawCalibrationOverlay(ctx, cvs.width, cvs.height);
  } else {
    const info = document.getElementById('wallSuggestInfo');
    if (info) info.style.display = 'none';
  }

  // Marca d'agua acima da simulacao exportada
  _wallDrawWatermark(ctx, cvs.width, cvs.height);

  wallSyncControlsPaneHeight();

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
  const { ppc } = _wallComputePpc(cW, cH, false);
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

  function getPPC() {
    return _wallComputePpc(cvs.width, cvs.height, false).ppc;
  }

  function onDown(e) {
    if (!wEnvImg) return;
    e.preventDefault();
    const { x, y } = _wallCanvasPos(e, cvs);
    const ppc = getPPC();
    const cW = cvs.width, cH = cvs.height;

    if (wallCalibMarkMode) {
      const xPct = _wallClamp((x / cW) * 100, 0, 100);
      const yPct = _wallClamp((y / cH) * 100, 0, 100);
      _wallApplyMarkPoint(xPct, yPct);
      return;
    }

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

    if (wallCalibMarkMode) {
      cvs.style.cursor = 'crosshair';
      return;
    }

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
    const { ppc, candidates } = _wallComputePpc(c.width, c.height, false);
    _wallUpdateScaleInfo(ppc, candidates);
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
    const run = (preparedFile) => {
      const blob = (preparedFile instanceof Blob) ? preparedFile : file;
      const img = new Image();
      img.onload = () => wallAddFrame(img);
      img.onerror = () => toast('Nao foi possivel abrir uma das artes selecionadas.');
      img.src = URL.createObjectURL(blob);
    };
    if (typeof _ffPrepareImageFile === 'function') {
      _ffPrepareImageFile(file)
        .then(run)
        .catch((err) => {
          console.error('Falha ao preparar arte para simulacao', err);
          if (typeof _isDngLike === 'function' && _isDngLike(file)) {
            toast('Nao foi possivel abrir um arquivo DNG neste dispositivo.');
          } else {
            toast('Nao foi possivel abrir uma das artes selecionadas.');
          }
        });
      return;
    }

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
  wallApplyScaleCalibration();
  wallRefreshCalibrationGuideUi();
  _wallUpdateCompositionLockBtn();
  _wallUpdateWatermarkUI();
  wallSyncControlsPaneHeight();
  window.addEventListener('resize', wallSyncControlsPaneHeight);
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
          wallSyncControlsPaneHeight();
        }, 50);
      }
    };
  }
});