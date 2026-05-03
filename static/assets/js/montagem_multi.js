// montagem_multi.js

let montagemConfig = {
    canvasWidthCm: 100,
    canvasHeightCm: 70,
    ppSizeCm: 5,
    ppColor: '#FFFFFF',
    frameSizeCm: 2,
    frameColor: '#000000',
    fitMode: 'contain',
    pxPerCm: 10 // Escala base para renderização (10px = 1cm para manter qualidade)
};

let selectedElement = null;
let zIndexCounter = 10;
const containerId = 'mCanvasContainer';
let uploadedImages = [];

function initMontagem() {
    updateMontagemBase();
}

function loadMontagemImages(event) {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    document.getElementById('mControls').style.display = 'block';
    
    // Atualiza base para mostrar o quadro
    updateMontagemBase();

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const reader = new FileReader();
        reader.onload = function(e) {
            addImageToWorkArea(e.target.result);
        };
        reader.readAsDataURL(file);
    }
}

function updateMontagemBase() {
    montagemConfig.canvasWidthCm = parseFloat(document.getElementById('mCanvasWidth').value) || 100;
    montagemConfig.canvasHeightCm = parseFloat(document.getElementById('mCanvasHeight').value) || 70;
    
    updateMontagem();
}

function updateMontagem() {
    montagemConfig.ppSizeCm = parseFloat(document.getElementById('mPpSize').value) || 0;
    montagemConfig.frameSizeCm = parseFloat(document.getElementById('mFrameSize').value) || 0;
    const fitSelect = document.getElementById('mFitMode');
    montagemConfig.fitMode = (fitSelect && fitSelect.value === 'cover') ? 'cover' : 'contain';

    const container = document.getElementById(containerId);
    if (!container) return;

    const baseWidthPx = montagemConfig.canvasWidthCm * montagemConfig.pxPerCm;
    const baseHeightPx = montagemConfig.canvasHeightCm * montagemConfig.pxPerCm;
    const framePx = montagemConfig.frameSizeCm * montagemConfig.pxPerCm;
    const ppPx = montagemConfig.ppSizeCm * montagemConfig.pxPerCm;
    
    // O tamanho total do container em tela precisa somar a moldura para o border-box
    const totalWidthPx = baseWidthPx + (framePx * 2);
    const totalHeightPx = baseHeightPx + (framePx * 2);

    container.style.boxSizing = 'border-box';
    container.style.width = `${totalWidthPx}px`;
    container.style.height = `${totalHeightPx}px`;
    container.style.backgroundColor = montagemConfig.ppColor;
    container.style.border = `${framePx}px solid ${montagemConfig.frameColor}`;
    
    let workArea = document.getElementById('mWorkArea');
    if (!workArea) {
        workArea = document.createElement('div');
        workArea.id = 'mWorkArea';
        workArea.style.position = 'relative';
        workArea.style.width = '100%';
        workArea.style.height = '100%';
        workArea.style.overflow = 'hidden'; 
        container.appendChild(workArea);
        // Listener adicionado apenas uma vez: usa 'click' (não 'mousedown') para
        // garantir que o onchange dos inputs de tamanho dispare ANTES de limpar a seleção
        workArea.addEventListener('click', (e) => {
            if (e.target.id === 'mWorkArea') {
                selectElement(null);
            }
        });
    }

    container.style.padding = `${ppPx}px`;

    const wrap = document.getElementById('mCanvasContainerWrap');
    if (wrap) {
        const maxWidth = wrap.clientWidth - 40; 
        
        // Calcular a altura máxima disponível na tela
        const rect = wrap.getBoundingClientRect();
        // window.innerHeight menos o topo do container, menos uma margem de segurança de 40px
        const availableHeight = window.innerHeight - rect.top - 40;
        const maxHeight = Math.max(400, availableHeight); // Pelo menos 400px de altura
        
        const scaleW = maxWidth / totalWidthPx;
        const scaleH = maxHeight / totalHeightPx;
        
        // Usa o menor dos três: 1 (não amplia), scaleW (cabe na largura), scaleH (cabe na altura)
        const scale = Math.min(1, scaleW, scaleH);
        
        container.style.transform = `scale(${scale})`;
        wrap.style.height = `${(totalHeightPx * scale) + 40}px`;
    }
}

function _getWrapFitMode(wrap) {
    if (!wrap) return (montagemConfig.fitMode === 'cover' ? 'cover' : 'contain');
    const mode = String(wrap.dataset.fitMode || '').toLowerCase();
    return mode === 'cover' ? 'cover' : 'contain';
}

function _applyWrapFitMode(wrap, mode) {
    if (!wrap) return;
    const finalMode = mode === 'cover' ? 'cover' : 'contain';
    wrap.dataset.fitMode = finalMode;
    const img = wrap.querySelector('img');
    if (!img) return;
    img.style.objectFit = finalMode;
    img.style.background = finalMode === 'contain' ? '#FFFFFF' : 'transparent';
}

function setMontagemPpColor(hex, btn) {
    montagemConfig.ppColor = hex;
    document.querySelectorAll('#mPpColorList .pp-swatch').forEach(b => b.classList.remove('active'));
    if(btn) btn.classList.add('active');
    updateMontagem();
}

function setMontagemFrameColor(hex, btn) {
    montagemConfig.frameColor = hex;
    document.querySelectorAll('#mFrameColorList .pp-swatch').forEach(b => b.classList.remove('active'));
    if(btn) btn.classList.add('active');
    updateMontagem();
}

function addImageToWorkArea(src) {
    const workArea = document.getElementById('mWorkArea');
    if (!workArea) return;

    const imgWrap = document.createElement('div');
    imgWrap.className = 'm-img-wrap';
    imgWrap.style.position = 'absolute';
    imgWrap.style.left = '10px';
    imgWrap.style.top = '10px';
    imgWrap.style.zIndex = zIndexCounter++;
    imgWrap.dataset.fitMode = montagemConfig.fitMode || 'contain';
    
    const img = document.createElement('img');
    img.src = src;
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = montagemConfig.fitMode || 'contain';
    img.style.background = (montagemConfig.fitMode || 'contain') === 'contain' ? '#FFFFFF' : 'transparent';
    img.draggable = false;
    
    // Adiciona Handles de resize
    const handles = ['tl', 'tr', 'bl', 'br'];
    handles.forEach(pos => {
        const handle = document.createElement('div');
        handle.className = `m-resize-handle ${pos}`;
        imgWrap.appendChild(handle);
    });

    // Botão de deletar
    const delBtn = document.createElement('div');
    delBtn.className = 'm-del-btn';
    delBtn.innerHTML = '✕';
    delBtn.onclick = (e) => {
        e.stopPropagation();
        workArea.removeChild(imgWrap);
    };
    imgWrap.appendChild(delBtn);

    imgWrap.appendChild(img);
    workArea.appendChild(imgWrap);

    // Inicialmente, dar um tamanho padrão (ex: 20cm)
    imgWrap.style.width = `${20 * montagemConfig.pxPerCm}px`;
    imgWrap.style.height = `${20 * montagemConfig.pxPerCm}px`;

    // Configura eventos de mouse para Drag e Resize
    setupDraggable(imgWrap);

    // Seleciona a imagem adicionada
    selectElement(imgWrap);
}

function selectElement(el) {
    if (selectedElement) {
        selectedElement.classList.remove('selected');
    }
    selectedElement = el;
    if (selectedElement) {
        selectedElement.classList.add('selected');
        selectedElement.style.zIndex = zIndexCounter++;
    }
    syncInputsFromPhoto(el);
}

function setupDraggable(el) {
    let isDragging = false;
    let isResizing = false;
    let currentHandle = null;
    let startX, startY, startW, startH, startLeft, startTop;

    el.addEventListener('mousedown', (e) => {
        if (e.target.classList.contains('m-del-btn')) return;
        e.preventDefault(); // evita seleção de texto e drag nativo durante resize/drag
        
        selectElement(el);
        startX = e.clientX;
        startY = e.clientY;
        
        // Calcular escala atual do container para corrigir valores de drag
        const container = document.getElementById(containerId);
        const transformMatrix = window.getComputedStyle(container).transform;
        let scale = 1;
        if (transformMatrix !== 'none') {
            scale = parseFloat(transformMatrix.split(',')[0].replace('matrix(', ''));
        }

        if (e.target.classList.contains('m-resize-handle')) {
            isResizing = true;
            currentHandle = e.target.classList.contains('tl') ? 'tl' :
                            e.target.classList.contains('tr') ? 'tr' :
                            e.target.classList.contains('bl') ? 'bl' : 'br';
            startW = el.offsetWidth;
            startH = el.offsetHeight;
            startLeft = el.offsetLeft;
            startTop = el.offsetTop;
        } else {
            isDragging = true;
            startLeft = el.offsetLeft;
            startTop = el.offsetTop;
        }

        function onMouseMove(moveEvent) {
            const dx = (moveEvent.clientX - startX) / scale;
            const dy = (moveEvent.clientY - startY) / scale;

            const workArea = document.getElementById('mWorkArea');
            const maxW = workArea.clientWidth;
            const maxH = workArea.clientHeight;

            if (isDragging) {
                let newLeft = startLeft + dx;
                let newTop = startTop + dy;

                newLeft = Math.max(0, Math.min(newLeft, maxW - el.offsetWidth));
                newTop = Math.max(0, Math.min(newTop, maxH - el.offsetHeight));

                el.style.left = `${newLeft}px`;
                el.style.top = `${newTop}px`;
            } else if (isResizing) {
                if (currentHandle === 'br') {
                    let newW = Math.max(20, startW + dx);
                    let newH = Math.max(20, startH + dy);
                    newW = Math.min(newW, maxW - startLeft);
                    newH = Math.min(newH, maxH - startTop);
                    el.style.width = `${newW}px`;
                    el.style.height = `${newH}px`;
                } else if (currentHandle === 'bl') {
                    let newW = Math.max(20, startW - dx);
                    let newH = Math.max(20, startH + dy);
                    let newLeft = startLeft + (startW - newW);
                    
                    if (newLeft < 0) {
                        newLeft = 0;
                        newW = startW + startLeft;
                    }
                    newH = Math.min(newH, maxH - startTop);

                    el.style.width = `${newW}px`;
                    el.style.left = `${newLeft}px`;
                    el.style.height = `${newH}px`;
                } else if (currentHandle === 'tr') {
                    let newW = Math.max(20, startW + dx);
                    let newH = Math.max(20, startH - dy);
                    let newTop = startTop + (startH - newH);

                    if (newTop < 0) {
                        newTop = 0;
                        newH = startH + startTop;
                    }
                    newW = Math.min(newW, maxW - startLeft);

                    el.style.width = `${newW}px`;
                    el.style.height = `${newH}px`;
                    el.style.top = `${newTop}px`;
                } else if (currentHandle === 'tl') {
                    let newW = Math.max(20, startW - dx);
                    let newH = Math.max(20, startH - dy);
                    let newLeft = startLeft + (startW - newW);
                    let newTop = startTop + (startH - newH);

                    if (newLeft < 0) {
                        newLeft = 0;
                        newW = startW + startLeft;
                    }
                    if (newTop < 0) {
                        newTop = 0;
                        newH = startH + startTop;
                    }

                    el.style.width = `${newW}px`;
                    el.style.height = `${newH}px`;
                    el.style.left = `${newLeft}px`;
                    el.style.top = `${newTop}px`;
                }
            }
            updateMontagemGuides(el);
            syncInputsFromPhoto(el);
        }

        function onMouseUp() {
            isDragging = false;
            isResizing = false;
            updateMontagemGuides(null);
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        }

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        
        // Show initial guides on mousedown if dragging starts
        updateMontagemGuides(el);
    });
}

function updateMontagemGuides(el) {
    const ids = ['mGuideTop', 'mGuideBottom', 'mGuideLeft', 'mGuideRight'];
    let guides = ids.map(id => document.getElementById(id));
    
    if (!guides[0]) {
        const workArea = document.getElementById('mWorkArea');
        if (!workArea) return;
        
        guides = ids.map((id, index) => {
            const g = document.createElement('div');
            g.id = id;
            g.style.position = 'absolute';
            g.style.backgroundColor = 'rgba(0,0,0,0.4)';
            g.style.pointerEvents = 'none';
            g.style.zIndex = '9999';
            
            // Horizontal guides (Top, Bottom)
            if (index < 2) {
                g.style.left = '0';
                g.style.right = '0';
                g.style.height = '1px';
            } else { // Vertical guides (Left, Right)
                g.style.top = '0';
                g.style.bottom = '0';
                g.style.width = '1px';
            }
            workArea.appendChild(g);
            return g;
        });
    }
    
    if (el) {
        guides.forEach(g => g.style.display = 'block');
        
        const top = el.offsetTop;
        const bottom = el.offsetTop + el.offsetHeight;
        const left = el.offsetLeft;
        const right = el.offsetLeft + el.offsetWidth;
        
        guides[0].style.top = `${top}px`;
        guides[1].style.top = `${bottom}px`;
        guides[2].style.left = `${left}px`;
        guides[3].style.left = `${right}px`;
    } else {
        guides.forEach(g => { if(g) g.style.display = 'none'; });
    }
}

function limparMontagem() {
    const workArea = document.getElementById('mWorkArea');
    if (workArea) workArea.innerHTML = '';
    document.getElementById('mFile').value = '';
}

function baixarMontagem() {
    selectElement(null); // remove a borda de seleção

    const container = document.getElementById(containerId);
    const workArea = document.getElementById('mWorkArea');
    if (!workArea) return;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    const baseWidthPx = montagemConfig.canvasWidthCm * montagemConfig.pxPerCm;
    const baseHeightPx = montagemConfig.canvasHeightCm * montagemConfig.pxPerCm;
    const framePx = montagemConfig.frameSizeCm * montagemConfig.pxPerCm;
    const ppPx = montagemConfig.ppSizeCm * montagemConfig.pxPerCm;

    canvas.width = baseWidthPx + (framePx * 2);
    canvas.height = baseHeightPx + (framePx * 2);

    ctx.fillStyle = montagemConfig.frameColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const innerX = framePx;
    const innerY = framePx;
    const innerW = baseWidthPx;
    const innerH = baseHeightPx;

    ctx.fillStyle = montagemConfig.ppColor;
    ctx.fillRect(innerX, innerY, innerW, innerH);

    const workX = innerX + ppPx;
    const workY = innerY + ppPx;

    const images = Array.from(workArea.children);
    images.sort((a, b) => parseInt(a.style.zIndex || 0) - parseInt(b.style.zIndex || 0));

    images.forEach(wrap => {
        const img = wrap.querySelector('img');
        if (!img) return;

        const left = parseFloat(wrap.style.left) || 0;
        const top = parseFloat(wrap.style.top) || 0;
        const width = parseFloat(wrap.style.width) || 0;
        const height = parseFloat(wrap.style.height) || 0;

        const safeW = Math.max(1, width);
        const safeH = Math.max(1, height);
        const fitMode = _getWrapFitMode(wrap);

        let drawX = workX + left;
        let drawY = workY + top;
        let drawW = safeW;
        let drawH = safeH;

        if (fitMode === 'contain') {
            const scale = Math.min(safeW / img.naturalWidth, safeH / img.naturalHeight);
            drawW = img.naturalWidth * scale;
            drawH = img.naturalHeight * scale;
            drawX = workX + left + ((safeW - drawW) / 2);
            drawY = workY + top + ((safeH - drawH) / 2);
        } else {
            const scale = Math.max(safeW / img.naturalWidth, safeH / img.naturalHeight);
            drawW = img.naturalWidth * scale;
            drawH = img.naturalHeight * scale;
            drawX = workX + left + ((safeW - drawW) / 2);
            drawY = workY + top + ((safeH - drawH) / 2);
        }

        ctx.save();
        ctx.beginPath();
        ctx.rect(workX, workY, innerW - (ppPx*2), innerH - (ppPx*2));
        ctx.clip();

        ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, drawX, drawY, drawW, drawH);
        ctx.restore();
    });

    const link = document.createElement('a');
    link.download = 'colagem_passepartout.jpg';
    link.href = canvas.toDataURL('image/jpeg', 0.9);
    link.click();
}

function syncInputsFromPhoto(el) {
    const wInput = document.getElementById('mPhotoWidth');
    const hInput = document.getElementById('mPhotoHeight');
    const fitInput = document.getElementById('mPhotoFitMode');
    if (!wInput || !hInput || !fitInput) return;
    
    if (el) {
        wInput.disabled = false;
        hInput.disabled = false;
        fitInput.disabled = false;
        wInput.value = (el.offsetWidth / montagemConfig.pxPerCm).toFixed(1);
        hInput.value = (el.offsetHeight / montagemConfig.pxPerCm).toFixed(1);
        fitInput.value = _getWrapFitMode(el);
    } else {
        wInput.disabled = true;
        hInput.disabled = true;
        fitInput.disabled = true;
        wInput.value = '0';
        hInput.value = '0';
        fitInput.value = 'contain';
    }
}

function updateSelectedPhotoFitMode() {
    if (!selectedElement) return;
    const fitInput = document.getElementById('mPhotoFitMode');
    if (!fitInput) return;
    _applyWrapFitMode(selectedElement, fitInput.value);
}

function updateSelectedPhotoSize() {
    if (!selectedElement) return;
    const wInput = document.getElementById('mPhotoWidth');
    const hInput = document.getElementById('mPhotoHeight');
    
    const workArea = document.getElementById('mWorkArea');
    if (!workArea) return;

    let newW = parseFloat(wInput.value) * montagemConfig.pxPerCm;
    let newH = parseFloat(hInput.value) * montagemConfig.pxPerCm;
    
    if (isNaN(newW) || newW < 10) newW = 10;
    if (isNaN(newH) || newH < 10) newH = 10;

    // Mantém o tamanho solicitado e reposiciona a foto se ela ultrapassar as bordas.
    // Só limita quando o tamanho for maior que a própria área útil.
    newW = Math.min(newW, workArea.clientWidth);
    newH = Math.min(newH, workArea.clientHeight);

    let newLeft = selectedElement.offsetLeft;
    let newTop = selectedElement.offsetTop;

    if (newLeft + newW > workArea.clientWidth) {
        newLeft = Math.max(0, workArea.clientWidth - newW);
    }
    if (newTop + newH > workArea.clientHeight) {
        newTop = Math.max(0, workArea.clientHeight - newH);
    }

    selectedElement.style.left = `${newLeft}px`;
    selectedElement.style.top = `${newTop}px`;
    selectedElement.style.width = `${newW}px`;
    selectedElement.style.height = `${newH}px`;
    
    updateMontagemGuides(selectedElement);
    syncInputsFromPhoto(selectedElement);
}

window.addEventListener('resize', updateMontagemBase);
