// ═══════════════════════════════════════════════════════════
//  FAST FRAME — script.js  (auditado, sem declarações duplicadas)
// ═══════════════════════════════════════════════════════════

/*
MAPA FUNCIONAL DO FRONTEND (script.js)

1) Navegacao e estado global
- switchTab controla abas da SPA e sincroniza desktop/mobile nav.
- Estados globais por modulo (q*, c*, sq*, wall, catalogo, clientes, admin).

2) Pipeline de imagem
- Upload/drag-drop para imagem e PDF.
- Conversao HEIC/HEIF para JPEG (heic2any).
- Render em canvas para qualidade, cortes e simulacoes.

3) Qualidade e producao
- Calculo de DPI por tamanho em cm.
- Sugestao de formatos e indicador visual de qualidade.
- Exportacao em JPG/PDF e nomeacao padrao de arquivos.

4) Simuladores
- Simulacao de quadro individual (moldura, passepartout, medidas).
- Simulacao de ambiente integra wall_simulator.js.

5) Catalogo e persistencia
- Catalogo por loja (itens/pastas/simulacoes) via /api/store-state/catalog.
- Migracao de legado localStorage/IndexedDB para store_state no backend.

6) CRM e atendimento
- CRUD de clientes, historico e consultas/orcamentos via API Flask.

7) Administracao e monitoramento
- Gestao de unidades e logins (/api/stores).
- Dashboard administrativo consolidado (/api/admin/dashboard).

Observacao
- Este arquivo usa handlers globais chamados diretamente no HTML.
*/

// ── Estado global ──
let qImg=null, cImg=null, wEnvImg=null, wArtImg=null;
let customW=null, customH=null;
let wallFrameColor='#3C2F1E';
let ppActive=false, ppColor='#FFFFFF';
let splitOrient='h';  // 'h', 'v', 'grid'
let gridCols=2, gridRows=2;
let partWidths=[1], partHeights=[1];
let totalWcm=null, totalHcm=null;
let enhOrigCanvas=null, enhScale=1, enhFilter='none';
let enhRemoteEnabled=false;
let _enhRemotePrefLoaded=false;
const QI_PRESETS=[
  { key:'10x15', w:10, h:15 },
  { key:'13x18', w:13, h:18 },
  { key:'21x30', w:21, h:30 },
  { key:'30x40', w:30, h:40 },
  { key:'50x70', w:50, h:70 },
  { key:'60x90', w:60, h:90 },
];
let qiFitMode='cover';
let qiSizeLocked=true;
let qiAspectRatio=4/3;
let qiInitialW=null;
let qiInitialH=null;
let qiImageScale=1;
let qiImageScaleX=1;
let qiImageScaleY=1;
let qiImageOffsetX=0;
let qiImageOffsetY=0;
let qiSelectionActive=false;
let qiDimensionSync=false;
let qiRenderMetrics=null;
let qiDragState=null;
let qiMatColor='#FFFFFF';
const QI_STATE_KEY='ff_qi_state_v1';
let qiSmartSuggestion=null;
let _qiPersistTimer=null;
let _enhApplyTimer=null;
let _enhApplyToken=0;
let _qiRenderQueued=false;
const ENH_REMOTE_TIMEOUT_MS=45000;
const ENH_LOCAL_MAX_SIDE=16384;
const ENH_LOCAL_MAX_PIXELS=140000000;
const ENH_REMOTE_PREF_KEY='ff_enh_remote_enabled';


// ─────────────────────────────────────────────────────────
//  NOME DO ARQUIVO — prompt nativo
// ─────────────────────────────────────────────────────────
function askFileName(suffix, callback, customSuggestedName=null) {
  // Sugestão baseada no arquivo carregado
  let suggestion = 'fastframe';
  if (typeof qImg !== 'undefined' && qImg && qImg.file) {
    suggestion = qImg.file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
  }
  const suggestedName = customSuggestedName || (suggestion + '-' + suffix);

  // Detecta se o formato é PDF ou JPG pelo sufixo do callback
  // O callback vai chamar esta função com o nome final — precisamos saber o tipo
  // Guardamos para uso no saveWithPicker
  askFileName._lastSuffix = suffix;
  askFileName._lastCallback = callback;
  askFileName._lastSuggested = suggestedName;

  // Tenta usar File System Access API (Chrome/Edge)
  if (window.showSaveFilePicker) {
    // Determina extensão: será definida por quem chama (pdf ou jpg)
    // Não sabemos ainda — deixamos o callback decidir via _saveAs
    callback(suggestedName); // passa o nome sugerido, o download usará _saveAs
  } else {
    // Fallback: prompt simples
    const defaultPromptName = customSuggestedName || suggestedName.replace(/-[^-]+$/, '').replace(/-$/, '');
    const input = prompt('Nome do arquivo (sem extensão):', defaultPromptName);
    if (input === null) return;
    const base = (input.trim() || suggestion).replace(/[^a-zA-Z0-9\u00C0-\u00FF\s\-_]/g, '').replace(/\s+/g, '-').toLowerCase();
    callback(customSuggestedName ? base : (base + '-' + suffix));
  }
}

function suggestFileNameFromImage(img){
  const base=(qImg?.file?.name||img?.alt||'fastframe')
    .replace(/\.[^.]+$/,'')
    .replace(/[^a-zA-Z0-9\-_]+/g,'-')
    .replace(/-+/g,'-')
    .replace(/^-|-$/g,'')
    .toLowerCase() || 'fastframe';
  askFileName._lastSuggested=base;
  return base;
}

// Salva um Blob com janela nativa do sistema operacional
async function _saveAs(blob, suggestedName, mimeType) {
  const ext = mimeType === 'application/pdf' ? 'pdf' : (mimeType === 'application/json' ? 'json' : 'jpg');
  const fullName = suggestedName.endsWith('.' + ext) ? suggestedName : suggestedName + '.' + ext;

  if (window.showSaveFilePicker) {
    try {
      const types = ext === 'pdf'
        ? [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }]
        : ext === 'json'
        ? [{ description: 'Arquivo JSON', accept: { 'application/json': ['.json'] } }]
        : [{ description: 'Imagem JPEG', accept: { 'image/jpeg': ['.jpg', '.jpeg'] } }];

      const handle = await window.showSaveFilePicker({
        suggestedName: fullName,
        types
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    } catch (e) {
      if (e.name === 'AbortError') return false; // usuário cancelou
      // Fallback se der erro inesperado
    }
  }
  // Fallback: download automático
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fullName;
  a.click();
  return true;
}


// ─────────────────────────────────────────────────────────
//  NAVEGAÇÃO
// ─────────────────────────────────────────────────────────
function switchTab(id,btn){
  document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
  document.getElementById('tab-'+id).classList.add('active');
  if(id==='quadros'&&typeof qImg!=='undefined'&&qImg) requestAnimationFrame(()=>qiRenderDesigner());
  // Sync desktop nav
  document.querySelectorAll('[data-nav]').forEach(b=>b.classList.toggle('active',b.dataset.nav===id));
  // Sync mobile nav
  document.querySelectorAll('[data-mobilenav]').forEach(b=>b.classList.toggle('active',b.dataset.mobilenav===id));
  // Re-render simulação de quadros
  if(id==='simquadro'&&typeof sqImg!=='undefined'&&sqImg) requestAnimationFrame(()=>renderFrame());
  // Auto-popular simulação de quadros a partir da imagem carregada
  if(id==='simquadro'&&!sqImg&&typeof qImg!=='undefined'&&qImg){
    const box=document.getElementById('sqUploadBox');
    if(box&&box.style.display!=='none'){ sqImg=qImg; showSQ(); toast('Usando a imagem carregada em Imagem & Qualidade.'); }
  }
  if(id==='simquadro'&&typeof ffAplicarComposicaoDivisaoNoQuadro==='function'&&_ffSplitComposicaoDataUrl){
    ffAplicarComposicaoDivisaoNoQuadro(false);
  }
  // Auto-popular divisão a partir da imagem carregada
  if(id==='canvas'&&!cImg&&typeof qImg!=='undefined'&&qImg){
    const results=document.getElementById('cResults');
    if(results&&results.style.display==='none'){
      cImg=qImg;
      const box=document.getElementById('cUploadBox');
      if(box) box.style.display='none';
      showC();
      toast('Usando a imagem carregada em Imagem & Qualidade.');
    }
  }
  if(id==='simulador'&&typeof ffAplicarComposicaoDivisaoNoAmbiente==='function'&&_ffSplitComposicaoDataUrl){
    if(_ffSkipNextSplitAutoApplyAmbiente){
      _ffSkipNextSplitAutoApplyAmbiente=false;
    } else {
      ffAplicarComposicaoDivisaoNoAmbiente(false);
    }
  }
  if(id==='clientes' && typeof carregarClientes==='function'){
    carregarClientes();
  }
  if(id==='catalogo'){
    ffCatalogInit();
    ffCatalogRender();
  }
  if(id==='admin' && typeof adminDashboardLoad==='function'){
    adminDashboardLoad();
  }

  const activeDesktopNav=document.querySelector('header nav .nav-item.active');
  if(activeDesktopNav){
    activeDesktopNav.scrollIntoView({ behavior:'smooth', block:'nearest', inline:'nearest' });
  }
  if(typeof updateNavScrollControls==='function') updateNavScrollControls();
}

function _getDesktopHeaderNav(){
  return document.querySelector('header nav');
}

function scrollNavTabs(direction){
  const nav=_getDesktopHeaderNav();
  if(!nav) return;
  const step=Math.max(180,Math.round(nav.clientWidth*0.5));
  nav.scrollBy({ left:(direction<0?-step:step), behavior:'smooth' });
  setTimeout(updateNavScrollControls,220);
}

function updateNavScrollControls(){
  const nav=_getDesktopHeaderNav();
  const controls=document.getElementById('navScrollControls');
  const leftBtn=document.getElementById('navScrollLeft');
  const rightBtn=document.getElementById('navScrollRight');
  if(!nav||!controls||!leftBtn||!rightBtn) return;

  if(window.matchMedia('(max-width: 900px)').matches){
    controls.style.display='none';
    return;
  }

  const maxLeft=Math.max(0,nav.scrollWidth-nav.clientWidth);
  const hasOverflow=maxLeft>2;
  controls.style.display=hasOverflow?'flex':'none';
  leftBtn.disabled=!hasOverflow||nav.scrollLeft<=2;
  rightBtn.disabled=!hasOverflow||nav.scrollLeft>=maxLeft-2;
}

// ─────────────────────────────────────────────────────────
//  TOAST
// ─────────────────────────────────────────────────────────
function toast(msg){
  const t=document.getElementById('toast');
  t.textContent=msg; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),3200);
}

// ─────────────────────────────────────────────────────────
//  DRAG & DROP
// ─────────────────────────────────────────────────────────
function dov(e,zid){ e.preventDefault(); document.getElementById(zid).classList.add('drag'); }
function dol(e,zid){ document.getElementById(zid).classList.remove('drag'); }

function dod(e,zid,type){
  e.preventDefault();
  document.getElementById(zid).classList.remove('drag');
  const file=e.dataTransfer.files[0];
  if(!file) return;
  // aceitar PDF ou imagem
  const isPDF=file.type==='application/pdf'||file.name.toLowerCase().endsWith('.pdf');
  if(!isPDF&&!file.type.startsWith('image/')) return toast('Envie uma imagem ou PDF válido.');
  loadImgFile(file,type);
}

// ─────────────────────────────────────────────────────────
//  CARREGAR IMAGEM / PDF
// ─────────────────────────────────────────────────────────
function loadQ(e){ loadImgFile(e.target.files[0],'q'); }
function loadC(e){ loadImgFile(e.target.files[0],'c'); }

function _isHeicLike(file){
  if(!file) return false;
  const type=String(file.type||'').toLowerCase();
  const name=String(file.name||'').toLowerCase();
  return type==='image/heic'||type==='image/heif'||name.endsWith('.heic')||name.endsWith('.heif');
}

function _isDngLike(file){
  if(!file) return false;
  const type=String(file.type||'').toLowerCase();
  const name=String(file.name||'').toLowerCase();
  return type.includes('dng')||name.endsWith('.dng');
}

function _blobToPreparedFile(blob, originalName){
  const safeBase=String(originalName||'imagem')
    .replace(/\.[^.]+$/,'')
    .replace(/[^a-zA-Z0-9\-_]+/g,'-')
    .replace(/-+/g,'-')
    .replace(/^-|-$/g,'') || 'imagem';

  const type=String(blob?.type||'').toLowerCase();
  const ext=(type==='image/png')?'png':'jpg';
  const mime=(type==='image/png')?'image/png':'image/jpeg';
  return new File([blob], `${safeBase}.${ext}`, { type:mime });
}

async function _convertDngToBlob(file){
  const fd=new FormData();
  fd.append('file', file, file.name||'arquivo.dng');
  fd.append('output', 'png');
  const resp=await fetch('/api/convert-dng', {
    method:'POST',
    body:fd,
    credentials:'same-origin'
  });
  if(!resp.ok){
    let detail='Falha ao converter DNG.';
    try{
      const data=await resp.json();
      detail=data?.details||data?.error||detail;
    }catch(_e){
      // sem detalhes json
    }
    throw new Error(detail);
  }
  return await resp.blob();
}

async function _ffPrepareImageFile(file){
  if(!file) return null;
  if(_isHeicLike(file)){
    const blob=await heic2any({blob:file,toType:'image/jpeg',quality:.9});
    return _blobToPreparedFile(blob, file.name);
  }
  if(_isDngLike(file)){
    const blob=await _convertDngToBlob(file);
    return _blobToPreparedFile(blob, file.name);
  }
  return file;
}

function _extractCmSizeFromFileName(name){
  if(!name) return null;
  const normalized=String(name)
    .replace(/\.[^.]+$/,'')
    .replace(/[_-]+/g,' ')
    .replace(/\s+/g,' ')
    .trim();

  // Com "cm" explicito, aceita formatos amplos.
  let match=normalized.match(/(?:^|[^a-zA-Z0-9])(\d+(?:[.,]\d+)?)\s*(?:x|X|×)\s*(\d+(?:[.,]\d+)?)\s*cm\b/i);
  // Sem "cm", evita capturar trechos colados em palavras (ex.: "de2x3").
  if(!match){
    match=normalized.match(/(?:^|[^a-zA-Z0-9])(\d+(?:[.,]\d+)?)\s*(?:x|X|×)\s*(\d+(?:[.,]\d+)?)(?=$|[^a-zA-Z0-9])/i);
  }
  if(!match) return null;
  const w=parseFloat(match[1].replace(',','.'));
  const h=parseFloat(match[2].replace(',','.'));
  if(!validatePositiveFrameValue(w)||!validatePositiveFrameValue(h)) return null;
  if(w<1||w>500||h<1||h>500) return null;
  return { w, h };
}

function _inferCmFromExportedPixels(fileName,wPx,hPx){
  if(!fileName) return null;
  const base=String(fileName).toLowerCase();
  if(!base.includes('enquadrada')) return null;

  const w=Math.round(((wPx/300)*2.54)*10)/10;
  const h=Math.round(((hPx/300)*2.54)*10)/10;
  if(!validatePositiveFrameValue(w)||!validatePositiveFrameValue(h)) return null;
  if(w<1||w>500||h<1||h>500) return null;
  return { w, h };
}

function loadImgFile(file,type){
  if(!file) return;
  const inferredSizeByName=(type==='q')?_extractCmSizeFromFileName(file.name):null;
  if(file.type==='application/pdf'||file.name.toLowerCase().endsWith('.pdf')){
    loadPDF(file,type); return;
  }
  const run=(preparedFile)=>{
    const blob=(preparedFile instanceof Blob)?preparedFile:file;
    const imgEl=new Image();
    imgEl.onload=()=>{
      const d2={img:imgEl,file:preparedFile||file,w:imgEl.naturalWidth,h:imgEl.naturalHeight};
      if(type==='q'){
        const inferredSize=inferredSizeByName||_inferCmFromExportedPixels((preparedFile?.name||file.name),imgEl.naturalWidth,imgEl.naturalHeight);
        customW=inferredSize?inferredSize.w:null;
        customH=inferredSize?inferredSize.h:null;
        qImg=d2;
        showQ();
      }
      else if(type==='sq'){ sqImg=d2; showSQ(); }
      else           { cImg=d2; showC(); }
    };
    imgEl.onerror=()=>toast('Este arquivo de imagem nao pode ser aberto neste dispositivo.');
    imgEl.src=URL.createObjectURL(blob);
  };
  _ffPrepareImageFile(file)
    .then(run)
    .catch((err)=>{
      console.error('Falha ao preparar imagem', err);
      if(_isDngLike(file)) toast('Nao foi possivel abrir este DNG aqui. Tente outro DNG ou converta para JPG.');
      else toast('Nao foi possivel abrir a imagem selecionada.');
    });
}

function loadPDF(file,type){
  const fallback=()=>{
    const c=document.createElement('canvas'); c.width=800; c.height=600;
    const ctx=c.getContext('2d');
    ctx.fillStyle='#F4F4F4'; ctx.fillRect(0,0,800,600);
    ctx.fillStyle='#1A3051'; ctx.font='bold 26px sans-serif'; ctx.textAlign='center';
    ctx.fillText('PDF: '+file.name,400,260);
    ctx.font='17px sans-serif'; ctx.fillStyle='#666';
    ctx.fillText('Nao foi possivel renderizar a primeira pagina.',400,310);
    c.toBlob(blob=>{
      if(!blob) return toast('Falha ao abrir o PDF.');
      const fi=new Image();
      fi.onload=()=>{ _dispatchImg({img:fi,file,w:800,h:600},type); };
      fi.src=URL.createObjectURL(blob);
    },'image/jpeg',0.92);
  };

  (async()=>{
    if(!window.pdfjsLib){
      fallback();
      return;
    }

    try{
      if(!pdfjsLib.GlobalWorkerOptions.workerSrc){
        pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      }

      const data=new Uint8Array(await file.arrayBuffer());
      const pdf=await pdfjsLib.getDocument({ data }).promise;
      const page=await pdf.getPage(1);
      const initialViewport=page.getViewport({ scale:1 });
      const maxSide=2200;
      const scale=Math.min(2.5, maxSide/Math.max(initialViewport.width, initialViewport.height)) || 1;
      const viewport=page.getViewport({ scale });
      const canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(viewport.width));
      canvas.height=Math.max(1,Math.round(viewport.height));
      await page.render({ canvasContext:canvas.getContext('2d'), viewport }).promise;

      const imgEl=new Image();
      imgEl.onload=()=>{
        _dispatchImg({img:imgEl,file,w:imgEl.naturalWidth||canvas.width,h:imgEl.naturalHeight||canvas.height},type);
      };
      imgEl.onerror=fallback;
      imgEl.src=canvas.toDataURL('image/jpeg',0.95);
    }catch(err){
      console.error('Falha ao abrir PDF', err);
      fallback();
    }
  })();
}

// ─────────────────────────────────────────────────────────
//  MOTOR DE QUALIDADE
// ─────────────────────────────────────────────────────────
function qualityLevel(imgW,imgH,printCmW,printCmH){
  const dpi=Math.round(Math.min(imgW/(printCmW/2.54),imgH/(printCmH/2.54)));
  return qualityLevelByDpi(dpi);
}

function qualityLevelByDpi(dpi){
  if(dpi>=250) return{level:5,label:'⭐ Perfeita',         color:'#2E7D52',bg:'#EBF7F0',icon:'✅'};
  if(dpi>=180) return{level:4,label:'👍 Muito boa',        color:'#3A6E2A',bg:'#EFF6EB',icon:'✅'};
  if(dpi>=120) return{level:3,label:'👌 Boa',              color:'#8B6400',bg:'#FDF6E3',icon:'⚠️'};
  if(dpi>=80)  return{level:2,label:'⚠️ Aceitável',        color:'#A0520A',bg:'#FEF0E4',icon:'⚠️'};
  return              {level:1,label:'❌ Não recomendado', color:'#9B2020',bg:'#FDECEC',icon:'❌'};
}

function qualityBar(level){
  const fills=['#9B2020','#C06020','#B8903C','#3A6E2A','#2E7D52'];
  const bars=[];
  for(let i=1;i<=5;i++)
    bars.push(`<div style="flex:1;height:8px;border-radius:4px;background:${i<=level?fills[level-1]:'#E0DAD0'};transition:background .3s"></div>`);
  return `<div style="display:flex;gap:4px;margin-top:6px">${bars.join('')}</div>`;
}

function maxPrintCm(imgW,imgH){
  const mn=Math.min(imgW,imgH), mx=Math.max(imgW,imgH);
  const mnC=Math.floor(mn/180*2.54), mxC=Math.floor(mx/180*2.54);
  return imgW>=imgH ? [mxC,mnC] : [mnC,mxC];
}

function estimatePrintDpi(imgW,imgH,printCmW,printCmH){
  return Math.max(1,Math.round(Math.min(imgW/(printCmW/2.54),imgH/(printCmH/2.54))));
}

function estimateEffectiveExportDpiForSize(printCmW,printCmH){
  const targetDpi=300;
  const maxPx=10000;
  const targetW=Math.max(1,Math.round((printCmW/2.54)*targetDpi));
  const targetH=Math.max(1,Math.round((printCmH/2.54)*targetDpi));

  let outW=targetW;
  let outH=targetH;
  let scaled=false;
  const maxSide=Math.max(outW,outH);
  if(maxSide>maxPx){
    const ratio=maxPx/maxSide;
    outW=Math.max(1,Math.round(outW*ratio));
    outH=Math.max(1,Math.round(outH*ratio));
    scaled=true;
  }

  const exportDpi=Math.max(1,Math.round(Math.min((outW*2.54)/printCmW,(outH*2.54)/printCmH)));
  const srcW=qImg?.img?.naturalWidth||qImg?.img?.width||0;
  const srcH=qImg?.img?.naturalHeight||qImg?.img?.height||0;
  const sourceDpi=(srcW>0&&srcH>0)
    ? Math.max(1,Math.round(Math.min((srcW*2.54)/printCmW,(srcH*2.54)/printCmH)))
    : exportDpi;

  return {
    dpi:Math.min(exportDpi,sourceDpi),
    exportDpi,
    sourceDpi,
    scaled,
  };
}

function dpiBadgeMeta(dpi){
  if(dpi>=220) return { tone:'alto', color:'#245A38', bg:'#EAF7EF' };
  if(dpi>=180) return { tone:'bom', color:'#3A6E2A', bg:'#EFF6EB' };
  if(dpi>=120) return { tone:'medio', color:'#8B6400', bg:'#FDF6E3' };
  return { tone:'baixo', color:'#9B2020', bg:'#FDECEC' };
}

// ─────────────────────────────────────────────────────────
//  ABA QUADROS
// ─────────────────────────────────────────────────────────
function showQ(){
  const{img,file,w,h}=qImg;
  document.getElementById('qThumb').style.display='block';
  document.getElementById('qThumb').innerHTML=buildThumb(img.src,file.name,w,h,file.size,'resetQ()');
  document.getElementById('pxDisp').innerHTML=w.toLocaleString()+' × '+h.toLocaleString()+' px';

  const mp=w*h/1e6;
  let qlabel,qcolor,qdesc;
  if(mp>=12)     { qlabel='⭐⭐⭐ Alta resolução'; qcolor='#2E7D52'; qdesc='Ideal para quadros grandes'; }
  else if(mp>=6) { qlabel='⭐⭐ Boa resolução';    qcolor='#3A6E2A'; qdesc='Ótima para a maioria dos tamanhos'; }
  else if(mp>=2) { qlabel='⭐ Resolução média';    qcolor='#8B6400'; qdesc='Adequada para quadros pequenos e médios'; }
  else           { qlabel='Resolução baixa';       qcolor='#9B2020'; qdesc='Recomendada apenas para quadros pequenos'; }

  document.getElementById('imgQuality').innerHTML=
    `<div style="font-size:18px;font-weight:700;color:${qcolor}">${qlabel}</div>
     <div style="font-size:12px;color:#8C8278;margin-top:3px">${qdesc}</div>`;

  const[mw,mh]=maxPrintCm(w,h);
  document.getElementById('maxSize').innerHTML=
    `<span style="font-size:28px;font-weight:800;color:var(--brown)">${mw} × ${mh} cm</span>
     <div style="font-size:12px;color:var(--gray);margin-top:4px">Maior tamanho com ótima qualidade</div>`;

  const sizes=[[20,30],[30,40],[40,50],[40,60],[50,70],[60,80],[60,90],[70,100],[80,100],[80,120],[100,150],[120,160],[120,180]];
  const tb=document.getElementById('sugTb');
  tb.innerHTML='';
  sizes.forEach(([sw,sh])=>{
    const eff=estimateEffectiveExportDpiForSize(sw,sh);
    const dpi=eff.dpi;
    const q=qualityLevelByDpi(dpi);
    const dpiMeta=dpiBadgeMeta(dpi);
    const dpiTitle=eff.scaled
      ? `DPI base ${eff.sourceDpi} | DPI exportacao ${eff.exportDpi} (limite de 10.000 px)`
      : `DPI base ${eff.sourceDpi}`;
    tb.innerHTML+=`<tr>
      <td style="font-weight:600">${sw} × ${sh} cm</td>
      <td><span title="${dpiTitle}" style="display:inline-block;padding:3px 10px;border-radius:20px;background:${dpiMeta.bg};color:${dpiMeta.color};font-size:11px;font-weight:700;white-space:nowrap">${dpi} DPI</span></td>
      <td>${qualityBar(q.level)}</td>
      <td><span style="background:${q.bg};color:${q.color};padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;white-space:nowrap">${q.label}</span></td>
    </tr>`;
  });

  document.getElementById('qResults').style.display='block';
  const qiCard=document.getElementById('qiDesignerCard');
  if(qiCard) qiCard.style.display='block';
  document.getElementById('enhCard').style.display='block';
  qiInitFromQImage();
  initEnhFromQImg();
  suggestFileNameFromImage(img);
}

function _qiRound(value, decimals=1){
  const factor=10**decimals;
  return Math.round((Number(value)||0)*factor)/factor;
}

function _qiFormatInput(value){
  const rounded=_qiRound(value,1);
  return Number.isInteger(rounded)?String(rounded):rounded.toFixed(1);
}

function _qiCurrentSize(){
  const w=parseFloat(document.getElementById('qiW')?.value);
  const h=parseFloat(document.getElementById('qiH')?.value);
  return { w, h };
}

function _qiValidSize(){
  const wEl=document.getElementById('qiW');
  const hEl=document.getElementById('qiH');
  if(!wEl||!hEl) return false;
  const okW=validateCmInput(wEl,1,500);
  const okH=validateCmInput(hEl,1,500);
  return okW&&okH&&validatePositiveFrameValue(wEl.value)&&validatePositiveFrameValue(hEl.value);
}

function qiUpdatePresetState(){
  const { w, h }=_qiCurrentSize();
  document.querySelectorAll('[data-qi-preset]').forEach((btn)=>{
    const preset=QI_PRESETS.find(item=>item.key===btn.dataset.qiPreset);
    const matched=Boolean(preset&&Math.abs((w||0)-preset.w)<0.05&&Math.abs((h||0)-preset.h)<0.05);
    btn.classList.toggle('active',matched);
  });
}

function qiUpdateMeta(){
  const lockBtn=document.getElementById('qiLockBtn');
  const lockIcon=document.getElementById('qiLockIcon');
  if(lockBtn){
    lockBtn.classList.toggle('active',qiSizeLocked);
    lockBtn.setAttribute('aria-pressed',qiSizeLocked?'true':'false');
    lockBtn.title=qiSizeLocked?'Proporcao travada':'Proporcao livre';
  }
  if(lockIcon) lockIcon.textContent=qiSizeLocked?'🔒':'🔓';
  const info=document.getElementById('qiInfo');
  const liveStatus=document.getElementById('qiLiveStatus');
  const { w, h }=_qiCurrentSize();
  if(info&&validatePositiveFrameValue(w)&&validatePositiveFrameValue(h)){
    const parts=[`Area final: ${_qiRound(w)} x ${_qiRound(h)} cm`];
    parts.push(`Escala H: ${Math.round(qiImageScaleX*100)}% · V: ${Math.round(qiImageScaleY*100)}%`);
    parts.push(qiFitMode==='cover'?'Modo: preencher':'Modo: encaixar');
    parts.push(`Fundo: ${qiMatColor.toUpperCase()}`);
    parts.push('Interacao: alcas e controles H/V');
    info.textContent=parts.join('  ·  ');
  }
  if(liveStatus){
    liveStatus.classList.remove('mode-cover','mode-contain');
    liveStatus.classList.add(qiFitMode==='cover'?'mode-cover':'mode-contain');
    const mode=qiFitMode==='cover'?'Preencher':'Encaixar';
    const modeIcon=qiFitMode==='cover'?'▣':'□';
    const zoom=Math.round(((qiImageScaleX+qiImageScaleY)/2)*100);
    const offX=_qiRound(qiImageOffsetX,1);
    const offY=_qiRound(qiImageOffsetY,1);
    liveStatus.textContent=`${modeIcon} Encaixe: ${mode} · Zoom: ${zoom}% · Offset: ${offX} cm / ${offY} cm`;
  }
  qiUpdateSmartAlert();
  qiUpdateExportPresetInfo();
  qiSchedulePersistState();
}

function qiUpdateSmartAlert(){
  const alertEl=document.getElementById('qiSmartAlert');
  if(!alertEl) return;
  const spec=qiGetExportSpec();
  if(!spec){
    qiSmartSuggestion=null;
    alertEl.className='qi-smart-alert hidden';
    alertEl.textContent='';
    return;
  }

  const avgScale=(qiImageScaleX+qiImageScaleY)/2;
  let tone='ok';
  let title='PODE SALVAR';
  let nextStep='O arquivo já está numa faixa segura para exportar sem IA.';
  let detail=`DPI efetivo ${spec.effectiveDpi}. Enquadramento pronto para exportação.`;
  let actionLabel='';
  qiSmartSuggestion=null;
  const aiRecommendation=qiGetAiRecommendationForSpec(spec);

  if(spec.effectiveDpi<150){
    tone='danger';
    title='USE IA';
    nextStep='A imagem está baixa para impressão. Use IA ou reduza o tamanho final.';
    detail=`DPI efetivo ${spec.effectiveDpi}. Reduza o tamanho final em cm ou use imagem com maior resolução.`;
    actionLabel='Ajustar tamanho';
    qiSmartSuggestion={ type:'resizeToDpi', targetDpi:220 };
  } else if(spec.scaled||spec.effectiveDpi<220){
    tone='warn';
    title='RECOMENDO TESTAR';
    nextStep='O fluxo local ainda pode funcionar, mas vale conferir uma prova antes de fechar.';
    detail=`DPI efetivo ${spec.effectiveDpi}${spec.scaled?' (limitado por 10.000 px).':''} Pode perder definição em visualização próxima.`;
    actionLabel='Tentar 220 DPI';
    qiSmartSuggestion={ type:'resizeToDpi', targetDpi:220 };
  } else if(avgScale>2.2){
    tone='warn';
    title='RECOMENDO TESTAR';
    nextStep='Reduza o zoom para comparar o detalhe real da imagem.';
    detail='Escala da imagem acima de 220%. Verifique se não há perda de detalhe nas áreas importantes.';
    actionLabel='Voltar zoom para 100%';
    qiSmartSuggestion={ type:'resetZoom' };
  } else if(qiFitMode==='contain'){
    tone='info';
    title='PODE SALVAR';
    nextStep='Use Preencher se quiser ocupar toda a área da impressão.';
    detail='Pode gerar margens visíveis no enquadramento. Use Preencher se quiser ocupar toda a área.';
    actionLabel='Trocar para Preencher';
    qiSmartSuggestion={ type:'setFitCover' };
  }

  if(aiRecommendation){
    detail += ` Sugestão de fluxo: ${aiRecommendation.name} — ${aiRecommendation.detail}`;
  }

  detail += qiGetUsageGuidanceForSpec(spec, aiRecommendation);

  alertEl.className=`qi-smart-alert ${tone}`;
  if(qiSmartSuggestion&&actionLabel){
    alertEl.innerHTML=`<div class="qi-smart-badge">${title}</div><strong>Próximo passo</strong><span class="qi-smart-next">${nextStep}</span><span>${detail}</span><button class="qi-smart-action" type="button" onclick="qiApplySmartSuggestion()">${actionLabel}</button>`;
    return;
  }
  alertEl.innerHTML=`<div class="qi-smart-badge">${title}</div><strong>Próximo passo</strong><span class="qi-smart-next">${nextStep}</span><span>${detail}</span>`;
}

function qiGetUsageGuidanceForSpec(spec, aiRecommendation){
  if(!spec) return '';

  if(spec.effectiveDpi>=220){
    return ' Regra prática: LOCAL suficiente. Pode salvar assim; use IA só se o teste impresso ainda mostrar perda de detalhe.';
  }

  if(spec.effectiveDpi>=180){
    const flow=aiRecommendation?.name==='Replicate'
      ? 'IA recomendada se a arte tiver detalhes finos.'
      : 'LOCAL ainda pode ser suficiente se a arte estiver boa visualmente.';
    return ` Regra prática: FAIXA INTERMEDIÁRIA. ${flow}`;
  }

  if(aiRecommendation?.name==='Replicate'){
    return ' Regra prática: IA fortemente recomendada. A definição está baixa para impressão; faça o primeiro ajuste local e, se ainda ficar limitado, use a IA externa.';
  }

  return ' Regra prática: ajuste o tamanho ou use uma imagem de origem maior antes de exportar.';
}

function qiApplySmartSuggestion(){
  if(!qiSmartSuggestion) return;
  if(qiSmartSuggestion.type==='setFitCover'){
    qiSetFitMode('cover');
    toast('Modo alterado para Preencher.');
    return;
  }
  if(qiSmartSuggestion.type==='resetZoom'){
    qiAdjustZoom(100);
    toast('Zoom ajustado para 100%.');
    return;
  }
  if(qiSmartSuggestion.type==='resizeToDpi'){
    const spec=qiGetExportSpec();
    const wEl=document.getElementById('qiW');
    const hEl=document.getElementById('qiH');
    if(!spec||!wEl||!hEl) return;
    const target=Math.max(150,parseInt(qiSmartSuggestion.targetDpi)||220);
    const ratio=Math.min(1,spec.effectiveDpi/target);
    const nextW=Math.max(1,_qiRound(spec.wCm*ratio,1));
    const nextH=Math.max(1,_qiRound(spec.hCm*ratio,1));
    wEl.value=_qiFormatInput(nextW);
    hEl.value=_qiFormatInput(nextH);
    qiAspectRatio=Math.max(0.1,nextW/Math.max(0.1,nextH));
    qiUpdatePresetState();
    qiApplyToCustomCheck(true);
    qiRenderDesigner();
    toast(`Tamanho ajustado para aproximadamente ${target} DPI.`);
  }
}

function _qiStateImageKey(){
  if(!qImg) return null;
  const name=(qImg.file?.name||'').toLowerCase();
  return `${qImg.w}x${qImg.h}|${name}`;
}

function qiSchedulePersistState(){
  if(_qiPersistTimer) clearTimeout(_qiPersistTimer);
  _qiPersistTimer=setTimeout(()=>{
    _qiPersistTimer=null;
    qiPersistState();
  },180);
}

function qiPersistState(){
  if(!qImg) return;
  const { w, h }=_qiCurrentSize();
  if(!validatePositiveFrameValue(w)||!validatePositiveFrameValue(h)) return;
  try{
    const payload={
      imageKey:_qiStateImageKey(),
      w,
      h,
      fit:qiFitMode,
      sizeLocked:qiSizeLocked,
      aspect:qiAspectRatio,
      scaleX:qiImageScaleX,
      scaleY:qiImageScaleY,
      offsetX:qiImageOffsetX,
      offsetY:qiImageOffsetY,
      matColor:qiMatColor,
      initialW:qiInitialW,
      initialH:qiInitialH,
      customW,
      customH,
      savedAt:Date.now()
    };
    localStorage.setItem(QI_STATE_KEY,JSON.stringify(payload));
  } catch {}
}

function _qiClampNum(v,min,max,fallback){
  const n=parseFloat(v);
  if(!Number.isFinite(n)) return fallback;
  return Math.max(min,Math.min(max,n));
}

function _qiMatPresetIndex(color){
  const list=['#FFFFFF','#F5F0E8','#E8E0D0','#D9DDE5','#111111'];
  const normalized=String(color||'').toUpperCase();
  return list.findIndex((item)=>item===normalized);
}

function qiRestoreStateFromStorage(){
  if(!qImg) return false;
  let saved;
  try{
    saved=JSON.parse(localStorage.getItem(QI_STATE_KEY)||'null');
  } catch {
    return false;
  }
  if(!saved||saved.imageKey!==_qiStateImageKey()) return false;

  const wEl=document.getElementById('qiW');
  const hEl=document.getElementById('qiH');
  if(!wEl||!hEl) return false;

  if(validatePositiveFrameValue(saved.initialW)&&validatePositiveFrameValue(saved.initialH)){
    qiInitialW=saved.initialW;
    qiInitialH=saved.initialH;
  }

  if(validatePositiveFrameValue(saved.w)&&validatePositiveFrameValue(saved.h)){
    wEl.value=_qiFormatInput(saved.w);
    hEl.value=_qiFormatInput(saved.h);
  }

  qiSizeLocked=Boolean(saved.sizeLocked);
  qiAspectRatio=validatePositiveFrameValue(saved.aspect)?saved.aspect:qiAspectRatio;
  qiFitMode=saved.fit==='contain'?'contain':'cover';
  document.querySelectorAll('[data-qi-fit]').forEach((item)=>{
    item.classList.toggle('active',item.dataset.qiFit===qiFitMode);
  });

  qiImageScaleX=_qiClampNum(saved.scaleX,0.35,4,1);
  qiImageScaleY=_qiClampNum(saved.scaleY,0.35,4,1);
  qiImageOffsetX=_qiClampNum(saved.offsetX,-10000,10000,0);
  qiImageOffsetY=_qiClampNum(saved.offsetY,-10000,10000,0);
  _qiSyncLegacyScale();

  const color=(typeof saved.matColor==='string'&&saved.matColor.trim())?saved.matColor:'#FFFFFF';
  qiSetMatColor(color,_qiMatPresetIndex(color));

  customW=validatePositiveFrameValue(saved.customW)?saved.customW:null;
  customH=validatePositiveFrameValue(saved.customH)?saved.customH:null;
  return true;
}

function qiSetMatColor(color, idx){
  qiMatColor=color;
  const picker=document.getElementById('qiMatColorPicker');
  if(picker&&picker.value!==color) picker.value=color;
  for(let i=0;i<5;i++){
    const el=document.getElementById('qiMatSw'+i);
    if(el) el.classList.toggle('active', i===idx && idx>=0);
  }
  qiRenderDesigner();
}

function qiGetExportSpec(){
  const dpi=300;
  const maxPx=10000;
  const { w: wCm, h: hCm }=_qiCurrentSize();
  if(!validatePositiveFrameValue(wCm)||!validatePositiveFrameValue(hCm)) return null;

  const targetW=Math.max(1,Math.round((wCm/2.54)*dpi));
  const targetH=Math.max(1,Math.round((hCm/2.54)*dpi));
  let outW=targetW;
  let outH=targetH;
  let scaled=false;

  const maxSide=Math.max(outW,outH);
  if(maxSide>maxPx){
    const ratio=maxPx/maxSide;
    outW=Math.max(1,Math.round(outW*ratio));
    outH=Math.max(1,Math.round(outH*ratio));
    scaled=true;
  }

  const dpiW=(outW*2.54)/wCm;
  const dpiH=(outH*2.54)/hCm;
  const effectiveDpi=Math.round(Math.min(dpiW,dpiH));
  return { wCm, hCm, dpi, targetW, targetH, outW, outH, scaled, effectiveDpi };
}

function qiUpdateExportPresetInfo(){
  const el=document.getElementById('qiExportSpec');
  if(!el) return;
  const spec=qiGetExportSpec();
  if(!spec){
    el.textContent='Defina largura e altura para ver a saida exata da exportacao.';
    return;
  }
  const area=`${_qiRound(spec.wCm)} x ${_qiRound(spec.hCm)} cm`;
  const px=`${spec.outW.toLocaleString('pt-BR')} x ${spec.outH.toLocaleString('pt-BR')} px`;
  if(spec.scaled){
    el.textContent=`Saida: ${area} · ${px} · ${spec.effectiveDpi} DPI efetivo (limite tecnico de 10.000 px aplicado).`;
    return;
  }
  el.textContent=`Saida: ${area} · ${px} · ${spec.dpi} DPI.`;
}

function qiGetAiRecommendationForSpec(spec){
  if(!spec) return null;

  const outputMp=(spec.outW*spec.outH)/1e6;
  const longSideCm=Math.max(spec.wCm,spec.hCm);
  const srcW=qImg?.img?.naturalWidth||qImg?.img?.width||0;
  const srcH=qImg?.img?.naturalHeight||qImg?.img?.height||0;
  const sourceDpi=(srcW>0&&srcH>0)
    ? Math.max(1,Math.round(Math.min((srcW*2.54)/spec.wCm,(srcH*2.54)/spec.hCm)))
    : spec.effectiveDpi;

  // Se o DPI efetivo já está confortável para impressão, evitar recomendar IA novamente.
  if(spec.effectiveDpi>=200){
    return {
      name:'Local',
      detail:'DPI já está em faixa segura para impressão. Use IA apenas se o teste impresso ainda mostrar perda de detalhe.'
    };
  }

  // Se a imagem base já possui DPI alto, mas caiu no limite técnico de exportação,
  // IA não resolve o gargalo principal deste fluxo de exportação.
  if(spec.scaled&&sourceDpi>=220){
    return {
      name:'Local',
      detail:`a imagem base já está alta (${sourceDpi} DPI). O limite atual é técnico de exportação (10.000 px), não falta de resolução da arte.`
    };
  }

  if(outputMp>=35 || longSideCm>=80 || spec.effectiveDpi<180 || spec.scaled){
    return {
      name:'Replicate',
      detail:'bom equilíbrio entre custo e qualidade para imagens grandes; é o caminho remoto mais barato que já deixei pronto.'
    };
  }

  return {
    name:'Local',
    detail:'suficiente para imagens pequenas e médias, com o menor custo operacional.'
  };
}

async function qiCanvasToBlob(canvas, mimeType='image/jpeg', quality=0.95){
  return new Promise((resolve, reject)=>{
    if(!canvas?.toBlob) {
      reject(new Error('Canvas sem suporte a toBlob.'));
      return;
    }
    canvas.toBlob((blob)=>{
      if(!blob) reject(new Error('Falha ao gerar blob da imagem.'));
      else resolve(blob);
    }, mimeType, quality);
  });
}

async function qiBlobToCanvas(blob){
  const url=URL.createObjectURL(blob);
  try{
    const img=new Image();
    const loaded=await new Promise((resolve,reject)=>{
      img.onload=()=>resolve(true);
      img.onerror=()=>reject(new Error('Falha ao carregar imagem retornada pela IA.'));
      img.src=url;
    });
    if(!loaded) return null;
    const canvas=document.createElement('canvas');
    canvas.width=img.naturalWidth||img.width;
    canvas.height=img.naturalHeight||img.height;
    canvas.getContext('2d').drawImage(img,0,0);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function qiEnhanceWithReplicate(sourceCanvas, scale){
  const blob=await qiCanvasToBlob(sourceCanvas, 'image/jpeg', 0.95);
  const form=new FormData();
  form.append('file', blob, 'fastframe-enhance.jpg');
  form.append('scale', String(scale>=3?4:2));

  const controller=new AbortController();
  const timeoutId=setTimeout(()=>controller.abort(), ENH_REMOTE_TIMEOUT_MS);
  let resp;
  try{
    resp=await fetch('/api/enhance-image', { method:'POST', body: form, signal: controller.signal });
  } catch (err){
    if(err?.name==='AbortError') throw new Error('Tempo limite excedido na IA externa.');
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
  if(!resp.ok){
    let errMsg='Falha ao melhorar com IA.';
    try{
      const err=await resp.json();
      errMsg=err.error || err.detail || errMsg;
    } catch {}
    throw new Error(errMsg);
  }

  const outBlob=await resp.blob();
  return qiBlobToCanvas(outBlob);
}

function qiBuildExportCanvas(){
  if(!qImg||!_qiValidSize()) return null;
  const spec=qiGetExportSpec();
  if(!spec) return null;
  const out=document.createElement('canvas');
  const outW=spec.outW;
  const outH=spec.outH;
  out.width=outW;
  out.height=outH;
  const ctx=out.getContext('2d');
  const drew=_qiDrawFramedImage(ctx, outW, outH, spec.wCm, spec.hCm);
  if(!drew) _qiDrawLegacyPreview(ctx, outW, outH);
  return out;
}

function _qiDrawFramedImage(ctx, outW, outH, wCm, hCm){
  if(!ctx||!qImg) return false;
  if(!validatePositiveFrameValue(wCm)||!validatePositiveFrameValue(hCm)) return false;
  ctx.fillStyle=qiMatColor;
  ctx.fillRect(0,0,outW,outH);
  const srcW=qImg.img.naturalWidth||qImg.img.width;
  const srcH=qImg.img.naturalHeight||qImg.img.height;
  if(!srcW||!srcH) return false;
  const baseScale=(qiFitMode==='cover')?Math.max(outW/srcW,outH/srcH):Math.min(outW/srcW,outH/srcH);
  const drawW=Math.max(1,srcW*baseScale*qiImageScaleX);
  const drawH=Math.max(1,srcH*baseScale*qiImageScaleY);

  const exportScaleX = outW / wCm;
  const exportScaleY = outH / hCm;
  const offsetPxX = qiImageOffsetX * exportScaleX;
  const offsetPxY = qiImageOffsetY * exportScaleY;

  const drawX=((outW-drawW)/2) + offsetPxX;
  const drawY=((outH-drawH)/2) + offsetPxY;

  ctx.save();
  ctx.beginPath();
  ctx.rect(0,0,outW,outH);
  ctx.clip();
  ctx.drawImage(qImg.img,drawX,drawY,drawW,drawH);
  ctx.restore();
  return true;
}

function _qiDrawLegacyPreview(ctx, outW, outH){
  if(!ctx||!qImg) return;
  ctx.fillStyle='#FFFFFF';
  ctx.fillRect(0,0,outW,outH);
  ctx.drawImage(qImg.img,0,0,outW,outH);
}

function _qiEnsureSizeTagInFileName(baseName,w,h){
  const safeBase=String(baseName||'fastframe')
    .replace(/\.[^.]+$/,'')
    .replace(/[^a-zA-Z0-9\u00C0-\u00FF\s\-_]/g,'')
    .replace(/\s+/g,'-')
    .replace(/-+/g,'-')
    .replace(/^-|-$/g,'')
    .toLowerCase() || 'fastframe';

  const sizeTag=`${_qiRound(w,1)}x${_qiRound(h,1)}cm`;
  if(/\d+(?:[.,]\d+)?\s*[xX]\s*\d+(?:[.,]\d+)?\s*cm\b/i.test(safeBase)) return safeBase;
  if(/-enquadrada$/i.test(safeBase)) return `${safeBase.replace(/-enquadrada$/i,'')}-${sizeTag}-enquadrada`;
  return `${safeBase}-${sizeTag}-enquadrada`;
}

function qiSaveImage(){
  if(!qImg) return toast('Carregue uma imagem primeiro.');
  const out=qiBuildExportCanvas();
  if(!out) return toast('Defina largura e altura válidas para salvar.');
  const spec=qiGetExportSpec();
  if(spec&&spec.scaled){
    toast(`Exportacao ajustada para ${spec.effectiveDpi} DPI por limite tecnico de 10.000 px.`);
  }
  const { w, h }=_qiCurrentSize();
  const safeBase=(qImg.file?.name||'fastframe')
    .replace(/\.[^.]+$/,'')
    .replace(/[^a-zA-Z0-9\-_]+/g,'-')
    .replace(/-+/g,'-')
    .replace(/^-|-$/g,'')
    .toLowerCase() || 'fastframe';
  const suggestedName=`${safeBase}-${_qiRound(w,1)}x${_qiRound(h,1)}cm-enquadrada`;
  askFileName('enquadrada', (finalName) => {
    const finalNameWithSize=_qiEnsureSizeTagInFileName(finalName,w,h);
    out.toBlob((blob)=>{
      if(!blob){ toast('Falha ao gerar a imagem.'); return; }
      _saveAs(blob, finalNameWithSize, 'image/jpeg').then(()=>toast('Imagem salva!'));
    }, 'image/jpeg', 0.95);
  }, suggestedName);
}

function _qiSyncLegacyScale(){
  qiImageScale=(qiImageScaleX+qiImageScaleY)/2;
}

function qiAdjustZoom(value){
  const parsed=parseFloat(value);
  if(!Number.isFinite(parsed)) return;
  const scale=Math.max(35,Math.min(400,parsed))/100;
  qiImageScaleX=scale;
  qiImageScaleY=scale;
  _qiSyncLegacyScale();
  qiRenderDesigner();
}

function qiUpdateZoomControl(){
  const zoomSlider=document.getElementById('qiZoomSlider');
  const zoomVal=document.getElementById('qiZoomVal');
  if(!zoomSlider||!zoomVal) return;
  const val = Math.round(((qiImageScaleX + qiImageScaleY) / 2) * 100);
  zoomSlider.value=String(val);
  zoomVal.textContent=val+'%';
}

function qiSetPreset(w,h){
  const wEl=document.getElementById('qiW');
  const hEl=document.getElementById('qiH');
  if(!wEl||!hEl) return;
  wEl.value=_qiFormatInput(w);
  hEl.value=_qiFormatInput(h);
  qiAspectRatio=w/h;
  qiUpdatePresetState();
  qiApplyToCustomCheck(false);
  qiRenderDesigner();
}

function qiToggleSizeLock(force){
  const { w, h }=_qiCurrentSize();
  qiSizeLocked=typeof force==='boolean'?force:!qiSizeLocked;
  if(qiSizeLocked&&validatePositiveFrameValue(w)&&validatePositiveFrameValue(h)) qiAspectRatio=w/h;
  qiUpdateMeta();
}

function qiHandleDimensionInput(changed){
  const wEl=document.getElementById('qiW');
  const hEl=document.getElementById('qiH');
  if(!wEl||!hEl) return;
  const currentEl=changed==='h'?hEl:wEl;
  validateCmInput(currentEl,1,500);
  const w=parseFloat(wEl.value);
  const h=parseFloat(hEl.value);

  if(qiSizeLocked&&!qiDimensionSync&&qiAspectRatio>0){
    qiDimensionSync=true;
    if(changed==='w'&&validatePositiveFrameValue(w)) hEl.value=_qiFormatInput(w/qiAspectRatio);
    if(changed==='h'&&validatePositiveFrameValue(h)) wEl.value=_qiFormatInput(h*qiAspectRatio);
    qiDimensionSync=false;
  }

  if(_qiValidSize()&&!qiSizeLocked){
    qiAspectRatio=parseFloat(wEl.value)/parseFloat(hEl.value);
  }
  qiUpdatePresetState();
  qiApplyToCustomCheck(false);
  qiRenderDesigner();
}

function qiSetFitMode(mode,btn=null){
  qiFitMode=mode==='contain'?'contain':'cover';
  document.querySelectorAll('[data-qi-fit]').forEach((item)=>{
    item.classList.toggle('active',item.dataset.qiFit===qiFitMode);
  });
  if(btn) btn.classList.add('active');
  qiRenderDesigner();
}

function qiResetTransform(){
  const wEl=document.getElementById('qiW');
  const hEl=document.getElementById('qiH');
  if(wEl&&hEl&&validatePositiveFrameValue(qiInitialW)&&validatePositiveFrameValue(qiInitialH)){
    wEl.value=_qiFormatInput(qiInitialW);
    hEl.value=_qiFormatInput(qiInitialH);
    qiAspectRatio=Math.max(0.1,qiInitialW/Math.max(0.1,qiInitialH));
  }
  qiSizeLocked=true;
  qiFitMode='cover';
  document.querySelectorAll('[data-qi-fit]').forEach((item)=>{
    item.classList.toggle('active',item.dataset.qiFit===qiFitMode);
  });
  qiSetMatColor('#FFFFFF',0);
  qiImageScale=1;
  qiImageScaleX=1;
  qiImageScaleY=1;
  qiImageOffsetX=0;
  qiImageOffsetY=0;
  qiSelectionActive=true;
  qiUpdatePresetState();
  qiApplyToCustomCheck(true);
  qiRenderDesigner();
}

function qiCenterImage(){
  qiImageOffsetX=0;
  qiImageOffsetY=0;
  qiSelectionActive=true;
  qiRenderDesigner();
}

function qiApplyToCustomCheck(runCheck=true){
  const { w, h }=_qiCurrentSize();
  const cW=document.getElementById('cW');
  const cH=document.getElementById('cH');
  if(cW&&validatePositiveFrameValue(w)) cW.value=_qiFormatInput(w);
  if(cH&&validatePositiveFrameValue(h)) cH.value=_qiFormatInput(h);
  customW=validatePositiveFrameValue(w)?w:null;
  customH=validatePositiveFrameValue(h)?h:null;
  if(runCheck&&customW&&customH&&qImg) checkCustom();
}

function qiInitFromQImage(){
  if(!qImg) return;
  const wEl=document.getElementById('qiW');
  const hEl=document.getElementById('qiH');
  if(!wEl||!hEl) return;
  const[mw,mh]=maxPrintCm(qImg.w,qImg.h);
  const initialW=customW||mw;
  const initialH=customH||mh;
  qiInitialW=initialW;
  qiInitialH=initialH;
  wEl.value=_qiFormatInput(initialW);
  hEl.value=_qiFormatInput(initialH);
  qiAspectRatio=Math.max(0.1,initialW/Math.max(0.1,initialH));
  qiSizeLocked=true;
  qiFitMode='cover';
  qiImageScale=1;
  qiImageScaleX=1;
  qiImageScaleY=1;
  qiImageOffsetX=0;
  qiImageOffsetY=0;
  qiMatColor='#FFFFFF';
  qiSelectionActive=true;
  qiDragState=null;
  const restored=qiRestoreStateFromStorage();
  qiUpdatePresetState();
  if(!restored) qiSetMatColor('#FFFFFF',0);
  qiApplyToCustomCheck(false);
  qiRenderDesigner();
  qiSchedulePersistState();
}

function _qiPointerPosition(evt){
  const canvas=document.getElementById('qiCanvas');
  if(!canvas) return { x:0, y:0 };
  const rect=canvas.getBoundingClientRect();
  return { x:evt.clientX-rect.left, y:evt.clientY-rect.top };
}

function _qiHitHandle(pos, metrics){
  if(!metrics) return null;
  const hs=metrics.handleSize;
  const handles=[
    { type:'nw', x:metrics.artX, y:metrics.artY },
    { type:'n', x:metrics.artX+metrics.artW/2, y:metrics.artY },
    { type:'ne', x:metrics.artX+metrics.artW, y:metrics.artY },
    { type:'e', x:metrics.artX+metrics.artW, y:metrics.artY+metrics.artH/2 },
    { type:'se', x:metrics.artX+metrics.artW, y:metrics.artY+metrics.artH },
    { type:'s', x:metrics.artX+metrics.artW/2, y:metrics.artY+metrics.artH },
    { type:'sw', x:metrics.artX, y:metrics.artY+metrics.artH },
    { type:'w', x:metrics.artX, y:metrics.artY+metrics.artH/2 },
  ];
  return handles.find((h)=>Math.abs(pos.x-h.x)<=hs&&Math.abs(pos.y-h.y)<=hs) || null;
}

function _qiCursorForHandle(type){
  if(type==='n'||type==='s') return 'ns-resize';
  if(type==='e'||type==='w') return 'ew-resize';
  if(type==='ne'||type==='sw') return 'nesw-resize';
  return 'nwse-resize';
}

function initQIDesignerInteractions(){
  const canvas=document.getElementById('qiCanvas');
  const stage=document.getElementById('qiStage');
  if(!canvas||!stage||canvas.dataset.qiBound==='1') return;
  canvas.dataset.qiBound='1';

  canvas.addEventListener('pointerdown',(evt)=>{
    if(!qImg||!qiRenderMetrics) return;
    const pos=_qiPointerPosition(evt);
    const handle=_qiHitHandle(pos,qiRenderMetrics);
    const insideArt=pos.x>=qiRenderMetrics.artX&&pos.x<=qiRenderMetrics.artX+qiRenderMetrics.artW&&pos.y>=qiRenderMetrics.artY&&pos.y<=qiRenderMetrics.artY+qiRenderMetrics.artH;
    if(!handle&&!insideArt){
      qiSelectionActive=false;
      qiRenderDesigner();
      return;
    }

    qiSelectionActive=true;
    if(handle){
      qiDragState={
        mode:'resize',
        pointerId:evt.pointerId,
        handleType:handle.type,
        startX:evt.clientX,
        startY:evt.clientY,
        startScaleX:qiImageScaleX,
        startScaleY:qiImageScaleY,
      };
      canvas.style.cursor=_qiCursorForHandle(handle.type);
      if(canvas.setPointerCapture) canvas.setPointerCapture(evt.pointerId);
      evt.preventDefault();
      return;
    } else if(insideArt){
      qiDragState={
        mode:'pan',
        pointerId:evt.pointerId,
        startX:evt.clientX,
        startY:evt.clientY,
        startOffsetX:qiImageOffsetX,
        startOffsetY:qiImageOffsetY
      };
      canvas.style.cursor='grabbing';
      if(canvas.setPointerCapture) canvas.setPointerCapture(evt.pointerId);
      evt.preventDefault();
      return;
    }

    canvas.style.cursor='default';
  });

  canvas.addEventListener('pointermove',(evt)=>{
    if(!qImg||!qiRenderMetrics) return;
    const pos=_qiPointerPosition(evt);

    if(!qiDragState){
      const handle=_qiHitHandle(pos,qiRenderMetrics);
      const insideArt=pos.x>=qiRenderMetrics.artX&&pos.x<=qiRenderMetrics.artX+qiRenderMetrics.artW&&pos.y>=qiRenderMetrics.artY&&pos.y<=qiRenderMetrics.artY+qiRenderMetrics.artH;
      if(handle) canvas.style.cursor=_qiCursorForHandle(handle.type);
      else if(insideArt) canvas.style.cursor='grab';
      else canvas.style.cursor='default';
      return;
    }

    if(qiDragState.pointerId!==evt.pointerId) return;
    if(qiDragState.mode==='resize'){
      const dx=evt.clientX-qiDragState.startX;
      const dy=evt.clientY-qiDragState.startY;
      const type=qiDragState.handleType||'';

      let nextScaleX=qiDragState.startScaleX;
      let nextScaleY=qiDragState.startScaleY;

      const isCorner = ['nw', 'ne', 'se', 'sw'].includes(type);
      if(isCorner){
        let factor = 0;
        if(type === 'se') factor = (dx + dy) / 2;
        else if(type === 'nw') factor = (-dx - dy) / 2;
        else if(type === 'ne') factor = (dx - dy) / 2;
        else if(type === 'sw') factor = (-dx + dy) / 2;

        const multiplier = 1 + factor/220;
        nextScaleX = qiDragState.startScaleX * multiplier;
        nextScaleY = qiDragState.startScaleY * multiplier;
      } else {
        if(type.includes('e')) nextScaleX=qiDragState.startScaleX*(1+dx/220);
        if(type.includes('w')) nextScaleX=qiDragState.startScaleX*(1-dx/220);
        if(type.includes('s')) nextScaleY=qiDragState.startScaleY*(1+dy/220);
        if(type.includes('n')) nextScaleY=qiDragState.startScaleY*(1-dy/220);
      }

      qiImageScaleX=Math.max(0.35,Math.min(4,nextScaleX));
      qiImageScaleY=Math.max(0.35,Math.min(4,nextScaleY));
      _qiSyncLegacyScale();
      qiRenderDesigner();
    } else if(qiDragState.mode==='pan'){
      const dx=evt.clientX-qiDragState.startX;
      const dyVal=evt.clientY-qiDragState.startY;
      const artScale = qiRenderMetrics.artScale || (qiRenderMetrics.artW / parseFloat(document.getElementById('qiW').value));
      qiImageOffsetX=qiDragState.startOffsetX + (dx / artScale);
      qiImageOffsetY=qiDragState.startOffsetY + (dyVal / artScale);
      qiRenderDesigner();
    }
  });

  const finish=(evt)=>{
    if(!qiDragState||!evt||qiDragState.pointerId!==evt.pointerId) return;
    qiDragState=null;
    canvas.style.cursor='default';
  };
  canvas.addEventListener('pointerup',finish);
  canvas.addEventListener('pointercancel',finish);
  canvas.addEventListener('pointerleave',()=>{
    if(!qiDragState) canvas.style.cursor='default';
  });
}

function qiRenderDesigner(){
  if(_qiRenderQueued) return;
  _qiRenderQueued=true;
  requestAnimationFrame(()=>{
    _qiRenderQueued=false;
    _qiRenderDesignerNow();
  });
}

function _qiRenderDesignerNow(){
  const canvas=document.getElementById('qiCanvas');
  const stage=document.getElementById('qiStage');
  if(!canvas||!stage||!qImg) return;
  if(!_qiValidSize()){
    const info=document.getElementById('qiInfo');
    if(info) info.textContent='Defina largura e altura validas em cm para continuar.';
    return;
  }

  const w=stage.clientWidth-24;
  const h=stage.clientHeight-24;
  if(w<20||h<20) return;
  canvas.width=w;
  canvas.height=h;
  const ctx=canvas.getContext('2d');
  const { w: wCm, h: hCm }=_qiCurrentSize();

  const artScale=Math.min((w-80)/wCm,(h-80)/hCm);
  const artW=Math.max(70,wCm*artScale);
  const artH=Math.max(70,hCm*artScale);
  const artX=(w-artW)/2;
  const artY=(h-artH)/2;

  ctx.clearRect(0,0,w,h);
  ctx.fillStyle='#DDE7F4';
  ctx.fillRect(0,0,w,h);

  ctx.fillStyle=qiMatColor;
  ctx.fillRect(artX,artY,artW,artH);

  const srcW=qImg.img.naturalWidth||qImg.img.width;
  const srcH=qImg.img.naturalHeight||qImg.img.height;
  const baseScale=(qiFitMode==='cover')?Math.max(artW/srcW,artH/srcH):Math.min(artW/srcW,artH/srcH);
  const drawW=Math.max(1,srcW*baseScale*qiImageScaleX);
  const drawH=Math.max(1,srcH*baseScale*qiImageScaleY);

  qiRenderMetrics={ artX, artY, artW, artH, drawW, drawH, handleSize:8, artScale };
  qiUpdateZoomControl();

  const offsetPxX = qiImageOffsetX * artScale;
  const offsetPxY = qiImageOffsetY * artScale;

  const drawX=artX+((artW-drawW)/2) + offsetPxX;
  const drawY=artY+((artH-drawH)/2) + offsetPxY;

  ctx.save();
  ctx.beginPath();
  ctx.rect(artX,artY,artW,artH);
  ctx.clip();
  ctx.drawImage(qImg.img,drawX,drawY,drawW,drawH);
  ctx.restore();

  ctx.strokeStyle='rgba(26,48,81,0.35)';
  ctx.lineWidth=1;
  ctx.strokeRect(artX+0.5,artY+0.5,artW-1,artH-1);

  if(qiSelectionActive){
    ctx.strokeStyle='#2F5E99';
    ctx.lineWidth=2;
    ctx.strokeRect(artX+1,artY+1,artW-2,artH-2);

    const handles=[
      [artX,artY],
      [artX+artW/2,artY],
      [artX+artW,artY],
      [artX+artW,artY+artH/2],
      [artX+artW,artY+artH],
      [artX+artW/2,artY+artH],
      [artX,artY+artH],
      [artX,artY+artH/2],
    ];
    ctx.fillStyle='#FFFFFF';
    ctx.strokeStyle='#2F5E99';
    handles.forEach(([hx,hy])=>{
      ctx.beginPath();
      ctx.rect(hx-5,hy-5,10,10);
      ctx.fill();
      ctx.stroke();
    });
  }

  qiUpdateMeta();
}

function checkCustom(){
  const w=parseFloat(document.getElementById('cW').value);
  const h=parseFloat(document.getElementById('cH').value);
  if(!w||!h||!qImg) return toast('Informe a largura e a altura em cm.');
  customW=w; customH=h;

  const q=qualityLevel(qImg.w,qImg.h,w,h);
  const el=document.getElementById('cRes');
  el.style.display='block';
  el.innerHTML=`
    <div style="background:${q.bg};border-radius:6px;padding:14px 16px">
      <div style="font-size:17px;font-weight:700;color:${q.color};margin-bottom:4px">${q.icon} ${q.label}</div>
      <div style="font-size:12px;color:#5A4530">Para um quadro de <strong>${w} × ${h} cm</strong></div>
      ${qualityBar(q.level)}
    </div>`;

  document.getElementById('previewSizeLabel').textContent=`${w} × ${h} cm`;

  const cvs=document.getElementById('previewCanvas');
  const ctx=cvs.getContext('2d');
  const ratio=w/h;
  const maxS=300;
  let dw,dh;
  if(w>=h){ dw=maxS; dh=dw/ratio; } else { dh=maxS; dw=dh*ratio; }
  cvs.width=dw; cvs.height=dh;
  try{
    const drew=_qiDrawFramedImage(ctx,dw,dh,w,h);
    if(!drew) _qiDrawLegacyPreview(ctx,dw,dh);
  } catch {
    _qiDrawLegacyPreview(ctx,dw,dh);
  }
  ctx.strokeStyle='rgba(26,48,81,0.25)'; ctx.lineWidth=1;
  ctx.strokeRect(0,0,dw,dh);
  document.getElementById('cPreview').style.display='block';
}

function openPreviewModal(){
  if(!qImg) return;
  const w=parseFloat(document.getElementById('cW').value);
  const h=parseFloat(document.getElementById('cH').value);
  if(!w||!h) return;

  const modal=document.getElementById('previewModal');
  const cvs=document.getElementById('largePreviewCanvas');
  const ctx=cvs.getContext('2d');

  let dw=Math.min(700,window.innerWidth*.8);
  let dh=dw/(w/h);
  const mH=window.innerHeight*.65;
  if(dh>mH){ dh=mH; dw=dh*(w/h); }

  cvs.width=Math.round(dw); cvs.height=Math.round(dh);
  try{
    const drew=_qiDrawFramedImage(ctx,cvs.width,cvs.height,w,h);
    if(!drew) _qiDrawLegacyPreview(ctx,cvs.width,cvs.height);
  } catch {
    _qiDrawLegacyPreview(ctx,cvs.width,cvs.height);
  }
  ctx.strokeStyle='rgba(26,48,81,0.5)'; ctx.lineWidth=3;
  ctx.strokeRect(1.5,1.5,cvs.width-3,cvs.height-3);

  document.getElementById('previewModalSize').textContent=`Tamanho real: ${w} × ${h} cm`;
  modal.style.display='flex';
  document.body.style.overflow='hidden';
}

function closePreviewModal(){
  document.getElementById('previewModal').style.display='none';
  document.body.style.overflow='auto';
}

function resetQ(){
  qImg=null;
  customW=null; customH=null;
  qiImageScale=1;
  qiImageScaleX=1;
  qiImageScaleY=1;
  qiImageOffsetX=0;
  qiImageOffsetY=0;
  qiMatColor='#FFFFFF';
  qiSelectionActive=false;
  qiRenderMetrics=null;
  qiDragState=null;
  document.getElementById('qThumb').style.display='none';
  document.getElementById('qResults').style.display='none';
  document.getElementById('qFile').value='';
  const qiCard=document.getElementById('qiDesignerCard');
  if(qiCard) qiCard.style.display='none';
  document.getElementById('cRes').style.display='none';
  document.getElementById('cPreview').style.display='none';
  document.getElementById('enhCard').style.display='none';
  enhOrigCanvas=null; enhScale=1;
  resetEnhSliders();
}

// ─────────────────────────────────────────────────────────
//  ABA CANVAS — divisão livre
// ─────────────────────────────────────────────────────────
function showC(){
  document.getElementById('cResults').style.display='block';
  const box=document.getElementById('cUploadBox');
  if(box) box.style.display='none';

  const[mw,mh]=maxPrintCm(cImg.w,cImg.h);
  totalWcm = customW || mw;
  totalHcm = customH || mh;
  document.getElementById('totalW').value=totalWcm;
  document.getElementById('totalH').value=totalHcm;
  partWidths=[totalWcm]; partHeights=[totalHcm];
  buildPartSizesTable();
  updateCInfo();
  requestAnimationFrame(()=>renderSplit());
}

function updateCInfo(){
  if(!cImg) return;
  const[mw,mh]=maxPrintCm(cImg.w,cImg.h);
  let info=`<strong style="color:var(--brown)">${cImg.file.name}</strong><br>`+
           `${cImg.w.toLocaleString()} × ${cImg.h.toLocaleString()} px · ${fmtB(cImg.file.size)}<br>`+
           `<span style="font-size:11px;color:var(--gray)">Maior tamanho recomendado: ${mw} × ${mh} cm</span>`;
  if(totalWcm&&totalHcm)
    info+=`<br><span style="font-size:11px;color:var(--brown)">Tamanho definido: ${totalWcm} × ${totalHcm} cm</span>`;
  document.getElementById('cInfo').innerHTML=info;
}

function setOrient(dir,btn){
  splitOrient=dir;
  document.querySelectorAll('.orient-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  // Mostrar/esconder controles de grade
  const gridControls=document.getElementById('gridControls');
  const numPartsRow=document.getElementById('numPartsRow');
  if(gridControls) gridControls.style.display=dir==='grid'?'block':'none';
  if(numPartsRow)  numPartsRow.style.display=dir==='grid'?'none':'flex';
  onNumPartsChange();
}

function onNumPartsChange(){
  const w=totalWcm||(cImg?maxPrintCm(cImg.w,cImg.h)[0]:100);
  const h=totalHcm||(cImg?maxPrintCm(cImg.w,cImg.h)[1]:70);
  if(splitOrient==='grid'){
    gridCols=parseInt(document.getElementById('gridCols')?.value)||2;
    gridRows=parseInt(document.getElementById('gridRows')?.value)||2;
    const n=gridCols*gridRows;
    partWidths =Array(n).fill(+(w/gridCols).toFixed(1));
    partHeights=Array(n).fill(+(h/gridRows).toFixed(1));
  } else {
    const n=parseInt(document.getElementById('numParts').value)||1;
    if(splitOrient==='h'){
      partWidths =Array(n).fill(+(w/n).toFixed(1));
      partHeights=Array(n).fill(h);
    } else {
      partWidths =Array(n).fill(w);
      partHeights=Array(n).fill(+(h/n).toFixed(1));
    }
  }
  buildPartSizesTable();
  renderSplit();
}

function applyDimensions(){
  const w=parseFloat(document.getElementById('totalW').value);
  const h=parseFloat(document.getElementById('totalH').value);
  if(!w||!h) return toast('Informe largura e altura.');
  totalWcm=w; totalHcm=h;
  if(splitOrient==='grid'){
    gridCols=parseInt(document.getElementById('gridCols')?.value)||2;
    gridRows=parseInt(document.getElementById('gridRows')?.value)||2;
    const n=gridCols*gridRows;
    partWidths =Array(n).fill(+(w/gridCols).toFixed(1));
    partHeights=Array(n).fill(+(h/gridRows).toFixed(1));
  } else {
    const n=parseInt(document.getElementById('numParts').value)||1;
    if(splitOrient==='h'){
      partWidths =Array(n).fill(+(w/n).toFixed(1));
      partHeights=Array(n).fill(h);
    } else {
      partWidths =Array(n).fill(w);
      partHeights=Array(n).fill(+(h/n).toFixed(1));
    }
  }
  buildPartSizesTable();
  updateCInfo();
  renderSplit();
  toast('Dimensões aplicadas!');
}

function buildPartSizesTable(){
  const n=partWidths.length;
  const card=document.getElementById('partSizesCard');
  const tbody=document.getElementById('partSizesTbody');
  card.style.display=n>1?'block':'none';
  if(n<=1) return;
  tbody.innerHTML='';
  for(let i=0;i<n;i++){
    tbody.innerHTML+=`<tr>
      <td style="font-weight:600;color:var(--brown)">Parte ${i+1}</td>
      <td><input type="number" id="pw${i}" value="${partWidths[i]}" min="1" step="0.5"></td>
      <td><input type="number" id="ph${i}" value="${partHeights[i]}" min="1" step="0.5"></td>
    </tr>`;
  }
}

function applyPartSizes(){
  const n=partWidths.length;
  for(let i=0;i<n;i++){
    const wv=parseFloat(document.getElementById('pw'+i).value);
    const hv=parseFloat(document.getElementById('ph'+i).value);
    if(!wv||!hv) return toast('Preencha todos os campos.');
    partWidths[i]=wv; partHeights[i]=hv;
  }
  renderSplit();
  toast('Composição aplicada!');
}

function renderSplit(){
  if(!cImg) return;
  const{img,w:imgW,h:imgH}=cImg;
  const cvs=document.getElementById('splitCanvas');
  // Gap branco visível entre painéis (simula espaço real entre chassi)
  const PANEL_GAP=12; // px no display

  let avail=cvs.parentElement.offsetWidth-28;
  if(avail<=0) avail=600;
  const maxW=Math.min(avail,820);
  const maxH=520;

  if(splitOrient==='grid'){
    const cols=gridCols, rows=gridRows;
    const n=cols*rows;
    const cellW=partWidths[0]  || (totalWcm||100)/cols;
    const cellH=partHeights[0] || (totalHcm||70)/rows;
    const totW=cellW*cols, totH=cellH*rows;

    const scaleW=(maxW - PANEL_GAP*(cols-1))/totW;
    const scaleH=(maxH - PANEL_GAP*(rows-1))/totH;
    const scale=Math.min(scaleW,scaleH);

    const cellWpx=Math.round(cellW*scale);
    const cellHpx=Math.round(cellH*scale);
    cvs.width =cols*cellWpx + PANEL_GAP*(cols-1);
    cvs.height=rows*cellHpx + PANEL_GAP*(rows-1);

    const ctx=cvs.getContext('2d');
    // Fundo branco entre painéis
    ctx.fillStyle='#FFFFFF'; ctx.fillRect(0,0,cvs.width,cvs.height);

    for(let r=0;r<rows;r++){
      for(let c=0;c<cols;c++){
        const dx=c*(cellWpx+PANEL_GAP);
        const dy=r*(cellHpx+PANEL_GAP);
        const srcX=Math.round(c*imgW/cols);
        const srcY=Math.round(r*imgH/rows);
        const srcW=Math.round(imgW/cols);
        const srcH=Math.round(imgH/rows);
        ctx.drawImage(img,srcX,srcY,srcW,srcH,dx,dy,cellWpx,cellHpx);
        // Borda de cada painel
        ctx.strokeStyle='rgba(26,48,81,0.5)'; ctx.lineWidth=2;
        ctx.strokeRect(dx+1,dy+1,cellWpx-2,cellHpx-2);
      }
    }

    const sizeLabel=document.getElementById('splitSizeLabel');
    if(sizeLabel) sizeLabel.textContent=`Grade ${cols}×${rows}  —  Cada painel: ${cellW}×${cellH}cm  —  Total: ${totW.toFixed(0)}×${totH.toFixed(0)}cm`;

  } else {
    const n=partWidths.length;
    const totW=splitOrient==='h'?partWidths.reduce((a,b)=>a+b,0):partWidths[0];
    const totH=splitOrient==='v'?partHeights.reduce((a,b)=>a+b,0):partHeights[0];

    const scaleByW=(maxW - PANEL_GAP*(n-1))/totW;
    const scaleByH=(maxH - PANEL_GAP*(n-1))/totH;
    const scale=Math.min(scaleByW,scaleByH);

    const sizeLabel=document.getElementById('splitSizeLabel');
    if(sizeLabel){
      sizeLabel.textContent=n===1
        ?`${totW} × ${totH} cm`
        :`Total: ${totW} × ${totH} cm  —  `+partWidths.map((w,i)=>`${w}×${partHeights[i]}cm`).join(' | ');
    }

    // Calcular canvas com gaps
    let totalDispW=0, totalDispH=0;
    const pWpxArr=[], pHpxArr=[];
    for(let i=0;i<n;i++){
      pWpxArr.push(Math.round(partWidths[i]*scale));
      pHpxArr.push(Math.round(partHeights[i]*scale));
    }
    if(splitOrient==='h'){
      totalDispW=pWpxArr.reduce((a,b)=>a+b,0)+PANEL_GAP*(n-1);
      totalDispH=pHpxArr[0];
    } else {
      totalDispW=pWpxArr[0];
      totalDispH=pHpxArr.reduce((a,b)=>a+b,0)+PANEL_GAP*(n-1);
    }

    cvs.width=totalDispW; cvs.height=totalDispH;
    const ctx=cvs.getContext('2d');
    // Fundo branco = gap entre painéis
    ctx.fillStyle='#FFFFFF'; ctx.fillRect(0,0,cvs.width,cvs.height);

    let offX=0, offY=0;
    for(let i=0;i<n;i++){
      const pW=pWpxArr[i], pH=pHpxArr[i];
      const dx=splitOrient==='h'?offX:0;
      const dy=splitOrient==='v'?offY:0;
      const bounds=_splitSrcBoundsNonGrid(i,imgW,imgH);
      const srcX=bounds.srcX;
      const srcW=bounds.srcW;
      const srcY=bounds.srcY;
      const srcH=bounds.srcH;
      ctx.drawImage(img,srcX,srcY,srcW,srcH,dx,dy,pW,pH);
      ctx.strokeStyle='rgba(26,48,81,0.5)'; ctx.lineWidth=2;
      ctx.strokeRect(dx+1,dy+1,pW-2,pH-2);
      if(splitOrient==='h') offX+=pW+PANEL_GAP;
      else                   offY+=pH+PANEL_GAP;
    }
  }
  buildDlRow();
  ffAtualizarComposicaoDivisaoSincronizada();
}

function ffAtualizarComposicaoDivisaoSincronizada(){
  if(!cImg) return;
  const cvs=document.getElementById('splitCanvas');
  if(!cvs || cvs.width<2 || cvs.height<2) return;

  _ffSplitComposicaoDataUrl=cvs.toDataURL('image/jpeg',0.9);
  const fallbackDims=_ffCatalogDims50x70ForImage(cImg.img);
  const wBase=parseFloat(totalWcm)||fallbackDims.w;
  const hBase=parseFloat(totalHcm)||fallbackDims.h;
  _ffSplitComposicaoDims={ w:wBase, h:hBase };
  const nAtual=splitOrient==='grid'?(gridCols*gridRows):partWidths.length;
  _ffSplitComposicaoMeta={
    orient:splitOrient,
    n:nAtual,
    gridCols:splitOrient==='grid'?gridCols:1,
    gridRows:splitOrient==='grid'?gridRows:1,
    partWidths:[...partWidths],
    partHeights:[...partHeights],
    totalW:wBase,
    totalH:hBase,
    gapCm:1.2,
  };
  _ffSplitComposicaoStamp=Date.now();

  if(document.getElementById('tab-simquadro')?.classList.contains('active')){
    ffAplicarComposicaoDivisaoNoQuadro(false);
  }
  if(document.getElementById('tab-simulador')?.classList.contains('active')){
    ffAplicarComposicaoDivisaoNoAmbiente(false);
  }
}

function ffAplicarComposicaoDivisaoNoQuadro(showMsg=true){
  if(!_ffSplitComposicaoDataUrl) return;
  _aplicarImagemQuadroBase64(_ffSplitComposicaoDataUrl, ()=>{
    _ffSplitComposicaoAtiva=Boolean(_ffSplitComposicaoMeta && (_ffSplitComposicaoMeta.n||0)>1);
    const sqWEl=document.getElementById('sqW');
    const sqHEl=document.getElementById('sqH');
    if(sqWEl) sqWEl.value=_ffSplitComposicaoDims.w;
    if(sqHEl) sqHEl.value=_ffSplitComposicaoDims.h;
    if(typeof renderFrame==='function') renderFrame();
    if(showMsg) toast('Composição de Divisão aplicada no Simulador de Quadros.');
  });
}

function ffAplicarComposicaoDivisaoNoAmbiente(showMsg=true){
  if(!_ffSplitComposicaoDataUrl) return;
  const jaAplicadaNoStamp=window._ffSplitComposicaoStampAplicadaAmbiente===_ffSplitComposicaoStamp;
  if(Array.isArray(wallFrames)&&wallFrames.length&&jaAplicadaNoStamp) return;

  const meta=_ffSplitComposicaoMeta;
  const srcImg=(cImg&&cImg.img)?cImg.img:null;
  const temMultiPainel=Boolean(meta && (meta.n||0)>1 && srcImg);
  if(temMultiPainel){
    _ffSplitCreatePanelImages(meta,srcImg)
      .then((layoutData)=>{
        const ok=_ffSplitApplyPanelsToWall(layoutData);
        if(!ok) throw new Error('Não foi possível montar os quadros da composição.');
        window._ffSplitComposicaoStampAplicadaAmbiente=_ffSplitComposicaoStamp;
        if(showMsg) toast('Composição aplicada no ambiente como múltiplos quadros.');
      })
      .catch(()=>{
        if(showMsg) toast('Falha ao aplicar composição em múltiplos quadros no ambiente.');
      });
    return;
  }

  _ffSplitWallLayoutState=null;
  _ffSplitSetWallGapUI(false,1.2);

  const img=new Image();
  img.onload=()=>{
    if(Array.isArray(wallFrames)&&wallFrames.length){
      if(wallSelectedIdx<0) wallSelectedIdx=0;
      const idx=wallSelectedIdx>=0?wallSelectedIdx:0;
      if(wallFrames[idx]){
        wallFrames[idx].img=img;
        _ffCatalogFitSelectedWallFrame(img,_ffSplitComposicaoDims);
      }
    } else {
      wallAddFrame(img);
      _ffCatalogFitSelectedWallFrame(img,_ffSplitComposicaoDims);
    }
    wArtImg=img;
    window._ffSplitComposicaoStampAplicadaAmbiente=_ffSplitComposicaoStamp;
    if(typeof checkWall==='function') checkWall();
    if(typeof renderWall==='function') renderWall();
    if(showMsg) toast('Composição de Divisão aplicada no Simulador de Ambiente.');
  };
  img.src=_ffSplitComposicaoDataUrl;
}

function buildDlRow(){
  const dr=document.getElementById('dlRow');
  const bleedBtns =
    `<button class="dl-btn pri" onclick="dlBleed('jpg')">⬇ JPEG com Sangria</button>`;
  if(splitOrient==='grid'){
    const n=gridCols*gridRows;
    let b='';
    for(let i=0;i<n;i++){
      const r=Math.floor(i/gridCols), c=i%gridCols;
      b+=`<button class="dl-btn pri" onclick="dlPiece(${i},${n},'jpg')">⬇ L${r+1}C${c+1} JPEG</button>`;
    }
    b+=`<button class="dl-btn pri" onclick="dlAll('jpg')">⬇ Todos JPEG</button>`;
    b+=bleedBtns;
    dr.innerHTML=b;
  } else {
    const n=partWidths.length;
    if(n===1){
      dr.innerHTML=`
        <button class="dl-btn pri" onclick="dlPiece(0,1,'jpg')">⬇ JPEG</button>
        ${bleedBtns}`;
    } else {
      let b='';
      for(let i=0;i<n;i++){
        b+=`<button class="dl-btn pri" onclick="dlPiece(${i},${n},'jpg')">⬇ Parte ${i+1} JPEG</button>`;
      }
      b+=`<button class="dl-btn pri" onclick="dlAll('jpg')">⬇ Todos JPEG</button>`;
      b+=bleedBtns;
      dr.innerHTML=b;
    }
  }
}

function _splitSrcBoundsNonGrid(idx, imgW, imgH) {
  const n = partWidths.length;
  if (n <= 1) {
    return { srcX: 0, srcY: 0, srcW: imgW, srcH: imgH };
  }

  if (splitOrient === 'h') {
    const totalW = partWidths.reduce((a, b) => a + (parseFloat(b) || 0), 0) || 1;
    const prevW = partWidths.slice(0, idx).reduce((a, b) => a + (parseFloat(b) || 0), 0);
    const currW = parseFloat(partWidths[idx]) || 0;
    const start = Math.round((prevW / totalW) * imgW);
    const end = idx === n - 1 ? imgW : Math.round(((prevW + currW) / totalW) * imgW);
    return { srcX: start, srcY: 0, srcW: Math.max(1, end - start), srcH: imgH };
  }

  const totalH = partHeights.reduce((a, b) => a + (parseFloat(b) || 0), 0) || 1;
  const prevH = partHeights.slice(0, idx).reduce((a, b) => a + (parseFloat(b) || 0), 0);
  const currH = parseFloat(partHeights[idx]) || 0;
  const start = Math.round((prevH / totalH) * imgH);
  const end = idx === n - 1 ? imgH : Math.round(((prevH + currH) / totalH) * imgH);
  return { srcX: 0, srcY: start, srcW: imgW, srcH: Math.max(1, end - start) };
}

function _fitExportSize(pxW, pxH, maxPixels=28000000, maxSide=10000){
  let w=Math.max(1, Math.round(pxW));
  let h=Math.max(1, Math.round(pxH));

  const sideScale=Math.min(maxSide/w, maxSide/h, 1);
  if(sideScale < 1){
    w=Math.max(1, Math.round(w*sideScale));
    h=Math.max(1, Math.round(h*sideScale));
  }

  const total=w*h;
  if(total > maxPixels){
    const s=Math.sqrt(maxPixels/total);
    w=Math.max(1, Math.round(w*s));
    h=Math.max(1, Math.round(h*s));
  }

  return { w, h };
}

function _splitEnsureSizeTagInFileName(baseName,wCm,hCm){
  const safeBase=String(baseName||'fastframe')
    .replace(/\.[^.]+$/,'')
    .replace(/[^a-zA-Z0-9\u00C0-\u00FF\s\-_]/g,'')
    .replace(/\s+/g,'-')
    .replace(/-+/g,'-')
    .replace(/^-|-$/g,'')
    .toLowerCase() || 'fastframe';

  if(/\d+(?:[.,]\d+)?\s*[xX×]\s*\d+(?:[.,]\d+)?\s*cm\b/i.test(safeBase)) return safeBase;
  const sizeTag=`${_qiRound(wCm,1)}x${_qiRound(hCm,1)}cm`;
  return `${safeBase}-${sizeTag}`;
}

function dlPiece(idx,total,fmt){
  if(!cImg) return;
  const{img,w:imgW,h:imgH}=cImg;
  const DPI=300;
  let pW,pH,srcX,srcY,srcW,srcH,name,pieceWcm,pieceHcm;
  if(splitOrient==='grid'){
    const cols=gridCols, rows=gridRows;
    const r=Math.floor(idx/cols), c=idx%cols;
    pieceWcm=partWidths[0];
    pieceHcm=partHeights[0];
    pW=Math.round(partWidths[0]/2.54*DPI);
    pH=Math.round(partHeights[0]/2.54*DPI);
    srcX=Math.round(c*imgW/cols); srcW=Math.round(imgW/cols);
    srcY=Math.round(r*imgH/rows); srcH=Math.round(imgH/rows);
    name=`fastframe-L${r+1}C${c+1}de${rows}x${cols}`;
  } else {
    pieceWcm=partWidths[idx];
    pieceHcm=partHeights[idx];
    pW=Math.round(partWidths[idx]/2.54*DPI);
    pH=Math.round(partHeights[idx]/2.54*DPI);
    const bounds=_splitSrcBoundsNonGrid(idx,imgW,imgH);
    srcX=bounds.srcX;
    srcY=bounds.srcY;
    srcW=bounds.srcW;
    srcH=bounds.srcH;
    name=`fastframe-parte${idx+1}de${total}`;
  }
  const fitted=_fitExportSize(pW,pH);
  const cv=document.createElement('canvas');
  cv.width=fitted.w;
  cv.height=fitted.h;
  cv.getContext('2d').drawImage(img,srcX,srcY,srcW,srcH,0,0,fitted.w,fitted.h);
  const suffix = name.replace(/^fastframe-?/,'') || 'parte';
  if(fmt==='jpg'){
    askFileName(suffix, (finalName) => {
      const finalNameWithSize=_splitEnsureSizeTagInFileName(finalName,pieceWcm,pieceHcm);
      cv.toBlob(b=>{ _saveAs(b, finalNameWithSize, 'image/jpeg'); toast('JPEG exportado!'); },'image/jpeg',0.92);
    });
  } else {
    askFileName(suffix, (finalName) => {
      const finalNameWithSize=_splitEnsureSizeTagInFileName(finalName,pieceWcm,pieceHcm);
      exportPDFsave(cv, finalNameWithSize);
      toast('PDF exportado!');
    });
  }
}

function dlAll(fmt){
  const n=splitOrient==='grid'?gridCols*gridRows:partWidths.length;
  for(let i=0;i<n;i++) setTimeout(()=>dlPiece(i,n,fmt),i*700);
}

// ─────────────────────────────────────────────────────────
//  SANGRIA
// ─────────────────────────────────────────────────────────
function applyBleed(){
  if(!cImg) return toast('Carregue uma imagem primeiro.');
  const{img,w:imgW,h:imgH}=cImg;
  // A prévia não precisa de 300 DPI. Em tamanhos grandes isso estoura o limite
  // de área do canvas do navegador e a imagem fica invisível.
  const PREVIEW_DPI_BASE=96;
  const BLEED_CM=5;
  const MAX_PREVIEW_CANVAS_SIDE=16384;
  const MAX_PREVIEW_CANVAS_AREA=260000000;
  const PIECE_GAP_PX=8;              // gap branco entre painéis no preview

  const cmToPx=(cm,dpi)=>Math.max(1,Math.round((cm/2.54)*dpi));

  function estimatePreviewBounds(dpi){
    const bp=cmToPx(BLEED_CM,dpi);

    if(splitOrient==='grid'){
      const cols=gridCols, rows=gridRows;
      const cellW=cmToPx(partWidths[0]||1,dpi)+bp*2;
      const cellH=cmToPx(partHeights[0]||1,dpi)+bp*2;
      return {
        w:cols*cellW + PIECE_GAP_PX*(cols-1),
        h:rows*cellH + PIECE_GAP_PX*(rows-1)
      };
    }

    const n=partWidths.length;
    if(n===1){
      return {
        w:cmToPx(partWidths[0]||1,dpi)+bp*2,
        h:cmToPx(partHeights[0]||1,dpi)+bp*2
      };
    }

    if(splitOrient==='h'){
      const w=partWidths.reduce((acc,cm)=>acc + cmToPx(cm||1,dpi)+bp*2,0)+PIECE_GAP_PX*(n-1);
      const h=cmToPx(partHeights[0]||1,dpi)+bp*2;
      return { w, h };
    }

    const w=cmToPx(partWidths[0]||1,dpi)+bp*2;
    const h=partHeights.reduce((acc,cm)=>acc + cmToPx(cm||1,dpi)+bp*2,0)+PIECE_GAP_PX*(n-1);
    return { w, h };
  }

  let DPI=PREVIEW_DPI_BASE;
  while(DPI>24){
    const est=estimatePreviewBounds(DPI);
    const tooLargeSide=est.w>MAX_PREVIEW_CANVAS_SIDE||est.h>MAX_PREVIEW_CANVAS_SIDE;
    const tooLargeArea=(est.w*est.h)>MAX_PREVIEW_CANVAS_AREA;
    if(!tooLargeSide&&!tooLargeArea) break;
    DPI=Math.floor(DPI*0.85);
  }

  const BP=cmToPx(BLEED_CM,DPI);

  function buildPiece(srcX,srcY,srcW,srcH,sw,sh){
    const pc=document.createElement('canvas');
    pc.width=sw+BP*2; pc.height=sh+BP*2;
    const p=pc.getContext('2d');
    // Área útil central
    p.drawImage(img,srcX,srcY,srcW,srcH,BP,BP,sw,sh);
    // Borda superior espelhada
    p.save(); p.translate(BP,BP); p.scale(1,-1);
    p.drawImage(img,srcX,srcY,srcW,Math.round(srcH*BP/sh),0,0,sw,BP);
    p.restore();
    // Borda inferior espelhada
    p.save(); p.translate(BP,sh+BP); p.scale(1,-1);
    p.drawImage(img,srcX,srcY+srcH-Math.round(srcH*BP/sh),srcW,Math.round(srcH*BP/sh),0,-BP,sw,BP);
    p.restore();
    // Borda esquerda espelhada
    p.save(); p.translate(BP,BP); p.scale(-1,1);
    p.drawImage(img,srcX,srcY,Math.round(srcW*BP/sw),srcH,0,0,BP,sh);
    p.restore();
    // Borda direita espelhada
    p.save(); p.translate(sw+BP,BP); p.scale(-1,1);
    p.drawImage(img,srcX+srcW-Math.round(srcW*BP/sw),srcY,Math.round(srcW*BP/sw),srcH,-BP,0,BP,sh);
    p.restore();
    // Cantos
    const cpSrcW=Math.round(srcW*BP/sw), cpSrcH=Math.round(srcH*BP/sh);
    p.save(); p.translate(BP,BP);             p.scale(-1,-1); p.drawImage(img,srcX,srcY,cpSrcW,cpSrcH,0,0,BP,BP);                       p.restore();
    p.save(); p.translate(sw+BP*2,BP);        p.scale(-1,-1); p.drawImage(img,srcX+srcW-cpSrcW,srcY,cpSrcW,cpSrcH,0,0,BP,BP);           p.restore();
    p.save(); p.translate(BP,sh+BP*2);        p.scale(-1,-1); p.drawImage(img,srcX,srcY+srcH-cpSrcH,cpSrcW,cpSrcH,0,0,BP,BP);           p.restore();
    p.save(); p.translate(sw+BP*2,sh+BP*2);   p.scale(-1,-1); p.drawImage(img,srcX+srcW-cpSrcW,srcY+srcH-cpSrcH,cpSrcW,cpSrcH,0,0,BP,BP); p.restore();
    return pc;
  }

  let bigC;
  const pieces=[];

  if(splitOrient==='grid'){
    const cols=gridCols, rows=gridRows;
    for(let r=0;r<rows;r++){
      for(let c=0;c<cols;c++){
        const outW=cmToPx(partWidths[0],DPI);
        const outH=cmToPx(partHeights[0],DPI);
        const srcX=Math.round(c*imgW/cols), srcW=Math.round(imgW/cols);
        const srcY=Math.round(r*imgH/rows), srcH=Math.round(imgH/rows);
        pieces.push(buildPiece(srcX,srcY,srcW,srcH,outW,outH));
      }
    }
    const cellFullW=pieces[0].width, cellFullH=pieces[0].height;
    bigC=document.createElement('canvas');
    bigC.width =cols*cellFullW + PIECE_GAP_PX*(cols-1);
    bigC.height=rows*cellFullH + PIECE_GAP_PX*(rows-1);
    const bc=bigC.getContext('2d');
    bc.fillStyle='#FFFFFF'; bc.fillRect(0,0,bigC.width,bigC.height);
    for(let r=0;r<rows;r++){
      for(let c=0;c<cols;c++){
        bc.drawImage(pieces[r*cols+c], c*(cellFullW+PIECE_GAP_PX), r*(cellFullH+PIECE_GAP_PX));
      }
    }
  } else {
    const n=partWidths.length;
    if(n===1){
      bigC=buildPiece(0,0,imgW,imgH,
        cmToPx(partWidths[0],DPI),
        cmToPx(partHeights[0],DPI));
    } else {
      for(let i=0;i<n;i++){
        const outW=cmToPx(partWidths[i],DPI);
        const outH=cmToPx(partHeights[i],DPI);
        const srcX=splitOrient==='h'?Math.round(i*imgW/n):0;
        const srcW=splitOrient==='h'?Math.round(imgW/n):imgW;
        const srcY=splitOrient==='v'?Math.round(i*imgH/n):0;
        const srcH=splitOrient==='v'?Math.round(imgH/n):imgH;
        pieces.push(buildPiece(srcX,srcY,srcW,srcH,outW,outH));
      }
      let bigW,bigH;
      if(splitOrient==='h'){
        bigW=pieces.reduce((a,p2)=>a+p2.width,0)+PIECE_GAP_PX*(n-1);
        bigH=pieces[0].height;
      } else {
        bigW=pieces[0].width;
        bigH=pieces.reduce((a,p2)=>a+p2.height,0)+PIECE_GAP_PX*(n-1);
      }
      bigC=document.createElement('canvas'); bigC.width=bigW; bigC.height=bigH;
      const bc=bigC.getContext('2d');
      bc.fillStyle='#FFFFFF'; bc.fillRect(0,0,bigW,bigH);
      let ox=0,oy=0;
      pieces.forEach(p2=>{
        bc.drawImage(p2,ox,oy);
        if(splitOrient==='h') ox+=p2.width+PIECE_GAP_PX;
        else                   oy+=p2.height+PIECE_GAP_PX;
      });
    }
  }

  cImg.bleed=bigC;

  // ── Prévia ─────────────────────────────────────────────
  const sv=document.getElementById('splitCanvas');
  let svAvail=sv.parentElement.offsetWidth-28;
  if(svAvail<=0) svAvail=600;
  const svMaxW=Math.min(svAvail,820);
  const svMaxH=520;

  const ratioW=svMaxW/bigC.width;
  const ratioH=svMaxH/bigC.height;
  const ratio=Math.min(ratioW,ratioH);

  sv.width =Math.round(bigC.width *ratio);
  sv.height=Math.round(bigC.height*ratio);

  const pc2=sv.getContext('2d');
  pc2.drawImage(bigC,0,0,sv.width,sv.height);

  // Linha tracejada vermelha no contorno de corte de CADA painel
  const bpDisp=Math.round(BP*ratio);
  pc2.strokeStyle='rgba(178,34,34,0.9)';
  pc2.setLineDash([6,4]); pc2.lineWidth=1.5;

  if(splitOrient==='grid'){
    const cols=gridCols, rows=gridRows;
    const cellFullW=pieces[0].width, cellFullH=pieces[0].height;
    const cellDispW=Math.round(cellFullW*ratio);
    const cellDispH=Math.round(cellFullH*ratio);
    for(let r=0;r<rows;r++){
      for(let c=0;c<cols;c++){
        const dx=c*(cellDispW + Math.round(PIECE_GAP_PX*ratio));
        const dy=r*(cellDispH + Math.round(PIECE_GAP_PX*ratio));
        pc2.strokeRect(dx+bpDisp, dy+bpDisp, cellDispW-bpDisp*2, cellDispH-bpDisp*2);
      }
    }
  } else if(partWidths.length===1){
    pc2.strokeRect(bpDisp,bpDisp,sv.width-bpDisp*2,sv.height-bpDisp*2);
  } else {
    const n=pieces.length;
    let ox=0,oy=0;
    pieces.forEach(p2=>{
      const pw=Math.round(p2.width*ratio);
      const ph=Math.round(p2.height*ratio);
      pc2.strokeRect(ox+bpDisp, oy+bpDisp, pw-bpDisp*2, ph-bpDisp*2);
      if(splitOrient==='h') ox+=pw+Math.round(PIECE_GAP_PX*ratio);
      else                   oy+=ph+Math.round(PIECE_GAP_PX*ratio);
    });
  }
  pc2.setLineDash([]);

  // Label atualizado
  const sizeLabel=document.getElementById('splitSizeLabel');
  if(sizeLabel){
    if(splitOrient==='grid'){
      sizeLabel.textContent=`Grade ${gridCols}×${gridRows}  —  Cada painel: ${partWidths[0]}×${partHeights[0]}cm (+5cm sangria)`;
    } else {
      const totW=splitOrient==='h'?partWidths.reduce((a,b)=>a+b,0):partWidths[0];
      const totH=splitOrient==='v'?partHeights.reduce((a,b)=>a+b,0):partHeights[0];
      const n=partWidths.length;
      sizeLabel.textContent=n===1
        ?`${totW} × ${totH} cm  (+5cm sangria em cada lado)`
        :`Total: ${totW} × ${totH} cm  (+5cm sangria por painel)`;
    }
  }

  toast('Sangria aplicada! Linha tracejada = área de corte.');
}


function removeBleed(){
  if(!cImg) return;
  if(!cImg.bleed) return toast('Nenhuma sangria aplicada.');
  cImg.bleed=null;
  renderSplit();
  toast('Sangria removida!');
}

function _buildBleedPieceCanvas(idx,total){
  if(!cImg) return null;
  const { img, w:imgW, h:imgH } = cImg;
  const DPI = 300;
  const BP = Math.round(5/2.54*DPI);

  let srcX, srcY, srcW, srcH, sw, sh, pieceName;

  if(splitOrient==='grid'){
    const cols=gridCols, rows=gridRows;
    const r=Math.floor(idx/cols), c=idx%cols;
    sw=Math.round((partWidths[0]||1)/2.54*DPI);
    sh=Math.round((partHeights[0]||1)/2.54*DPI);
    srcX=Math.round(c*imgW/cols);
    srcY=Math.round(r*imgH/rows);
    srcW=(c===cols-1)?(imgW-srcX):Math.round(imgW/cols);
    srcH=(r===rows-1)?(imgH-srcY):Math.round(imgH/rows);
    pieceName=`sangria-L${r+1}C${c+1}de${rows}x${cols}`;
  } else {
    sw=Math.round((partWidths[idx]||partWidths[0]||1)/2.54*DPI);
    sh=Math.round((partHeights[idx]||partHeights[0]||1)/2.54*DPI);
    const b=_splitSrcBoundsNonGrid(idx,imgW,imgH);
    srcX=b.srcX; srcY=b.srcY; srcW=b.srcW; srcH=b.srcH;
    pieceName=`sangria-parte${idx+1}de${total}`;
  }

  const pc=document.createElement('canvas');
  pc.width=Math.max(1,sw+BP*2);
  pc.height=Math.max(1,sh+BP*2);
  const p=pc.getContext('2d');

  // Area util central
  p.drawImage(img,srcX,srcY,srcW,srcH,BP,BP,sw,sh);

  // Espelhamento para sangria
  p.save(); p.translate(BP,BP); p.scale(1,-1);
  p.drawImage(img,srcX,srcY,srcW,Math.max(1,Math.round(srcH*BP/sh)),0,0,sw,BP);
  p.restore();

  p.save(); p.translate(BP,sh+BP); p.scale(1,-1);
  p.drawImage(img,srcX,srcY+srcH-Math.max(1,Math.round(srcH*BP/sh)),srcW,Math.max(1,Math.round(srcH*BP/sh)),0,-BP,sw,BP);
  p.restore();

  p.save(); p.translate(BP,BP); p.scale(-1,1);
  p.drawImage(img,srcX,srcY,Math.max(1,Math.round(srcW*BP/sw)),srcH,0,0,BP,sh);
  p.restore();

  p.save(); p.translate(sw+BP,BP); p.scale(-1,1);
  p.drawImage(img,srcX+srcW-Math.max(1,Math.round(srcW*BP/sw)),srcY,Math.max(1,Math.round(srcW*BP/sw)),srcH,-BP,0,BP,sh);
  p.restore();

  const cpSrcW=Math.max(1,Math.round(srcW*BP/sw));
  const cpSrcH=Math.max(1,Math.round(srcH*BP/sh));
  p.save(); p.translate(BP,BP);       p.scale(-1,-1); p.drawImage(img,srcX,srcY,cpSrcW,cpSrcH,0,0,BP,BP); p.restore();
  p.save(); p.translate(sw+BP,BP);    p.scale(1,-1);  p.drawImage(img,srcX+srcW-cpSrcW,srcY,cpSrcW,cpSrcH,0,0,BP,BP); p.restore();
  p.save(); p.translate(BP,sh+BP);    p.scale(-1,1);  p.drawImage(img,srcX,srcY+srcH-cpSrcH,cpSrcW,cpSrcH,0,0,BP,BP); p.restore();
  p.save(); p.translate(sw+BP,sh+BP);                 p.drawImage(img,srcX+srcW-cpSrcW,srcY+srcH-cpSrcH,cpSrcW,cpSrcH,0,0,BP,BP); p.restore();

  return { canvas: pc, name: pieceName };
}

function _dlBleedPiece(idx,total,fmt){
  const piece=_buildBleedPieceCanvas(idx,total);
  if(!piece) return;
  const baseName=piece.name;
  const baseWcm=splitOrient==='grid' ? (partWidths[0]||1) : (partWidths[idx]||partWidths[0]||1);
  const baseHcm=splitOrient==='grid' ? (partHeights[0]||1) : (partHeights[idx]||partHeights[0]||1);
  const outWcm=baseWcm+10;
  const outHcm=baseHcm+10;
  if(fmt==='jpg'){
    askFileName(baseName, (finalName) => {
      const finalNameWithSize=_splitEnsureSizeTagInFileName(finalName,outWcm,outHcm);
      piece.canvas.toBlob(b=>{ _saveAs(b, finalNameWithSize, 'image/jpeg').then(()=>toast('JPEG com sangria baixado!')); },'image/jpeg',0.92);
    });
  } else {
    askFileName(baseName, (finalName) => {
      const finalNameWithSize=_splitEnsureSizeTagInFileName(finalName,outWcm,outHcm);
      exportPDFsave(piece.canvas, finalNameWithSize);
      toast('PDF com sangria exportado!');
    });
  }
}

function dlBleed(fmt){
  if(!cImg?.bleed){ applyBleed(); setTimeout(()=>dlBleed(fmt),350); return; }

  const total = splitOrient==='grid' ? gridCols*gridRows : partWidths.length;
  if(total<=1){
    _dlBleedPiece(0,1,fmt);
    return;
  }

  for(let i=0;i<total;i++){
    setTimeout(()=>_dlBleedPiece(i,total,fmt), i*700);
  }
}

function exportPDF(canvas,name){
  try{
    const{jsPDF}=window.jspdf;
    const wC=+(canvas.width /300*2.54).toFixed(2);
    const hC=+(canvas.height/300*2.54).toFixed(2);
    const pdf=new jsPDF({unit:'cm',format:[wC,hC]});
    pdf.addImage(canvas.toDataURL('image/jpeg',1.0),'JPEG',0,0,wC,hC);
    pdf.save(name+'.pdf');
  } catch {
    canvas.toBlob(b=>{
      const a=document.createElement('a');
      a.href=URL.createObjectURL(b); a.download=finalName+'.jpg'; a.click();
    },'image/jpeg',1.0);
  }
}
// Versão com janela nativa de salvar (File System Access API)
async function exportPDFsave(canvas, name) {
  try {
    const{jsPDF}=window.jspdf;
    const wC=+(canvas.width /300*2.54).toFixed(2);
    const hC=+(canvas.height/300*2.54).toFixed(2);
    const pdf=new jsPDF({unit:'cm',format:[wC,hC]});
    pdf.addImage(canvas.toDataURL('image/jpeg',1.0),'JPEG',0,0,wC,hC);
    const blob = pdf.output('blob');
    await _saveAs(blob, name, 'application/pdf');
  } catch(e) {
    exportPDF(canvas, name); // fallback
  }
}


// ─────────────────────────────────────────────────────────
//  SIMULADOR DE PAREDE
// ─────────────────────────────────────────────────────────
const ROOM_PATHS={
  sala1:    '/static/assets/img/rooms/sala1.jpg',
  sala2:    '/static/assets/img/rooms/sala2.jpg',
  sala3:    '/static/assets/img/rooms/sala3.jpg',
  sala4:    '/static/assets/img/rooms/sala4.jpg',
  qcasal:   '/static/assets/img/rooms/qcasal.jpg',
  qhospede: '/static/assets/img/rooms/qhospede.jpg',
  qcrianca: '/static/assets/img/rooms/qcrianca.jpg',
  gourmet:  '/static/assets/img/rooms/gourmet.jpg',
};
const ROOM_DEFAULTS={
  sala1:   {x:50,y:38,w:100,h:70}, sala2:   {x:50,y:35,w:120,h:80},
  sala3:   {x:50,y:40,w:90,h:60},  sala4:   {x:50,y:36,w:80,h:60},
  qcasal:  {x:50,y:36,w:100,h:70}, qhospede:{x:50,y:38,w:80,h:60},
  qcrianca:{x:50,y:38,w:60,h:50},  gourmet: {x:50,y:40,w:80,h:60},
};

const ROOM_CUSTOM_STORE_KEY='ff_room_catalog_v1';
const ROOM_STORE_SCOPE='rooms';
let _roomTargetKey=null;
let _roomNameModalMode='';
let _roomPendingDataUrl='';
let _roomRenameKey='';
let _roomDeleteKey='';
let _roomStoreData={overrides:{},customs:[]};
let _roomStoreLoaded=false;
let _roomStoreInitPromise=null;
let _roomStoreSaveTimer=null;
let _roomStoreSaveInFlight=null;
let _roomStorePendingSync=false;

function _roomReadLegacyStore(){
  try{
    const raw=localStorage.getItem(ROOM_CUSTOM_STORE_KEY);
    const parsed=raw?JSON.parse(raw):{};
    return {
      overrides: parsed.overrides||{},
      customs: Array.isArray(parsed.customs)?parsed.customs:[]
    };
  }catch(_){
    return {overrides:{},customs:[]};
  }
}

function _roomMigrationFlagKey(){
  const storeId=window.FF_CURRENT_USER?.store_id||'0';
  return 'ff_store_state_room_migrated_'+storeId;
}

// Cache localStorage para evitar re-fetch do Supabase a cada carregamento (reduz egress)
function _roomCacheKey(){
  const storeId=window.FF_CURRENT_USER?.store_id||'0';
  return 'ff_rooms_cache_v2_'+storeId;
}
function _roomReadCache(){
  try{
    const raw=localStorage.getItem(_roomCacheKey());
    if(!raw) return null;
    const parsed=JSON.parse(raw);
    if(!parsed||!parsed.updated_at) return null;
    return parsed; // {data, updated_at}
  }catch(_){ return null; }
}
function _roomWriteCache(data, updated_at){
  try{ localStorage.setItem(_roomCacheKey(), JSON.stringify({data, updated_at})); }catch(_){}
}

function _roomNormalizeStore(data){
  const safe = data && typeof data === 'object' ? data : {};
  const overrides = safe.overrides && typeof safe.overrides === 'object' ? safe.overrides : {};
  const customs = Array.isArray(safe.customs) ? safe.customs.filter(c => c && c.key && c.src) : [];
  return { overrides, customs };
}

function _roomLoadStore(){
  return _roomNormalizeStore(_roomStoreData);
}

function _roomSaveStore(data){
  _roomStoreData=_roomNormalizeStore(data);
  _roomScheduleSync();
  return true;
}

function _roomHasMeaningfulData(data){
  const safe=_roomNormalizeStore(data);
  return !!(safe.customs.length || Object.keys(safe.overrides||{}).length);
}

function _roomScheduleSync(delay=250){
  if(_roomStoreSaveTimer) clearTimeout(_roomStoreSaveTimer);
  _roomStoreSaveTimer=setTimeout(()=>{
    _roomStoreSaveTimer=null;
    _roomSyncToServer();
  }, delay);
}

async function _roomSyncToServer(){
  if(!_roomStoreLoaded) return;
  if(_roomStoreSaveInFlight){
    _roomStorePendingSync=true;
    return;
  }
  const payload=_roomNormalizeStore(_roomStoreData);
  _roomStoreSaveInFlight=(async()=>{
    try{
      const resp=await _ffApi('/api/store-state/'+ROOM_STORE_SCOPE, {
        method:'PUT',
        body:JSON.stringify({ data: payload })
      });
      // Atualiza cache local com o updated_at retornado pelo servidor
      if(resp && resp.updated_at) _roomWriteCache(payload, resp.updated_at);
      try{ localStorage.setItem(_roomMigrationFlagKey(), '1'); }catch(_){ }
    }catch(err){
      toast(err.message||'Nao foi possivel sincronizar os ambientes da loja.');
    }finally{
      _roomStoreSaveInFlight=null;
      if(_roomStorePendingSync){
        _roomStorePendingSync=false;
        _roomScheduleSync(80);
      }
    }
  })();
  return _roomStoreSaveInFlight;
}

async function _roomEnsureStoreLoaded(){
  if(_roomStoreLoaded) return _roomStoreData;
  if(_roomStoreInitPromise) return _roomStoreInitPromise;
  _roomStoreInitPromise=(async()=>{
    try{
      // 1. Tenta cache local primeiro (zero egress Supabase)
      const cached=_roomReadCache();
      if(cached){
        _roomStoreData=_roomNormalizeStore(cached.data);
        _roomStoreLoaded=true;
        // Valida em background se o servidor tem versao mais nova
        _roomValidateCacheInBackground(cached.updated_at);
        return _roomStoreData;
      }
      // 2. Sem cache: busca completa do servidor
      const resp=await _ffApi('/api/store-state/'+ROOM_STORE_SCOPE);
      if(resp && resp.has_data){
        _roomStoreData=_roomNormalizeStore(resp.data);
        _roomWriteCache(resp.data, resp.updated_at);
      }else{
        const legacy=_roomNormalizeStore(_roomReadLegacyStore());
        _roomStoreData=legacy;
        if(_roomHasMeaningfulData(legacy)){
          _roomStoreLoaded=true;
          try{ localStorage.setItem(_roomMigrationFlagKey(), '1'); }catch(_){ }
          _roomScheduleSync(0);
          return _roomStoreData;
        }
      }
    }catch(_err){
      _roomStoreData=_roomNormalizeStore(_roomReadLegacyStore());
    }
    _roomStoreLoaded=true;
    return _roomStoreData;
  })();
  return _roomStoreInitPromise;
}

async function _roomValidateCacheInBackground(cachedUpdatedAt){
  try{
    const meta=await _ffApi('/api/store-state/'+ROOM_STORE_SCOPE+'?meta_only=1');
    if(meta && meta.has_data && meta.updated_at && meta.updated_at !== cachedUpdatedAt){
      // Servidor tem versao mais nova: busca completa e atualiza UI
      const resp=await _ffApi('/api/store-state/'+ROOM_STORE_SCOPE);
      if(resp && resp.has_data){
        _roomStoreData=_roomNormalizeStore(resp.data);
        _roomWriteCache(resp.data, resp.updated_at);
        _roomApplyOverrides();
        _roomRenderCustomGrid();
        Object.keys(ROOM_PATHS).forEach(key=>{
          const thumb=_roomThumbForKey(key);
          if(thumb && ROOM_PATHS[key]) _roomUpdateThumbImage(key, ROOM_PATHS[key], thumb.getAttribute('data-room-label')||'Ambiente');
        });
      }
    }
  }catch(_){}
}

function _roomApplyOverrides(){
  const data=_roomNormalizeStore(_roomLoadStore());
  Object.keys(data.overrides).forEach(key=>{
    if(data.overrides[key]) ROOM_PATHS[key]=data.overrides[key];
  });
  data.customs.forEach(c=>{
    if(!c||!c.key||!c.src) return;
    ROOM_PATHS[c.key]=c.src;
    ROOM_DEFAULTS[c.key]=c.defaults||{x:50,y:38,w:80,h:60};
  });
}

function _roomThumbForKey(key){
  return document.querySelector('.room-thumb[data-room-key="'+key+'"]');
}

function _roomUpdateThumbImage(key, src, label){
  const thumb=_roomThumbForKey(key);
  if(!thumb) return;
  thumb.classList.remove('no-img');
  let img=thumb.querySelector('img');
  if(!img){
    img=document.createElement('img');
    thumb.prepend(img);
  }
  img.src=src;
  img.alt=label||thumb.getAttribute('data-room-label')||'Ambiente';
}

function _roomRenderCustomGrid(){
  const grid=document.getElementById('customRoomGrid');
  if(!grid) return;
  const data=_roomNormalizeStore(_roomLoadStore());
  grid.innerHTML='';
  data.customs.forEach(c=>{
    const card=document.createElement('div');
    card.className='room-thumb';
    card.setAttribute('data-room-key', c.key);
    card.setAttribute('data-room-label', c.label||'Ambiente');
    card.setAttribute('onclick', "loadPresetRoom('"+c.key+"')");

    const btn=document.createElement('button');
    btn.className='room-edit-btn';
    btn.title='Trocar imagem';
    btn.textContent='✏️';
    btn.onclick=function(ev){ ev.stopPropagation(); trocarImagemPreset(c.key); };

    const renameBtn=document.createElement('button');
    renameBtn.className='room-rename-btn';
    renameBtn.title='Renomear ambiente';
    renameBtn.textContent='🏷';
    renameBtn.onclick=function(ev){ ev.stopPropagation(); renomearAmbienteCustom(c.key); };

    const delBtn=document.createElement('button');
    delBtn.className='room-del-btn';
    delBtn.title='Remover ambiente';
    delBtn.textContent='🗑';
    delBtn.onclick=function(ev){ ev.stopPropagation(); removerAmbienteCustom(c.key); };

    const img=document.createElement('img');
    img.src=c.src;
    img.alt=c.label||'Ambiente';

    const label=document.createElement('div');
    label.className='room-label';
    label.textContent=c.label||'Ambiente';

    card.appendChild(renameBtn);
    card.appendChild(delBtn);
    card.appendChild(btn);
    card.appendChild(img);
    card.appendChild(label);
    grid.appendChild(card);
  });
}

async function _roomInitCatalog(){
  await _roomEnsureStoreLoaded();
  _roomApplyOverrides();
  Object.keys(ROOM_PATHS).forEach(key=>{
    const thumb=_roomThumbForKey(key);
    if(thumb) _roomUpdateThumbImage(key, ROOM_PATHS[key], thumb.getAttribute('data-room-label')||'Ambiente');
  });
  _roomRenderCustomGrid();
}

async function exportarCatalogoAmbientes(){
  try{
    await _roomEnsureStoreLoaded();
    const payload={
      version: 1,
      exported_at: new Date().toISOString(),
      catalog: _roomNormalizeStore(_roomLoadStore())
    };
    const blob=new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
    const ok = await _saveAs(blob, 'fastframe-catalogo-ambientes', 'application/json');
    if(ok!==false) toast('Catálogo exportado.');
  }catch(_){
    toast('Nao foi possivel exportar o catalogo.');
  }
}

async function importarCatalogoAmbientes(e){
  const file=e.target.files?.[0];
  if(!file) return;
  try{
    await _roomEnsureStoreLoaded();
    const text=await file.text();
    const parsed=JSON.parse(text);
    const imported=_roomNormalizeStore(parsed.catalog || parsed);
    const current=_roomNormalizeStore(_roomLoadStore());

    const mergedOverrides={...current.overrides, ...imported.overrides};
    const mergedCustoms=[...current.customs];
    imported.customs.forEach(item=>{
      const idx=mergedCustoms.findIndex(c=>c.key===item.key);
      if(idx>=0) mergedCustoms[idx]=item;
      else mergedCustoms.push(item);
    });

    const next={ overrides: mergedOverrides, customs: mergedCustoms };
    if(!_roomSaveStore(next)){
      toast('Espaco do navegador insuficiente para importar este catalogo.');
      return;
    }

    _roomApplyOverrides();
    _roomRenderCustomGrid();
    Object.keys(ROOM_PATHS).forEach(key=>{
      const thumb=_roomThumbForKey(key);
      if(thumb && ROOM_PATHS[key]) _roomUpdateThumbImage(key, ROOM_PATHS[key], thumb.getAttribute('data-room-label')||'Ambiente');
    });
    toast('Catálogo importado com sucesso!');
  }catch(_){
    toast('Arquivo de catálogo inválido.');
  }finally{
    e.target.value='';
  }
}

function trocarImagemPreset(key){
  _roomTargetKey=key;
  const fileEl=document.getElementById('roomCustomFile');
  if(fileEl){ fileEl.value=''; fileEl.click(); }
}

function adicionarNovoAmbiente(){
  _roomTargetKey='__novo__';
  const fileEl=document.getElementById('roomCustomFile');
  if(fileEl){ fileEl.value=''; fileEl.click(); }
}

function abrirRoomNameModal({mode,title,confirmLabel,initialValue,pendingDataUrl,renameKey}){
  const modal=document.getElementById('roomNameModal');
  const ttl=document.getElementById('roomNameModalTitle');
  const btn=document.getElementById('roomNameModalConfirmBtn');
  const inp=document.getElementById('roomNameInput');
  if(!modal||!ttl||!btn||!inp) return;

  _roomNameModalMode=mode||'';
  _roomPendingDataUrl=pendingDataUrl||'';
  _roomRenameKey=renameKey||'';

  ttl.textContent=title||'Nome do ambiente';
  btn.textContent=confirmLabel||'Salvar';
  inp.value=initialValue||'';
  modal.style.display='flex';
  setTimeout(()=>inp.focus(),20);
}

function fecharRoomNameModal(){
  const modal=document.getElementById('roomNameModal');
  const inp=document.getElementById('roomNameInput');
  if(modal) modal.style.display='none';
  if(inp) inp.value='';
  _roomNameModalMode='';
  _roomPendingDataUrl='';
  _roomRenameKey='';
}

function abrirRoomDeleteModal(key){
  if(!key || !String(key).startsWith('custom_')) return;
  const modal=document.getElementById('roomDeleteModal');
  if(!modal) return;
  _roomDeleteKey=key;
  modal.style.display='flex';
}

function fecharRoomDeleteModal(){
  const modal=document.getElementById('roomDeleteModal');
  if(modal) modal.style.display='none';
  _roomDeleteKey='';
}

function confirmarRoomDeleteModal(){
  const key=_roomDeleteKey;
  if(!key || !String(key).startsWith('custom_')){ fecharRoomDeleteModal(); return; }

  const store=_roomLoadStore();
  const before=store.customs.length;
  store.customs=store.customs.filter(c=>c.key!==key);
  if(store.customs.length===before){ fecharRoomDeleteModal(); return; }

  delete ROOM_PATHS[key];
  delete ROOM_DEFAULTS[key];
  if(!_roomSaveStore(store)){
    toast('Nao foi possivel atualizar o catalogo de ambientes.');
    return;
  }
  _roomRenderCustomGrid();
  document.querySelectorAll('.room-thumb[data-room-key]').forEach(t=>{
    if(t.getAttribute('data-room-key')===key) t.classList.remove('active');
  });
  fecharRoomDeleteModal();
  toast('Ambiente removido.');
}

function confirmarRoomNameModal(){
  const inp=document.getElementById('roomNameInput');
  const nome=(inp?.value||'').trim();
  if(!nome){ toast('Informe um nome para o ambiente.'); return; }

  if(_roomNameModalMode==='add'){
    const dataUrl=_roomPendingDataUrl;
    if(!dataUrl){ fecharRoomNameModal(); return; }
    const store=_roomLoadStore();
    const key='custom_'+Date.now();
    ROOM_PATHS[key]=dataUrl;
    ROOM_DEFAULTS[key]={x:50,y:38,w:80,h:60};
    store.customs.push({ key, label:nome, src:dataUrl, defaults:{x:50,y:38,w:80,h:60} });
    if(!_roomSaveStore(store)){
      delete ROOM_PATHS[key];
      delete ROOM_DEFAULTS[key];
      toast('Espaco do navegador insuficiente para salvar este ambiente. Tente uma imagem menor.');
      return;
    }
    _roomRenderCustomGrid();
    loadPresetRoom(key);
    fecharRoomNameModal();
    toast('Novo ambiente adicionado!');
    return;
  }

  if(_roomNameModalMode==='rename'){
    const key=_roomRenameKey;
    const store=_roomLoadStore();
    const idx=store.customs.findIndex(c=>c.key===key);
    if(idx<0){ fecharRoomNameModal(); return; }
    store.customs[idx].label=nome;
    _roomSaveStore(store);
    _roomRenderCustomGrid();
    fecharRoomNameModal();
    toast('Ambiente renomeado.');
  }
}

function removerAmbienteCustom(key){
  abrirRoomDeleteModal(key);
}

function renomearAmbienteCustom(key){
  if(!key || !String(key).startsWith('custom_')) return;
  const store=_roomLoadStore();
  const idx=store.customs.findIndex(c=>c.key===key);
  if(idx<0) return;

  const atual=store.customs[idx].label||'Ambiente';
  abrirRoomNameModal({
    mode:'rename',
    title:'Renomear Ambiente',
    confirmLabel:'Salvar Nome',
    initialValue:atual,
    renameKey:key,
  });
}

function _readRoomFileAsDataURL(file){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(reader.result);
    reader.onerror=()=>reject(new Error('Falha ao ler arquivo da imagem.'));
    reader.readAsDataURL(file);
  });
}

function _roomLoadImage(src){
  return new Promise((resolve,reject)=>{
    const img=new Image();
    img.onload=()=>resolve(img);
    img.onerror=()=>reject(new Error('Falha ao processar a imagem do ambiente.'));
    img.src=src;
  });
}

async function _optimizeRoomImageToDataURL(file){
  const rawDataUrl=await _readRoomFileAsDataURL(file);
  const img=await _roomLoadImage(rawDataUrl);
  const maxW=1600;
  const maxH=1200;
  const scale=Math.min(maxW/(img.naturalWidth||img.width), maxH/(img.naturalHeight||img.height), 1);
  const width=Math.max(1, Math.round((img.naturalWidth||img.width)*scale));
  const height=Math.max(1, Math.round((img.naturalHeight||img.height)*scale));
  const canvas=document.createElement('canvas');
  canvas.width=width;
  canvas.height=height;
  const ctx=canvas.getContext('2d');
  ctx.drawImage(img,0,0,width,height);
  return canvas.toDataURL('image/jpeg', 0.8);
}

async function onRoomCustomFileChange(e){
  const file=e.target.files?.[0];
  if(!file) return;
  try{
    let blob=file;
    if(file.type==='image/heic'||file.type==='image/heif'){
      blob = await heic2any({blob:file,toType:'image/jpeg',quality:.9});
    }
    const asFile = blob instanceof Blob && !(blob instanceof File)
      ? new File([blob], 'ambiente.jpg', {type: blob.type || 'image/jpeg'})
      : blob;
    const dataUrl=await _optimizeRoomImageToDataURL(asFile);
    const store=_roomLoadStore();

    if(_roomTargetKey==='__novo__'){
      abrirRoomNameModal({
        mode:'add',
        title:'Novo Ambiente',
        confirmLabel:'Adicionar',
        initialValue:'Novo Ambiente',
        pendingDataUrl:dataUrl,
      });
      return;
    }

    if(!_roomTargetKey) return;
    ROOM_PATHS[_roomTargetKey]=dataUrl;
    if(String(_roomTargetKey).startsWith('custom_')){
      const idx=store.customs.findIndex(c=>c.key===_roomTargetKey);
      if(idx>=0) store.customs[idx].src=dataUrl;
    }else{
      store.overrides[_roomTargetKey]=dataUrl;
    }
    if(!_roomSaveStore(store)){
      toast('Espaco do navegador insuficiente para salvar este ambiente. Tente uma imagem menor.');
      return;
    }
    _roomUpdateThumbImage(_roomTargetKey, dataUrl);
    loadPresetRoom(_roomTargetKey);
    toast('Imagem do ambiente atualizada!');
  }catch(err){
    toast(err.message||'Nao foi possivel atualizar o ambiente.');
  }finally{
    _roomTargetKey=null;
    e.target.value='';
  }
}

function loadPresetRoom(key){
  document.querySelectorAll('.room-thumb[data-room-key]').forEach(t=>{
    t.classList.toggle('active', t.getAttribute('data-room-key')===key);
  });
  const roomImg=new Image();
  roomImg.crossOrigin='anonymous';
  roomImg.onload=()=>{ wEnvImg=roomImg; _applyRoomDefaults(key); checkWall(); toast('Ambiente carregado!'); };
  roomImg.onerror=()=>{ wEnvImg=generateRoomCanvas(key); _applyRoomDefaults(key); checkWall(); toast('Ambiente ilustrativo. Substitua pela foto real em static/assets/img/rooms/'+key+'.jpg'); };
  roomImg.src=ROOM_PATHS[key];
}

function _applyRoomDefaults(key){
  const def=ROOM_DEFAULTS[key]||{x:50,y:38,w:80,h:60};
  document.getElementById('wX').value=def.x;
  document.getElementById('wY').value=def.y;
  document.getElementById('wW').value=def.w;
  document.getElementById('wH').value=def.h;
}

function generateRoomCanvas(key){
  const rooms={
    sala1:   {wall:'#E8E0D5',floor:'#8B6F47',accent:'#5A4530',name:'Sala Clássica'},
    sala2:   {wall:'#F0EDE8',floor:'#C4A882',accent:'#3C2F1E',name:'Sala Moderna'},
    sala3:   {wall:'#D4CFC8',floor:'#6B5B45',accent:'#B8903C',name:'Sala Industrial'},
    sala4:   {wall:'#FAFAF8',floor:'#E0D8CC',accent:'#888888',name:'Sala Minimalista'},
    qcasal:  {wall:'#EDE8E2',floor:'#A08060',accent:'#7A5C42',name:'Quarto Casal'},
    qhospede:{wall:'#EAE6E0',floor:'#B89878',accent:'#5A4530',name:'Quarto Hóspede'},
    qcrianca:{wall:'#E8F0F8',floor:'#D4C8B8',accent:'#4A8AB8',name:'Quarto Criança'},
    gourmet: {wall:'#2C2420',floor:'#4A3828',accent:'#B8903C',name:'Área Gourmet'},
  };
  const s=rooms[key]||rooms.sala1;
  const c=document.createElement('canvas'); c.width=1200; c.height=800;
  const ctx=c.getContext('2d');
  ctx.fillStyle=s.wall; ctx.fillRect(0,0,1200,800);
  ctx.fillStyle=s.floor; ctx.fillRect(0,580,1200,220);
  ctx.fillStyle=s.accent; ctx.fillRect(0,572,1200,12);
  const gr=ctx.createLinearGradient(0,560,0,620);
  gr.addColorStop(0,'rgba(0,0,0,0.18)'); gr.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle=gr; ctx.fillRect(0,560,1200,60);
  if(['sala1','sala2','sala3','sala4'].includes(key)){
    ctx.fillStyle=key==='sala3'?'#4A4A4A':'#BDB0A0';
    ctx.beginPath(); ctx.roundRect(200,460,800,120,8); ctx.fill();
  } else if(['qcasal','qhospede'].includes(key)){
    ctx.fillStyle='#8B7355'; ctx.beginPath(); ctx.roundRect(300,420,600,160,6); ctx.fill();
    ctx.fillStyle='#F5F0E8'; ctx.beginPath(); ctx.roundRect(310,390,580,100,4); ctx.fill();
  } else if(key==='qcrianca'){
    ctx.fillStyle='#6AABCF'; ctx.beginPath(); ctx.roundRect(320,420,560,150,8); ctx.fill();
  } else if(key==='gourmet'){
    ctx.fillStyle='#6B5030'; ctx.beginPath(); ctx.roundRect(0,420,1200,160,0); ctx.fill();
  }
  ctx.font='bold 22px sans-serif'; ctx.fillStyle='rgba(0,0,0,0.12)'; ctx.textAlign='center';
  ctx.fillText(s.name,600,760);
  const roomImg=new Image(); roomImg.src=c.toDataURL(); return roomImg;
}

// loadEnv permanece; loadArt, checkWall, renderWall, setWallFrameColor → wall_simulator.js
function loadEnv(e){
  const file=e.target.files[0]; if(!file) return;
  const run=(preparedFile)=>{
    const blob=(preparedFile instanceof Blob)?preparedFile:file;
    const img=new Image();
    img.onload=()=>{ wEnvImg=img; checkWall(); };
    img.onerror=()=>toast('Nao foi possivel abrir a imagem do ambiente.');
    img.src=URL.createObjectURL(blob);
  };
  _ffPrepareImageFile(file)
    .then(run)
    .catch((err)=>{
      console.error('Falha ao preparar ambiente', err);
      if(_isDngLike(file)) toast('DNG do ambiente nao suportado neste dispositivo.');
      else toast('Falha ao abrir imagem do ambiente.');
    });
}

// checkWall, togglePP, setPPColor, renderWall, dlWall → wall_simulator.js

// ─────────────────────────────────────────────────────────
//  MELHORADOR DE IMAGEM
// ─────────────────────────────────────────────────────────
function initEnhFromQImg(){
  if(!qImg) return;
  ensureEnhRemotePreference();
  enhScale=1;
  const img=qImg.img;
  const beforeCvs=document.getElementById('enhBefore');
  const maxD=400;
  let bw=img.naturalWidth, bh=img.naturalHeight;
  if(bw>maxD){ bh=Math.round(bh*maxD/bw); bw=maxD; }
  if(bh>maxD){ bw=Math.round(bw*maxD/bh); bh=maxD; }
  beforeCvs.width=bw; beforeCvs.height=bh;
  beforeCvs.getContext('2d').drawImage(img,0,0,bw,bh);
  document.getElementById('enhBeforeInfo').textContent=
    `${img.naturalWidth} × ${img.naturalHeight} px · ${fmtB(qImg.file.size)}`;

  enhOrigCanvas=document.createElement('canvas');
  enhOrigCanvas.width=img.naturalWidth; enhOrigCanvas.height=img.naturalHeight;
  enhOrigCanvas.getContext('2d').drawImage(img,0,0);

  const afterCvs=document.getElementById('enhAfter');
  afterCvs.width=1; afterCvs.height=1;
  document.getElementById('enhAfterInfo').textContent='';
  resetEnhSliders();
  updateEnhRemoteInfo();
  updateScaleInfo();
}

function ensureEnhRemotePreference(){
  if(_enhRemotePrefLoaded) return;
  _enhRemotePrefLoaded=true;
  try{
    enhRemoteEnabled=localStorage.getItem(ENH_REMOTE_PREF_KEY)==='1';
  } catch {
    enhRemoteEnabled=false;
  }
  updateEnhRemoteInfo();
}

function updateEnhRemoteInfo(){
  const cb=document.getElementById('enhUseRemote');
  const info=document.getElementById('enhRemoteInfo');
  if(cb) cb.checked=Boolean(enhRemoteEnabled);
  if(info){
    info.textContent=enhRemoteEnabled
      ? 'IA externa ativada. O uso de crédito só ocorre quando ela for realmente acionada.'
      : 'IA externa desativada. Todo processamento ficará local, sem consumo de crédito.';
  }
}

function setEnhRemoteEnabled(enabled){
  enhRemoteEnabled=Boolean(enabled);
  try{
    localStorage.setItem(ENH_REMOTE_PREF_KEY, enhRemoteEnabled?'1':'0');
  } catch {}
  updateEnhRemoteInfo();
  updateScaleInfo();
}

function setEnhFilter(f,btn){
  enhFilter=f;
  ['filterNone','filterBW','filterSepia','filterVivid'].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.classList.remove('active');
  });
  btn.classList.add('active');
  applyEnhancement();
}

function setScale(s,btn){
  enhScale=s;
  document.querySelectorAll('[id^=scaleBtn]').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  updateScaleInfo(); applyEnhancement();
}

function updateScaleInfo(){
  if(!enhOrigCanvas) return;
  const nw=enhOrigCanvas.width*enhScale, nh=enhOrigCanvas.height*enhScale;
  const mode=enhRemoteEnabled?'IA externa liberada':'modo local';
  document.getElementById('enhScaleInfo').textContent=`Saída: ${nw.toLocaleString()} × ${nh.toLocaleString()} px · ${mode}`;
}

function qiCanProcessLocally(w,h){
  if(!Number.isFinite(w)||!Number.isFinite(h)||w<=0||h<=0) return false;
  if(Math.max(w,h)>ENH_LOCAL_MAX_SIDE) return false;
  if((w*h)>ENH_LOCAL_MAX_PIXELS) return false;
  return true;
}

async function applyEnhancement(){
  if(!enhOrigCanvas) return;
  if(_enhApplyTimer){
    clearTimeout(_enhApplyTimer);
    _enhApplyTimer=null;
  }
  const token=++_enhApplyToken;

  _enhApplyTimer=setTimeout(async()=>{
    if(token!==_enhApplyToken) return;
    _enhApplyTimer=null;

    const bright  =parseInt(document.getElementById('brightS').value);
    const contrast=parseInt(document.getElementById('contrastS').value);
    const sat     =parseInt(document.getElementById('satS').value);
    const sharp   =parseInt(document.getElementById('sharpS').value);
    const noise   =parseInt(document.getElementById('noiseS').value);
    const temp    =parseInt(document.getElementById('tempS').value);

    const progWrap=document.getElementById('enhProgress');
    const progBar =document.getElementById('enhProgressBar');
    const progLbl =document.getElementById('enhProgressLabel');
    try{
      if(progWrap){ progWrap.style.display='block'; progLbl.textContent=enhScale>1?'Aumentando resolução…':'Aplicando ajustes…'; progBar.style.width='20%'; }

      let baseCanvas=enhOrigCanvas;
      let upscaleScale=enhScale;
      const aiRecommendation=qiGetAiRecommendationForSpec(qiGetExportSpec());
      const canUseRemoteAi=Boolean(enhRemoteEnabled&&aiRecommendation&&aiRecommendation.name==='Replicate'&&enhScale>1);
      if(canUseRemoteAi){
        try{
          progLbl.textContent='Melhorando com IA externa…';
          progBar.style.width='35%';
          const remoteCanvas=await qiEnhanceWithReplicate(enhOrigCanvas, enhScale);
          if(token!==_enhApplyToken) return;
          if(remoteCanvas) baseCanvas=remoteCanvas;
          upscaleScale=1;
          progLbl.textContent='Finalizando ajustes locais…';
          progBar.style.width='55%';
        } catch (err){
          const msg=String(err?.message||'').toLowerCase();
          const rejectedBySize=msg.includes('limite permitido')||msg.includes('413');
          if(rejectedBySize){
            throw new Error('REMOTE_SIZE_LIMIT');
          }
          console.warn('Falha no upscaling remoto, usando fluxo local.', err);
          toast('IA externa indisponivel. Voltando para o modo local classico.');
        }
      }

      const projectedW=baseCanvas.width*upscaleScale;
      const projectedH=baseCanvas.height*upscaleScale;
      if(!qiCanProcessLocally(projectedW,projectedH)){
        throw new Error('LOCAL_SIZE_LIMIT');
      }

      // Upscale bicúbico por passagens de 1.5×
      let cur=baseCanvas;
      let cw=cur.width, ch=cur.height;
      const tw=cw*upscaleScale, th=ch*upscaleScale;
      while(cw<tw){
        const sw=Math.min(Math.round(cw*1.5),tw);
        const sh=Math.min(Math.round(ch*1.5),th);
        const tmp=document.createElement('canvas'); tmp.width=sw; tmp.height=sh;
        const tc=tmp.getContext('2d');
        tc.imageSmoothingEnabled=true; tc.imageSmoothingQuality='high';
        tc.drawImage(cur,0,0,sw,sh);
        cur=tmp; cw=sw; ch=sh;
      }
      if(progBar) progBar.style.width='60%';

      const out=document.createElement('canvas'); out.width=cur.width; out.height=cur.height;
      const ctx=out.getContext('2d'); ctx.drawImage(cur,0,0);

      // Temperatura via overlay
      if(temp!==0){
        ctx.save(); ctx.globalAlpha=Math.abs(temp)/200;
        ctx.fillStyle=temp>0?'#FF9900':'#0099FF';
        ctx.fillRect(0,0,out.width,out.height); ctx.restore();
      }

      // Brilho + contraste + saturação via ImageData
      const imgData=ctx.getImageData(0,0,out.width,out.height);
      const d=imgData.data;
      const cf=(contrast/100+1)**2;
      const bf=bright/100*255;
      for(let i=0;i<d.length;i+=4){
        let r=d[i], g=d[i+1], b2=d[i+2];
        r+=bf; g+=bf; b2+=bf;
        r=(r-128)*cf+128; g=(g-128)*cf+128; b2=(b2-128)*cf+128;
        if(sat!==0){
          const gray=.299*r+.587*g+.114*b2;
          const sf=sat/100+1;
          r=gray+(r-gray)*sf; g=gray+(g-gray)*sf; b2=gray+(b2-gray)*sf;
        }
        d[i]=Math.max(0,Math.min(255,r));
        d[i+1]=Math.max(0,Math.min(255,g));
        d[i+2]=Math.max(0,Math.min(255,b2));
      }
      ctx.putImageData(imgData,0,0);

      // Filtros de estilo (B&W, Sépia, Vívido)
      if(enhFilter!=='none'){
        const fImgData=ctx.getImageData(0,0,out.width,out.height);
        const fPx=fImgData.data;
        for(let fi=0;fi<fPx.length;fi+=4){
          const fGray=Math.round(.299*fPx[fi]+.587*fPx[fi+1]+.114*fPx[fi+2]);
          if(enhFilter==='bw'){
            fPx[fi]=fGray; fPx[fi+1]=fGray; fPx[fi+2]=fGray;
          } else if(enhFilter==='sepia'){
            fPx[fi]  =Math.min(255,Math.round(fGray*.393+fGray*.769+fGray*.189));
            fPx[fi+1]=Math.min(255,Math.round(fGray*.349+fGray*.686+fGray*.168));
            fPx[fi+2]=Math.min(255,Math.round(fGray*.272+fGray*.534+fGray*.131));
          } else if(enhFilter==='vivid'){
            const vf=(1.2)**2;
            let vr=(fPx[fi]-128)*vf+128;
            let vg=(fPx[fi+1]-128)*vf+128;
            let vb=(fPx[fi+2]-128)*vf+128;
            const vGray=.299*vr+.587*vg+.114*vb;
            const vs=1.6;
            fPx[fi]  =Math.max(0,Math.min(255,vGray+(vr-vGray)*vs));
            fPx[fi+1]=Math.max(0,Math.min(255,vGray+(vg-vGray)*vs));
            fPx[fi+2]=Math.max(0,Math.min(255,vGray+(vb-vGray)*vs));
          }
        }
        ctx.putImageData(fImgData,0,0);
      }

      for(let ni=0;ni<noise;ni++) applyBoxBlur(ctx,out.width,out.height);
      for(let si=0;si<sharp;si++) applyUnsharp(ctx,out.width,out.height);

      if(progBar) progBar.style.width='100%';

      const afterCvs=document.getElementById('enhAfter');
      const maxD=400;
      let aw=out.width, ah=out.height;
      if(aw>maxD){ ah=Math.round(ah*maxD/aw); aw=maxD; }
      if(ah>maxD){ aw=Math.round(aw*maxD/ah); ah=maxD; }
      afterCvs.width=aw; afterCvs.height=ah;
      afterCvs.getContext('2d').drawImage(out,0,0,aw,ah);
      document.getElementById('enhAfterInfo').textContent=`${out.width.toLocaleString()} × ${out.height.toLocaleString()} px`;

      enhOrigCanvas._processed=out;
    } catch (err){
      console.error('Falha no melhorador de imagem:', err);
      if(String(err?.message||'').includes('REMOTE_SIZE_LIMIT')){
        toast('A IA externa recusou a imagem por tamanho. Para este arquivo, reduza a escala ou use uma versao menor antes de melhorar novamente.');
        return;
      }
      if(String(err?.message||'').includes('LOCAL_SIZE_LIMIT')){
        toast('Este novo aumento ultrapassa o limite tecnico do navegador. Reduza a escala (2x/3x) ou reutilize a versao atual para exportar.');
        return;
      }
      toast('Falha ao processar imagem neste tamanho. Tente reduzir a escala.');
    } finally {
      if(progWrap) setTimeout(()=>{ progWrap.style.display='none'; },200);
      hideLoading();
    }
  },90);
}

function applyBoxBlur(ctx,w,h){
  const imgData=ctx.getImageData(0,0,w,h);
  const d=imgData.data, o=new Uint8ClampedArray(d);
  for(let y=1;y<h-1;y++){
    for(let x=1;x<w-1;x++){
      for(let ch=0;ch<3;ch++){
        let s=0;
        for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++) s+=d[((y+dy)*w+(x+dx))*4+ch];
        o[(y*w+x)*4+ch]=s/9;
      }
      o[(y*w+x)*4+3]=d[(y*w+x)*4+3];
    }
  }
  imgData.data.set(o); ctx.putImageData(imgData,0,0);
}

function applyUnsharp(ctx,w,h){
  const orig=ctx.getImageData(0,0,w,h);
  const tmp=document.createElement('canvas'); tmp.width=w; tmp.height=h;
  const tc=tmp.getContext('2d');
  tc.putImageData(new ImageData(new Uint8ClampedArray(orig.data),w,h),0,0);
  applyBoxBlur(tc,w,h);
  const bd=tc.getImageData(0,0,w,h).data;
  const od=orig.data;
  for(let i=0;i<od.length;i+=4)
    for(let ch=0;ch<3;ch++)
      od[i+ch]=Math.max(0,Math.min(255,od[i+ch]+1.2*(od[i+ch]-bd[i+ch])));
  ctx.putImageData(orig,0,0);
}

function resetEnhSliders(){
  ['brightS','contrastS','satS','sharpS','noiseS','tempS'].forEach(id=>document.getElementById(id).value=0);
  ['brightL','contrastL','satL','sharpL','noiseL','tempL'].forEach(id=>document.getElementById(id).textContent=0);
  enhScale=1; enhFilter='none';
  const btn1=document.getElementById('scaleBtn1');
  if(btn1) btn1.classList.add('active');
  ['scaleBtn2','scaleBtn3','scaleBtn4'].forEach(id=>{
    const el=document.getElementById(id); if(el) el.classList.remove('active');
  });
  // Resetar filtro
  const fnEl=document.getElementById('filterNone');
  if(fnEl){ fnEl.classList.add('active'); ['filterBW','filterSepia','filterVivid'].forEach(fid=>{const fel=document.getElementById(fid);if(fel) fel.classList.remove('active');}); }
}

function dlEnhanced(fmt){
  if(!enhOrigCanvas?._processed) return toast('Aplique os ajustes primeiro.');
  const isPDF=fmt==='pdf';
  if(isPDF){
    askFileName('melhorada', (finalName) => { exportPDFsave(enhOrigCanvas._processed, finalName); toast('PDF baixado!'); });
  } else {
    askFileName('melhorada', (finalName) => {
      enhOrigCanvas._processed.toBlob(b=>{ _saveAs(b, finalName, 'image/jpeg').then(()=>toast('JPEG baixado!')); },'image/jpeg',.95);
    });
  }
}

// ─────────────────────────────────────────────────────────
//  UTILITÁRIOS
// ─────────────────────────────────────────────────────────
function fmtB(b){ return b>1048576?(b/1048576).toFixed(1)+' MB':(b/1024).toFixed(0)+' KB'; }

function buildThumb(src,name,w,h,size,resetFn){
  return `<div class="thumb-row">
    <img class="thumb-img" src="${src}">
    <div class="thumb-info">
      <div class="tname">${name}</div>
      <div class="tmeta">${w.toLocaleString()} × ${h.toLocaleString()} px · ${fmtB(size)}</div>
    </div>
    <button class="btn-rm" onclick="${resetFn}">✕ Remover</button>
  </div>`;
}

// ─────────────────────────────────────────────────────────
//  NAVEGAÇÃO INTELIGENTE
// ─────────────────────────────────────────────────────────
function goToDivisao(){
  if(!qImg) return toast('Carregue uma imagem primeiro.');
  cImg=qImg;
  switchTab('canvas');
  window.scrollTo({top:0,behavior:'smooth'});
  requestAnimationFrame(()=>showC());
}

function goToSelecao(){
  switchTab('quadros');
  const box=document.getElementById('cUploadBox');
  if(box) box.style.display='block';
  window.scrollTo({top:0,behavior:'smooth'});
}

// ─────────────────────────────────────────────────────────
//  EVENTOS
// ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded',()=>{
  const modal=document.getElementById('previewModal');
  if(modal){
    modal.addEventListener('click',e=>{ if(e.target===modal) closePreviewModal(); });
  }
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'&&modal?.style.display==='flex') closePreviewModal();
  });
});

// ─────────────────────────────────────────────────────────
//  SIMULAÇÃO DE QUADROS (aba individual)
// ─────────────────────────────────────────────────────────
let sqImg=null;
let sqFrameColor='#3C2F1E';
let sqPpColor='#FFFFFF';
let sqBgColor='#E8EDF2';
let sqMarginColor='#FFFFFF';
let sqSizeLocked=true;
let sqAspectRatio=4/3;
let sqImageScale=1;
let sqImageOffsetX=0;
let sqImageOffsetY=0;
let sqFitMode='contain';
let sqRenderMetrics=null;
let sqDragState=null;
let sqDimensionSync=false;
let _ffSplitComposicaoAtiva=false;
let _ffSplitComposicaoMeta=null;
let _ffSplitReplayImg=null;

const SQ_PRESETS=[
  { key:'10x15', label:'10 × 15 cm', w:10, h:15 },
  { key:'13x18', label:'13 × 18 cm', w:13, h:18 },
  { key:'21x30', label:'21 × 30 cm', w:21, h:30 },
  { key:'30x40', label:'30 × 40 cm', w:30, h:40 },
  { key:'50x70', label:'50 × 70 cm', w:50, h:70 },
  { key:'60x90', label:'60 × 90 cm', w:60, h:90 },
];

function loadSQ(e){ loadImgFile(e.target.files[0],'sq'); }

function _sqRound(value, decimals=1){
  const factor=10**decimals;
  return Math.round((Number(value)||0)*factor)/factor;
}

function _sqFormatInput(value){
  const rounded=_sqRound(value,1);
  return Number.isInteger(rounded)?String(rounded):rounded.toFixed(1);
}

function validatePositiveFrameValue(value){
  const num=parseFloat(value);
  return Number.isFinite(num) && num>0;
}

function _sqCurrentSize(){
  const w=parseFloat(document.getElementById('sqW')?.value);
  const h=parseFloat(document.getElementById('sqH')?.value);
  return { w, h };
}

function _sqClampOffsets(metrics){
  if(!metrics) return;
  const limitX=Math.abs((metrics.artWpx-metrics.drawW)/2);
  const limitY=Math.abs((metrics.artHpx-metrics.drawH)/2);
  sqImageOffsetX=Math.max(-limitX,Math.min(limitX,sqImageOffsetX));
  sqImageOffsetY=Math.max(-limitY,Math.min(limitY,sqImageOffsetY));
}

function updateSQSizeMeta(){
  const { w, h }=_sqCurrentSize();
  const lockBtn=document.getElementById('sqLockBtn');
  const lockIcon=document.getElementById('sqLockIcon');
  const ratioLabel=document.getElementById('sqRatioLabel');
  if(lockBtn){
    lockBtn.classList.toggle('active',sqSizeLocked);
    lockBtn.setAttribute('aria-pressed', sqSizeLocked ? 'true' : 'false');
    lockBtn.title=sqSizeLocked ? 'Proporção travada' : 'Proporção livre';
  }
  if(lockIcon) lockIcon.textContent=sqSizeLocked ? '🔒' : '🔓';
  if(validatePositiveFrameValue(w) && validatePositiveFrameValue(h)){
    const gcd=(a,b)=>b?gcd(b,a%b):a;
    const scaledW=Math.round(w*10);
    const scaledH=Math.round(h*10);
    const div=gcd(scaledW,scaledH) || 1;
    if(ratioLabel) ratioLabel.textContent=`${scaledW/div}:${scaledH/div}`;
  } else if(ratioLabel){
    ratioLabel.textContent='-';
  }
}

function updateSQPresetState(){
  const { w, h }=_sqCurrentSize();
  const presetLabel=document.getElementById('sqPresetLabel');
  let matchedLabel='Livre';
  document.querySelectorAll('[data-sq-preset]').forEach((btn)=>{
    const preset=SQ_PRESETS.find(item=>item.key===btn.dataset.sqPreset);
    const matched=Boolean(preset && Math.abs((w||0)-preset.w)<0.05 && Math.abs((h||0)-preset.h)<0.05);
    btn.classList.toggle('active', matched);
    if(matched) matchedLabel=preset.label;
  });
  if(presetLabel) presetLabel.textContent=matchedLabel;
}

function validateSQSizeInputs(){
  const wEl=document.getElementById('sqW');
  const hEl=document.getElementById('sqH');
  if(!wEl || !hEl) return false;
  const okW=validateCmInput(wEl,0.1,300);
  const okH=validateCmInput(hEl,0.1,300);
  return okW && okH && validatePositiveFrameValue(wEl.value) && validatePositiveFrameValue(hEl.value);
}

function toggleSQSizeLock(force){
  const { w, h }=_sqCurrentSize();
  sqSizeLocked=typeof force==='boolean' ? force : !sqSizeLocked;
  if(sqSizeLocked && validatePositiveFrameValue(w) && validatePositiveFrameValue(h)){
    sqAspectRatio=w/h;
  }
  updateSQSizeMeta();
}

function handleSQDimensionInput(changed){
  const wEl=document.getElementById('sqW');
  const hEl=document.getElementById('sqH');
  if(!wEl || !hEl) return;
  const currentEl=changed==='h' ? hEl : wEl;
  validateCmInput(currentEl,0.1,300);
  const w=parseFloat(wEl.value);
  const h=parseFloat(hEl.value);

  if(sqSizeLocked && !sqDimensionSync && sqAspectRatio>0){
    sqDimensionSync=true;
    if(changed==='w' && validatePositiveFrameValue(w)){
      hEl.value=_sqFormatInput(w/sqAspectRatio);
    }
    if(changed==='h' && validatePositiveFrameValue(h)){
      wEl.value=_sqFormatInput(h*sqAspectRatio);
    }
    sqDimensionSync=false;
  }

  const valid=validateSQSizeInputs();
  if(valid && !sqSizeLocked){
    sqAspectRatio=parseFloat(wEl.value)/parseFloat(hEl.value);
  }
  updateSQSizeMeta();
  updateSQPresetState();
  renderFrame();
}

function setSQPreset(w,h,label='Livre'){
  const wEl=document.getElementById('sqW');
  const hEl=document.getElementById('sqH');
  if(!wEl || !hEl) return;
  wEl.value=_sqFormatInput(w);
  hEl.value=_sqFormatInput(h);
  sqAspectRatio=w/h;
  validateSQSizeInputs();
  updateSQSizeMeta();
  updateSQPresetState();
  const presetLabel=document.getElementById('sqPresetLabel');
  if(presetLabel) presetLabel.textContent=label;
  renderFrame();
}

function setSQFitMode(mode,btn=null){
  sqFitMode=mode==='cover' ? 'cover' : 'contain';
  document.querySelectorAll('[data-sq-fit]').forEach((item)=>{
    item.classList.toggle('active', item.dataset.sqFit===sqFitMode);
  });
  if(btn) btn.classList.add('active');
  renderFrame();
}

function setSQImageScale(value){
  const slider=document.getElementById('sqImageScale');
  const label=document.getElementById('sqImageScaleL');
  const numeric=Math.max(40,Math.min(180,parseFloat(value)||100));
  sqImageScale=numeric/100;
  if(slider && slider.value!==String(Math.round(numeric))) slider.value=String(Math.round(numeric));
  if(label) label.textContent=`${Math.round(numeric)}%`;
  renderFrame();
}

function resetSQImagePlacement(){
  sqImageOffsetX=0;
  sqImageOffsetY=0;
  setSQImageScale(100);
}

function setSQMarginColor(color,idx){
  sqMarginColor=color;
  const picker=document.getElementById('sqMarginColorPicker');
  if(picker) picker.value=color;
  for(let i=0;i<5;i++){
    const el=document.getElementById('sqMarginSw'+i);
    if(el) el.classList.toggle('active',i===idx);
  }
  renderFrame();
}

function clearSQMarginActive(){
  for(let i=0;i<5;i++){
    const el=document.getElementById('sqMarginSw'+i);
    if(el) el.classList.remove('active');
  }
}

function buildSQFramePayload(){
  if(!validateSQSizeInputs()) throw new Error('Informe largura e altura válidas em cm.');
  const metrics=sqRenderMetrics || { artWpx:1, artHpx:1 };
  const widthCm=parseFloat(document.getElementById('sqW').value);
  const heightCm=parseFloat(document.getElementById('sqH').value);
  const frameWidthCm=parseFloat(document.getElementById('sqFrameW').value||0) || 0;
  const passepartoutEnabled=Boolean(document.getElementById('sqPpEnabled').checked);
  const passepartoutSizeCm=passepartoutEnabled ? (parseFloat(document.getElementById('sqPpSize').value||0) || 0) : 0;
  return {
    widthCm: parseFloat(widthCm.toFixed(2)),
    heightCm: parseFloat(heightCm.toFixed(2)),
    unit: 'cm',
    ratioLocked: Boolean(sqSizeLocked),
    fitMode: sqFitMode,
    frameWidthCm: parseFloat(frameWidthCm.toFixed(2)),
    passepartoutEnabled,
    passepartoutSizeCm: parseFloat(passepartoutSizeCm.toFixed(2)),
    marginColor: sqMarginColor,
    imageScale: parseFloat(sqImageScale.toFixed(3)),
    imageOffsetX: parseFloat((sqImageOffsetX/Math.max(1,metrics.artWpx)).toFixed(4)),
    imageOffsetY: parseFloat((sqImageOffsetY/Math.max(1,metrics.artHpx)).toFixed(4)),
  };
}

async function postSQFramePayload(url='/api/frame-spec'){
  const payload=buildSQFramePayload();
  return _ffApi(url, {
    method:'POST',
    body: JSON.stringify(payload),
  });
}

function _sqPointerPosition(evt){
  const canvas=document.getElementById('frameCanvas');
  if(!canvas) return { x:0, y:0 };
  const rect=canvas.getBoundingClientRect();
  return {
    x:evt.clientX-rect.left,
    y:evt.clientY-rect.top,
  };
}

function initSQDesignerInteractions(){
  updateSQSizeMeta();
  updateSQPresetState();
}

function _sqCanDragImage(){
  return Boolean(sqImg && sqRenderMetrics && !(_ffSplitComposicaoAtiva && _ffSplitComposicaoMeta && (_ffSplitComposicaoMeta.n||0)>1));
}

// Override the img load dispatch to handle sq
function _dispatchImg(d, type){
  if(type==='q'){  qImg=d; showQ(); }
  else if(type==='c'){ cImg=d; showC(); }
  else if(type==='sq'){
    _ffSplitComposicaoAtiva=false;
    _ffSplitComposicaoMeta=null;
    _ffSplitReplayImg=null;
    sqImg=d;
    showSQ();
  }
}

function showSQ(){
  document.getElementById('sqUploadBox').style.display='none';
  document.getElementById('sqResults').style.display='block';
  // Pré-preencher dimensões com tamanho máximo recomendado
  const[mw,mh]=maxPrintCm(sqImg.w,sqImg.h);
  const useW=validatePositiveFrameValue(customW)?customW:mw;
  const useH=validatePositiveFrameValue(customH)?customH:mh;
  const sqWEl=document.getElementById('sqW');
  const sqHEl=document.getElementById('sqH');
  if(sqWEl) sqWEl.value=_sqFormatInput(useW);
  if(sqHEl) sqHEl.value=_sqFormatInput(useH);
  sqAspectRatio=useW/useH;
  sqImageOffsetX=0;
  sqImageOffsetY=0;
  sqFitMode=(typeof qiFitMode!=='undefined'&&qiFitMode==='contain')?'contain':'cover';
  sqImageScale=(typeof qiImageScale==='number'&&Number.isFinite(qiImageScale))?qiImageScale:1;
  sqMarginColor=(typeof qiMatColor==='string'&&qiMatColor)?qiMatColor:'#FFFFFF';
  toggleSQSizeLock(true);
  setSQImageScale(Math.max(40,Math.min(180,Math.round(sqImageScale*100))));
  setSQFitMode(sqFitMode);
  updateSQPresetState();
  requestAnimationFrame(()=>renderFrame());
}

function resetSQ(){
  sqImg=null;
  sqRenderMetrics=null;
  sqImageOffsetX=0;
  sqImageOffsetY=0;
  _ffSplitComposicaoAtiva=false;
  _ffSplitComposicaoMeta=null;
  _ffSplitReplayImg=null;
  document.getElementById('sqUploadBox').style.display='block';
  document.getElementById('sqResults').style.display='none';
  document.getElementById('sqFile').value='';
}

function _ffSplitLayout(meta){
  if(!meta) return { cols:1, rows:1 };
  if(meta.orient==='grid'){
    return {
      cols:Math.max(1,parseInt(meta.gridCols)||1),
      rows:Math.max(1,parseInt(meta.gridRows)||1)
    };
  }
  if(meta.orient==='v') return { cols:1, rows:Math.max(1,parseInt(meta.n)||1) };
  return { cols:Math.max(1,parseInt(meta.n)||1), rows:1 };
}

function _ffSplitColsCm(meta){
  const { cols }=_ffSplitLayout(meta);
  const totalW=parseFloat(meta?.totalW)||50;
  if(meta?.orient==='h'){
    const arr=(meta.partWidths||[]).slice(0,cols).map(v=>parseFloat(v)||0);
    if(arr.length===cols && arr.every(v=>v>0)) return arr;
  }
  if(meta?.orient==='grid'){
    const arr=[];
    for(let c=0;c<cols;c++){
      const v=parseFloat((meta.partWidths||[])[c]);
      arr.push(v>0?v:totalW/cols);
    }
    return arr;
  }
  return [Math.max(1,totalW)];
}

function _ffSplitRowsCm(meta){
  const { rows }=_ffSplitLayout(meta);
  const totalH=parseFloat(meta?.totalH)||70;
  if(meta?.orient==='v'){
    const arr=(meta.partHeights||[]).slice(0,rows).map(v=>parseFloat(v)||0);
    if(arr.length===rows && arr.every(v=>v>0)) return arr;
  }
  if(meta?.orient==='grid'){
    const arr=[];
    for(let r=0;r<rows;r++){
      const idx=r*(Math.max(1,parseInt(meta.gridCols)||1));
      const v=parseFloat((meta.partHeights||[])[idx]);
      arr.push(v>0?v:totalH/rows);
    }
    return arr;
  }
  return [Math.max(1,totalH)];
}

function _ffSplitSrcBoundsFromMeta(meta, idx, imgW, imgH){
  if(!meta) return { srcX:0, srcY:0, srcW:imgW, srcH:imgH };
  if(meta.orient==='grid'){
    const cols=Math.max(1,parseInt(meta.gridCols)||1);
    const rows=Math.max(1,parseInt(meta.gridRows)||1);
    const r=Math.floor(idx/cols);
    const c=idx%cols;
    const srcX=Math.round(c*imgW/cols);
    const srcY=Math.round(r*imgH/rows);
    const srcW=Math.round(imgW/cols);
    const srcH=Math.round(imgH/rows);
    return { srcX, srcY, srcW, srcH };
  }
  if(meta.orient==='h'){
    const widths=(meta.partWidths||[]).map(v=>parseFloat(v)||0);
    const totalW=widths.reduce((a,b)=>a+b,0)||1;
    const prevW=widths.slice(0,idx).reduce((a,b)=>a+b,0);
    const currW=widths[idx]||0;
    const start=Math.round((prevW/totalW)*imgW);
    const end=idx===widths.length-1?imgW:Math.round(((prevW+currW)/totalW)*imgW);
    return { srcX:start, srcY:0, srcW:Math.max(1,end-start), srcH:imgH };
  }
  const heights=(meta.partHeights||[]).map(v=>parseFloat(v)||0);
  const totalH=heights.reduce((a,b)=>a+b,0)||1;
  const prevH=heights.slice(0,idx).reduce((a,b)=>a+b,0);
  const currH=heights[idx]||0;
  const start=Math.round((prevH/totalH)*imgH);
  const end=idx===heights.length-1?imgH:Math.round(((prevH+currH)/totalH)*imgH);
  return { srcX:0, srcY:start, srcW:imgW, srcH:Math.max(1,end-start) };
}

function _ffSplitBuildPanelSpecs(meta){
  const { cols, rows }=_ffSplitLayout(meta);
  const colsCm=_ffSplitColsCm(meta);
  const rowsCm=_ffSplitRowsCm(meta);
  const specs=[];
  let idx=0;
  for(let r=0;r<rows;r++){
    for(let c=0;c<cols;c++){
      if(idx>=(meta.n||1)) break;
      specs.push({ idx, col:c, row:r, wCm:Math.max(1,colsCm[c]||10), hCm:Math.max(1,rowsCm[r]||10) });
      idx++;
    }
  }
  return { cols, rows, specs };
}

function _ffSplitCreatePanelImage(srcImg, meta, spec){
  return new Promise((resolve,reject)=>{
    try{
      const imgW=srcImg.naturalWidth||srcImg.width;
      const imgH=srcImg.naturalHeight||srcImg.height;
      const src=_ffSplitSrcBoundsFromMeta(meta,spec.idx,imgW,imgH);
      const cv=document.createElement('canvas');
      cv.width=Math.max(1,src.srcW);
      cv.height=Math.max(1,src.srcH);
      const cctx=cv.getContext('2d');
      cctx.drawImage(srcImg,src.srcX,src.srcY,src.srcW,src.srcH,0,0,cv.width,cv.height);
      const panelImg=new Image();
      panelImg.onload=()=>resolve({ img:panelImg, spec });
      panelImg.onerror=()=>reject(new Error('Falha ao criar painel da composição.'));
      panelImg.src=cv.toDataURL('image/jpeg',0.92);
    }catch(err){
      reject(err);
    }
  });
}

async function _ffSplitCreatePanelImages(meta, srcImg){
  const layout=_ffSplitBuildPanelSpecs(meta);
  const tasks=layout.specs.map(spec=>_ffSplitCreatePanelImage(srcImg,meta,spec));
  const items=await Promise.all(tasks);
  return { ...layout, items };
}

function _ffSplitSetWallGapUI(active, gapCm=1.2){
  const wrap=document.getElementById('wCompGapWrap');
  const inp=document.getElementById('wCompGap');
  const lbl=document.getElementById('wCompGapL');
  if(wrap) wrap.style.display=active?'block':'none';
  if(inp){
    inp.value=String(gapCm);
    inp.disabled=!active;
  }
  if(lbl) lbl.textContent=(Number(gapCm).toFixed(1))+'cm';
}

function _ffSplitGetWallFrameOuterDimsCm(frame){
  if(!frame) return { outerW:10, outerH:10 };
  const ppCm=frame.ppOn ? (parseFloat(frame.ppSize)||0) : 0;
  const frameW=parseFloat(frame.frameW)||0;
  return {
    outerW:(parseFloat(frame.wCm)||10) + 2*(ppCm + frameW),
    outerH:(parseFloat(frame.hCm)||10) + 2*(ppCm + frameW),
  };
}

function ffSplitSetWallGap(value){
  const gap=Math.max(0,Math.min(10,parseFloat(value)||0));
  if(!_ffSplitWallLayoutState || !Array.isArray(wallFrames) || !wallFrames.length) return;
  _ffSplitWallLayoutState.gapCm=gap;

  const specs=_ffSplitWallLayoutState.specs||[];
  const cols=_ffSplitWallLayoutState.cols||1;
  const rows=_ffSplitWallLayoutState.rows||1;
  const frameMap=new Map();
  for(const f of wallFrames){
    if(f && f._ffCompPanel===true) frameMap.set(f._ffCompIdx,f);
  }
  if(!frameMap.size) return;

  const rowLayouts=[];
  let totalHcm=0;
  let maxRowWcm=0;
  for(let r=0;r<rows;r++){
    const rowSpecs=specs.filter(s=>s.row===r).sort((a,b)=>a.col-b.col);
    const rowFrames=rowSpecs.map(s=>({ spec:s, frame:frameMap.get(s.idx) })).filter(x=>x.frame);
    const rowWidths=rowFrames.map(x=>_ffSplitGetWallFrameOuterDimsCm(x.frame).outerW);
    const rowHeights=rowFrames.map(x=>_ffSplitGetWallFrameOuterDimsCm(x.frame).outerH);
    const rowWcm=rowWidths.reduce((a,b)=>a+b,0)+Math.max(0,rowFrames.length-1)*gap;
    const rowHcm=rowHeights.length?Math.max(...rowHeights):10;
    rowLayouts.push({ rowFrames, rowWcm, rowHcm });
    maxRowWcm=Math.max(maxRowWcm,rowWcm);
    totalHcm+=rowHcm;
  }
  totalHcm += Math.max(0,rows-1)*gap;
  const safeBaseCenterX=Math.max(2,Math.min(98,Number(_ffSplitWallLayoutState.baseCenterX)||50));
  const safeBaseCenterY=Math.max(2,Math.min(98,Number(_ffSplitWallLayoutState.baseCenterY)||38));
  const wallHcm=wEnvImg ? (300 * ((wEnvImg.naturalHeight||1)/(wEnvImg.naturalWidth||1))) : 170;
  const leftCm=-maxRowWcm/2;
  const topCm=-totalHcm/2;

  let runningY=0;
  for(let r=0;r<rowLayouts.length;r++){
    const row=rowLayouts[r];
    let runningX=(maxRowWcm - row.rowWcm)/2;
    for(const item of row.rowFrames){
      const f=item.frame;
      const dims=_ffSplitGetWallFrameOuterDimsCm(f);
      const centerXcm=leftCm + runningX + (dims.outerW/2);
      const centerYcm=topCm + runningY + (row.rowHcm/2);
      f.xP=Math.max(2,Math.min(98,safeBaseCenterX + (centerXcm/300)*100));
      f.yP=Math.max(2,Math.min(98,safeBaseCenterY + (centerYcm/wallHcm)*100));
      runningX+=dims.outerW+gap;
    }
    runningY+=row.rowHcm+gap;
  }

  const lbl=document.getElementById('wCompGapL');
  if(lbl) lbl.textContent=gap.toFixed(1)+'cm';
  if(typeof _wallUpdatePanelFromSelected==='function') _wallUpdatePanelFromSelected();
  if(typeof _wallRenderPanel==='function') _wallRenderPanel();
  if(typeof renderWall==='function') renderWall();
}

function ffSplitScaleWallCompositionFromFrame(frame, options={}){
  if(!_ffSplitWallLayoutState || !frame || frame._ffCompPanel !== true) return false;
  const specs=_ffSplitWallLayoutState.specs||[];
  const targetSpec=specs.find(s=>s.idx===frame._ffCompIdx);
  if(!targetSpec) return false;

  const srcW=Math.max(0.1, parseFloat(targetSpec.wCm)||0.1);
  const srcH=Math.max(0.1, parseFloat(targetSpec.hCm)||0.1);
  const nextW=Math.max(1, parseFloat(frame.wCm)||srcW);
  const nextH=Math.max(1, parseFloat(frame.hCm)||srcH);
  const scaleW=nextW/srcW;
  const scaleH=nextH/srcH;
  const prefer=options.prefer || 'auto';

  let scale=1;
  if(prefer==='width') scale=scaleW;
  else if(prefer==='height') scale=scaleH;
  else {
    const dw=Math.abs(scaleW-1);
    const dh=Math.abs(scaleH-1);
    scale=dw>=dh?scaleW:scaleH;
  }
  scale=Math.max(0.1, scale);

  _ffSplitWallLayoutState.specs=_ffSplitWallLayoutState.specs.map((spec)=>({
    ...spec,
    wCm:Math.max(1, Math.round((spec.wCm*scale)*10)/10),
    hCm:Math.max(1, Math.round((spec.hCm*scale)*10)/10),
  }));

  ffSplitSetWallGap(_ffSplitWallLayoutState.gapCm);
  return true;
}

function _ffSplitApplyPanelsToWall(layoutData){
  const items=layoutData?.items||[];
  if(!items.length) return false;

  const cols=layoutData.cols||1;
  const rows=layoutData.rows||1;
  const gapCm=parseFloat(_ffSplitComposicaoMeta?.gapCm)||1.2;
  const wallHcm=wEnvImg ? (300 * ((wEnvImg.naturalHeight||1)/(wEnvImg.naturalWidth||1))) : 170;
  const totalWcm=(layoutData.specs||[]).reduce((acc,s)=>acc + (s.row===0?s.wCm:0),0) + Math.max(0,cols-1)*gapCm;

  const rowHeights=[];
  for(let r=0;r<rows;r++){
    const rowItem=(layoutData.specs||[]).find(s=>s.row===r);
    rowHeights.push(rowItem ? rowItem.hCm : 10);
  }
  const totalHcm=rowHeights.reduce((a,b)=>a+b,0)+Math.max(0,rows-1)*gapCm;

  const styleFrameW=parseFloat(document.getElementById('wFrameW')?.value||3)||3;
  const stylePPOn=Boolean(document.getElementById('ppEnabled')?.checked);
  const stylePPSize=parseFloat(document.getElementById('ppSize')?.value||3)||3;
  const styleShadow=parseInt(document.getElementById('wS')?.value||2);

  const baseCenterX=50;
  const baseCenterY=38;
  const leftCm=-totalWcm/2;
  const topCm=-totalHcm/2;

  let runningY=0;
  const frames=[];
  for(let r=0;r<rows;r++){
    let runningX=0;
    const rowItems=items.filter(it=>it.spec.row===r).sort((a,b)=>a.spec.col-b.spec.col);
    for(const it of rowItems){
      const f=(typeof _wallDefaultFrame==='function')?_wallDefaultFrame(it.img):{ img:it.img, frameColor:wallFrameColor||'#3C2F1E', frameW:3, ppOn:false, ppColor:'#FFFFFF', ppSize:3, shadow:2, id:Date.now()+Math.random() };
      f.img=it.img;
      f.wCm=Math.max(1,it.spec.wCm);
      f.hCm=Math.max(1,it.spec.hCm);
      f.frameColor=wallFrameColor||f.frameColor;
      f.frameW=styleFrameW;
      f.ppOn=stylePPOn;
      f.ppColor=ppColor||f.ppColor;
      f.ppSize=stylePPSize;
      f.shadow=Number.isFinite(styleShadow)?styleShadow:2;
      f._ffCompPanel=true;
      f._ffCompIdx=it.spec.idx;
      f._ffCompRow=it.spec.row;
      f._ffCompCol=it.spec.col;

      const centerXcm=leftCm + runningX + (it.spec.wCm/2);
      const centerYcm=topCm + runningY + (it.spec.hCm/2);
      f.xP=Math.max(2,Math.min(98,baseCenterX + (centerXcm/300)*100));
      f.yP=Math.max(2,Math.min(98,baseCenterY + (centerYcm/wallHcm)*100));
      frames.push(f);
      runningX += it.spec.wCm + gapCm;
    }
    runningY += (rowHeights[r]||10) + gapCm;
  }

  if(!frames.length) return false;
  _ffSplitWallLayoutState={
    cols,
    rows,
    specs:(layoutData.specs||[]).map(s=>({ ...s })),
    baseCenterX,
    baseCenterY,
    gapCm,
  };
  _ffSplitSetWallGapUI(true,gapCm);
  wallFrames=frames;
  wallSelectedIdx=0;
  wArtImg=frames[0].img;
  ffSplitSetWallGap(gapCm);
  if(typeof checkWall==='function') checkWall();
  if(typeof _wallRenderPanel==='function') _wallRenderPanel();
  if(typeof _wallUpdatePanelFromSelected==='function') _wallUpdatePanelFromSelected();
  if(typeof renderWall==='function') renderWall();
  return true;
}

function _ffDrawQuadroUnit(ctx, img, src, x, y, imgWpx, imgHpx, frameWpx, ppPx, ppOn){
  const outerW=imgWpx+2*(frameWpx+ppPx);
  const outerH=imgHpx+2*(frameWpx+ppPx);

  ctx.save();
  ctx.shadowColor='rgba(0,0,0,0.35)';
  ctx.shadowBlur=20;
  ctx.shadowOffsetX=4;
  ctx.shadowOffsetY=6;
  ctx.fillStyle=sqFrameColor||'transparent';
  ctx.fillRect(x,y,outerW,outerH);
  ctx.restore();

  if(frameWpx>0){
    ctx.fillStyle=sqFrameColor;
    ctx.fillRect(x,y,outerW,outerH);
    const bevel=Math.max(2,frameWpx*0.12);
    ctx.fillStyle='rgba(255,255,255,0.18)';
    ctx.beginPath();
    ctx.moveTo(x,y); ctx.lineTo(x+outerW,y); ctx.lineTo(x+outerW-bevel,y+bevel); ctx.lineTo(x+bevel,y+bevel); ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x,y); ctx.lineTo(x+bevel,y+bevel); ctx.lineTo(x+bevel,y+outerH-bevel); ctx.lineTo(x,y+outerH); ctx.closePath(); ctx.fill();
    ctx.fillStyle='rgba(0,0,0,0.18)';
    ctx.beginPath();
    ctx.moveTo(x+outerW,y+outerH); ctx.lineTo(x,y+outerH); ctx.lineTo(x+bevel,y+outerH-bevel); ctx.lineTo(x+outerW-bevel,y+outerH-bevel); ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x+outerW,y+outerH); ctx.lineTo(x+outerW-bevel,y+outerH-bevel); ctx.lineTo(x+outerW-bevel,y+bevel); ctx.lineTo(x+outerW,y); ctx.closePath(); ctx.fill();
  }

  if(ppOn&&ppPx>0){
    ctx.fillStyle=sqPpColor;
    ctx.fillRect(x+frameWpx,y+frameWpx,outerW-frameWpx*2,outerH-frameWpx*2);
    const ppBevel=Math.max(1,ppPx*0.08);
    ctx.strokeStyle='rgba(0,0,0,0.1)';
    ctx.lineWidth=ppBevel;
    ctx.strokeRect(x+frameWpx+ppPx-ppBevel/2,y+frameWpx+ppPx-ppBevel/2,imgWpx+ppBevel,imgHpx+ppBevel);
  }

  const imgX=x+frameWpx+ppPx;
  const imgY=y+frameWpx+ppPx;
  ctx.drawImage(img,src.srcX,src.srcY,src.srcW,src.srcH,imgX,imgY,imgWpx,imgHpx);
}

function renderFrame(){
  if(!sqImg) return;
  const cvs=document.getElementById('frameCanvas');
  const stage=document.getElementById('frameStage');
  const stageW=stage.offsetWidth-28||600;

  const wCm=parseFloat(document.getElementById('sqW').value);
  const hCm=parseFloat(document.getElementById('sqH').value);
  const frameWcm=parseFloat(document.getElementById('sqFrameW').value)||0;
  const ppOn=document.getElementById('sqPpEnabled').checked;
  const ppCm=ppOn?(parseFloat(document.getElementById('sqPpSize').value)||3):0;
  const info=document.getElementById('sqSizeInfo');

  if(!validatePositiveFrameValue(wCm) || !validatePositiveFrameValue(hCm)){
    sqRenderMetrics=null;
    stage.classList.remove('can-drag','is-dragging');
    if(info) info.textContent='Defina largura e altura válidas em cm para montar o quadro.';
    return;
  }

  const splitAtivo=Boolean(_ffSplitComposicaoAtiva && _ffSplitComposicaoMeta && (_ffSplitComposicaoMeta.n||0)>1);
  if(splitAtivo){
    sqRenderMetrics=null;
    stage.classList.remove('can-drag','is-dragging');
    const meta=_ffSplitComposicaoMeta;
    const srcImg=_ffSplitReplayImg || ((cImg&&cImg.img)?cImg.img:sqImg.img);
    const imgW=srcImg.naturalWidth||srcImg.width;
    const imgH=srcImg.naturalHeight||srcImg.height;
    const { cols, rows }=_ffSplitLayout(meta);
    const colsCm=_ffSplitColsCm(meta);
    const rowsCm=_ffSplitRowsCm(meta);
    const gapCm=parseFloat(meta.gapCm)||1.2;

    const colOuterCm=colsCm.map(v=>v+2*(ppCm+frameWcm));
    const rowOuterCm=rowsCm.map(v=>v+2*(ppCm+frameWcm));
    const totalWcm=colOuterCm.reduce((a,b)=>a+b,0)+Math.max(0,cols-1)*gapCm;
    const totalHcm=rowOuterCm.reduce((a,b)=>a+b,0)+Math.max(0,rows-1)*gapCm;

    const scale=Math.min((stageW/Math.max(1,totalWcm)),(520/Math.max(1,totalHcm)));
    const totalWpx=Math.max(2,Math.round(totalWcm*scale));
    const totalHpx=Math.max(2,Math.round(totalHcm*scale));
    const frameWpx=Math.max(0,Math.round(frameWcm*scale));
    const ppPx=Math.max(0,Math.round(ppCm*scale));
    const gapPx=Math.max(2,Math.round(gapCm*scale));

    cvs.width=totalWpx; cvs.height=totalHpx;
    const ctx=cvs.getContext('2d');
    ctx.fillStyle=sqBgColor; ctx.fillRect(0,0,totalWpx,totalHpx);

    const xOff=[0];
    for(let c=1;c<cols;c++) xOff[c]=xOff[c-1]+Math.round(colOuterCm[c-1]*scale)+gapPx;
    const yOff=[0];
    for(let r=1;r<rows;r++) yOff[r]=yOff[r-1]+Math.round(rowOuterCm[r-1]*scale)+gapPx;

    let idx=0;
    for(let r=0;r<rows;r++){
      for(let c=0;c<cols;c++){
        if(idx>=(meta.n||1)) break;
        const imgWpx=Math.max(1,Math.round(colsCm[c]*scale));
        const imgHpx=Math.max(1,Math.round(rowsCm[r]*scale));
        const src=_ffSplitSrcBoundsFromMeta(meta,idx,imgW,imgH);
        _ffDrawQuadroUnit(ctx,srcImg,src,xOff[c],yOff[r],imgWpx,imgHpx,frameWpx,ppPx,ppOn);
        idx++;
      }
    }

    if(info){
      const parts=[`Composição: ${meta.n} quadros`];
      if(ppOn&&ppCm>0) parts.push(`Passepartout: ${ppCm}cm`);
      if(frameWcm>0) parts.push(`Moldura: ${frameWcm}cm`);
      parts.push(`Total: ${totalWcm.toFixed(1)}×${totalHcm.toFixed(1)}cm`);
      info.textContent=parts.join('  ·  ');
    }
    return;
  }

  // Tamanho total = imagem + passepartout + moldura (2 lados)
  const totalWcm=wCm+(ppCm+frameWcm)*2;
  const totalHcm=hCm+(ppCm+frameWcm)*2;

  // Escala de display
  const scaleW=stageW/totalWcm;
  const scaleH=520/totalHcm;
  const scale=Math.min(scaleW,scaleH);

  const totalWpx=Math.round(totalWcm*scale);
  const totalHpx=Math.round(totalHcm*scale);
  const frameWpx=Math.round(frameWcm*scale);
  const ppPx=Math.round(ppCm*scale);
  const imgWpx=Math.round(wCm*scale);
  const imgHpx=Math.round(hCm*scale);

  cvs.width=totalWpx; cvs.height=totalHpx;
  const ctx=cvs.getContext('2d');

  // Fundo da cena
  ctx.fillStyle=sqBgColor; ctx.fillRect(0,0,totalWpx,totalHpx);

  // Sombra do conjunto
  ctx.save();
  ctx.shadowColor='rgba(0,0,0,0.35)'; ctx.shadowBlur=20; ctx.shadowOffsetX=4; ctx.shadowOffsetY=6;
  ctx.fillStyle=sqFrameColor||'transparent';
  ctx.fillRect(0,0,totalWpx,totalHpx);
  ctx.restore();

  // Moldura (fundo)
  if(frameWcm>0){
    ctx.fillStyle=sqFrameColor;
    ctx.fillRect(0,0,totalWpx,totalHpx);
    // Bisel interno da moldura (efeito 3D simples)
    const bevel=Math.max(2,frameWpx*0.12);
    ctx.fillStyle='rgba(255,255,255,0.18)';
    ctx.beginPath();
    ctx.moveTo(0,0); ctx.lineTo(totalWpx,0); ctx.lineTo(totalWpx-bevel,bevel); ctx.lineTo(bevel,bevel); ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0,0); ctx.lineTo(bevel,bevel); ctx.lineTo(bevel,totalHpx-bevel); ctx.lineTo(0,totalHpx); ctx.closePath(); ctx.fill();
    ctx.fillStyle='rgba(0,0,0,0.18)';
    ctx.beginPath();
    ctx.moveTo(totalWpx,totalHpx); ctx.lineTo(0,totalHpx); ctx.lineTo(bevel,totalHpx-bevel); ctx.lineTo(totalWpx-bevel,totalHpx-bevel); ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(totalWpx,totalHpx); ctx.lineTo(totalWpx-bevel,totalHpx-bevel); ctx.lineTo(totalWpx-bevel,bevel); ctx.lineTo(totalWpx,0); ctx.closePath(); ctx.fill();
  }

  // Passepartout
  if(ppOn&&ppCm>0){
    ctx.fillStyle=sqPpColor;
    ctx.fillRect(frameWpx,frameWpx,totalWpx-frameWpx*2,totalHpx-frameWpx*2);
    // Borda interna do passepartout (chanfro sutil)
    const ppBevel=Math.max(1,ppPx*0.08);
    ctx.strokeStyle='rgba(0,0,0,0.1)'; ctx.lineWidth=ppBevel;
    ctx.strokeRect(frameWpx+ppPx-ppBevel/2, frameWpx+ppPx-ppBevel/2, imgWpx+ppBevel, imgHpx+ppBevel);
  }

  const artX=frameWpx+ppPx;
  const artY=frameWpx+ppPx;
  const sourceW=sqImg.img.naturalWidth||sqImg.img.width;
  const sourceH=sqImg.img.naturalHeight||sqImg.img.height;
  const baseScale=(sqFitMode==='cover') ? Math.max(imgWpx/sourceW,imgHpx/sourceH) : Math.min(imgWpx/sourceW,imgHpx/sourceH);
  const drawW=Math.max(1,sourceW*baseScale*sqImageScale);
  const drawH=Math.max(1,sourceH*baseScale*sqImageScale);

  sqRenderMetrics={ artX, artY, artWpx:imgWpx, artHpx:imgHpx, drawW, drawH };
  _sqClampOffsets(sqRenderMetrics);
  const drawX=artX+((imgWpx-drawW)/2)+sqImageOffsetX;
  const drawY=artY+((imgHpx-drawH)/2)+sqImageOffsetY;

  ctx.fillStyle=sqMarginColor;
  ctx.fillRect(artX,artY,imgWpx,imgHpx);
  ctx.save();
  ctx.beginPath();
  ctx.rect(artX,artY,imgWpx,imgHpx);
  ctx.clip();
  ctx.drawImage(sqImg.img, drawX, drawY, drawW, drawH);
  ctx.restore();
  ctx.strokeStyle='rgba(26,48,81,0.08)';
  ctx.lineWidth=1;
  ctx.strokeRect(artX+.5,artY+.5,imgWpx-1,imgHpx-1);
  stage.classList.add('can-drag');

  // Info de tamanho
  if(info){
    const parts=[`Formato: ${_sqRound(wCm)}×${_sqRound(hCm)}cm`];
    parts.push(`Arte: ${Math.round(sqImageScale*100)}%`);
    parts.push(sqFitMode==='contain' ? 'Modo: encaixar' : 'Modo: preencher');
    if(ppOn&&ppCm>0) parts.push(`Passepartout: ${ppCm}cm`);
    if(frameWcm>0) parts.push(`Moldura: ${frameWcm}cm`);
    parts.push(`Total: ${totalWcm.toFixed(1)}×${totalHcm.toFixed(1)}cm`);
    info.textContent=parts.join('  ·  ');
  }
}

function setSQFrameColor(color,idx){
  sqFrameColor=color;
  document.getElementById('sqFrameColorPicker').value=color;
  for(let i=0;i<7;i++){
    const el=document.getElementById('sqFc'+i);
    if(el) el.classList.toggle('active',i===idx);
  }
  renderFrame();
}
function clearSQFrameActive(){ for(let i=0;i<7;i++){const el=document.getElementById('sqFc'+i);if(el) el.classList.remove('active');} }

function setSQPpColor(color,idx){
  sqPpColor=color;
  document.getElementById('sqPpColorPicker').value=color;
  for(let i=0;i<7;i++){
    const el=document.getElementById('sqPpSw'+i);
    if(el) el.classList.toggle('active',i===idx);
  }
  renderFrame();
}
function clearSQPpActive(){ for(let i=0;i<7;i++){const el=document.getElementById('sqPpSw'+i);if(el) el.classList.remove('active');} }

function setSQBg(color,idx){
  sqBgColor=color;
  document.getElementById('sqBgPicker').value=color;
  for(let i=0;i<5;i++){
    const el=document.getElementById('sqBg'+i);
    if(el) el.classList.toggle('active',i===idx);
  }
  renderFrame();
}
function clearSQBgActive(){ for(let i=0;i<5;i++){const el=document.getElementById('sqBg'+i);if(el) el.classList.remove('active');} }

function dlFrame(fmt){
  const cvs=document.getElementById('frameCanvas');
  if(!cvs||!sqImg) return toast('Carregue uma imagem primeiro.');
  if(fmt==='pdf'){
    askFileName('quadro', (finalName) => { exportPDFsave(cvs, finalName); toast('PDF do quadro baixado!'); });
  } else {
    askFileName('quadro', (finalName) => {
      cvs.toBlob(b=>{ _saveAs(b, finalName, 'image/jpeg').then(()=>toast('JPEG do quadro baixado!')); },'image/jpeg',.95);
    });
  }
}


// ─────────────────────────────────────────────────────────
//  CATALOGO (PDF + IMAGENS + HISTORICO DE SIMULACOES)
// ─────────────────────────────────────────────────────────
const FF_CATALOG_STORAGE_KEY='ff_catalog_bank_v1';
const FF_CATALOG_STORE_SCOPE='catalog';
const FF_CATALOG_MAX_ITEMS=180;
const FF_CATALOG_MAX_SIMS=80;
const FF_CATALOG_PAGE_SIZE=15;
const FF_CATALOG_DB_NAME='fastframe_catalog_db';
const FF_CATALOG_DB_VERSION=1;
const FF_CATALOG_DB_STORE='kv';
const FF_CATALOG_DB_KEY='catalog_v1';
let _ffCatalogInitDone=false;
let _ffCatalogLoaded=false;
let _ffCatalogDbPromise=null;
let _ffCatalogData={version:2,folders:[],items:[],sims:[]};
let _ffCatalogCurrentFolderId='';
let _ffCatalogPage=1;
let _ffCatalogViewKey='';
let _ffCatalogInitPromise=null;
let _ffCatalogSaveTimer=null;
let _ffSplitComposicaoDataUrl='';
let _ffSplitComposicaoDims={ w: 50, h: 70 };
let _ffSplitComposicaoStamp=0;
let _ffSplitWallLayoutState=null;
let _ffSkipNextSplitAutoApplyAmbiente=false;
let _ffCatalogSaveInFlight=null;
let _ffCatalogPendingSync=false;

function ffCatalogPrevPage(){
  _ffCatalogPage=Math.max(1,_ffCatalogPage-1);
  ffCatalogRender();
}

function ffCatalogNextPage(){
  _ffCatalogPage+=1;
  ffCatalogRender();
}

function _ffCatalogPaginate(list){
  const total=list.length;
  const totalPages=Math.max(1,Math.ceil(total/FF_CATALOG_PAGE_SIZE));
  _ffCatalogPage=Math.min(Math.max(1,_ffCatalogPage),totalPages);
  const start=(_ffCatalogPage-1)*FF_CATALOG_PAGE_SIZE;
  const end=start+FF_CATALOG_PAGE_SIZE;
  return {
    items:list.slice(start,end),
    total,
    totalPages,
    page:_ffCatalogPage,
  };
}

function _ffCatalogRenderPagination(totalItems,totalPages,page){
  const box=document.getElementById('catPagination');
  if(!box) return;
  if(totalItems<=FF_CATALOG_PAGE_SIZE){
    box.style.display='none';
    box.innerHTML='';
    return;
  }
  const shownStart=((page-1)*FF_CATALOG_PAGE_SIZE)+1;
  const shownEnd=Math.min(totalItems,page*FF_CATALOG_PAGE_SIZE);
  const btnBase='padding:7px 10px;border:1px solid #C7D3E4;background:#F6F9FD;color:#24497E;border-radius:8px;font-size:11px;font-weight:700;letter-spacing:.2px;cursor:pointer;min-width:88px;transition:all .15s ease';
  const btnDisabled='padding:7px 10px;border:1px solid #D5DFEC;background:#F8FAFD;color:#7E91AB;border-radius:8px;font-size:11px;font-weight:700;letter-spacing:.2px;cursor:not-allowed;min-width:88px;opacity:.7';
  const btnHoverIn="this.style.background='#EAF1FA';this.style.borderColor='#AFC2DB';this.style.transform='translateY(-1px)'";
  const btnHoverOut="this.style.background='#F6F9FD';this.style.borderColor='#C7D3E4';this.style.transform='none'";
  const prevStyle = page<=1 ? btnDisabled : btnBase;
  const nextStyle = page>=totalPages ? btnDisabled : btnBase;
  const prevDisabled = page<=1 ? 'disabled' : '';
  const nextDisabled = page>=totalPages ? 'disabled' : '';
  const prevHover = page<=1 ? '' : ('onmouseover="'+btnHoverIn+'" onmouseout="'+btnHoverOut+'"');
  const nextHover = page>=totalPages ? '' : ('onmouseover="'+btnHoverIn+'" onmouseout="'+btnHoverOut+'"');
  box.style.display='flex';
  box.innerHTML=
    '<button style="'+prevStyle+'" '+prevHover+' onclick="ffCatalogPrevPage()" '+prevDisabled+'>◀ Anterior</button>'+
    '<div style="font-size:12px;color:#2B4264;font-weight:700;padding:0 6px">Pagina '+page+' de '+totalPages+' • ('+shownStart+'-'+shownEnd+' de '+totalItems+')</div>'+
    '<button style="'+nextStyle+'" '+nextHover+' onclick="ffCatalogNextPage()" '+nextDisabled+'>Proximo ▶</button>';
}

function _ffCatalogHasIDB(){
  return typeof indexedDB!=='undefined';
}

function _ffCatalogOpenDb(){
  if(!_ffCatalogHasIDB()) return Promise.resolve(null);
  if(_ffCatalogDbPromise) return _ffCatalogDbPromise;
  _ffCatalogDbPromise=new Promise((resolve,reject)=>{
    try{
      const req=indexedDB.open(FF_CATALOG_DB_NAME, FF_CATALOG_DB_VERSION);
      req.onupgradeneeded=function(){
        const db=req.result;
        if(!db.objectStoreNames.contains(FF_CATALOG_DB_STORE)){
          db.createObjectStore(FF_CATALOG_DB_STORE);
        }
      };
      req.onsuccess=function(){ resolve(req.result); };
      req.onerror=function(){ reject(req.error||new Error('Falha ao abrir banco local.')); };
    }catch(err){ reject(err); }
  });
  return _ffCatalogDbPromise;
}

async function _ffCatalogReadFromIDB(){
  const db=await _ffCatalogOpenDb();
  if(!db) return null;
  return new Promise((resolve,reject)=>{
    try{
      const tx=db.transaction(FF_CATALOG_DB_STORE,'readonly');
      const store=tx.objectStore(FF_CATALOG_DB_STORE);
      const req=store.get(FF_CATALOG_DB_KEY);
      req.onsuccess=function(){ resolve(req.result||null); };
      req.onerror=function(){ reject(req.error||new Error('Falha ao ler banco local.')); };
    }catch(err){ reject(err); }
  });
}

async function _ffCatalogWriteToIDB(data){
  const db=await _ffCatalogOpenDb();
  if(!db) return false;
  return new Promise((resolve,reject)=>{
    try{
      const tx=db.transaction(FF_CATALOG_DB_STORE,'readwrite');
      const store=tx.objectStore(FF_CATALOG_DB_STORE);
      store.put(data, FF_CATALOG_DB_KEY);
      tx.oncomplete=function(){ resolve(true); };
      tx.onerror=function(){ reject(tx.error||new Error('Falha ao salvar banco local.')); };
      tx.onabort=function(){ reject(tx.error||new Error('Operacao cancelada ao salvar banco local.')); };
    }catch(err){ reject(err); }
  });
}

function _ffCatalogNormalizeData(parsed){
  const foldersRaw=Array.isArray(parsed?.folders)?parsed.folders:[];
  const itemsRaw=Array.isArray(parsed?.items)?parsed.items:[];
  const simsRaw=Array.isArray(parsed?.sims)?parsed.sims:[];
  const folders=[];
  const seenFolderId=new Set();

  foldersRaw.forEach((f,idx)=>{
    const id=String(f?.id||'').trim()||_ffCatalogId('folder_'+idx);
    if(seenFolderId.has(id)) return;
    seenFolderId.add(id);
    folders.push({
      id,
      name:String(f?.name||'Pasta').trim()||'Pasta',
      createdAt:f?.createdAt||new Date().toISOString(),
    });
  });

  const items=itemsRaw.map((it,idx)=>({
    ...it,
    id:String(it?.id||'').trim()||_ffCatalogId('item_'+idx),
    folderId:String(it?.folderId||'').trim(),
  }));

  const sims=simsRaw.map((s,idx)=>({
    ...s,
    id:String(s?.id||'').trim()||_ffCatalogId('sim_'+idx),
  }));

  // Migração automática: banco antigo sem pastas vai para "Geral".
  if(!folders.length){
    const geralId=_ffCatalogId('folder');
    folders.push({ id:geralId, name:'Geral', createdAt:new Date().toISOString() });
    items.forEach(it=>{ if(!it.folderId) it.folderId=geralId; });
  }

  const validIds=new Set(folders.map(f=>f.id));
  const fallbackId=folders[0].id;
  items.forEach(it=>{
    if(!it.folderId || !validIds.has(it.folderId)) it.folderId=fallbackId;
  });

  return { version:2, folders, items, sims };
}

async function _ffCatalogReadLegacyData(){
  if(_ffCatalogHasIDB()){
    try{
      const idbData=await _ffCatalogReadFromIDB();
      if(idbData) return _ffCatalogNormalizeData(idbData);
    }catch(_err){}
  }
  try{
    const raw=localStorage.getItem(FF_CATALOG_STORAGE_KEY);
    const parsed=raw?JSON.parse(raw):{version:2,folders:[],items:[],sims:[]};
    return _ffCatalogNormalizeData(parsed);
  }catch(_){
    return {version:2,folders:[],items:[],sims:[]};
  }
}

function _ffCatalogHasMeaningfulData(data){
  const safe=_ffCatalogNormalizeData(data||{});
  return !!((safe.items||[]).length || (safe.sims||[]).length || (safe.folders||[]).length>1);
}

function _ffCatalogMigrationFlagKey(){
  const storeId=window.FF_CURRENT_USER?.store_id||'0';
  return 'ff_store_state_catalog_migrated_'+storeId;
}

// Cache localStorage para evitar re-fetch do Supabase a cada carregamento (reduz egress)
function _ffCatalogCacheKey(){
  const storeId=window.FF_CURRENT_USER?.store_id||'0';
  return 'ff_catalog_cache_v2_'+storeId;
}
function _ffCatalogReadCache(){
  try{
    const raw=localStorage.getItem(_ffCatalogCacheKey());
    if(!raw) return null;
    const parsed=JSON.parse(raw);
    if(!parsed||!parsed.updated_at) return null;
    return parsed; // {data, updated_at}
  }catch(_){ return null; }
}
function _ffCatalogWriteCache(data, updated_at){
  try{ localStorage.setItem(_ffCatalogCacheKey(), JSON.stringify({data, updated_at})); }catch(_){}
}

function _ffCatalogCanUseLegacyFallback(){
  const storeId=window.FF_CURRENT_USER?.store_id;
  // Em ambiente multiunidade, evitar importar legado local automaticamente
  // para nao contaminar lojas novas com dados de outro usuario/loja.
  return !(storeId && String(storeId).trim());
}

function ffCatalogInit(){
  if(_ffCatalogInitDone) return _ffCatalogInitPromise;
  _ffCatalogInitDone=true;
  _ffCatalogData={version:2,folders:[],items:[],sims:[]};
  _ffCatalogCurrentFolderId='';
  _ffCatalogLoaded=false;

  _ffCatalogInitPromise=(async()=>{
    try{
      // 1. Tenta cache local primeiro (zero egress Supabase)
      const cached=_ffCatalogReadCache();
      if(cached){
        _ffCatalogData=_ffCatalogNormalizeData(cached.data);
        _ffCatalogLoaded=true;
        ffCatalogRender();
        // Valida em background se o servidor tem versao mais nova
        _ffCatalogValidateCacheInBackground(cached.updated_at);
        return;
      }
      // 2. Sem cache: busca completa do servidor
      const resp=await _ffApi('/api/store-state/'+FF_CATALOG_STORE_SCOPE);
      if(resp && resp.has_data){
        _ffCatalogData=_ffCatalogNormalizeData(resp.data);
        _ffCatalogWriteCache(resp.data, resp.updated_at);
      }else{
        if(_ffCatalogCanUseLegacyFallback()){
          const legacyData=await _ffCatalogReadLegacyData();
          _ffCatalogData=legacyData;
          if(_ffCatalogHasMeaningfulData(legacyData)){
            _ffCatalogEnforceLimits();
            _ffCatalogLoaded=true;
            ffCatalogRender();
            try{ localStorage.setItem(_ffCatalogMigrationFlagKey(), '1'); }catch(_){ }
            _ffCatalogSchedulePersist(0);
            return;
          }
        }else{
          _ffCatalogData=_ffCatalogNormalizeData({version:2,folders:[],items:[],sims:[]});
        }
      }
    }catch(_err){
      _ffCatalogData=_ffCatalogCanUseLegacyFallback()
        ? await _ffCatalogReadLegacyData()
        : _ffCatalogNormalizeData({version:2,folders:[],items:[],sims:[]});
    }
    _ffCatalogLoaded=true;
    ffCatalogRender();
  })();
  _ffCatalogInitPromise.catch(()=>{
    _ffCatalogLoaded=true;
    ffCatalogRender();
  });

  if(window.pdfjsLib){
    pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  return _ffCatalogInitPromise;
}

async function _ffCatalogValidateCacheInBackground(cachedUpdatedAt){
  try{
    const meta=await _ffApi('/api/store-state/'+FF_CATALOG_STORE_SCOPE+'?meta_only=1');
    if(meta && meta.has_data && meta.updated_at && meta.updated_at !== cachedUpdatedAt){
      // Servidor tem versao mais nova: busca completa e re-renderiza
      const resp=await _ffApi('/api/store-state/'+FF_CATALOG_STORE_SCOPE);
      if(resp && resp.has_data){
        _ffCatalogData=_ffCatalogNormalizeData(resp.data);
        _ffCatalogWriteCache(resp.data, resp.updated_at);
        ffCatalogRender();
      }
    }
  }catch(_){}
}

function _ffCatalogTs(v){
  const t=new Date(v||'').getTime();
  return Number.isNaN(t)?0:t;
}

function _ffCatalogDropOldest(){
  const hasItems=Array.isArray(_ffCatalogData.items)&&_ffCatalogData.items.length>0;
  const hasSims=Array.isArray(_ffCatalogData.sims)&&_ffCatalogData.sims.length>0;
  if(!hasItems&&!hasSims) return false;

  if(hasItems&&hasSims){
    const oldItem=_ffCatalogData.items.reduce((a,b)=>_ffCatalogTs(a.createdAt)<=_ffCatalogTs(b.createdAt)?a:b);
    const oldSim=_ffCatalogData.sims.reduce((a,b)=>_ffCatalogTs(a.createdAt)<=_ffCatalogTs(b.createdAt)?a:b);
    if(_ffCatalogTs(oldItem.createdAt)<=_ffCatalogTs(oldSim.createdAt)){
      _ffCatalogData.items=_ffCatalogData.items.filter(x=>x.id!==oldItem.id);
    }else{
      _ffCatalogData.sims=_ffCatalogData.sims.filter(x=>x.id!==oldSim.id);
    }
    return true;
  }
  if(hasItems){
    const oldItem=_ffCatalogData.items.reduce((a,b)=>_ffCatalogTs(a.createdAt)<=_ffCatalogTs(b.createdAt)?a:b);
    _ffCatalogData.items=_ffCatalogData.items.filter(x=>x.id!==oldItem.id);
    return true;
  }
  const oldSim=_ffCatalogData.sims.reduce((a,b)=>_ffCatalogTs(a.createdAt)<=_ffCatalogTs(b.createdAt)?a:b);
  _ffCatalogData.sims=_ffCatalogData.sims.filter(x=>x.id!==oldSim.id);
  return true;
}

function _ffCatalogEnforceLimits(){
  if(Array.isArray(_ffCatalogData.items)&&_ffCatalogData.items.length>FF_CATALOG_MAX_ITEMS){
    _ffCatalogData.items=[..._ffCatalogData.items]
      .sort((a,b)=>_ffCatalogTs(b.createdAt)-_ffCatalogTs(a.createdAt))
      .slice(0,FF_CATALOG_MAX_ITEMS);
  }
  if(Array.isArray(_ffCatalogData.sims)&&_ffCatalogData.sims.length>FF_CATALOG_MAX_SIMS){
    _ffCatalogData.sims=[..._ffCatalogData.sims]
      .sort((a,b)=>_ffCatalogTs(b.createdAt)-_ffCatalogTs(a.createdAt))
      .slice(0,FF_CATALOG_MAX_SIMS);
  }
}

function _ffCatalogPersist(){
  _ffCatalogEnforceLimits();
  _ffCatalogSchedulePersist();
  return true;
}

function _ffCatalogSchedulePersist(delay=250){
  if(_ffCatalogSaveTimer) clearTimeout(_ffCatalogSaveTimer);
  _ffCatalogSaveTimer=setTimeout(()=>{
    _ffCatalogSaveTimer=null;
    _ffCatalogSyncToServer();
  }, delay);
}

async function _ffCatalogSyncToServer(){
  if(!_ffCatalogLoaded) return;
  if(_ffCatalogSaveInFlight){
    _ffCatalogPendingSync=true;
    return;
  }
  const payload=_ffCatalogNormalizeData(_ffCatalogData);
  _ffCatalogSaveInFlight=(async()=>{
    try{
      const resp=await _ffApi('/api/store-state/'+FF_CATALOG_STORE_SCOPE, {
        method:'PUT',
        body:JSON.stringify({ data: payload })
      });
      // Atualiza cache local com o updated_at retornado pelo servidor
      if(resp && resp.updated_at) _ffCatalogWriteCache(payload, resp.updated_at);
      try{ localStorage.setItem(_ffCatalogMigrationFlagKey(), '1'); }catch(_){ }
    }catch(err){
      toast(err.message||'Nao foi possivel sincronizar o catalogo da loja.');
    }finally{
      _ffCatalogSaveInFlight=null;
      if(_ffCatalogPendingSync){
        _ffCatalogPendingSync=false;
        _ffCatalogSchedulePersist(80);
      }
    }
  })();
  return _ffCatalogSaveInFlight;
}

function _ffCatalogId(prefix){
  return prefix+'_'+Date.now()+'_'+Math.floor(Math.random()*100000);
}

function _ffCatalogSetStatus(msg){
  const el=document.getElementById('catImportStatus');
  if(el) el.textContent=msg;
}

function ffCatalogOpenImageModalById(itemId){
  const item=(_ffCatalogData.items||[]).find(x=>x.id===itemId);
  if(!item||!item.src) return;
  const modal=document.getElementById('catImageModal');
  const img=document.getElementById('catImageModalImg');
  if(!modal||!img) return;
  img.src=item.src;
  img.alt=item.title||'Imagem do catalogo';
  modal.style.display='flex';
}

function ffCatalogCloseImageModal(){
  const modal=document.getElementById('catImageModal');
  const img=document.getElementById('catImageModalImg');
  if(img){
    img.src='';
    img.alt='';
  }
  if(modal) modal.style.display='none';
}

function ffCatalogHandleImageModalBgClick(ev){
  if(ev && ev.target && ev.target.id==='catImageModal'){
    ffCatalogCloseImageModal();
  }
}

function _ffCatalogFolderById(id){
  return (_ffCatalogData.folders||[]).find(f=>f.id===id)||null;
}

function _ffCatalogSanitizeName(v, fallback){
  const txt=String(v||'').trim().replace(/\s+/g,' ');
  return txt||fallback;
}

function _ffCatalogEnsureDefaultFolder(){
  let folder=(_ffCatalogData.folders||[]).find(f=>String(f.name||'').toLowerCase()==='geral');
  if(!folder){
    folder={ id:_ffCatalogId('folder'), name:'Geral', createdAt:new Date().toISOString() };
    _ffCatalogData.folders.push(folder);
  }
  return folder;
}

function _ffCatalogActiveFolderIdForImport(){
  if(_ffCatalogCurrentFolderId && _ffCatalogFolderById(_ffCatalogCurrentFolderId)) return _ffCatalogCurrentFolderId;
  return _ffCatalogEnsureDefaultFolder().id;
}

function ffCatalogCreateFolder(){
  ffCatalogInit();
  const nameRaw=prompt('Nome da nova pasta:', 'Nova Pasta');
  if(nameRaw===null) return;
  const name=_ffCatalogSanitizeName(nameRaw,'Nova Pasta');
  const exists=(_ffCatalogData.folders||[]).some(f=>String(f.name||'').toLowerCase()===name.toLowerCase());
  if(exists){ toast('Ja existe uma pasta com esse nome.'); return; }
  const folder={ id:_ffCatalogId('folder'), name, createdAt:new Date().toISOString() };
  _ffCatalogData.folders.push(folder);
  _ffCatalogCurrentFolderId=folder.id;
  if(!_ffCatalogPersist()) return;
  ffCatalogRender();
  toast('Pasta criada.');
}

function ffCatalogOpenFolder(folderId){
  ffCatalogInit();
  if(!_ffCatalogFolderById(folderId)) return;
  _ffCatalogCurrentFolderId=folderId;
  ffCatalogRender();
}

function ffCatalogBackToFolders(){
  _ffCatalogCurrentFolderId='';
  ffCatalogRender();
}

function ffCatalogRenameFolder(folderId){
  ffCatalogInit();
  const folder=_ffCatalogFolderById(folderId);
  if(!folder) return;
  const raw=prompt('Novo nome da pasta:', folder.name||'Pasta');
  if(raw===null) return;
  const next=_ffCatalogSanitizeName(raw, folder.name||'Pasta');
  const dup=(_ffCatalogData.folders||[]).some(f=>f.id!==folder.id && String(f.name||'').toLowerCase()===next.toLowerCase());
  if(dup){ toast('Ja existe outra pasta com esse nome.'); return; }
  folder.name=next;
  if(!_ffCatalogPersist()) return;
  ffCatalogRender();
  toast('Pasta renomeada.');
}

function ffCatalogRenameCurrentFolder(){
  if(!_ffCatalogCurrentFolderId) return;
  ffCatalogRenameFolder(_ffCatalogCurrentFolderId);
}

function ffCatalogDeleteFolder(folderId){
  ffCatalogInit();
  const folder=_ffCatalogFolderById(folderId);
  if(!folder) return;
  if(String(folder.name||'').toLowerCase()==='geral'){
    toast('A pasta Geral nao pode ser excluida.');
    return;
  }
  const hasItems=(_ffCatalogData.items||[]).some(it=>it.folderId===folderId);
  if(hasItems){
    const okMove=confirm('Esta pasta tem imagens. Elas serao movidas para a pasta Geral. Continuar?');
    if(!okMove) return;
    const geral=_ffCatalogEnsureDefaultFolder();
    (_ffCatalogData.items||[]).forEach(it=>{ if(it.folderId===folderId) it.folderId=geral.id; });
  } else {
    const ok=confirm('Deseja excluir esta pasta?');
    if(!ok) return;
  }
  _ffCatalogData.folders=(_ffCatalogData.folders||[]).filter(f=>f.id!==folderId);
  if(_ffCatalogCurrentFolderId===folderId) _ffCatalogCurrentFolderId='';
  if(!_ffCatalogPersist()) return;
  ffCatalogRender();
  toast('Pasta excluida.');
}

function ffCatalogRenameItem(itemId){
  ffCatalogInit();
  const it=(_ffCatalogData.items||[]).find(x=>x.id===itemId);
  if(!it) return;
  const raw=prompt('Novo nome da imagem/arquivo:', it.title||'Item');
  if(raw===null) return;
  it.title=_ffCatalogSanitizeName(raw, it.title||'Item');
  if(!_ffCatalogPersist()) return;
  ffCatalogRender();
  toast('Item renomeado.');
}

async function _ffLoadImageFromSrc(src){
  return new Promise((resolve,reject)=>{
    const img=new Image();
    img.onload=()=>resolve(img);
    img.onerror=()=>reject(new Error('Falha ao carregar imagem.'));
    img.src=src;
  });
}

async function _ffFileToOptimizedDataUrl(file, maxW=1000, maxH=1000, quality=0.72){
  let blob=file;
  if(file.type==='image/heic'||file.type==='image/heif'){
    blob=await heic2any({blob:file,toType:'image/jpeg',quality:0.9});
  }
  const objBlob=(blob instanceof Blob)?blob:file;
  const src=URL.createObjectURL(objBlob);
  const img=await _ffLoadImageFromSrc(src);
  URL.revokeObjectURL(src);

  const w=img.naturalWidth||img.width;
  const h=img.naturalHeight||img.height;
  const scale=Math.min(maxW/w,maxH/h,1);
  const tw=Math.max(1,Math.round(w*scale));
  const th=Math.max(1,Math.round(h*scale));
  const c=document.createElement('canvas');
  c.width=tw; c.height=th;
  c.getContext('2d').drawImage(img,0,0,tw,th);
  return c.toDataURL('image/jpeg',quality);
}

function ffCatalogRender(){
  ffCatalogInit();
  const grid=document.getElementById('catItemsGrid');
  const sims=document.getElementById('catSimsList');
  const pagination=document.getElementById('catPagination');
  const breadcrumb=document.getElementById('catBreadcrumb');
  const viewTitle=document.getElementById('catViewTitle');
  const backBtn=document.getElementById('catBackFoldersBtn');
  const renameBtn=document.getElementById('catRenameFolderBtn');
  if(!grid||!sims) return;

  if(!_ffCatalogLoaded){
    grid.innerHTML='<div style="grid-column:1/-1;padding:12px;border:1px dashed var(--border);border-radius:8px;color:var(--gray);font-size:13px">Carregando banco do catálogo...</div>';
    sims.innerHTML='<div style="padding:12px;border:1px dashed var(--border);border-radius:8px;color:var(--gray);font-size:13px">Carregando histórico de simulações...</div>';
    if(pagination){ pagination.style.display='none'; pagination.innerHTML=''; }
    return;
  }

  if(!Array.isArray(_ffCatalogData.folders) || !_ffCatalogData.folders.length){
    _ffCatalogEnsureDefaultFolder();
  }

  const q=(document.getElementById('catSearch')?.value||'').trim().toLowerCase();
  const t=(document.getElementById('catTypeFilter')?.value||'').trim().toLowerCase();
  const items=[...(_ffCatalogData.items||[])].sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
  const folders=[...(_ffCatalogData.folders||[])].sort((a,b)=>String(a.name||'').localeCompare(String(b.name||'')));
  const activeFolder=_ffCatalogFolderById(_ffCatalogCurrentFolderId);
  const currentViewKey = q ? ('search|'+q+'|'+t) : (activeFolder ? ('folder|'+activeFolder.id+'|'+t) : 'folders');
  if(currentViewKey!==_ffCatalogViewKey){
    _ffCatalogViewKey=currentViewKey;
    _ffCatalogPage=1;
  }
  const cardBtnStyle='padding:6px 4px;font-size:9px;letter-spacing:.4px;text-transform:none;white-space:nowrap;min-height:32px;display:flex;align-items:center;justify-content:center;border-radius:6px';
  const cardBtnGrid2='display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px';
  const cardBtnGrid3='display:grid;grid-template-columns:repeat(auto-fit,minmax(52px,1fr));gap:6px;margin-top:8px';
  const cardBtnPrimary='background:#24497E;border:1px solid #24497E;color:#fff';
  const cardBtnAction='background:#E7EEF8;border:1px solid #9EB3CF;color:#1F3F69;transition:all .15s ease';
  const cardBtnSecondary='background:#EEF3FA;border:1px solid #B7C7DD;color:#24497E';
  const cardBtnSecondaryStrong='background:#E7EEF8;border:1px solid #9EB3CF;color:#1F3F69';
  const cardBtnDanger='background:#A92A2A;border:1px solid #A92A2A;color:#fff';

  const filteredBySearch=items.filter(it=>{
    if(t && String(it.type||'').toLowerCase()!==t) return false;
    const folderName=_ffCatalogFolderById(it.folderId)?.name||'';
    if(!q) return true;
    const txt=[it.title,it.tags,it.sourceName,it.type,folderName].join(' ').toLowerCase();
    return txt.includes(q);
  });

  if(q){
    if(viewTitle) viewTitle.textContent='Busca global no catálogo';
    if(breadcrumb) breadcrumb.textContent='← Resultado da busca em todas as pastas';
    if(backBtn) backBtn.style.display='none';
    if(renameBtn) renameBtn.style.display='none';
    if(!filteredBySearch.length){
      grid.innerHTML='<div style="grid-column:1/-1;padding:12px;border:1px dashed var(--border);border-radius:8px;color:var(--gray);font-size:13px">Nenhum item encontrado no banco.</div>';
      if(pagination){ pagination.style.display='none'; pagination.innerHTML=''; }
    } else {
      const pageData=_ffCatalogPaginate(filteredBySearch);
      grid.innerHTML=pageData.items.map(it=>{
        const created=_fmtDataHora(it.createdAt);
        const folderName=_ffCatalogFolderById(it.folderId)?.name||'Sem pasta';
        return '<div style="border:1px solid var(--border2);border-radius:8px;background:#fff;overflow:hidden;display:flex;flex-direction:column">'+
          '<img src="'+_esc(it.src)+'" alt="item" onclick="ffCatalogOpenImageModalById(\''+it.id+'\')" style="width:100%;height:130px;object-fit:cover;background:#f3f3f3;cursor:zoom-in">'+
          '<div style="padding:8px">'+
            '<div style="font-size:12px;font-weight:700;color:var(--brown);line-height:1.4;min-height:34px">'+_esc(it.title||'Item')+'</div>'+
            '<div style="font-size:10px;color:var(--gray);margin-top:4px">'+_esc(it.type==='pdf-page'?'PDF':'Imagem')+' • '+_esc(created)+'</div>'+
            '<div style="font-size:10px;color:#24497E;margin-top:3px">📁 '+_esc(folderName)+'</div>'+
            '<div style="'+cardBtnGrid3+'">'+
              '<button class="btn" style="'+cardBtnStyle+';'+cardBtnAction+'" onmouseover="this.style.background=\'#24497E\';this.style.borderColor=\'#24497E\';this.style.color=\'#fff\';this.style.transform=\'translateY(-1px)\';this.style.boxShadow=\'0 6px 14px rgba(36,73,126,.28)\'" onmouseout="this.style.background=\'#E7EEF8\';this.style.borderColor=\'#9EB3CF\';this.style.color=\'#1F3F69\';this.style.transform=\'none\';this.style.boxShadow=\'none\'" onclick="ffCatalogUseItem(\''+it.id+'\',\'quadro\')">No quadro</button>'+
              '<button class="btn" style="'+cardBtnStyle+';'+cardBtnAction+'" onmouseover="this.style.background=\'#24497E\';this.style.borderColor=\'#24497E\';this.style.color=\'#fff\';this.style.transform=\'translateY(-1px)\';this.style.boxShadow=\'0 6px 14px rgba(36,73,126,.28)\'" onmouseout="this.style.background=\'#E7EEF8\';this.style.borderColor=\'#9EB3CF\';this.style.color=\'#1F3F69\';this.style.transform=\'none\';this.style.boxShadow=\'none\'" onclick="ffCatalogUseItem(\''+it.id+'\',\'ambiente\')">No ambiente</button>'+
              '<button class="btn" style="'+cardBtnStyle+';'+cardBtnAction+'" onmouseover="this.style.background=\'#24497E\';this.style.borderColor=\'#24497E\';this.style.color=\'#fff\';this.style.transform=\'translateY(-1px)\';this.style.boxShadow=\'0 6px 14px rgba(36,73,126,.28)\'" onmouseout="this.style.background=\'#E7EEF8\';this.style.borderColor=\'#9EB3CF\';this.style.color=\'#1F3F69\';this.style.transform=\'none\';this.style.boxShadow=\'none\'" onclick="ffCatalogUseItem(\''+it.id+'\',\'fundo\')">Como fundo</button>'+
            '</div>'+
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:6px">'+
              '<button class="btn dark" title="Renomear" aria-label="Renomear" style="'+cardBtnStyle+';'+cardBtnSecondaryStrong+'" onclick="ffCatalogRenameItem(\''+it.id+'\')">✏️</button>'+
              '<button class="btn dark" title="Excluir" aria-label="Excluir" style="'+cardBtnStyle+';'+cardBtnDanger+'" onclick="ffCatalogDeleteItem(\''+it.id+'\')">🗑</button>'+
            '</div>'+
          '</div>'+
        '</div>';
      }).join('');
      _ffCatalogRenderPagination(pageData.total,pageData.totalPages,pageData.page);
    }
  } else if(!activeFolder){
    if(viewTitle) viewTitle.textContent='Pastas do catálogo';
    if(breadcrumb) breadcrumb.textContent='← Todas as Pastas';
    if(backBtn) backBtn.style.display='none';
    if(renameBtn) renameBtn.style.display='none';
    if(!folders.length){
      grid.innerHTML='<div style="grid-column:1/-1;padding:12px;border:1px dashed var(--border);border-radius:8px;color:var(--gray);font-size:13px">Nenhuma pasta criada ainda.</div>';
      if(pagination){ pagination.style.display='none'; pagination.innerHTML=''; }
    } else {
      grid.innerHTML=folders.map(folder=>{
        const folderItems=items.filter(it=>it.folderId===folder.id);
        const thumb=folderItems[0]?.src||'';
        return '<div style="border:1px solid var(--border2);border-radius:8px;background:#fff;overflow:hidden;display:flex;flex-direction:column">'+
          (thumb
            ? '<img src="'+_esc(thumb)+'" alt="pasta" style="width:100%;height:130px;object-fit:cover;background:#f3f3f3">'
            : '<div style="height:130px;display:flex;align-items:center;justify-content:center;background:#F5F7FA;font-size:42px">📁</div>')+
          '<div style="padding:8px">'+
            '<div style="font-size:12px;font-weight:700;color:var(--brown);line-height:1.4">'+_esc(folder.name)+'</div>'+
            '<div style="font-size:10px;color:var(--gray);margin-top:4px">'+folderItems.length+' imagem(ns)</div>'+
            '<div style="'+cardBtnGrid3+'">'+
              '<button class="btn" style="'+cardBtnStyle+';'+cardBtnPrimary+'" onclick="ffCatalogOpenFolder(\''+folder.id+'\')">Abrir</button>'+
              '<button class="btn dark" style="'+cardBtnStyle+';'+cardBtnSecondaryStrong+'" onclick="ffCatalogRenameFolder(\''+folder.id+'\')">✏️</button>'+
              '<button class="btn dark" style="'+cardBtnStyle+';'+cardBtnDanger+'" onclick="ffCatalogDeleteFolder(\''+folder.id+'\')">🗑</button>'+
            '</div>'+
          '</div>'+
        '</div>';
      }).join('');
      if(pagination){ pagination.style.display='none'; pagination.innerHTML=''; }
    }
  } else {
    if(viewTitle) viewTitle.textContent='Imagens da pasta';
    if(breadcrumb) breadcrumb.textContent='← Todas as Pastas / '+activeFolder.name;
    if(backBtn) backBtn.style.display='inline-flex';
    if(renameBtn) renameBtn.style.display='inline-flex';
    const filtered=filteredBySearch.filter(it=>it.folderId===activeFolder.id);
    if(!filtered.length){
      grid.innerHTML='<div style="grid-column:1/-1;padding:12px;border:1px dashed var(--border);border-radius:8px;color:var(--gray);font-size:13px">Nenhum item nesta pasta.</div>';
      if(pagination){ pagination.style.display='none'; pagination.innerHTML=''; }
    } else {
      const pageData=_ffCatalogPaginate(filtered);
      grid.innerHTML=pageData.items.map(it=>{
      const created=_fmtDataHora(it.createdAt);
      return '<div style="border:1px solid var(--border2);border-radius:8px;background:#fff;overflow:hidden;display:flex;flex-direction:column">'+
        '<img src="'+_esc(it.src)+'" alt="item" onclick="ffCatalogOpenImageModalById(\''+it.id+'\')" style="width:100%;height:130px;object-fit:cover;background:#f3f3f3;cursor:zoom-in">'+
        '<div style="padding:8px">'+
          '<div style="font-size:12px;font-weight:700;color:var(--brown);line-height:1.4;min-height:34px">'+_esc(it.title||'Item')+'</div>'+
          '<div style="font-size:10px;color:var(--gray);margin-top:4px">'+_esc(it.type==='pdf-page'?'PDF':'Imagem')+' • '+_esc(created)+'</div>'+
          '<div style="'+cardBtnGrid3+'">'+
            '<button class="btn" style="'+cardBtnStyle+';'+cardBtnAction+'" onmouseover="this.style.background=\'#24497E\';this.style.borderColor=\'#24497E\';this.style.color=\'#fff\';this.style.transform=\'translateY(-1px)\';this.style.boxShadow=\'0 6px 14px rgba(36,73,126,.28)\'" onmouseout="this.style.background=\'#E7EEF8\';this.style.borderColor=\'#9EB3CF\';this.style.color=\'#1F3F69\';this.style.transform=\'none\';this.style.boxShadow=\'none\'" onclick="ffCatalogUseItem(\''+it.id+'\',\'quadro\')">No quadro</button>'+
            '<button class="btn" style="'+cardBtnStyle+';'+cardBtnAction+'" onmouseover="this.style.background=\'#24497E\';this.style.borderColor=\'#24497E\';this.style.color=\'#fff\';this.style.transform=\'translateY(-1px)\';this.style.boxShadow=\'0 6px 14px rgba(36,73,126,.28)\'" onmouseout="this.style.background=\'#E7EEF8\';this.style.borderColor=\'#9EB3CF\';this.style.color=\'#1F3F69\';this.style.transform=\'none\';this.style.boxShadow=\'none\'" onclick="ffCatalogUseItem(\''+it.id+'\',\'ambiente\')">No ambiente</button>'+
            '<button class="btn" style="'+cardBtnStyle+';'+cardBtnAction+'" onmouseover="this.style.background=\'#24497E\';this.style.borderColor=\'#24497E\';this.style.color=\'#fff\';this.style.transform=\'translateY(-1px)\';this.style.boxShadow=\'0 6px 14px rgba(36,73,126,.28)\'" onmouseout="this.style.background=\'#E7EEF8\';this.style.borderColor=\'#9EB3CF\';this.style.color=\'#1F3F69\';this.style.transform=\'none\';this.style.boxShadow=\'none\'" onclick="ffCatalogUseItem(\''+it.id+'\',\'fundo\')">Como fundo</button>'+
          '</div>'+
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:6px">'+
            '<button class="btn dark" title="Renomear" aria-label="Renomear" style="'+cardBtnStyle+';'+cardBtnSecondaryStrong+'" onclick="ffCatalogRenameItem(\''+it.id+'\')">✏️</button>'+
            '<button class="btn dark" title="Excluir" aria-label="Excluir" style="'+cardBtnStyle+';'+cardBtnDanger+'" onclick="ffCatalogDeleteItem(\''+it.id+'\')">🗑</button>'+
          '</div>'+
        '</div>'+
      '</div>';
    }).join('');
      _ffCatalogRenderPagination(pageData.total,pageData.totalPages,pageData.page);
    }
  }

  const simList=[...(_ffCatalogData.sims||[])].sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
  if(!simList.length){
    sims.innerHTML='<div style="padding:12px;border:1px dashed var(--border);border-radius:8px;color:var(--gray);font-size:13px">Nenhuma simulação no histórico.</div>';
  } else {
    sims.innerHTML=simList.map(s=>{
      const tipo=s.type==='ambiente'?'Ambiente':(s.type==='montagem'?'Montagem':'Quadro');
      return '<div style="border:1px solid var(--border2);border-radius:8px;background:#fff;padding:8px">'+
        '<div style="display:flex;gap:8px">'+
          '<img src="'+_esc(s.preview||'')+'" alt="sim" style="width:92px;height:66px;object-fit:cover;border:1px solid var(--border2);border-radius:6px;background:#f5f5f5">'+
          '<div style="flex:1">'+
            '<div style="font-size:12px;font-weight:700;color:var(--brown)">'+_esc(s.title||('Simulação '+tipo))+'</div>'+
            '<div style="font-size:10px;color:var(--gray);margin-top:2px">'+_esc(tipo)+' • '+_esc(_fmtDataHora(s.createdAt))+'</div>'+
            '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(92px,1fr));gap:6px;margin-top:8px">'+
              '<button class="btn" style="'+cardBtnStyle+';'+cardBtnPrimary+'" onclick="ffCatalogOpenSimulation(\''+s.id+'\')">Restaurar</button>'+
              '<button class="btn dark" style="'+cardBtnStyle+';'+cardBtnSecondaryStrong+'" onclick="ffCatalogSaveSimulationToCatalog(\''+s.id+'\')">Salvar no Catálogo</button>'+
              '<button class="btn dark" style="'+cardBtnStyle+';'+cardBtnDanger+'" onclick="ffCatalogDeleteSimulation(\''+s.id+'\')">Remover</button>'+
            '</div>'+
          '</div>'+
        '</div>'+
      '</div>';
    }).join('');
  }
}

async function ffCatalogImportPdf(e){
  ffCatalogInit();
  const targetFolderId=_ffCatalogActiveFolderIdForImport();
  const file=e.target.files?.[0];
  if(!file) return;
  if(!window.pdfjsLib){
    toast('Biblioteca de PDF ainda nao carregou. Tente novamente em alguns segundos.');
    e.target.value='';
    return;
  }
  try{
    _ffCatalogSetStatus('Lendo PDF...');
    const buf=await file.arrayBuffer();
    const pdf=await pdfjsLib.getDocument({data:buf}).promise;
    const total=Math.min(pdf.numPages,12);
    for(let i=1;i<=total;i++){
      _ffCatalogSetStatus('Processando pagina '+i+' de '+total+'...');
      const page=await pdf.getPage(i);
      const vp=page.getViewport({scale:1});
      const scale=Math.min(760/vp.width,760/vp.height,1.25);
      const viewport=page.getViewport({scale});
      const c=document.createElement('canvas');
      c.width=Math.round(viewport.width);
      c.height=Math.round(viewport.height);
      await page.render({canvasContext:c.getContext('2d'),viewport}).promise;
      _ffCatalogData.items.push({
        id:_ffCatalogId('item'),
        folderId:targetFolderId,
        type:'pdf-page',
        title:(file.name.replace(/\.[^.]+$/,'')||'Catalogo')+' - Pagina '+i,
        tags:'pdf, catalogo, molduras',
        sourceName:file.name,
        src:c.toDataURL('image/jpeg',0.62),
        createdAt:new Date().toISOString(),
      });
    }
    if(!_ffCatalogPersist()) return;
    _ffCatalogSetStatus('PDF importado com sucesso: '+total+' pagina(s).');
    ffCatalogRender();
    toast('Catálogo PDF importado!');
  }catch(err){
    _ffCatalogSetStatus('Falha ao importar PDF.');
    toast(err.message||'Nao foi possivel importar o PDF.');
  }finally{
    e.target.value='';
  }
}

async function ffCatalogImportImages(e){
  ffCatalogInit();
  const targetFolderId=_ffCatalogActiveFolderIdForImport();
  const files=Array.from(e.target.files||[]);
  if(!files.length) return;
  try{
    let count=0;
    for(const file of files){
      _ffCatalogSetStatus('Importando imagem '+(count+1)+' de '+files.length+'...');
      const src=await _ffFileToOptimizedDataUrl(file);
      _ffCatalogData.items.push({
        id:_ffCatalogId('item'),
        folderId:targetFolderId,
        type:'image',
        title:file.name.replace(/\.[^.]+$/,'')||'Imagem',
        tags:'imagem, banco',
        sourceName:file.name,
        src,
        createdAt:new Date().toISOString(),
      });
      count++;
    }
    if(!_ffCatalogPersist()) return;
    _ffCatalogSetStatus('Imagens importadas: '+count+'.');
    ffCatalogRender();
    toast('Imagens adicionadas ao banco!');
  }catch(err){
    _ffCatalogSetStatus('Falha ao importar imagens.');
    toast(err.message||'Nao foi possivel importar imagens.');
  }finally{
    e.target.value='';
  }
}

async function ffCatalogUseItem(itemId, target){
  ffCatalogInit();
  const it=(_ffCatalogData.items||[]).find(x=>x.id===itemId);
  if(!it) return;
  try{
    if(it.fromSimulation===true && it.simType==='quadro' && it.simCfg){
      const cfg=_ffCloneCfg(it.simCfg);
      if(target==='quadro'){
        const ok=await _ffCatalogApplyQuadroCfgNoSimulador(cfg);
        if(ok){ toast('Simulação aplicada no Simulador de Quadros.'); return; }
      }
      if(target==='ambiente'){
        _ffSkipNextSplitAutoApplyAmbiente=true;
        switchTab('simulador');
        const splitSaved=Boolean(cfg.splitActive && cfg.splitMeta && (cfg.splitMeta.n||0)>1);
        if(splitSaved && cfg.splitSourceSrc){
          const srcImg=await _ffLoadImageFromSrc(cfg.splitSourceSrc);
          const meta={
            ...cfg.splitMeta,
            partWidths:[...(cfg.splitMeta.partWidths||[])],
            partHeights:[...(cfg.splitMeta.partHeights||[])],
          };
          _ffSplitComposicaoMeta=meta;
          _ffSplitComposicaoAtiva=true;
          const layoutData=await _ffSplitCreatePanelImages(meta,srcImg);
          const ok=_ffSplitApplyPanelsToWall(layoutData);
          if(ok){
            (wallFrames||[]).forEach((f)=>{
              f.frameColor=cfg.frameColor||f.frameColor;
              f.frameW=(cfg.frameW!==undefined)?cfg.frameW:f.frameW;
              f.ppOn=(cfg.ppOn!==undefined)?Boolean(cfg.ppOn):f.ppOn;
              f.ppColor=cfg.ppColor||f.ppColor;
              f.ppSize=(cfg.ppSize!==undefined)?cfg.ppSize:f.ppSize;
            });
            if(typeof ffSplitSetWallGap==='function' && _ffSplitWallLayoutState) ffSplitSetWallGap(_ffSplitWallLayoutState.gapCm);
            toast('Composição aplicada no Simulador de Ambiente.');
            return;
          }
        }

        // Quadro simples salvo no histórico: usar arte original para evitar moldura duplicada.
        const artSrc=cfg.imageSrc || it.src;
        const imgSim=await _ffLoadImageFromSrc(artSrc);
        const dims={ w:parseFloat(cfg.w)||50, h:parseFloat(cfg.h)||70 };
        wallAddFrame(imgSim);
        _ffCatalogFitSelectedWallFrame(imgSim, dims);
        if(Array.isArray(wallFrames) && wallSelectedIdx>=0 && wallFrames[wallSelectedIdx]){
          const f=wallFrames[wallSelectedIdx];
          f.frameColor=cfg.frameColor||f.frameColor;
          f.frameW=(cfg.frameW!==undefined)?cfg.frameW:f.frameW;
          f.ppOn=(cfg.ppOn!==undefined)?Boolean(cfg.ppOn):f.ppOn;
          f.ppColor=cfg.ppColor||f.ppColor;
          f.ppSize=(cfg.ppSize!==undefined)?cfg.ppSize:f.ppSize;
          if(typeof _wallUpdatePanelFromSelected==='function') _wallUpdatePanelFromSelected();
          if(typeof renderWall==='function') renderWall();
        }
        toast('Simulação aplicada no Simulador de Ambiente.');
        return;
      }
    }

    const img=await _ffLoadImageFromSrc(it.src);
    const dims = _ffCatalogDims50x70ForImage(img);
    if(target==='quadro'){
      _ffSplitComposicaoAtiva=false;
      _ffSplitComposicaoMeta=null;
      _ffSplitReplayImg=null;
      sqImg={img,file:{name:it.title||'catalogo.jpg',size:0},w:img.naturalWidth||img.width,h:img.naturalHeight||img.height};
      switchTab('simquadro');
      showSQ();
      const sqWEl=document.getElementById('sqW');
      const sqHEl=document.getElementById('sqH');
      if(sqWEl) sqWEl.value=dims.w;
      if(sqHEl) sqHEl.value=dims.h;
      if(typeof renderFrame === 'function') renderFrame();
      toast('Imagem aplicada no Simulador de Quadros.');
      return;
    }
    if(target==='ambiente'){
      _ffSkipNextSplitAutoApplyAmbiente=true;
      switchTab('simulador');
      wallAddFrame(img);
      _ffCatalogFitSelectedWallFrame(img, dims);
      toast('Imagem adicionada no Simulador de Ambiente.');
      return;
    }
    if(target==='fundo'){
      wEnvImg=img;
      _ffSkipNextSplitAutoApplyAmbiente=true;
      switchTab('simulador');
      if(typeof checkWall==='function') checkWall();
      toast('Imagem aplicada como fundo do ambiente.');
      return;
    }
  }catch(err){
    toast(err.message||'Nao foi possivel aplicar este item.');
  }
}

function _ffCatalogDims50x70ForImage(img){
  const naturalW = img?.naturalWidth || img?.width || 800;
  const naturalH = img?.naturalHeight || img?.height || 600;
  if(naturalW > naturalH) return { w: 70, h: 50 };
  return { w: 50, h: 70 };
}

function _ffCatalogFitSelectedWallFrame(img, dims){
  if(!img || !Array.isArray(wallFrames) || wallSelectedIdx < 0) return;
  const frame = wallFrames[wallSelectedIdx];
  if(!frame) return;

  const finalDims = dims || _ffCatalogDims50x70ForImage(img);
  frame.wCm = finalDims.w;
  frame.hCm = finalDims.h;

  if(typeof _wallUpdatePanelFromSelected === 'function') _wallUpdatePanelFromSelected();
  if(typeof renderWall === 'function') renderWall();
}

function _ffCloneCfg(obj){
  try{ return JSON.parse(JSON.stringify(obj||{})); }
  catch(_){ return {}; }
}

async function _ffCatalogApplyQuadroCfgNoSimulador(cfg){
  const imageSrc = cfg?.imageSrc || cfg?.renderSrc || '';
  if(!imageSrc) return false;

  const img=await _ffLoadImageFromSrc(imageSrc);
  const splitSaved=Boolean(cfg?.splitActive && cfg?.splitMeta && (cfg.splitMeta.n||0)>1);
  _ffResetQuadroSimulationState();
  _ffSplitComposicaoAtiva=splitSaved;
  _ffSplitComposicaoMeta=splitSaved ? {
    ...cfg.splitMeta,
    partWidths:[...(cfg.splitMeta.partWidths||[])],
    partHeights:[...(cfg.splitMeta.partHeights||[])],
  } : null;
  _ffSplitReplayImg=null;
  if(splitSaved && cfg?.splitSourceSrc){
    try{ _ffSplitReplayImg=await _ffLoadImageFromSrc(cfg.splitSourceSrc); }catch(_){ _ffSplitReplayImg=null; }
  }

  sqImg={img,file:{name:'catalogo-simulacao.jpg',size:0},w:img.naturalWidth||img.width,h:img.naturalHeight||img.height};
  switchTab('simquadro');
  showSQ();

  if(cfg?.w) document.getElementById('sqW').value=cfg.w;
  if(cfg?.h) document.getElementById('sqH').value=cfg.h;
  if(cfg?.frameW!==undefined) document.getElementById('sqFrameW').value=cfg.frameW;
  if(cfg?.ppOn!==undefined) document.getElementById('sqPpEnabled').checked=Boolean(cfg.ppOn);
  if(cfg?.ppSize!==undefined){
    document.getElementById('sqPpSize').value=cfg.ppSize;
    const lbl=document.getElementById('sqPpSizeL'); if(lbl) lbl.textContent=cfg.ppSize+'cm';
  }
  if(cfg?.frameColor){ sqFrameColor=cfg.frameColor; const p=document.getElementById('sqFrameColorPicker'); if(p) p.value=cfg.frameColor; }
  if(cfg?.ppColor){ sqPpColor=cfg.ppColor; const p=document.getElementById('sqPpColorPicker'); if(p) p.value=cfg.ppColor; }
  if(cfg?.bgColor){ sqBgColor=cfg.bgColor; const p=document.getElementById('sqBgPicker'); if(p) p.value=cfg.bgColor; }
  renderFrame();
  return true;
}

function _ffResetQuadroSimulationState(){
  _ffSplitComposicaoAtiva=false;
  _ffSplitComposicaoMeta=null;
  _ffSplitReplayImg=null;
}

function ffCatalogDeleteItem(itemId){
  ffCatalogInit();
  const it=(_ffCatalogData.items||[]).find(x=>x.id===itemId);
  if(!it) return;
  const nome=(it.title||'este arquivo').trim();
  const ok=window.confirm('Excluir "'+nome+'" do banco de arquivos?\n\nEssa acao nao pode ser desfeita.');
  if(!ok) return;
  _ffCatalogData.items=(_ffCatalogData.items||[]).filter(x=>x.id!==itemId);
  if(!_ffCatalogPersist()) return;
  ffCatalogRender();
  toast('Item removido do banco.');
}

function ffCatalogSaveCurrentQuadro(){
  ffCatalogInit();
  if(!sqImg){ toast('Abra o Simulador de Quadros e carregue uma imagem primeiro.'); return; }
  const canvas=document.getElementById('frameCanvas');
  const preview=(canvas&&canvas.width>1)?canvas.toDataURL('image/jpeg',0.76):'';
  const splitActive=Boolean(_ffSplitComposicaoAtiva && _ffSplitComposicaoMeta && (_ffSplitComposicaoMeta.n||0)>1);
  const splitMeta=splitActive ? {
    ..._ffSplitComposicaoMeta,
    partWidths:[...(_ffSplitComposicaoMeta.partWidths||[])],
    partHeights:[...(_ffSplitComposicaoMeta.partHeights||[])],
  } : null;
  const splitSourceImg = splitActive
    ? (_ffSplitReplayImg || (cImg&&cImg.img) || (sqImg&&sqImg.img) || null)
    : null;
  const cfg={
    imageSrc:_imgElementParaBase64(sqImg,0.68),
    renderSrc:(canvas&&canvas.width>1)?canvas.toDataURL('image/jpeg',0.86):'',
    splitActive,
    splitMeta,
    splitSourceSrc:splitSourceImg ? _imgElementParaBase64(splitSourceImg,0.82) : '',
    w:parseFloat(document.getElementById('sqW')?.value||80),
    h:parseFloat(document.getElementById('sqH')?.value||60),
    frameW:parseFloat(document.getElementById('sqFrameW')?.value||0),
    frameColor:sqFrameColor,
    ppOn:Boolean(document.getElementById('sqPpEnabled')?.checked),
    ppSize:parseFloat(document.getElementById('sqPpSize')?.value||3),
    ppColor:sqPpColor,
    bgColor:sqBgColor,
  };
  _ffCatalogData.sims.push({
    id:_ffCatalogId('sim'),
    type:'quadro',
    title:'Quadro '+(new Date().toLocaleString('pt-BR')),
    preview,
    cfg,
    createdAt:new Date().toISOString(),
  });
  if(!_ffCatalogPersist()) return;
  ffCatalogRender();
  toast('Simulação de quadro salva.');
}

function ffCatalogSaveCurrentAmbiente(){
  ffCatalogInit();
  if(!wEnvImg){ toast('Abra o Simulador de Ambiente e carregue um ambiente primeiro.'); return; }
  const canvas=document.getElementById('wallCanvas');
  const preview=(canvas&&canvas.width>1)?canvas.toDataURL('image/jpeg',0.76):'';
  const frames=(wallFrames||[]).map(f=>({
    imageSrc:_imgElementParaBase64(f.img,0.66),
    xP:f.xP,yP:f.yP,wCm:f.wCm,hCm:f.hCm,
    frameColor:f.frameColor,frameW:f.frameW,
    ppOn:f.ppOn,ppColor:f.ppColor,ppSize:f.ppSize,
    shadow:f.shadow,
  }));
  _ffCatalogData.sims.push({
    id:_ffCatalogId('sim'),
    type:'ambiente',
    title:'Ambiente '+(new Date().toLocaleString('pt-BR')),
    preview,
    cfg:{envSrc:_imgElementParaBase64(wEnvImg,0.62),frames},
    createdAt:new Date().toISOString(),
  });
  if(!_ffCatalogPersist()) return;
  ffCatalogRender();
  toast('Simulação de ambiente salva.');
}

function ffCatalogSaveCurrentMontagem(){
  ffCatalogInit();
  const workArea=document.getElementById('mWorkArea');
  if(!workArea||workArea.children.length===0){ toast('Adicione imagens na Montagem primeiro.'); return; }
  // Renderiza a composição num canvas off-screen (mesma lógica do baixarMontagem)
  const cfg=montagemConfig||{};
  const fitMode=cfg.fitMode==='cover'?'cover':'contain';
  const pxPerCm=cfg.pxPerCm||10;
  const baseW=(cfg.canvasWidthCm||100)*pxPerCm;
  const baseH=(cfg.canvasHeightCm||70)*pxPerCm;
  const framePx=(cfg.frameSizeCm||2)*pxPerCm;
  const ppPx=(cfg.ppSizeCm||5)*pxPerCm;
  const offCanvas=document.createElement('canvas');
  offCanvas.width=baseW+(framePx*2);
  offCanvas.height=baseH+(framePx*2);
  const ctx=offCanvas.getContext('2d');
  ctx.fillStyle=cfg.frameColor||'#000000';
  ctx.fillRect(0,0,offCanvas.width,offCanvas.height);
  ctx.fillStyle=cfg.ppColor||'#FFFFFF';
  ctx.fillRect(framePx,framePx,baseW,baseH);
  const workX=framePx+ppPx;
  const workY=framePx+ppPx;
  const clipW=baseW-(ppPx*2);
  const clipH=baseH-(ppPx*2);
  const images=Array.from(workArea.children);
  images.sort((a,b)=>parseInt(a.style.zIndex||0)-parseInt(b.style.zIndex||0));
  images.forEach(wrap=>{
    const img=wrap.querySelector('img');
    if(!img) return;
    const left=parseFloat(wrap.style.left)||0;
    const top=parseFloat(wrap.style.top)||0;
    const width=parseFloat(wrap.style.width)||0;
    const height=parseFloat(wrap.style.height)||0;
    const safeW=Math.max(1,width);
    const safeH=Math.max(1,height);
    const wrapFitMode=((wrap&&wrap.dataset&&wrap.dataset.fitMode)==='cover')?'cover':fitMode;
    const scale=wrapFitMode==='cover'
      ? Math.max(safeW/img.naturalWidth, safeH/img.naturalHeight)
      : Math.min(safeW/img.naturalWidth, safeH/img.naturalHeight);
    const drawW=img.naturalWidth*scale;
    const drawH=img.naturalHeight*scale;
    const drawX=workX+left+((safeW-drawW)/2);
    const drawY=workY+top+((safeH-drawH)/2);
    ctx.save();
    ctx.beginPath(); ctx.rect(workX,workY,clipW,clipH); ctx.clip();
    ctx.drawImage(img,0,0,img.naturalWidth,img.naturalHeight,drawX,drawY,drawW,drawH);
    ctx.restore();
  });
  const photos=images.map(wrap=>{
    const img=wrap.querySelector('img');
    return {
      src:(img&&img.src)||'',
      left:parseFloat(wrap.style.left)||0,
      top:parseFloat(wrap.style.top)||0,
      width:parseFloat(wrap.style.width)||0,
      height:parseFloat(wrap.style.height)||0,
      zIndex:parseInt(wrap.style.zIndex||0,10)||0,
      fitMode:((wrap&&wrap.dataset&&wrap.dataset.fitMode)==='cover')?'cover':'contain',
    };
  }).filter(p=>p.src);
  const preview=offCanvas.toDataURL('image/jpeg',0.76);
  _ffCatalogData.sims.push({
    id:_ffCatalogId('sim'),
    type:'montagem',
    title:'Montagem '+(new Date().toLocaleString('pt-BR')),
    preview,
    cfg:{
      montageVersion:1,
      previewSrc:preview,
      canvasWidthCm:cfg.canvasWidthCm,
      canvasHeightCm:cfg.canvasHeightCm,
      ppSizeCm:cfg.ppSizeCm,
      ppColor:cfg.ppColor,
      frameSizeCm:cfg.frameSizeCm,
      frameColor:cfg.frameColor,
      fitMode,
      pxPerCm:cfg.pxPerCm,
      photos,
    },
    createdAt:new Date().toISOString(),
  });
  if(!_ffCatalogPersist()) return;
  ffCatalogRender();
  toast('Montagem salva na Biblioteca.');
}

async function ffCatalogOpenSimulation(simId){
  ffCatalogInit();
  const sim=(_ffCatalogData.sims||[]).find(s=>s.id===simId);
  if(!sim) return;
  try{
    if(sim.type==='quadro'){
      const cfg=sim.cfg||{};
      const imageSrc=cfg.imageSrc || cfg.renderSrc || sim.preview || '';
      if(!imageSrc) throw new Error('Simulação sem imagem.');
      _ffResetQuadroSimulationState();
      const img=await _ffLoadImageFromSrc(imageSrc);
      const splitSaved=Boolean(cfg.splitActive && cfg.splitMeta && (cfg.splitMeta.n||0)>1);
      _ffSplitComposicaoAtiva=splitSaved;
      _ffSplitComposicaoMeta=splitSaved ? {
        ...cfg.splitMeta,
        partWidths:[...(cfg.splitMeta.partWidths||[])],
        partHeights:[...(cfg.splitMeta.partHeights||[])],
      } : null;
      _ffSplitReplayImg=null;
      if(splitSaved && cfg.splitSourceSrc){
        try{ _ffSplitReplayImg=await _ffLoadImageFromSrc(cfg.splitSourceSrc); }catch(_){ _ffSplitReplayImg=null; }
      }
      sqImg={img,file:{name:'simulacao.jpg',size:0},w:img.naturalWidth||img.width,h:img.naturalHeight||img.height};
      switchTab('simquadro');
      showSQ();
      if(cfg.w) document.getElementById('sqW').value=cfg.w;
      if(cfg.h) document.getElementById('sqH').value=cfg.h;
      if(cfg.frameW!==undefined) document.getElementById('sqFrameW').value=cfg.frameW;
      if(cfg.ppOn!==undefined) document.getElementById('sqPpEnabled').checked=Boolean(cfg.ppOn);
      if(cfg.ppSize!==undefined){
        document.getElementById('sqPpSize').value=cfg.ppSize;
        const lbl=document.getElementById('sqPpSizeL'); if(lbl) lbl.textContent=cfg.ppSize+'cm';
      }
      if(cfg.frameColor){ sqFrameColor=cfg.frameColor; const p=document.getElementById('sqFrameColorPicker'); if(p) p.value=cfg.frameColor; }
      if(cfg.ppColor){ sqPpColor=cfg.ppColor; const p=document.getElementById('sqPpColorPicker'); if(p) p.value=cfg.ppColor; }
      if(cfg.bgColor){ sqBgColor=cfg.bgColor; const p=document.getElementById('sqBgPicker'); if(p) p.value=cfg.bgColor; }
      renderFrame();
      toast('Simulação de quadro reaberta.');
      return;
    }

    if(sim.type==='montagem'){
      const cfg=sim.cfg||{};
      switchTab('montagem');

      const controls=document.getElementById('mControls');
      if(controls) controls.style.display='block';

      if(cfg.canvasWidthCm!==undefined) document.getElementById('mCanvasWidth').value=cfg.canvasWidthCm;
      if(cfg.canvasHeightCm!==undefined) document.getElementById('mCanvasHeight').value=cfg.canvasHeightCm;
      if(cfg.ppSizeCm!==undefined) document.getElementById('mPpSize').value=cfg.ppSizeCm;
      if(cfg.frameSizeCm!==undefined) document.getElementById('mFrameSize').value=cfg.frameSizeCm;
      const fitInput=document.getElementById('mFitMode');
      if(fitInput) fitInput.value=(cfg.fitMode==='cover'?'cover':'contain');

      if(typeof setMontagemPpColor==='function' && cfg.ppColor){
        const ppSwatch=[...document.querySelectorAll('#mPpColorList .pp-swatch')]
          .find(s=>String(s.getAttribute('style')||'').toLowerCase().includes(String(cfg.ppColor).toLowerCase()));
        setMontagemPpColor(cfg.ppColor, ppSwatch||null);
      }
      if(typeof setMontagemFrameColor==='function' && cfg.frameColor){
        const frameSwatch=[...document.querySelectorAll('#mFrameColorList .pp-swatch')]
          .find(s=>String(s.getAttribute('style')||'').toLowerCase().includes(String(cfg.frameColor).toLowerCase()));
        setMontagemFrameColor(cfg.frameColor, frameSwatch||null);
      }

      if(typeof updateMontagemBase==='function') updateMontagemBase();

      const workArea=document.getElementById('mWorkArea');
      if(!workArea) throw new Error('Área de montagem indisponível.');
      workArea.innerHTML='';

      if(Array.isArray(cfg.photos) && cfg.photos.length && typeof addImageToWorkArea==='function'){
        const sorted=[...cfg.photos].sort((a,b)=>(a.zIndex||0)-(b.zIndex||0));
        sorted.forEach(p=>{
          if(!p||!p.src) return;
          addImageToWorkArea(p.src);
          const el=workArea.lastElementChild;
          if(!el) return;
          el.style.left=`${Math.max(0,Number(p.left)||0)}px`;
          el.style.top=`${Math.max(0,Number(p.top)||0)}px`;
          if(Number.isFinite(Number(p.width)) && Number(p.width)>0) el.style.width=`${Number(p.width)}px`;
          if(Number.isFinite(Number(p.height)) && Number(p.height)>0) el.style.height=`${Number(p.height)}px`;
          if(Number.isFinite(Number(p.zIndex))) el.style.zIndex=String(Number(p.zIndex));
          const img=el.querySelector('img');
          const fitMode=(p.fitMode==='cover')?'cover':'contain';
          el.dataset.fitMode=fitMode;
          if(img){
            img.style.objectFit=fitMode;
            img.style.background=fitMode==='contain'?'#FFFFFF':'transparent';
          }
        });
      } else {
        throw new Error('Esta montagem foi salva sem fotos individuais (versão antiga). Monte novamente e salve de novo para restaurar item por item.');
      }

      if(typeof selectElement==='function') selectElement(null);
      toast('Montagem reaberta.');
      return;
    }

    const cfg=sim.cfg||{};
    if(!cfg.envSrc) throw new Error('Simulação de ambiente sem foto do ambiente.');
    const env=await _ffLoadImageFromSrc(cfg.envSrc);
    wEnvImg=env;
    const frames=[];
    for(const fr of (cfg.frames||[])){
      if(!fr.imageSrc) continue;
      const img=await _ffLoadImageFromSrc(fr.imageSrc);
      const base=(typeof _wallDefaultFrame==='function')?_wallDefaultFrame(img):{
        img,xP:50,yP:38,wCm:80,hCm:60,frameColor:'#3C2F1E',frameW:3,ppOn:false,ppColor:'#FFFFFF',ppSize:3,shadow:2,id:Date.now()+Math.random()
      };
      base.xP=fr.xP; base.yP=fr.yP; base.wCm=fr.wCm; base.hCm=fr.hCm;
      base.frameColor=fr.frameColor; base.frameW=fr.frameW;
      base.ppOn=fr.ppOn; base.ppColor=fr.ppColor; base.ppSize=fr.ppSize;
      base.shadow=fr.shadow;
      frames.push(base);
    }
    wallFrames=frames;
    wallSelectedIdx=frames.length?0:-1;
    wArtImg=frames.length?frames[0].img:null;
    _ffSkipNextSplitAutoApplyAmbiente=true;
    switchTab('simulador');
    checkWall();
    if(typeof _wallRenderPanel==='function') _wallRenderPanel();
    if(typeof _wallUpdatePanelFromSelected==='function') _wallUpdatePanelFromSelected();
    renderWall();
    toast('Simulação de ambiente reaberta.');
  }catch(err){
    toast(err.message||'Nao foi possivel reabrir a simulacao.');
  }
}

function ffCatalogDeleteSimulation(simId){
  ffCatalogInit();
  const sim=(_ffCatalogData.sims||[]).find(s=>s.id===simId);
  if(!sim) return;
  const titulo=(sim.title||'esta simulacao').trim();
  const ok=window.confirm('Excluir "'+titulo+'" do catalogo?\n\nEssa acao nao pode ser desfeita.');
  if(!ok) return;
  _ffCatalogData.sims=(_ffCatalogData.sims||[]).filter(s=>s.id!==simId);
  if(!_ffCatalogPersist()) return;
  ffCatalogRender();
  toast('Simulação removida.');
}

function _ffCatalogPickFolderForSimulation(){
  ffCatalogInit();
  if(!Array.isArray(_ffCatalogData.folders) || !_ffCatalogData.folders.length) _ffCatalogEnsureDefaultFolder();
  const folders=[...(_ffCatalogData.folders||[])].sort((a,b)=>String(a.name||'').localeCompare(String(b.name||'')));
  const lines=folders.map((f,idx)=>`${idx+1}. ${f.name}`);
  const msg='Salvar em qual pasta?\n\n'+lines.join('\n')+'\n\nDigite o número da pasta ou um nome novo para criar.';
  const raw=prompt(msg, '1');
  if(raw===null) return null;
  const input=String(raw||'').trim();
  if(!input) return folders[0]?.id || _ffCatalogEnsureDefaultFolder().id;

  const num=parseInt(input,10);
  if(Number.isFinite(num) && num>=1 && num<=folders.length){
    return folders[num-1].id;
  }

  const name=_ffCatalogSanitizeName(input,'Nova Pasta');
  const existing=(_ffCatalogData.folders||[]).find(f=>String(f.name||'').toLowerCase()===name.toLowerCase());
  if(existing) return existing.id;

  const folder={ id:_ffCatalogId('folder'), name, createdAt:new Date().toISOString() };
  _ffCatalogData.folders.push(folder);
  return folder.id;
}

function ffCatalogSaveSimulationToCatalog(simId){
  ffCatalogInit();
  const sim=(_ffCatalogData.sims||[]).find(s=>s.id===simId);
  if(!sim) return;

  const folderId=_ffCatalogPickFolderForSimulation();
  if(!folderId) return;

  const cfg=sim.cfg||{};
  const src=cfg.renderSrc || sim.preview || cfg.imageSrc || cfg.envSrc || '';
  if(!src){
    toast('Esta simulação não possui imagem para salvar no catálogo.');
    return;
  }

  const tipoLabel=sim.type==='ambiente'?'Ambiente':(sim.type==='montagem'?'Montagem':'Quadro');
  const created=_fmtDataHora(sim.createdAt);
  _ffCatalogData.items.push({
    id:_ffCatalogId('item'),
    folderId,
    type:'image',
    title:(sim.title || `${tipoLabel} ${created}`),
    tags:`simulacao, historico, ${sim.type||'quadro'}`,
    sourceName:`sim-${sim.id}.jpg`,
    src,
    fromSimulation:true,
    simType:sim.type||'quadro',
    simCfg:_ffCloneCfg(cfg),
    createdAt:new Date().toISOString(),
  });

  if(!_ffCatalogPersist()) return;
  ffCatalogRender();
  toast('Simulação salva no catálogo.');
}

async function ffCatalogExport(){
  ffCatalogInit();
  const payload={
    version:2,
    folders:_ffCatalogData.folders||[],
    items:_ffCatalogData.items||[],
    sims:_ffCatalogData.sims||[],
  };
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
  const ok=await _saveAs(blob,'fastframe-catalogo-banco','application/json');
  if(ok!==false) toast('Banco exportado.');
}

async function ffCatalogImportJson(e){
  ffCatalogInit();
  const file=e.target.files?.[0];
  if(!file) return;
  try{
    const txt=await file.text();
    const parsed=JSON.parse(txt);
    const incoming=_ffCatalogNormalizeData(parsed);

    const folderNameToId=new Map((_ffCatalogData.folders||[]).map(f=>[String(f.name||'').toLowerCase(),f.id]));
    const incomingFolderIdMap=new Map();
    incoming.folders.forEach(f=>{
      const key=String(f.name||'').toLowerCase();
      if(folderNameToId.has(key)){
        incomingFolderIdMap.set(f.id, folderNameToId.get(key));
        return;
      }
      const created={ id:_ffCatalogId('folder'), name:f.name, createdAt:f.createdAt||new Date().toISOString() };
      _ffCatalogData.folders.push(created);
      folderNameToId.set(key, created.id);
      incomingFolderIdMap.set(f.id, created.id);
    });

    incoming.items.forEach(it=>{
      const mappedFolderId=incomingFolderIdMap.get(it.folderId)||_ffCatalogEnsureDefaultFolder().id;
      _ffCatalogData.items.push({ ...it, id:_ffCatalogId('item'), folderId:mappedFolderId });
    });
    incoming.sims.forEach(s=>{
      _ffCatalogData.sims.push({ ...s, id:_ffCatalogId('sim') });
    });

    if(!_ffCatalogPersist()) return;
    ffCatalogRender();
    toast('Banco importado com sucesso.');
  }catch(err){
    toast(err.message||'Arquivo de banco invalido.');
  }finally{
    e.target.value='';
  }
}


// ─────────────────────────────────────────────────────────
//  MOBILE NAV
// ─────────────────────────────────────────────────────────
function toggleMobileNav(){
  const nav=document.getElementById('mobileNav');
  const ham=document.getElementById('hamburger');
  if(!nav||!ham) return;
  const isOpen=nav.classList.toggle('open');
  ham.classList.toggle('open',isOpen);
  document.body.style.overflow=isOpen?'hidden':'';
}

// (mobile nav sync integrado em switchTab)

// ─────────────────────────────────────────────────────────
//  LOADING OVERLAY
// ─────────────────────────────────────────────────────────
function showLoading(msg){
  const el=document.getElementById('ffLoading');
  const ml=document.getElementById('ffLoadingMsg');
  if(el){ el.classList.add('show'); if(ml) ml.textContent=msg||'Processando…'; }
}
function hideLoading(){
  const el=document.getElementById('ffLoading');
  if(el) el.classList.remove('show');
}

// Wrap applyBleed with loading
const _applyBleedOrig=applyBleed;
window.applyBleed=function(){
  showLoading('Calculando sangria…');
  setTimeout(()=>{ _applyBleedOrig(); hideLoading(); },50);
};

// Wrap applyEnhancement with loading for upscale
const _applyEnhOrig=applyEnhancement;
window.applyEnhancement=function(){
  if(typeof enhScale!=='undefined'&&enhScale>1) showLoading('Aumentando resolução…');
  _applyEnhOrig();
  // hideLoading is called inside applyEnhancement after setTimeout
};

// ─────────────────────────────────────────────────────────
//  VALIDAÇÃO DE ENTRADAS
// ─────────────────────────────────────────────────────────
function validateCmInput(input, min, max){
  const v=parseFloat(input.value);
  const invalid=isNaN(v)||v<min||v>max;
  input.classList.toggle('invalid', invalid);
  // Find or create validation message
  let msg=input.parentElement.querySelector('.validation-msg');
  if(!msg){
    msg=document.createElement('div');
    msg.className='validation-msg';
    input.parentElement.appendChild(msg);
  }
  if(invalid){
    msg.textContent=`Valor entre ${min} e ${max} cm`;
    msg.classList.add('show');
  } else {
    msg.classList.remove('show');
  }
  return !invalid;
}

// Add validation to cm inputs on change
document.addEventListener('DOMContentLoaded',()=>{
  // Verificar tamanho específico
  const cWEl=document.getElementById('cW');
  const cHEl=document.getElementById('cH');
  if(cWEl) cWEl.addEventListener('input',()=>validateCmInput(cWEl,1,500));
  if(cHEl) cHEl.addEventListener('input',()=>validateCmInput(cHEl,1,500));

  // Tamanho total divisão
  const twEl=document.getElementById('totalW');
  const thEl=document.getElementById('totalH');
  if(twEl) twEl.addEventListener('input',()=>validateCmInput(twEl,1,500));
  if(thEl) thEl.addEventListener('input',()=>validateCmInput(thEl,1,500));

  // Quadro simulação
  const sqWEl=document.getElementById('sqW');
  const sqHEl=document.getElementById('sqH');
  if(sqWEl) sqWEl.addEventListener('input',()=>validateCmInput(sqWEl,0.1,300));
  if(sqHEl) sqHEl.addEventListener('input',()=>validateCmInput(sqHEl,0.1,300));

  const qiWEl=document.getElementById('qiW');
  const qiHEl=document.getElementById('qiH');
  if(qiWEl) qiWEl.addEventListener('input',()=>validateCmInput(qiWEl,1,500));
  if(qiHEl) qiHEl.addEventListener('input',()=>validateCmInput(qiHEl,1,500));

  initQIDesignerInteractions();
  initSQDesignerInteractions();

  window.addEventListener('resize',()=>{
    if(qImg&&document.getElementById('tab-quadros')?.classList.contains('active')) qiRenderDesigner();
    if(sqImg&&document.getElementById('tab-simquadro')?.classList.contains('active')) renderFrame();
  });

  // Close mobile nav on ESC
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'){
      const catModal=document.getElementById('catImageModal');
      if(catModal&&catModal.style.display==='flex'){
        ffCatalogCloseImageModal();
        return;
      }
      const nav=document.getElementById('mobileNav');
      if(nav&&nav.classList.contains('open')) toggleMobileNav();
    }
  });

  // Close mobile nav on overlay click (outside menu)
  const mobileNav=document.getElementById('mobileNav');
  if(mobileNav){
    mobileNav.addEventListener('click',e=>{
      if(e.target===mobileNav) toggleMobileNav();
    });
  }

  const desktopNav=_getDesktopHeaderNav();
  if(desktopNav){
    desktopNav.addEventListener('scroll',updateNavScrollControls,{passive:true});
  }
  window.addEventListener('resize',updateNavScrollControls);
  window.addEventListener('load',updateNavScrollControls);
  setTimeout(updateNavScrollControls,80);
});

// (persistência de imagem entre abas integrada em switchTab)

// ═══════════════════════════════════════════════════════════
//  ORÇAMENTO EM PDF
// ═══════════════════════════════════════════════════════════

let _orcContexto = 'quadro';
let _consultaEditandoId = null;

function atualizarDetalhesOrcamento() {
  const detEl = document.getElementById('orcDetalhes');
  if (!detEl) return;

  const modelo = document.getElementById('orcModelo')?.value || 'Padrão';
  const vidro = document.getElementById('orcVidro')?.value || 'Sem vidro';
  const fundo = document.getElementById('orcFundo')?.value || 'Sem fundo';

  if (_orcContexto === 'quadro' && typeof sqImg !== 'undefined' && sqImg) {
    const w = document.getElementById('sqW')?.value || 80;
    const h = document.getElementById('sqH')?.value || 60;
    const frameW = parseFloat(document.getElementById('sqFrameW')?.value || 0);
    const ppOn = document.getElementById('sqPpEnabled')?.checked;
    const ppSize = parseFloat(document.getElementById('sqPpSize')?.value || 3);

    const coresNome = {
      '#3c2f1e': 'Marrom Escura',
      '#c9a97f': 'Marrom Clara',
      '#b8903c': 'Dourado',
      '#8a5f2b': 'Cobre',
      '#ffffff': 'Branco',
      '#f5f0e8': 'Off-white',
      '#e8e0d0': 'Bege',
      '#888': 'Prata',
      '#888888': 'Prata',
      '#000': 'Preto',
      '#000000': 'Preto'
    };
    const corMoldura = coresNome[sqFrameColor?.toLowerCase()] || sqFrameColor || 'Personalizada';
    const corPassepartout = coresNome[sqPpColor?.toLowerCase()] || sqPpColor || 'Personalizada';
    const tamanhoFinalW = (parseFloat(w) + (frameW + (ppOn ? ppSize : 0)) * 2).toFixed(1);
    const tamanhoFinalH = (parseFloat(h) + (frameW + (ppOn ? ppSize : 0)) * 2).toFixed(1);

    const _detItem = (label, value) =>
      `<label style="display:flex;align-items:center;gap:8px;padding:5px 0;cursor:pointer;border-bottom:1px solid var(--border2)">` +
      `<input type="checkbox" class="orc-det-cb" checked style="accent-color:var(--gold);width:14px;height:14px;flex-shrink:0;cursor:pointer">` +
      `<span style="font-size:12px;color:var(--brown)"><strong>${label}:</strong> ${value}</span></label>`;
    detEl.innerHTML =
      _detItem('Modelo do Quadro', modelo) +
      (frameW > 0 ? _detItem('Moldura', `${corMoldura}, ${frameW}cm de espessura`) : _detItem('Moldura', 'Sem moldura')) +
      (ppOn ? _detItem('Passepartout', `${corPassepartout}, ${ppSize}cm`) : _detItem('Passepartout', 'Sem passepartout')) +
      _detItem('Vidro', vidro) +
      _detItem('Fundo', fundo) +
      _detItem('Tamanho da imagem', `${w} × ${h} cm`) +
      _detItem('Tamanho Final', `${tamanhoFinalW} × ${tamanhoFinalH} cm`);
    return;
  }

  if (_orcContexto === 'ambiente' && wEnvImg && wArtImg) {
    const w = document.getElementById('wW')?.value || 80;
    const h = document.getElementById('wH')?.value || 60;
    const _detItem = (label, value) =>
      `<label style="display:flex;align-items:center;gap:8px;padding:5px 0;cursor:pointer;border-bottom:1px solid var(--border2)">` +
      `<input type="checkbox" class="orc-det-cb" checked style="accent-color:var(--gold);width:14px;height:14px;flex-shrink:0;cursor:pointer">` +
      `<span style="font-size:12px;color:var(--brown)"><strong>${label}:</strong> ${value}</span></label>`;
    detEl.innerHTML =
      _detItem('Modelo do Quadro', modelo) +
      _detItem('Moldura', 'Simulação em ambiente') +
      _detItem('Passepartout', 'Não aplicado') +
      _detItem('Vidro', vidro) +
      _detItem('Fundo', fundo) +
      _detItem('Tamanho da imagem', `${w} × ${h} cm`) +
      _detItem('Tamanho Final', `${w} × ${h} cm`);
    return;
  }

  detEl.innerHTML = '<div style="color:var(--gray)">Carregue uma imagem no simulador primeiro.</div>';
}

function abrirOrcamento(contexto) {
  _orcContexto = contexto;
  const modal = document.getElementById('orcModal');

  // Preencher data/validade somente quando nao estiver editando um atendimento existente
  if (!_consultaEditandoId) {
    const hoje = new Date();
    const validade = new Date();
    validade.setDate(hoje.getDate() + 7);
    const fmt = d => d.toISOString().split('T')[0];
    document.getElementById('orcData').value = fmt(hoje);
    document.getElementById('orcValidade').value = fmt(validade);
  }
  atualizarDetalhesOrcamento();

  // Montar detalhes técnicos e preview
  const detEl = document.getElementById('orcDetalhes');
  const prevCvs = document.getElementById('orcPreviewCanvas');
  const prevInfo = document.getElementById('orcPreviewInfo');

  if (contexto === 'quadro' && typeof sqImg !== 'undefined' && sqImg) {
    const w = document.getElementById('sqW')?.value || 80;
    const h = document.getElementById('sqH')?.value || 60;
    atualizarDetalhesOrcamento();

    // Preview do canvas atual
    const fc = document.getElementById('frameCanvas');
    if (fc && fc.width > 0) {
      const maxW = 320, maxH = 150;
      const sc = Math.min(maxW / fc.width, maxH / fc.height);
      prevCvs.width = Math.round(fc.width * sc);
      prevCvs.height = Math.round(fc.height * sc);
      prevCvs.getContext('2d').drawImage(fc, 0, 0, prevCvs.width, prevCvs.height);
      prevInfo.textContent = `${w} × ${h} cm`;
    }

  } else if (contexto === 'ambiente' && wEnvImg && wArtImg) {
    const w = document.getElementById('wW')?.value || 80;
    const h = document.getElementById('wH')?.value || 60;
    atualizarDetalhesOrcamento();

    const wc = document.getElementById('wallCanvas');
    if (wc && wc.width > 0) {
      const maxW = 320, maxH = 150;
      const sc = Math.min(maxW / wc.width, maxH / wc.height);
      prevCvs.width = Math.round(wc.width * sc);
      prevCvs.height = Math.round(wc.height * sc);
      prevCvs.getContext('2d').drawImage(wc, 0, 0, prevCvs.width, prevCvs.height);
      prevInfo.textContent = `Simulação de ambiente`;
    }
  } else {
    atualizarDetalhesOrcamento();
    prevCvs.width = 1; prevCvs.height = 1;
  }

  modal.style.display = 'flex';
}

function fecharOrcamento(limparEdicao = true) {
  document.getElementById('orcModal').style.display = 'none';
  if (limparEdicao) _consultaEditandoId = null;
  const titulo = document.getElementById('orcModalTitulo');
  const subtitulo = document.getElementById('orcModalSubtitulo');
  const dica = document.getElementById('orcPreviewDica');
  const cvs = document.getElementById('orcPreviewCanvas');
  if (titulo) titulo.textContent = '📄 Gerar Orçamento';
  if (subtitulo) subtitulo.textContent = 'Preencha os dados para gerar o PDF';
  if (dica) dica.style.display = 'none';
  if (cvs) cvs.style.cursor = 'default';
}

function _orcGetDetalhesLinhas() {
  return [...document.querySelectorAll('#orcDetalhes .orc-det-cb')]
    .filter(cb => cb.checked)
    .map(cb => cb.nextElementSibling?.textContent.trim())
    .filter(Boolean);
}

function orcToggleTodosDetalhes(checked) {
  document.querySelectorAll('#orcDetalhes .orc-det-cb').forEach(cb => { cb.checked = checked; });
}

function _montarOrcamentoPDFData() {
  const { jsPDF } = window.jspdf;

  const cliente = document.getElementById('orcCliente').value.trim() || 'Cliente';
  const telefone = document.getElementById('orcTelefone')?.value.trim().replace(/\D/g, '') || '';
  const data = document.getElementById('orcData').value;
  const validade = document.getElementById('orcValidade').value;
  const preco = parseFloat(document.getElementById('orcPreco').value) || 0;
  const desconto = parseFloat(document.getElementById('orcDesconto').value) || 0;
  const obs = document.getElementById('orcObs').value.trim();
  const total = Math.max(0, preco - desconto);
  const detalhes = document.getElementById('orcDetalhes').innerText.trim();
  const linhasDetalhes = _orcGetDetalhesLinhas();

  const fmtData = (s) => {
    if (!s) return '';
    const [y, m, d] = s.split('-');
    return `${d}/${m}/${y}`;
  };
  const fmtMoeda = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  // PDF A4
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210, H = 297;
  let y = 0;
  const MAX_CONTENT_Y = H - 22;

  // Cabeçalho azul
  pdf.setFillColor(26, 48, 81);
  pdf.rect(0, 0, W, 38, 'F');

  // Variação visual da logo no PDF: use 'discreta' ou 'destaque'.
  const PDF_LOGO_VARIANT = 'destaque'; // 'discreta' tem fundo mais suave e sem borda, 'destaque' tem fundo branco com borda cinza para maior contraste.  

  // Logo da Fast Frame no cabeçalho com fundo claro para manter contraste do azul da marca.
  let tituloX = 14;
  const logoEl = document.querySelector('img.logo-icon');
  if (logoEl && logoEl.complete) {
    try {
      const isDiscreta = PDF_LOGO_VARIANT === 'discreta';
      const boxX = 14;
      const boxY = isDiscreta ? 8 : 5;
      const boxW = isDiscreta ? 23 : 30;
      const boxH = isDiscreta ? 20 : 26;
      const radius = isDiscreta ? 1.5 : 2.5;

      if (isDiscreta) {
        pdf.setFillColor(247, 249, 252);
        pdf.roundedRect(boxX, boxY, boxW, boxH, radius, radius, 'F');
      } else {
        pdf.setFillColor(255, 255, 255);
        pdf.roundedRect(boxX, boxY, boxW, boxH, radius, radius, 'F');
        pdf.setDrawColor(220, 226, 236);
        pdf.roundedRect(boxX, boxY, boxW, boxH, radius, radius, 'S');
      }

      const pad = isDiscreta ? 2.5 : 2;
      pdf.addImage(logoEl, 'PNG', boxX + pad, boxY + pad, boxW - (pad * 2), boxH - (pad * 2));
      tituloX = isDiscreta ? 41 : 48;
    } catch (_) {
      tituloX = 14;
    }
  }

  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(20);
  pdf.setFont('helvetica', 'bold');
  pdf.text('Fast Frame Sorocaba', tituloX, 16);

  pdf.setFontSize(10);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(180, 200, 230);
  pdf.text('sorocaba@fastframe.com.br  |  (15) 99135-5747', tituloX, 24);

  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(16);
  pdf.setFont('helvetica', 'bold');
  pdf.text('ORÇAMENTO', W - 14, 16, { align: 'right' });

  pdf.setFontSize(9);
  pdf.setFont('helvetica', 'normal');
  pdf.text(`Data: ${fmtData(data)}`, W - 14, 24, { align: 'right' });
  pdf.text(`Validade: ${fmtData(validade)}`, W - 14, 30, { align: 'right' });

  y = 50;

  // Nome do cliente
  pdf.setTextColor(26, 48, 81);
  pdf.setFontSize(13);
  pdf.setFont('helvetica', 'bold');
  pdf.text(`Cliente: ${cliente}`, 14, y);
  y += 10;

  // Linha separadora
  pdf.setDrawColor(220, 220, 220);
  pdf.line(14, y, W - 14, y);
  y += 8;

  // Preview da simulacao (sempre visivel)
  const prevCvs = document.getElementById('orcPreviewCanvas');
  if (prevCvs && prevCvs.width > 1) {
    try {
      const imgData = prevCvs.toDataURL('image/jpeg', 0.85);
      const maxW = 80, maxH = 50;
      const ratio = Math.min(maxW / prevCvs.width, maxH / prevCvs.height);
      const iW = prevCvs.width * ratio;
      const iH = prevCvs.height * ratio;
      const ix = (W - iW) / 2;
      pdf.addImage(imgData, 'JPEG', ix, y, iW, iH);
      y += iH + 12;
    } catch(e) {}
  }

  if (linhasDetalhes.length > 0) {
    // Seção: Detalhes do Quadro
    pdf.setFillColor(244, 247, 252);
    pdf.roundedRect(14, y, W - 28, 8, 2, 2, 'F');
    pdf.setTextColor(26, 48, 81);
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'bold');
    pdf.text('DETALHES DO QUADRO', 18, y + 5.5);
    y += 14;

    pdf.setTextColor(50, 50, 50);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    linhasDetalhes.forEach(linha => {
      pdf.text(linha.trim(), 18, y);
      y += 5.5;
    });
    y += 2;
  } 
  

  // Linha separadora
  pdf.setDrawColor(220, 220, 220);
  pdf.line(14, y, W - 14, y);
  y += 8;

  // Seção: Valores
  pdf.setFillColor(244, 247, 252);
  pdf.roundedRect(14, y, W - 28, 8, 2, 2, 'F');
  pdf.setTextColor(26, 48, 81);
  pdf.setFontSize(10);
  pdf.setFont('helvetica', 'bold');
  pdf.text('VALORES', 18, y + 5.5);
  y += 14;

  // Tabela de valores
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(60, 60, 60);
  if (desconto > 0) {
    pdf.text('Valor:', 18, y);
    pdf.text(fmtMoeda(preco), W - 14, y, { align: 'right' });
    y += 7;

    pdf.setTextColor(178, 34, 34);
    pdf.text('Desconto aplicado:', 18, y);
    pdf.text('- ' + fmtMoeda(desconto), W - 14, y, { align: 'right' });
    y += 7;

    pdf.setFillColor(26, 48, 81);
    pdf.roundedRect(14, y, W - 28, 12, 2, 2, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(12);
    pdf.text('TOTAL COM DESCONTO:', 18, y + 8);
    pdf.text(fmtMoeda(total), W - 18, y + 8, { align: 'right' });
    y += 20;
  } else {
    pdf.setFillColor(26, 48, 81);
    pdf.roundedRect(14, y, W - 28, 12, 2, 2, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(12);
    pdf.text('VALOR:', 18, y + 8);
    pdf.text(fmtMoeda(preco), W - 18, y + 8, { align: 'right' });
    y += 20;
  }

  // Formas de pagamento
  const pgDinheiro  = document.getElementById('pgDinheiro')?.checked;
  const pgPix       = document.getElementById('pgPix')?.checked;
  const pgDebito    = document.getElementById('pgDebito')?.checked;
  const pgParcelado = document.getElementById('pgParcelado')?.checked;
  const formasSel = [
    pgDinheiro  ? 'Dinheiro' : null,
    pgPix       ? 'PIX (10% de desconto)' : null,
    pgDebito    ? 'Cartão de Débito/Crédito' : null,
    pgParcelado ? 'Parcelado até 5x sem juros*' : null,
  ].filter(Boolean);

  if (formasSel.length > 0) {
    const compact = (MAX_CONTENT_Y - y) < 44;
    const headingH = compact ? 7 : 8;
    const headingOffset = compact ? 4.8 : 5.5;
    const headingToListGap = compact ? 9 : 12;
    const listLineGap = compact ? 4.5 : 6;
    const listFont = compact ? 8.5 : 10;

    pdf.setDrawColor(220, 220, 220);
    pdf.line(14, y, W - 14, y);
    y += compact ? 5 : 8;
    pdf.setFillColor(244, 247, 252);
    pdf.roundedRect(14, y, W - 28, headingH, 2, 2, 'F');
    pdf.setTextColor(26, 48, 81);
    pdf.setFontSize(compact ? 9 : 10);
    pdf.setFont('helvetica', 'bold');
    pdf.text('FORMAS DE PAGAMENTO', 18, y + headingOffset);
    y += headingToListGap;
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(60, 60, 60);
    pdf.setFontSize(listFont);
    const metade = Math.ceil(formasSel.length / 2);
    const col1 = formasSel.slice(0, metade);
    const col2 = formasSel.slice(metade);
    const maxLinhas = Math.max(col1.length, col2.length);
    let yCol = y;
    for (let i = 0; i < maxLinhas; i++) {
      if (col1[i]) pdf.text('- ' + col1[i], 18, yCol);
      if (col2[i]) pdf.text('- ' + col2[i], 110, yCol);
      yCol += listLineGap;
    }
    y = yCol;
    if (pgParcelado) {
      pdf.setTextColor(120, 120, 120);
      pdf.setFontSize(compact ? 7 : 8);
      pdf.text('*Parcela minima de R$ 100,00', 18, y);
      pdf.setFontSize(listFont);
      y += compact ? 5 : 8;
    }
  }

  // Observações
  if (obs) {
    const compactObs = (MAX_CONTENT_Y - y) < 36;
    const obsHeaderH = compactObs ? 7 : 8;
    const obsHeaderOffset = compactObs ? 4.8 : 5.5;
    const obsLineGap = compactObs ? 4.5 : 6;
    const obsFont = compactObs ? 8.3 : 10;

    pdf.setDrawColor(220, 220, 220);
    pdf.line(14, y, W - 14, y);
    y += compactObs ? 5 : 8;
    pdf.setFillColor(244, 247, 252);
    pdf.roundedRect(14, y, W - 28, obsHeaderH, 2, 2, 'F');
    pdf.setTextColor(26, 48, 81);
    pdf.setFontSize(compactObs ? 9 : 10);
    pdf.setFont('helvetica', 'bold');
    pdf.text('OBSERVACOES', 18, y + obsHeaderOffset);
    y += compactObs ? 9 : 12;
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(60, 60, 60);
    pdf.setFontSize(obsFont);
    const obsLinhas = pdf.splitTextToSize(obs, W - 36);
    const maxLinhas = Math.max(1, Math.floor((MAX_CONTENT_Y - y) / obsLineGap));
    const linhasVisiveis = obsLinhas.slice(0, maxLinhas);
    if (obsLinhas.length > maxLinhas && linhasVisiveis.length) {
      linhasVisiveis[linhasVisiveis.length - 1] = String(linhasVisiveis[linhasVisiveis.length - 1]).replace(/\s*$/, '') + '...';
    }
    linhasVisiveis.forEach(l => { pdf.text(l, 18, y); y += obsLineGap; });
  }

  // Rodapé
  pdf.setFillColor(26, 48, 81);
  pdf.rect(0, H - 18, W, 18, 'F');
  pdf.setTextColor(180, 200, 230);
  pdf.setFontSize(8);
  pdf.setFont('helvetica', 'normal');
  let footerY = H - 11;
  pdf.text('Horario: Segunda a Sexta - 9h as 18h e Sabado das 9h as 13h', 14, footerY);
  footerY += 5;
  pdf.text('Endereco: Av. Barao de Tatui, 1584 - Jardim Vergueiro, Sorocaba/SP', 14, footerY);

  // Salvar
  const clienteSlug = (cliente || 'cliente')
    .trim()
    .replace(/[^a-zA-Z0-9\u00C0-\u00FF\s\-_]/g, '')
    .replace(/\s+/g, '-')
    .toLowerCase();
  const dataSlug = data || 'sem-data';
  const contextoSlug = _orcContexto === 'ambiente' ? 'digital' : 'quadro';
  const nomeArq = `orcamento-${contextoSlug}-${clienteSlug}-${dataSlug}`;

  return {
    pdf,
    nomeArq,
    cliente,
    telefone,
  };
}

function gerarOrcamentoPDF() {
  const { pdf, nomeArq } = _montarOrcamentoPDFData();
  askFileName('orcamento', (finalName) => {
    _saveAs(new Blob([pdf.output('arraybuffer')], { type: 'application/pdf' }), finalName, 'application/pdf');
    toast('Orçamento gerado!');
    fecharOrcamento();
  }, nomeArq);
}

async function compartilharOrcamentoWhatsAppPDF() {
  try {
    const { pdf, nomeArq, cliente, telefone } = _montarOrcamentoPDFData();
    const blob = new Blob([pdf.output('arraybuffer')], { type: 'application/pdf' });
    const arquivo = new File([blob], nomeArq + '.pdf', { type: 'application/pdf' });
    const texto = cliente
      ? 'Olá, ' + cliente + '! Segue o orçamento da Fast Frame Sorocaba.'
      : 'Segue o orçamento da Fast Frame Sorocaba.';

    if (navigator.share && typeof File !== 'undefined') {
      try {
        const shareData = { files: [arquivo], title: 'Orçamento Fast Frame', text: texto };
        if (!navigator.canShare || navigator.canShare(shareData)) {
          await navigator.share(shareData);
          toast('PDF compartilhado.');
          return;
        }
      } catch (err) {
        if (err && err.name === 'AbortError') return;
      }
    }

    const salvo = await _saveAs(blob, nomeArq, 'application/pdf');
    if (salvo === false) return;

    const numero = telefone ? '55' + telefone : '';
    const msg = texto + '\n\nO PDF foi gerado neste aparelho. Anexe o arquivo salvo na conversa para enviar.';
    const url = numero
      ? 'https://wa.me/' + numero + '?text=' + encodeURIComponent(msg)
      : 'https://wa.me/?text=' + encodeURIComponent(msg);
    window.open(url, '_blank');
    toast('PDF salvo. No WhatsApp, anexe o arquivo para enviar.');
  } catch (err) {
    toast(err.message || 'Não foi possível preparar o PDF para o WhatsApp.');
  }
}

// ═══════════════════════════════════════════════════════════
//  MENSAGENS PARA WHATSAPP
// ═══════════════════════════════════════════════════════════

function _montarMensagemWhatsApp() {
  const cliente   = document.getElementById('orcCliente')?.value.trim() || '';
  const telefone  = document.getElementById('orcTelefone')?.value.trim().replace(/\D/g, '');
  const data      = document.getElementById('orcData')?.value || '';
  const validade  = document.getElementById('orcValidade')?.value || '';
  const preco     = parseFloat(document.getElementById('orcPreco')?.value) || 0;
  const desconto  = parseFloat(document.getElementById('orcDesconto')?.value) || 0;
  const obs       = document.getElementById('orcObs')?.value.trim() || '';
  const linhasDetalhes = _orcGetDetalhesLinhas();
  const total     = Math.max(0, preco - desconto);

  const pgDinheiro  = document.getElementById('pgDinheiro')?.checked;
  const pgPix       = document.getElementById('pgPix')?.checked;
  const pgDebito    = document.getElementById('pgDebito')?.checked;
  const pgParcelado = document.getElementById('pgParcelado')?.checked;

  const fmtData  = (s) => { if(!s) return ''; const [y,m,d]=s.split('-'); return d+'/'+m+'/'+y; };
  const fmtMoeda = (v) => 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2 });

  let msg = cliente ? 'Ola, ' + cliente + '!\n\n' : 'Ola!\n\n';
  msg += 'Segue o orçamento da *Fast Frame Sorocaba*:\n\n';
  msg += '*ORÇAMENTO*\n';
  msg += 'Data: ' + fmtData(data) + '\n';
  msg += 'Validade: ' + fmtData(validade) + '\n\n';

  msg += '*DETALHES DO QUADRO*\n';
  if (linhasDetalhes.length > 0) {
    linhasDetalhes.forEach(linha => {
      msg += linha.trim() + '\n';
    });
  } else {
    msg += 'Detalhes tecnicos ocultados pela loja.\n';
  }

  msg += '\n*VALORES*\n';
  if (desconto > 0) {
    msg += 'Valor: ' + fmtMoeda(preco) + '\n';
    msg += 'Desconto aplicado: - ' + fmtMoeda(desconto) + '\n';
    msg += '*Total com desconto: ' + fmtMoeda(total) + '*\n';
  } else {
    msg += '*Valor: ' + fmtMoeda(preco) + '*\n';
  }

  // Formas de pagamento
  const formas = [
    pgDinheiro  ? 'Dinheiro' : null,
    pgPix       ? 'PIX (10% desconto)' : null,
    pgDebito    ? 'Cartão de Débito/Crédito' : null,
    pgParcelado ? 'Parcelado até 5x sem juros*' : null,
  ].filter(Boolean);

  if (formas.length > 0) {
    msg += '\n*FORMAS DE PAGAMENTO*\n';
    formas.forEach(f => { msg += '- ' + f + '\n'; });
    if (pgParcelado) msg += '_*Parcela minima de R$ 100,00_\n';
  }

  if (obs) msg += '\n*OBSERVACOES*\n' + obs + '\n';

  msg += '\nAtenciosamente,\n*Fast Frame Sorocaba*\n(15) 99135-5747';

  return { msg, telefone, cliente, data };
}

function _canvasToBlob(canvas, mimeType, quality) {
  return new Promise((resolve, reject) => {
    if (!canvas || !canvas.width || !canvas.height) {
      reject(new Error('Simulação não encontrada para gerar imagem.'));
      return;
    }
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Nao foi possivel gerar imagem da simulacao.'));
        return;
      }
      resolve(blob);
    }, mimeType || 'image/jpeg', quality ?? 0.92);
  });
}

function _getCanvasSimulacaoAtual() {
  const wall = document.getElementById('wallCanvas');
  const frame = document.getElementById('frameCanvas');
  const preview = document.getElementById('orcPreviewCanvas');
  if (_orcContexto === 'ambiente' && wall && wall.width > 1 && wall.height > 1) return wall;
  if (_orcContexto === 'quadro' && frame && frame.width > 1 && frame.height > 1) return frame;
  if (preview && preview.width > 1 && preview.height > 1) return preview;
  return null;
}

async function enviarWhatsAppComImagem() {
  try {
    const { msg, telefone, cliente, data } = _montarMensagemWhatsApp();
    const canvas = _getCanvasSimulacaoAtual();
    if (!canvas) {
      toast('Abra uma simulacao de quadro/ambiente para enviar imagem.');
      return;
    }

    const blob = await _canvasToBlob(canvas, 'image/jpeg', 0.92);
    const baseNome = (cliente || 'cliente')
      .trim()
      .replace(/[^a-zA-Z0-9\u00C0-\u00FF\s\-_]/g, '')
      .replace(/\s+/g, '-')
      .toLowerCase() || 'cliente';
    const contexto = _orcContexto === 'ambiente' ? 'ambiente' : 'quadro';
    const refData = data || new Date().toISOString().slice(0, 10);
    const nomeImagem = 'simulacao-' + contexto + '-' + baseNome + '-' + refData + '.jpg';
    const arquivo = new File([blob], nomeImagem, { type: 'image/jpeg' });

    if (navigator.share && typeof File !== 'undefined') {
      try {
        const shareData = { files: [arquivo], title: 'Simulacao Fast Frame', text: msg };
        if (!navigator.canShare || navigator.canShare(shareData)) {
          await navigator.share(shareData);
          toast('Imagem da simulação compartilhada.');
          return;
        }
      } catch (err) {
        if (err && err.name === 'AbortError') return;
      }
    }

    const salvo = await _saveAs(blob, nomeImagem.replace(/\.jpg$/i, ''), 'image/jpeg');
    if (salvo === false) return;

    const numero = telefone ? '55' + telefone : '';
    const aviso = msg + '\n\nA imagem da simulacao foi salva neste aparelho. Anexe o arquivo salvo na conversa para enviar.';
    const url = numero
      ? 'https://wa.me/' + numero + '?text=' + encodeURIComponent(aviso)
      : 'https://wa.me/?text=' + encodeURIComponent(aviso);
    window.open(url, '_blank');
    toast('Imagem salva. No WhatsApp, anexe para enviar.');
  } catch (err) {
    toast(err.message || 'Nao foi possivel compartilhar a simulacao com imagem.');
  }
}

async function compartilharSimulacaoNoWhatsApp(contexto) {
  try {
    const tipo = contexto === 'ambiente' ? 'ambiente' : 'quadro';
    const canvas = tipo === 'ambiente'
      ? document.getElementById('wallCanvas')
      : document.getElementById('frameCanvas');

    if (!canvas || canvas.width <= 1 || canvas.height <= 1) {
      toast('Gere a simulacao antes de compartilhar no WhatsApp.');
      return;
    }

    const telefone = (document.getElementById('orcTelefone')?.value || '').trim().replace(/\D/g, '');
    const cliente = (document.getElementById('orcCliente')?.value || '').trim();

    const blob = await _canvasToBlob(canvas, 'image/jpeg', 0.92);
    const baseNome = (cliente || 'cliente')
      .trim()
      .replace(/[^a-zA-Z0-9\u00C0-\u00FF\s\-_]/g, '')
      .replace(/\s+/g, '-')
      .toLowerCase() || 'cliente';
    const refData = new Date().toISOString().slice(0, 10);
    const nomeImagem = 'simulacao-' + tipo + '-' + baseNome + '-' + refData + '.jpg';
    const arquivo = new File([blob], nomeImagem, { type: 'image/jpeg' });

    if (navigator.share && typeof File !== 'undefined') {
      try {
        const shareData = { files: [arquivo] };
        if (!navigator.canShare || navigator.canShare(shareData)) {
          await navigator.share(shareData);
          toast('Imagem da simulacao compartilhada.');
          return;
        }
      } catch (err) {
        if (err && err.name === 'AbortError') return;
      }
    }

    const salvo = await _saveAs(blob, nomeImagem.replace(/\.jpg$/i, ''), 'image/jpeg');
    if (salvo === false) return;

    const numero = telefone ? '55' + telefone : '';
    const url = numero
      ? 'https://wa.me/' + numero
      : 'https://wa.me/';
    window.open(url, '_blank');
    toast('Imagem salva. No WhatsApp, envie somente a imagem.');
  } catch (err) {
    toast(err.message || 'Nao foi possivel compartilhar a simulacao.');
  }
}

let _clienteSelecionadoId = null;
let _historicoPorId = {};
let _historicoListaAtual = [];
let _historicoSelecionados = new Set();
let _clienteHistoricoAtual = null;
let _clienteEdicaoId = null;
let _clientesPorId = {};
let _usuarioAtual = (window.FF_CURRENT_USER && typeof window.FF_CURRENT_USER === 'object') ? window.FF_CURRENT_USER : null;
let _usuarioEdicaoId = null;
let _usuariosSistemaPorId = {};

function _esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function _fmtDataHora(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('pt-BR');
}

function _fmtMoeda(v) {
  return (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function _fmtDataBR(s) {
  if (!s) return '-';
  const parts = String(s).split('-');
  if (parts.length !== 3) return s;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function togglePasswordField(inputId, triggerEl) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  if (triggerEl) {
    triggerEl.textContent = showing ? 'Mostrar' : 'Ocultar';
    triggerEl.setAttribute('aria-pressed', showing ? 'false' : 'true');
  }
}

function _normalizarSelecaoHistorico(hist) {
  const idsDisponiveis = new Set((hist || []).map(h => h.id));
  _historicoSelecionados = new Set([..._historicoSelecionados].filter(id => idsDisponiveis.has(id)));
  if (!_historicoSelecionados.size && idsDisponiveis.size) {
    idsDisponiveis.forEach(id => _historicoSelecionados.add(id));
  }
}

function _getHistoricoSelecionado() {
  return (_historicoListaAtual || []).filter(h => _historicoSelecionados.has(h.id));
}

function _atualizarResumoSelecaoHistorico() {
  const selecionados = _getHistoricoSelecionado();
  const total = (_historicoListaAtual || []).length;
  const elCount = document.getElementById('histOrcCount');
  const btnPdf = document.getElementById('histOrcPdfBtn');
  const btnWa = document.getElementById('histOrcWaBtn');
  const chkAll = document.getElementById('histSelectAll');
  const bar = document.getElementById('historicoBulkBar');

  if (bar) bar.style.display = total ? 'flex' : 'none';
  if (elCount) elCount.textContent = `${selecionados.length} de ${total} selecionados`;
  if (btnPdf) btnPdf.disabled = !selecionados.length;
  if (btnWa) btnWa.disabled = !selecionados.length;
  if (chkAll) {
    chkAll.checked = total > 0 && selecionados.length === total;
    chkAll.indeterminate = selecionados.length > 0 && selecionados.length < total;
  }
}

function toggleSelecaoHistorico(consultaId, checked) {
  if (checked) _historicoSelecionados.add(consultaId);
  else _historicoSelecionados.delete(consultaId);
  _atualizarResumoSelecaoHistorico();
}

function alternarSelecaoTodosHistorico(checked) {
  if (checked) {
    (_historicoListaAtual || []).forEach(h => _historicoSelecionados.add(h.id));
  } else {
    _historicoSelecionados.clear();
  }
  const listEl = document.getElementById('historicoList');
  if (listEl) {
    const checks = listEl.querySelectorAll('input[type="checkbox"][data-historico-id]');
    checks.forEach(cb => { cb.checked = checked; });
  }
  _atualizarResumoSelecaoHistorico();
}

function _montarOrcamentoConsolidadoPDFData() {
  const { jsPDF } = window.jspdf;
  const selecionados = _getHistoricoSelecionado();
  if (!selecionados.length) throw new Error('Selecione ao menos uma simulacao no historico.');

  const cliente = (_clienteHistoricoAtual?.nome || 'Cliente').trim();
  const telefone = String(_clienteHistoricoAtual?.telefone || '').replace(/\D/g, '');
  const hoje = new Date();
  const dataRef = hoje.toISOString().slice(0, 10);

  const totalBruto = selecionados.reduce((acc, h) => acc + (Number(h.preco) || 0), 0);
  const totalDesconto = selecionados.reduce((acc, h) => acc + (Number(h.desconto) || 0), 0);
  const totalFinal = selecionados.reduce((acc, h) => {
    const bruto = Number(h.preco) || 0;
    const desc = Number(h.desconto) || 0;
    return acc + (Number(h.total) || Math.max(0, bruto - desc));
  }, 0);

  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210;
  const H = 297;
  let y = 18;

  pdf.setFillColor(26, 48, 81);
  pdf.rect(0, 0, W, 34, 'F');
  pdf.setTextColor(255, 255, 255);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(16);
  pdf.text('ORÇAMENTO CONSOLIDADO', 14, 15);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  pdf.text('Fast Frame Sorocaba', 14, 23);
  pdf.text(`Data: ${_fmtDataBR(dataRef)}`, W - 14, 15, { align: 'right' });
  pdf.text(`Itens: ${selecionados.length}`, W - 14, 23, { align: 'right' });

  y = 42;
  pdf.setTextColor(26, 48, 81);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(12);
  pdf.text(`Cliente: ${cliente}`, 14, y);
  y += 6;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  pdf.setTextColor(70, 70, 70);
  pdf.text(`WhatsApp: ${telefone || '-'}`, 14, y);
  y += 7;

  pdf.setDrawColor(220, 220, 220);
  pdf.line(14, y, W - 14, y);
  y += 8;

  const addHeader = () => {
    pdf.setFillColor(244, 247, 252);
    pdf.rect(14, y - 5, W - 28, 7, 'F');
    pdf.setTextColor(26, 48, 81);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9);
    pdf.text('ITEM', 16, y);
    pdf.text('SIMULACAO', 27, y);
    pdf.text('DETALHES', 68, y);
    pdf.text('VALOR', 156, y, { align: 'right' });
    pdf.text('DESC', 176, y, { align: 'right' });
    pdf.text('TOTAL', 196, y, { align: 'right' });
    y += 6;
  };

  addHeader();
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(55, 55, 55);
  pdf.setFontSize(8.5);

  selecionados.forEach((h, idx) => {
    if (y > H - 30) {
      pdf.addPage();
      y = 18;
      addHeader();
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(55, 55, 55);
      pdf.setFontSize(8.5);
    }

    const bruto = Number(h.preco) || 0;
    const desc = Number(h.desconto) || 0;
    const total = Number(h.total) || Math.max(0, bruto - desc);
    const tipo = h.contexto === 'ambiente' ? 'Ambiente' : 'Quadro';
    const detalhes = String(h.detalhes || '').split('\n').filter(Boolean).slice(0, 2).join(' | ') || '-';
    const detalheLinhas = pdf.splitTextToSize(detalhes, 82).slice(0, 2);
    const rowH = Math.max(6, detalheLinhas.length * 3.6);

    pdf.text(String(idx + 1), 16, y);
    pdf.text(tipo, 27, y);
    detalheLinhas.forEach((ln, i) => pdf.text(ln, 68, y + (i * 3.6)));
    pdf.text(_fmtMoeda(bruto), 156, y, { align: 'right' });
    pdf.text(_fmtMoeda(desc), 176, y, { align: 'right' });
    pdf.text(_fmtMoeda(total), 196, y, { align: 'right' });

    y += rowH;
    pdf.setDrawColor(236, 236, 236);
    pdf.line(14, y - 2.5, W - 14, y - 2.5);
    y += 1.5;
  });

  if (y > H - 42) {
    pdf.addPage();
    y = 18;
  }

  y += 4;
  pdf.setFillColor(244, 247, 252);
  pdf.rect(120, y - 5, 76, 22, 'F');
  pdf.setTextColor(26, 48, 81);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10);
  pdf.text('RESUMO FINANCEIRO', 123, y);
  y += 6;

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.setTextColor(60, 60, 60);
  pdf.text('Valor bruto:', 123, y);
  pdf.text(_fmtMoeda(totalBruto), 194, y, { align: 'right' });
  y += 5;
  pdf.text('Desconto total:', 123, y);
  pdf.text('- ' + _fmtMoeda(totalDesconto), 194, y, { align: 'right' });
  y += 6;
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(26, 48, 81);
  pdf.text('TOTAL FINAL:', 123, y);
  pdf.text(_fmtMoeda(totalFinal), 194, y, { align: 'right' });

  const clienteSlug = cliente
    .replace(/[^a-zA-Z0-9\u00C0-\u00FF\s\-_]/g, '')
    .replace(/\s+/g, '-')
    .toLowerCase() || 'cliente';
  const nomeArq = `orçamento-consolidado-${clienteSlug}-${dataRef}`;

  return { pdf, nomeArq, cliente, telefone, totalFinal, totalBruto, totalDesconto, itens: selecionados.length };
}

function gerarOrcamentoConsolidadoCliente() {
  try {
    const { pdf, nomeArq } = _montarOrcamentoConsolidadoPDFData();
    askFileName('orçamento', (finalName) => {
      _saveAs(new Blob([pdf.output('arraybuffer')], { type: 'application/pdf' }), finalName, 'application/pdf');
      toast('Orçamento consolidado gerado!');
    }, nomeArq);
  } catch (err) {
    toast(err.message || 'Não foi possível gerar o orçamento consolidado.');
  }
}

async function enviarOrcamentoConsolidadoWhatsApp() {
  try {
    const { pdf, nomeArq, cliente, telefone, totalFinal, totalBruto, totalDesconto, itens } = _montarOrcamentoConsolidadoPDFData();
    const blob = new Blob([pdf.output('arraybuffer')], { type: 'application/pdf' });
    const arquivo = new File([blob], nomeArq + '.pdf', { type: 'application/pdf' });

    const texto =
      (cliente ? ('Ola, ' + cliente + '!\n\n') : 'Ola!\n\n') +
      'Segue o orçamento consolidado da Fast Frame Sorocaba com ' + itens + ' simulações.\n' +
      'Valor bruto: ' + _fmtMoeda(totalBruto) + '\n' +
      'Desconto total: - ' + _fmtMoeda(totalDesconto) + '\n' +
      'Total final: ' + _fmtMoeda(totalFinal);

    if (navigator.share && typeof File !== 'undefined') {
      try {
        const shareData = { files: [arquivo], title: 'Orçamento Consolidado Fast Frame', text: texto };
        if (!navigator.canShare || navigator.canShare(shareData)) {
          await navigator.share(shareData);
          toast('PDF consolidado compartilhado.');
          return;
        }
      } catch (err) {
        if (err && err.name === 'AbortError') return;
      }
    }

    const salvo = await _saveAs(blob, nomeArq, 'application/pdf');
    if (salvo === false) return;

    const numero = telefone ? '55' + telefone : '';
    const msg = texto + '\n\nO PDF foi gerado neste aparelho. Anexe o arquivo salvo na conversa para enviar.';
    const url = numero
      ? 'https://wa.me/' + numero + '?text=' + encodeURIComponent(msg)
      : 'https://wa.me/?text=' + encodeURIComponent(msg);
    window.open(url, '_blank');
    toast('PDF consolidado salvo. No WhatsApp, anexe o arquivo para enviar.');
  } catch (err) {
    toast(err.message || 'Nao foi possivel preparar o PDF consolidado para o WhatsApp.');
  }
}

async function _ffApi(url, options = {}) {
  const cfg = { ...options };
  cfg.headers = { ...(options.headers || {}) };
  if (!(options.body instanceof FormData) && !cfg.headers['Content-Type']) {
    cfg.headers['Content-Type'] = 'application/json';
  }
  const resp = await fetch(url, cfg);
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || data.erro || 'Falha na requisicao.');
  return data;
}

function _pagamentosSelecionados() {
  const pgDinheiro = document.getElementById('pgDinheiro')?.checked;
  const pgPix = document.getElementById('pgPix')?.checked;
  const pgDebito = document.getElementById('pgDebito')?.checked;
  const pgParcelado = document.getElementById('pgParcelado')?.checked;
  return [
    pgDinheiro ? 'Dinheiro' : null,
    pgPix ? 'PIX (10% desconto)' : null,
    pgDebito ? 'Cartao de Debito/Credito' : null,
    pgParcelado ? 'Parcelado ate 5x sem juros*' : null,
  ].filter(Boolean);
}

function _coletarConfigAtendimento() {
  const base = {
    contexto: _orcContexto,
    modelo: document.getElementById('orcModelo')?.value || '',
    vidro: document.getElementById('orcVidro')?.value || '',
    fundo: document.getElementById('orcFundo')?.value || '',
  };

  if (_orcContexto === 'quadro') {
    base.tamanho = {
      largura_cm: Number(document.getElementById('sqW')?.value || 0),
      altura_cm: Number(document.getElementById('sqH')?.value || 0),
      moldura_cm: Number(document.getElementById('sqFrameW')?.value || 0),
      passepartout_ativo: Boolean(document.getElementById('sqPpEnabled')?.checked),
      passepartout_cm: Number(document.getElementById('sqPpSize')?.value || 0),
      cor_moldura: typeof sqFrameColor !== 'undefined' ? sqFrameColor : '',
      cor_passepartout: typeof sqPpColor !== 'undefined' ? sqPpColor : '',
    };
    base.imagem_quadro_base64 = _coletarImagemQuadroBase64();
  }

  if (_orcContexto === 'ambiente') {
    base.tamanho = {
      largura_cm: Number(document.getElementById('wW')?.value || 0),
      altura_cm: Number(document.getElementById('wH')?.value || 0),
      pos_x: Number(document.getElementById('wX')?.value || 0),
      pos_y: Number(document.getElementById('wY')?.value || 0),
      sombra: Number(document.getElementById('wS')?.value || 0),
      moldura_cor: typeof wallFrameColor !== 'undefined' ? wallFrameColor : '',
      passepartout_ativo: Boolean(document.getElementById('ppEnabled')?.checked),
      passepartout_cm: Number(document.getElementById('ppSize')?.value || 0),
      passepartout_cor: typeof ppColor !== 'undefined' ? ppColor : '',
    };
    base.imagem_ambiente_base64 = _coletarImagemAmbienteBase64();
    base.imagem_arte_base64 = _coletarImagemArteAmbienteBase64();
  }

  return base;
}

function _coletarImagemQuadroBase64() {
  if (typeof sqImg === 'undefined' || !sqImg || !sqImg.img) return '';
  try {
    const c = document.createElement('canvas');
    c.width = sqImg.w || sqImg.img.naturalWidth || sqImg.img.width || 0;
    c.height = sqImg.h || sqImg.img.naturalHeight || sqImg.img.height || 0;
    if (!c.width || !c.height) return '';
    const ctx = c.getContext('2d');
    ctx.drawImage(sqImg.img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.88);
  } catch (_) {
    return '';
  }
}

function _imgElementParaBase64(imgObj, quality = 0.86) {
  if (!imgObj) return '';
  const img = imgObj.img || imgObj;
  const w = imgObj.w || img.naturalWidth || img.width || 0;
  const h = imgObj.h || img.naturalHeight || img.height || 0;
  if (!img || !w || !h) return '';
  try {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    return c.toDataURL('image/jpeg', quality);
  } catch (_) {
    return '';
  }
}

function _coletarImagemAmbienteBase64() {
  if (typeof wEnvImg === 'undefined' || !wEnvImg) return '';
  return _imgElementParaBase64(wEnvImg, 0.82);
}

// _coletarImagemArteAmbienteBase64 → wall_simulator.js

function _aplicarImagemQuadroBase64(dataUrl, onReady) {
  if (!dataUrl) return;
  _ffSplitComposicaoAtiva=false;
  const img = new Image();
  img.onload = function() {
    sqImg = {
      img,
      file: null,
      w: img.naturalWidth || img.width,
      h: img.naturalHeight || img.height,
    };
    const uploadBox = document.getElementById('sqUploadBox');
    const results = document.getElementById('sqResults');
    if (uploadBox) uploadBox.style.display = 'none';
    if (results) results.style.display = 'block';
    if (typeof onReady === 'function') onReady();
  };
  img.src = dataUrl;
}

function _restaurarQuadroDaConsulta(item) {
  if (!item) return;
  const cfg = item.config || {};
  const t = cfg.tamanho || {};

  if (t.largura_cm) document.getElementById('sqW').value = t.largura_cm;
  if (t.altura_cm) document.getElementById('sqH').value = t.altura_cm;
  if (t.moldura_cm !== undefined) document.getElementById('sqFrameW').value = t.moldura_cm;
  if (t.passepartout_cm !== undefined) document.getElementById('sqPpSize').value = t.passepartout_cm;
  if (t.passepartout_ativo !== undefined) document.getElementById('sqPpEnabled').checked = Boolean(t.passepartout_ativo);
  if (t.cor_moldura && typeof sqFrameColor !== 'undefined') sqFrameColor = t.cor_moldura;
  if (t.cor_passepartout && typeof sqPpColor !== 'undefined') sqPpColor = t.cor_passepartout;

  const imagemBase = cfg.imagem_quadro_base64 || item.imagem_preview || '';
  if (imagemBase) {
    _aplicarImagemQuadroBase64(imagemBase, function() {
      if (typeof renderFrame === 'function') renderFrame();
    });
  } else if (typeof renderFrame === 'function') {
    renderFrame();
  }
}

// _restaurarAmbienteDaConsulta → wall_simulator.js

function _coletarPreviewBase64() {
  const cvs = document.getElementById('orcPreviewCanvas');
  if (!cvs || cvs.width <= 1 || cvs.height <= 1) return '';
  try {
    return cvs.toDataURL('image/jpeg', 0.72);
  } catch (_) {
    return '';
  }
}

async function salvarAtendimento() {
  try {
    const nome = document.getElementById('orcCliente')?.value.trim() || '';
    if (!nome) {
      toast('Informe o nome do cliente para salvar o atendimento.');
      return;
    }

    const telefone = (document.getElementById('orcTelefone')?.value || '').trim().replace(/\D/g, '');
    const status = document.getElementById('orcStatus')?.value || 'em andamento';
    const dataOrc = document.getElementById('orcData')?.value || '';
    const validade = document.getElementById('orcValidade')?.value || '';
    const preco = parseFloat(document.getElementById('orcPreco')?.value) || 0;
    const desconto = parseFloat(document.getElementById('orcDesconto')?.value) || 0;
    const obs = document.getElementById('orcObs')?.value.trim() || '';
    const detalhes = document.getElementById('orcDetalhes')?.innerText.trim() || '';
    const total = Math.max(0, preco - desconto);

    const consultaData = {
      contexto: _orcContexto,
      status,
      data_orcamento: dataOrc,
      validade,
      preco,
      desconto,
      total,
      detalhes,
      observacoes: obs,
      pagamentos: _pagamentosSelecionados(),
      config: _coletarConfigAtendimento(),
      imagem_preview: _coletarPreviewBase64(),
    };
    const clienteData = { nome, telefone, status, observacoes: '' };

    let out;
    if (_consultaEditandoId) {
      // Atualiza consulta existente
      out = await _ffApi('/api/consultas/' + _consultaEditandoId, {
        method: 'PUT',
        body: JSON.stringify({ cliente: clienteData, consulta: consultaData })
      });
      toast('Atendimento atualizado!');
    } else {
      // Nova consulta
      out = await _ffApi('/api/consultas', {
        method: 'POST',
        body: JSON.stringify({ cliente: clienteData, consulta: consultaData })
      });
      toast('Atendimento salvo com sucesso!');
    }

    if (out?.cliente?.id) {
      _clienteSelecionadoId = out.cliente.id;
    }
    _consultaEditandoId = null;
    const titulo = document.getElementById('orcModalTitulo');
    const subtitulo = document.getElementById('orcModalSubtitulo');
    if (titulo) titulo.textContent = '📄 Gerar Orçamento';
    if (subtitulo) subtitulo.textContent = 'Preencha os dados para gerar o PDF';
    carregarClientes();
  } catch (err) {
    toast(err.message || 'Erro ao salvar atendimento.');
  }
}

async function salvarCliente() {
  try {
    if (!_clienteEdicaoId) {
      toast('Para cadastrar cliente, use Salvar Atendimento no orçamento. Aqui você edita clientes existentes.');
      return;
    }

    const nome = document.getElementById('cliNome')?.value.trim() || '';
    if (!nome) {
      toast('Informe o nome do cliente.');
      return;
    }

    const telefone = (document.getElementById('cliTelefone')?.value || '').trim().replace(/\D/g, '');
    const status = document.getElementById('cliStatus')?.value || 'novo';
    const observacoes = document.getElementById('cliObs')?.value.trim() || '';

    await _ffApi('/api/clientes/' + _clienteEdicaoId, {
      method: 'PUT',
      body: JSON.stringify({ nome, telefone, status, observacoes })
    });
    toast('Cliente atualizado com sucesso!');

    cancelarEdicaoCliente();
    carregarClientes();
  } catch (err) {
    toast(err.message || 'Erro ao salvar cliente.');
  }
}

function editarCliente(clienteId) {
  const cli = _clientesPorId[clienteId];
  if (!cli) {
    toast('Cliente nao encontrado para edicao.');
    return;
  }
  _clienteEdicaoId = clienteId;
  document.getElementById('cliNome').value = cli.nome || '';
  document.getElementById('cliTelefone').value = cli.telefone || '';
  document.getElementById('cliObs').value = cli.observacoes || '';
  document.getElementById('cliStatus').value = cli.status || 'novo';

  const titulo = document.getElementById('cliFormTitulo');
  const btnSalvar = document.getElementById('cliSalvarBtn');
  const btnCancelar = document.getElementById('cliCancelarBtn');
  if (titulo) titulo.textContent = 'Editar Cliente Selecionado';
  if (btnSalvar) {
    btnSalvar.textContent = 'Atualizar Cliente';
    btnSalvar.disabled = false;
  }
  if (btnCancelar) btnCancelar.style.display = 'inline-flex';
  toast('Cliente carregado para edicao.');
}

function cancelarEdicaoCliente() {
  _clienteEdicaoId = null;
  const nome = document.getElementById('cliNome');
  const tel = document.getElementById('cliTelefone');
  const obs = document.getElementById('cliObs');
  const status = document.getElementById('cliStatus');
  if (nome) nome.value = '';
  if (tel) tel.value = '';
  if (obs) obs.value = '';
  if (status) status.value = 'novo';

  const titulo = document.getElementById('cliFormTitulo');
  const btnSalvar = document.getElementById('cliSalvarBtn');
  const btnCancelar = document.getElementById('cliCancelarBtn');
  if (titulo) titulo.textContent = 'Editar Cliente Selecionado';
  if (btnSalvar) {
    btnSalvar.textContent = 'Atualizar Cliente';
    btnSalvar.disabled = true;
  }
  if (btnCancelar) btnCancelar.style.display = 'none';
}

async function atualizarStatusCliente(clienteId, novoStatus) {
  const cli = _clientesPorId[clienteId];
  if (!cli) return;
  try {
    await _ffApi('/api/clientes/' + clienteId, {
      method: 'PUT',
      body: JSON.stringify({
        nome: cli.nome,
        telefone: cli.telefone || '',
        status: novoStatus,
        observacoes: cli.observacoes || ''
      })
    });
    _clientesPorId[clienteId].status = novoStatus;
    toast('Status atualizado.');
    carregarClientes();
  } catch (err) {
    toast(err.message || 'Erro ao atualizar status.');
  }
}

function _limparPainelHistoricoCliente() {
  _clienteSelecionadoId = null;
  _clienteHistoricoAtual = null;
  _historicoPorId = {};
  _historicoListaAtual = [];
  _historicoSelecionados.clear();

  const historicoList = document.getElementById('historicoList');
  const historicoTitulo = document.getElementById('historicoTitulo');
  if (historicoList) historicoList.innerHTML = '';
  if (historicoTitulo) historicoTitulo.textContent = 'Selecione um cliente para ver os atendimentos.';

  _atualizarResumoSelecaoHistorico();
  _renderResumoClienteHistorico(null, []);
}

function _removerClienteDaTela(clienteId) {
  delete _clientesPorId[clienteId];

  const clienteCard = document.getElementById('cliente-card-' + clienteId);
  if (clienteCard) clienteCard.remove();

  if (_clienteSelecionadoId === clienteId) {
    _limparPainelHistoricoCliente();
  }

  const listEl = document.getElementById('clientesList');
  if (listEl && !listEl.children.length) {
    listEl.innerHTML = '<div style="padding:12px;border:1px dashed var(--border);border-radius:6px;color:var(--gray);font-size:13px">Nenhum cliente cadastrado.</div>';
  }
}

function _removerHistoricoDaTela(clienteId, consultaId) {
  delete _historicoPorId[consultaId];
  _historicoListaAtual = (_historicoListaAtual || []).filter(h => h.id !== consultaId);
  _historicoSelecionados.delete(consultaId);

  const historicoCard = document.getElementById('historico-card-' + consultaId);
  if (historicoCard) historicoCard.remove();

  const cliente = _clientesPorId[clienteId];
  if (cliente) {
    cliente.total_consultas = Math.max(0, Number(cliente.total_consultas || 0) - 1);
    if (!cliente.total_consultas) {
      cliente.ultima_consulta = '';
    }
  }

  _atualizarResumoSelecaoHistorico();

  const listEl = document.getElementById('historicoList');
  if (listEl && !listEl.children.length) {
    listEl.innerHTML = '<div style="padding:12px;border:1px dashed var(--border);border-radius:6px;color:var(--gray);font-size:13px">Esse cliente ainda não possui atendimentos salvos.</div>';
  }
}

async function excluirUltimoOrcamentoCliente(clienteId) {
  const cli = _clientesPorId[clienteId];
  if (!cli) {
    toast('Cliente nao encontrado.');
    return;
  }

  try {
    const hist = await _ffApi('/api/clientes/' + clienteId + '/historico');
    const lista = hist.historico || [];
    if (!lista.length) {
      const okCli = window.confirm(
        'Esse cliente não possui orçamentos.\n\n' +
        'Deseja excluir o cadastro do cliente mesmo assim?'
      );
      if (!okCli) return;

      await _ffApi('/api/clientes/' + clienteId, { method: 'DELETE' });
      _removerClienteDaTela(clienteId);
      toast('Cliente excluído com sucesso.');
      carregarClientes();
      return;
    }

    const ultimo = lista[0];
    const when = _fmtDataHora(ultimo.created_at);
    const ok = window.confirm(
      'Excluir o último orçamento de ' + (cli.nome || 'cliente') + '?\n\n' +
      'Data: ' + when + '\n' +
      'Contexto: ' + (ultimo.contexto || '-') + '\n\n' +
      'Essa ação não pode ser desfeita.'
    );
    if (!ok) return;

    await _ffApi('/api/consultas/' + ultimo.id, { method: 'DELETE' });
    _removerHistoricoDaTela(clienteId, ultimo.id);
    toast('Último orçamento excluído com sucesso.');

    carregarClientes();
    if (_clienteSelecionadoId === clienteId) {
      carregarHistoricoCliente(clienteId);
    }
  } catch (err) {
    toast(err.message || 'Erro ao excluir o orçamento.');
  }
}

async function atualizarStatusHistorico(consultaId, novoStatus) {
  const item = _historicoPorId[consultaId];
  if (!item || !_clienteHistoricoAtual) return;
  try {
    await _ffApi('/api/consultas/' + consultaId, {
      method: 'PUT',
      body: JSON.stringify({
        cliente: {
          nome: _clienteHistoricoAtual.nome || '',
          telefone: _clienteHistoricoAtual.telefone || '',
          status: novoStatus,
          observacoes: _clienteHistoricoAtual.observacoes || ''
        },
        consulta: {
          contexto: item.contexto || '',
          status: novoStatus,
          data_orcamento: item.data_orcamento || '',
          validade: item.validade || '',
          preco: Number(item.preco) || 0,
          desconto: Number(item.desconto) || 0,
          total: Number(item.total) || 0,
          detalhes: item.detalhes || '',
          observacoes: item.observacoes || '',
          pagamentos: item.pagamentos || [],
          config: item.config || {},
          imagem_preview: item.imagem_preview || '',
        }
      })
    });
    item.status = novoStatus;
    _clienteHistoricoAtual.status = novoStatus;
    if (_clienteSelecionadoId) {
      carregarClientes();
      carregarHistoricoCliente(_clienteSelecionadoId);
    }
    toast('Status do atendimento atualizado.');
  } catch (err) {
    toast(err.message || 'Erro ao atualizar status do atendimento.');
  }
}

function _statusCor(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'finalizado') return '#2E7D52';
  if (s === 'aguardando') return '#B26A00';
  if (s === 'em andamento') return '#1A3051';
  return '#666';
}

function sincronizarFiltroStatusClientes() {
  const statusEdicao = document.getElementById('cliStatus')?.value || '';
  const filtro = document.getElementById('clienteStatusFiltro');
  if (filtro) filtro.value = statusEdicao;
  carregarClientes();
}

function limparFiltrosHistorico() {
  const busca = document.getElementById('historicoBusca');
  const tipo = document.getElementById('historicoTipoFiltro');
  const status = document.getElementById('historicoStatusFiltro');
  const periodo = document.getElementById('historicoPeriodoFiltro');
  if (busca) busca.value = '';
  if (tipo) tipo.value = '';
  if (status) status.value = '';
  if (periodo) periodo.value = '';
  if (_clienteSelecionadoId) carregarHistoricoCliente(_clienteSelecionadoId);
}

function _filtrosHistoricoAtuais() {
  return {
    busca: (document.getElementById('historicoBusca')?.value || '').trim().toLowerCase(),
    tipo: (document.getElementById('historicoTipoFiltro')?.value || '').toLowerCase(),
    status: (document.getElementById('historicoStatusFiltro')?.value || '').toLowerCase(),
    periodo: parseInt(document.getElementById('historicoPeriodoFiltro')?.value || '0', 10) || 0,
  };
}

function _ehNoPeriodo(isoData, dias) {
  if (!dias) return true;
  const dt = new Date(isoData);
  if (Number.isNaN(dt.getTime())) return false;
  const limite = new Date();
  limite.setHours(0, 0, 0, 0);
  limite.setDate(limite.getDate() - dias);
  return dt >= limite;
}

function _renderResumoClienteHistorico(cliente, hist) {
  const kpiUltimoContato = document.getElementById('kpiUltimoContato');
  const kpiProximaAcao = document.getElementById('kpiProximaAcao');
  const kpiTotalFechado = document.getElementById('kpiTotalFechado');
  const kpiTicketMedio = document.getElementById('kpiTicketMedio');
  if (!kpiUltimoContato || !kpiProximaAcao || !kpiTotalFechado || !kpiTicketMedio) return;

  if (!cliente || !(hist || []).length) {
    kpiUltimoContato.textContent = '-';
    kpiProximaAcao.textContent = '-';
    kpiTotalFechado.textContent = _fmtMoeda(0);
    kpiTicketMedio.textContent = _fmtMoeda(0);
    return;
  }

  const lista = [...hist];
  const ultimo = lista[0];
  const emAndamento = lista.filter(h => String(h.status || '').toLowerCase() === 'em andamento').length;
  const aguardando = lista.filter(h => String(h.status || '').toLowerCase() === 'aguardando').length;
  const finalizados = lista.filter(h => String(h.status || '').toLowerCase() === 'finalizado');

  const totalFechado = finalizados.reduce((acc, h) => {
    const bruto = Number(h.preco) || 0;
    const desconto = Number(h.desconto) || 0;
    const total = Number(h.total) || Math.max(0, bruto - desconto);
    return acc + total;
  }, 0);
  const ticketMedio = finalizados.length ? totalFechado / finalizados.length : 0;

  kpiUltimoContato.textContent = _fmtDataHora(ultimo.created_at);
  if (emAndamento > 0) kpiProximaAcao.textContent = 'Retornar atendimentos em andamento';
  else if (aguardando > 0) kpiProximaAcao.textContent = 'Fazer follow-up dos aguardando';
  else kpiProximaAcao.textContent = 'Sem pendências no momento';
  kpiTotalFechado.textContent = _fmtMoeda(totalFechado);
  kpiTicketMedio.textContent = _fmtMoeda(ticketMedio);
}

function _aplicarFiltrosHistorico(hist) {
  const filtros = _filtrosHistoricoAtuais();
  return (hist || []).filter(h => {
    if (filtros.tipo && String(h.contexto || '').toLowerCase() !== filtros.tipo) return false;
    if (filtros.status && String(h.status || '').toLowerCase() !== filtros.status) return false;
    if (filtros.periodo && !_ehNoPeriodo(h.created_at, filtros.periodo)) return false;
    if (filtros.busca) {
      const alvo = [
        h.detalhes,
        h.observacoes,
        h.contexto,
        h.status,
        h.validade,
        _fmtDataHora(h.created_at),
      ].join(' ').toLowerCase();
      if (!alvo.includes(filtros.busca)) return false;
    }
    return true;
  });
}

async function carregarClientes() {
  const listEl = document.getElementById('clientesList');
  if (!listEl) return;
  try {
    const busca = document.getElementById('clienteBusca')?.value.trim() || '';
    const statusFiltro = document.getElementById('clienteStatusFiltro')?.value || '';
    const out = await _ffApi('/api/clientes' + (busca ? ('?q=' + encodeURIComponent(busca)) : ''));
    let clientes = out.clientes || [];
    if (statusFiltro) {
      clientes = clientes.filter(c => (c.status || '') === statusFiltro);
    }
    _clientesPorId = {};
    clientes.forEach(c => { _clientesPorId[c.id] = c; });
    if (!clientes.length) {
      listEl.innerHTML = '<div style="padding:12px;border:1px dashed var(--border);border-radius:6px;color:var(--gray);font-size:13px">Nenhum cliente cadastrado.</div>';
      document.getElementById('historicoList').innerHTML = '';
      document.getElementById('historicoTitulo').textContent = 'Selecione um cliente para ver os atendimentos.';
      _renderResumoClienteHistorico(null, []);
      return;
    }

    listEl.innerHTML = clientes.map(c => {
      const ativo = _clienteSelecionadoId === c.id;

      function _badge(val, label) {
        const sel = (c.status || 'em andamento') === val;
        const cor = _statusCor(val);
        const bg = sel ? cor : 'transparent';
        const textColor = sel ? '#fff' : cor;
        return '<span onclick="atualizarStatusCliente(' + c.id + ',\'' + val + '\')" ' +
          'style="display:inline-block;padding:3px 8px;border-radius:20px;font-size:10px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;cursor:pointer;' +
          'background:' + bg + ';color:' + textColor + ';border:1.5px solid ' + cor + '">' +
          label + '</span>';
      }

      return (
        '<div id="cliente-card-' + c.id + '" style="border:1px solid ' + (ativo ? 'var(--gold)' : 'var(--border2)') + ';background:#fff;border-radius:8px;padding:10px">' +
          '<div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">' +
            '<div>' +
              '<div style="font-size:14px;color:var(--brown);font-weight:700">' + _esc(c.nome) + '</div>' +
              '<div style="font-size:12px;color:var(--gray)">📱 ' + _esc(c.telefone || '-') + '</div>' +
              '<div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:7px">' +
                _badge('em andamento', 'Em andamento') +
                _badge('aguardando', 'Aguardando') +
                _badge('finalizado', 'Finalizado') +
              '</div>' +
            '</div>' +
            '<div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">' +
              '<button title="Editar cliente" aria-label="Editar cliente" style="width:30px;height:30px;border-radius:999px;border:1px solid var(--border2);background:#fff;color:var(--brown);font-size:13px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;padding:0" onclick="editarCliente(' + c.id + ')">✏️</button>' +
              '<button title="Ver histórico" aria-label="Ver histórico" style="width:30px;height:30px;border-radius:999px;border:1px solid ' + (ativo ? 'var(--gold)' : 'var(--border2)') + ';background:' + (ativo ? 'var(--gold)' : '#fff') + ';color:' + (ativo ? '#fff' : 'var(--brown)') + ';font-size:13px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;padding:0" onclick="selecionarCliente(' + c.id + ')">👁</button>' +
              '<button title="Excluir último orçamento ou cliente" aria-label="Excluir último orçamento ou cliente" style="width:30px;height:30px;border-radius:999px;border:1px solid #E7D9D9;background:#fff;color:#B22222;font-size:13px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;padding:0" onclick="excluirUltimoOrcamentoCliente(' + c.id + ')">🗑</button>' +
            '</div>' +
          '</div>' +
          '<div style="margin-top:8px;font-size:11px;color:var(--gray)">Pedidos: ' + (c.total_consultas || 0) + (c.ultima_consulta ? (' • Último: ' + _fmtDataHora(c.ultima_consulta)) : '') + '</div>' +
        '</div>'
      );
    }).join('');

    if (_clienteSelecionadoId) {
      const existe = clientes.some(c => c.id === _clienteSelecionadoId);
      if (existe) carregarHistoricoCliente(_clienteSelecionadoId);
    }
  } catch (err) {
    listEl.innerHTML = '<div style="padding:12px;border:1px solid #E6B8B8;background:#FFF5F5;border-radius:6px;color:#8A1F1F;font-size:13px">' + _esc(err.message || 'Erro ao carregar clientes.') + '</div>';
  }
}

async function selecionarCliente(clienteId) {
  _clienteSelecionadoId = clienteId;
  carregarClientes();
  carregarHistoricoCliente(clienteId);
}

async function carregarHistoricoCliente(clienteId) {
  const tituloEl = document.getElementById('historicoTitulo');
  const listEl = document.getElementById('historicoList');
  if (!tituloEl || !listEl) return;

  try {
    const out = await _ffApi('/api/clientes/' + clienteId + '/historico');
    const cliente = out.cliente;
    const hist = out.historico || [];
    const histFiltrado = _aplicarFiltrosHistorico(hist);
    _clienteHistoricoAtual = cliente;
    _historicoListaAtual = histFiltrado;
    _historicoPorId = {};
    hist.forEach(h => { _historicoPorId[h.id] = h; });
    _normalizarSelecaoHistorico(histFiltrado);

    _renderResumoClienteHistorico(cliente, hist);

    tituloEl.textContent = cliente.nome + ' • ' + (cliente.telefone || 'sem telefone') + ' • status: ' + (cliente.status || 'novo');
    if (!hist.length) {
      _historicoSelecionados.clear();
      _atualizarResumoSelecaoHistorico();
      listEl.innerHTML = '<div style="padding:12px;border:1px dashed var(--border);border-radius:6px;color:var(--gray);font-size:13px">Esse cliente ainda não possui atendimentos salvos.</div>';
      return;
    }

    if (!histFiltrado.length) {
      _historicoSelecionados.clear();
      _atualizarResumoSelecaoHistorico();
      listEl.innerHTML = '<div style="padding:12px;border:1px dashed var(--border);border-radius:6px;color:var(--gray);font-size:13px">Nenhum atendimento encontrado com os filtros atuais.</div>';
      return;
    }

    listEl.innerHTML = histFiltrado.map(h => {
      const pagamentos = (h.pagamentos || []).map(_esc).join(' • ');
      const img = h.imagem_preview ? ('<img src="' + h.imagem_preview + '" alt="preview" style="width:100%;max-width:220px;border:1px solid var(--border2);border-radius:6px;display:block;margin-top:8px">') : '';
      const checkedAttr = _historicoSelecionados.has(h.id) ? 'checked' : '';
      const status = String(h.status || 'em andamento');
      const preco = Number(h.preco) || 0;
      const desconto = Number(h.desconto) || 0;
      const total = Number(h.total) || Math.max(0, preco - desconto);
      const badgeStatus = (valor, label) => {
        const cor = _statusCor(valor);
        const selecionado = status === valor;
        return '<span onclick="atualizarStatusHistorico(' + h.id + ',\'' + valor + '\')" style="display:inline-block;padding:4px 8px;border-radius:999px;background:' + (selecionado ? cor : 'transparent') + ';color:' + (selecionado ? '#fff' : cor) + ';border:1px solid ' + cor + ';font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;cursor:pointer">' + label + '</span>';
      };
      const valoresHtml = desconto > 0
        ? ('<div style="margin-top:8px;font-size:11px;color:var(--gray);line-height:1.6">' +
            '<div><strong>Valor:</strong> ' + _esc(_fmtMoeda(preco)) + '</div>' +
            '<div><strong>Desconto aplicado:</strong> - ' + _esc(_fmtMoeda(desconto)) + '</div>' +
            '<div style="color:var(--brown);font-weight:700"><strong>Total com desconto:</strong> ' + _esc(_fmtMoeda(total)) + '</div>' +
          '</div>')
        : ('<div style="margin-top:8px;font-size:11px;color:var(--brown);font-weight:700"><strong>Valor:</strong> ' + _esc(_fmtMoeda(preco)) + '</div>');
      return (
        '<div id="historico-card-' + h.id + '" style="border:1px solid var(--border2);border-radius:8px;padding:12px;background:#fff;position:relative">' +
          '<div style="position:absolute;left:-1px;top:12px;bottom:12px;width:4px;border-radius:4px;background:' + _statusCor(status) + '"></div>' +
          '<div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap">' +
            '<label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--gray);cursor:pointer">' +
              '<input type="checkbox" data-historico-id="' + h.id + '" ' + checkedAttr + ' onchange="toggleSelecaoHistorico(' + h.id + ', this.checked)" style="accent-color:var(--gold)">' +
              '<span>' + _fmtDataHora(h.created_at) + '</span>' +
            '</label>' +
            '<div style="display:flex;align-items:center;gap:8px">' +
              '<div style="font-size:11px;color:var(--gray);font-weight:700;text-transform:uppercase">' + _esc(h.contexto || '-') + '</div>' +
              '<button class="btn dark" style="padding:6px 10px;font-size:11px" onclick="editarAtendimentoHistorico(' + h.id + ')">Editar</button>' +
            '</div>' +
          '</div>' +
          '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">' +
            badgeStatus('em andamento', 'Em andamento') +
            badgeStatus('aguardando', 'Aguardando') +
            badgeStatus('finalizado', 'Finalizado') +
          '</div>' +
          '<div style="font-size:11px;color:var(--gray);margin-top:4px">Validade: ' + _esc(h.validade || '-') + '</div>' +
          '<div style="margin-top:8px;font-size:12px;color:var(--brown);line-height:1.6;white-space:pre-line">' + _esc(h.detalhes || '-') + '</div>' +
          valoresHtml +
          '<div style="margin-top:8px;font-size:11px;color:var(--gray)"><strong>Pagamento:</strong> ' + (pagamentos || '-') + '</div>' +
          (h.observacoes ? ('<div style="margin-top:4px;font-size:11px;color:var(--gray)"><strong>Obs:</strong> ' + _esc(h.observacoes) + '</div>') : '') +
          img +
        '</div>'
      );
    }).join('');
    _atualizarResumoSelecaoHistorico();
  } catch (err) {
    _historicoListaAtual = [];
    _historicoSelecionados.clear();
    _atualizarResumoSelecaoHistorico();
    _renderResumoClienteHistorico(null, []);
    listEl.innerHTML = '<div style="padding:12px;border:1px solid #E6B8B8;background:#FFF5F5;border-radius:6px;color:#8A1F1F;font-size:13px">' + _esc(err.message || 'Erro ao carregar historico.') + '</div>';
  }
}

function _usuarioPodeGerenciar() {
  return Boolean(_usuarioAtual && _usuarioAtual.role === 'admin');
}

function _normalizarLoginUsuario(login) {
  return String(login || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '');
}

function cancelarEdicaoUsuario() {
  _usuarioEdicaoId = null;
  const title = document.getElementById('userFormTitle');
  const displayName = document.getElementById('userDisplayName');
  const username = document.getElementById('userUsername');
  const password = document.getElementById('userPassword');
  const role = document.getElementById('userRole');
  const active = document.getElementById('userActive');
  const hint = document.getElementById('userFormHint');
  const cancelBtn = document.getElementById('userCancelBtn');

  if (title) title.textContent = 'Nova Unidade';
  if (displayName) displayName.value = '';
  if (username) {
    username.value = '';
    username.disabled = false;
    username.style.opacity = '1';
  }
  if (password) password.value = '';
  if (role) role.value = 'user';
  if (active) active.value = '1';
  if (hint) hint.textContent = 'Cada unidade usa um login próprio. Em edição, deixe a senha em branco para manter a atual.';
  if (cancelBtn) cancelBtn.style.display = 'none';
}

function editarUsuarioSistema(userId) {
  const user = _usuariosSistemaPorId[userId];
  if (!user) {
    toast('Unidade nao encontrada.');
    return;
  }

  _usuarioEdicaoId = userId;
  const title = document.getElementById('userFormTitle');
  const displayName = document.getElementById('userDisplayName');
  const username = document.getElementById('userUsername');
  const password = document.getElementById('userPassword');
  const role = document.getElementById('userRole');
  const active = document.getElementById('userActive');
  const hint = document.getElementById('userFormHint');
  const cancelBtn = document.getElementById('userCancelBtn');

  if (title) title.textContent = 'Editar Unidade';
  if (displayName) displayName.value = user.name || user.display_name || '';
  if (username) {
    username.value = user.access_username || '';
    username.disabled = true;
    username.style.opacity = '.7';
  }
  if (password) password.value = '';
  if (role) role.value = user.access_role || 'user';
  if (active) active.value = user.is_active ? '1' : '0';
  if (hint) hint.textContent = 'O login principal da unidade nao pode ser alterado. Preencha a senha apenas se quiser trocar a atual.';
  if (cancelBtn) cancelBtn.style.display = 'inline-flex';
}

async function carregarUsuariosSistema() {
  const listEl = document.getElementById('usersList');
  if (!listEl || !_usuarioPodeGerenciar()) return;

  listEl.innerHTML = '<div style="padding:12px;border:1px dashed var(--border);border-radius:6px;color:var(--gray);font-size:13px">Carregando unidades...</div>';

  try {
    const out = await _ffApi('/api/stores');
    const users = out.stores || [];
    _usuariosSistemaPorId = {};
    users.forEach(u => {
      _usuariosSistemaPorId[u.id] = u;
    });

    if (!users.length) {
      listEl.innerHTML = '<div style="padding:12px;border:1px dashed var(--border);border-radius:6px;color:var(--gray);font-size:13px">Nenhuma unidade cadastrada.</div>';
      return;
    }

    listEl.innerHTML = users.map(u => {
      const isCurrent = Boolean(_usuarioAtual && _usuarioAtual.store_id === u.id);
      const statusColor = u.is_active ? '#2E7D52' : '#B22222';
      const roleLabel = u.access_role === 'admin' ? 'Administrador' : 'Unidade';
      const statusLabel = u.is_active ? 'Ativa' : 'Inativa';
      const actionBtn = u.is_active
        ? '<button class="btn dark" style="padding:7px 10px;font-size:11px;background:#B22222;border-color:#B22222" onclick="desativarUsuarioSistema(' + u.id + ')"' + (isCurrent ? ' disabled' : '') + '>Desativar</button>'
        : '<button class="btn dark" style="padding:7px 10px;font-size:11px;background:#2E7D52;border-color:#2E7D52" onclick="ativarUsuarioSistema(' + u.id + ')">Ativar</button>';
      const deleteBtn = '<button class="btn dark" style="padding:7px 10px;font-size:11px;background:#7A1B1B;border-color:#7A1B1B" onclick="excluirUsuarioSistema(' + u.id + ')"' + (isCurrent ? ' disabled' : '') + '>Excluir</button>';

      return (
        '<div style="border:1px solid var(--border2);border-radius:8px;background:#fff;padding:12px">' +
          '<div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap">' +
            '<div>' +
              '<div style="font-size:14px;color:var(--brown);font-weight:700">' + _esc(u.name || u.access_display_name || u.access_username) + (isCurrent ? ' <span style="font-size:11px;color:var(--gray)">(unidade atual)</span>' : '') + '</div>' +
              '<div style="font-size:12px;color:var(--gray);margin-top:2px">@' + _esc(u.access_username || '-') + '</div>' +
              '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">' +
                '<span style="display:inline-flex;align-items:center;padding:4px 8px;border-radius:999px;font-size:10px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;background:' + (u.access_role === 'admin' ? 'rgba(36,73,126,.12)' : 'rgba(26,48,81,.08)') + ';color:' + (u.access_role === 'admin' ? '#24497E' : '#1A3051') + '">' + roleLabel + '</span>' +
                '<span style="display:inline-flex;align-items:center;padding:4px 8px;border-radius:999px;font-size:10px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;background:transparent;color:' + statusColor + ';border:1px solid ' + statusColor + '">' + statusLabel + '</span>' +
              '</div>' +
            '</div>' +
            '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
              '<button class="btn dark" style="padding:7px 10px;font-size:11px" onclick="editarUsuarioSistema(' + u.id + ')">Editar</button>' +
              actionBtn +
              deleteBtn +
            '</div>' +
          '</div>' +
          '<div style="margin-top:8px;font-size:11px;color:var(--gray)">Clientes: ' + (u.total_clientes || 0) + ' • Atendimentos: ' + (u.total_consultas || 0) + '</div>' +
        '</div>'
      );
    }).join('');
  } catch (err) {
    listEl.innerHTML = '<div style="padding:12px;border:1px solid #E6B8B8;background:#FFF5F5;border-radius:6px;color:#8A1F1F;font-size:13px">' + _esc(err.message || 'Erro ao carregar unidades.') + '</div>';
  }
}

// ─────────────────────────────────────────────────────────
//  DASHBOARD DE MONITORAMENTO (admin)
// ─────────────────────────────────────────────────────────
function _fmtBrl(v) {
  return 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function _fmtDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch (_) { return iso; }
}

async function adminDashboardLoad() {
  const body = document.getElementById('adminDashBody');
  if (!body) return;
  body.innerHTML = '<tr><td colspan="12" style="padding:20px;text-align:center;color:var(--gray);font-size:12px">Carregando…</td></tr>';
  try {
    const out = await _ffApi('/api/admin/dashboard');
    const t = out.totals || {};
    const _set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    _set('dashTotalLojas', t.lojas ?? '—');
    _set('dashTotalClientes', t.clientes ?? '—');
    _set('dashTotalConsultas', t.consultas ?? '—');
    _set('dashTotalVendido', _fmtBrl(t.vendido));

    const stores = out.stores || [];
    if (!stores.length) {
      body.innerHTML = '<tr><td colspan="12" style="padding:20px;text-align:center;color:var(--gray);font-size:12px">Nenhuma unidade encontrada.</td></tr>';
      return;
    }

    body.innerHTML = stores.map(s => {
      const statusBadge = s.is_active
        ? '<span style="background:#EBF7F0;color:#2E7D52;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700">Ativo</span>'
        : '<span style="background:#FEF0E4;color:#A0520A;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700">Inativo</span>';
      return `<tr style="border-bottom:1px solid var(--border2);transition:background .15s" onmouseover="this.style.background='var(--cream2)'" onmouseout="this.style.background=''">
        <td style="padding:10px 6px;font-weight:600;color:var(--brown)">${_esc(s.store_name)}<br><span style="font-size:11px;color:var(--gray);font-weight:400">@${_esc(s.username)}</span></td>
        <td style="padding:10px 6px;text-align:center">${statusBadge}</td>
        <td style="padding:10px 6px;text-align:center;font-size:12px;color:var(--gray)">${_fmtDate(s.last_login_at)}</td>
        <td style="padding:10px 6px;text-align:center;font-weight:700">${s.login_count}</td>
        <td style="padding:10px 6px;text-align:center">${s.total_clientes}</td>
        <td style="padding:10px 6px;text-align:center">${s.total_consultas}</td>
        <td style="padding:10px 6px;text-align:center;color:#A0520A;font-weight:600">${s.em_andamento}</td>
        <td style="padding:10px 6px;text-align:center;color:#2E7D52;font-weight:600">${s.fechados}</td>
        <td style="padding:10px 6px;text-align:center">${s.catalog_items}</td>
        <td style="padding:10px 6px;text-align:center">${s.catalog_sims}</td>
        <td style="padding:10px 6px;text-align:right;font-weight:700;color:#2E7D52">${_fmtBrl(s.total_vendido)}</td>
        <td style="padding:10px 6px;text-align:right;color:var(--gray)">${_fmtBrl(s.ticket_medio)}</td>
      </tr>`;
    }).join('');
  } catch (err) {
    if (body) body.innerHTML = '<tr><td colspan="12" style="padding:16px;color:#8A1F1F;font-size:13px">' + _esc(err.message || 'Erro ao carregar dashboard.') + '</td></tr>';
  }
}

async function salvarUsuarioSistema() {
  if (!_usuarioPodeGerenciar()) return;

  const displayName = document.getElementById('userDisplayName')?.value.trim() || '';
  const usernameRaw = document.getElementById('userUsername')?.value || '';
  const username = _normalizarLoginUsuario(usernameRaw);
  const password = document.getElementById('userPassword')?.value || '';
  const role = document.getElementById('userRole')?.value || 'user';
  const isActive = (document.getElementById('userActive')?.value || '1') === '1';

  if (!displayName) {
    toast('Informe o nome da unidade.');
    return;
  }

  if (!_usuarioEdicaoId && username.length < 3) {
    toast('Informe um login com pelo menos 3 caracteres.');
    return;
  }

  if (!_usuarioEdicaoId && password.length < 6) {
    toast('A senha precisa ter pelo menos 6 caracteres.');
    return;
  }

  try {
    let out;
    if (_usuarioEdicaoId) {
      out = await _ffApi('/api/stores/' + _usuarioEdicaoId, {
        method: 'PUT',
        body: JSON.stringify({
          store_name: displayName,
          display_name: displayName,
          password,
          role,
          is_active: isActive,
        })
      });
      toast('Unidade atualizada com sucesso.');
    } else {
      out = await _ffApi('/api/stores', {
        method: 'POST',
        body: JSON.stringify({
          store_name: displayName,
          display_name: displayName,
          username,
          password,
          role,
          is_active: isActive,
        })
      });
      toast('Unidade criada com sucesso.');
    }

    if (out && out.store && _usuarioAtual && out.store.access_user_id === _usuarioAtual.id) {
      _usuarioAtual.store_id = out.store.id;
      _usuarioAtual.store_name = out.store.name;
      _usuarioAtual.display_name = out.store.access_display_name || _usuarioAtual.display_name;
      _usuarioAtual.role = out.store.access_role || _usuarioAtual.role;
      if (out.store.access_role !== 'admin') {
        window.location.reload();
        return;
      }
    }

    cancelarEdicaoUsuario();
    await carregarUsuariosSistema();
  } catch (err) {
    toast(err.message || 'Erro ao salvar unidade.');
  }
}

async function ativarUsuarioSistema(userId) {
  const user = _usuariosSistemaPorId[userId];
  if (!user) return;
  try {
    await _ffApi('/api/stores/' + userId, {
      method: 'PUT',
      body: JSON.stringify({
        store_name: user.name || user.access_display_name || user.access_username,
        display_name: user.access_display_name || user.name || user.access_username,
        role: user.access_role || 'user',
        is_active: true,
        password: '',
      })
    });
    toast('Unidade reativada.');
    await carregarUsuariosSistema();
  } catch (err) {
    toast(err.message || 'Erro ao ativar unidade.');
  }
}

async function desativarUsuarioSistema(userId) {
  const user = _usuariosSistemaPorId[userId];
  if (!user) return;
  const ok = window.confirm('Desativar a unidade ' + (user.name || user.access_display_name || user.access_username) + '?\n\nO login dessa unidade sera bloqueado, mas os dados permanecerao salvos.');
  if (!ok) return;

  try {
    await _ffApi('/api/stores/' + userId, { method: 'DELETE' });
    if (_usuarioEdicaoId === userId) cancelarEdicaoUsuario();
    toast('Unidade desativada.');
    await carregarUsuariosSistema();
  } catch (err) {
    toast(err.message || 'Erro ao desativar unidade.');
  }
}

async function excluirUsuarioSistema(userId) {
  const user = _usuariosSistemaPorId[userId];
  if (!user) return;

  const nome = (user.name || user.access_display_name || user.access_username || '').trim();
  const ok = window.confirm('EXCLUSAO DEFINITIVA da unidade "' + nome + '"?\n\nEsta acao apaga login, clientes, atendimentos, catalogo e simulacoes dessa unidade.\n\nEssa acao nao pode ser desfeita.');
  if (!ok) return;

  const okFinal = window.confirm('Confirmacao final: deseja realmente EXCLUIR PERMANENTEMENTE a unidade "' + nome + '"?');
  if (!okFinal) return;

  try {
    await _ffApi('/api/stores/' + userId + '/purge', { method: 'DELETE' });
    if (_usuarioEdicaoId === userId) cancelarEdicaoUsuario();
    toast('Unidade excluida permanentemente.');
    await carregarUsuariosSistema();
    if (typeof adminDashboardLoad === 'function') {
      await adminDashboardLoad();
    }
  } catch (err) {
    toast(err.message || 'Erro ao excluir unidade.');
  }
}

function editarAtendimentoHistorico(consultaId) {
  const item = _historicoPorId[consultaId];
  if (!item) {
    toast('Atendimento não encontrado no histórico.');
    return;
  }

  _consultaEditandoId = consultaId;
  const contexto = item.contexto || 'quadro';
  abrirOrcamento(contexto);

  // Atualiza título do modal para indicar modo edição
  const titulo = document.getElementById('orcModalTitulo');
  const subtitulo = document.getElementById('orcModalSubtitulo');
  const dica = document.getElementById('orcPreviewDica');
  const cvs = document.getElementById('orcPreviewCanvas');
  if (titulo) titulo.textContent = '✏️ Editando Atendimento';
  if (subtitulo) subtitulo.textContent = 'Salvar vai substituir o registro anterior';
  if (dica) dica.style.display = 'block';
  if (cvs) { cvs.style.cursor = 'pointer'; cvs.onclick = orcAbrirEditorQuadro; }

  const cfg = item.config || {};
  document.getElementById('orcCliente').value = _clienteHistoricoAtual?.nome || '';
  document.getElementById('orcTelefone').value = _clienteHistoricoAtual?.telefone || '';
  document.getElementById('orcStatus').value = item.status || _clienteHistoricoAtual?.status || 'em andamento';
  document.getElementById('orcData').value = item.data_orcamento || '';
  document.getElementById('orcValidade').value = item.validade || '';
  document.getElementById('orcPreco').value = item.preco || 0;
  document.getElementById('orcDesconto').value = item.desconto || 0;
  document.getElementById('orcObs').value = item.observacoes || '';

  if (cfg.modelo) document.getElementById('orcModelo').value = cfg.modelo;
  if (cfg.vidro) document.getElementById('orcVidro').value = cfg.vidro;
  if (cfg.fundo) document.getElementById('orcFundo').value = cfg.fundo;

  const pagamentos = item.pagamentos || [];
  document.getElementById('pgDinheiro').checked = pagamentos.includes('Dinheiro');
  document.getElementById('pgPix').checked = pagamentos.some(p => String(p).startsWith('PIX'));
  document.getElementById('pgDebito').checked = pagamentos.some(p => String(p).toLowerCase().includes('debito'));
  document.getElementById('pgParcelado').checked = pagamentos.some(p => String(p).toLowerCase().includes('parcelado'));

  if (cfg.tamanho && contexto === 'quadro') {
    _restaurarQuadroDaConsulta(item);
  }

  if (cfg.tamanho && contexto === 'ambiente') {
    _restaurarAmbienteDaConsulta(item);
  }

  const detEl = document.getElementById('orcDetalhes');
  if (detEl && item.detalhes) {
    detEl.textContent = item.detalhes;
  }

  if (item.imagem_preview) {
    const prevCvs = document.getElementById('orcPreviewCanvas');
    const img = new Image();
    img.onload = function() {
      const maxW = 320;
      const maxH = 150;
      const scale = Math.min(maxW / img.width, maxH / img.height, 1);
      prevCvs.width = Math.round(img.width * scale);
      prevCvs.height = Math.round(img.height * scale);
      const ctx = prevCvs.getContext('2d');
      ctx.clearRect(0, 0, prevCvs.width, prevCvs.height);
      ctx.drawImage(img, 0, 0, prevCvs.width, prevCvs.height);
    };
    img.src = item.imagem_preview;
  }

  // Vai direto para a simulacao com tudo restaurado para agilizar o fluxo de edicao.
  orcAbrirEditorQuadro();
  toast('Atendimento carregado. Simulacao pronta para editar o quadro.');
}

// Compatibilidade para chamadas antigas
function reaplicarAtendimento(consultaId) {
  editarAtendimentoHistorico(consultaId);
}

// Fecha modal e abre a aba de edição do quadro
function orcAbrirEditorQuadro() {
  if (_consultaEditandoId && _historicoPorId[_consultaEditandoId]) {
    const item = _historicoPorId[_consultaEditandoId];
    if (_orcContexto === 'ambiente') _restaurarAmbienteDaConsulta(item);
    else _restaurarQuadroDaConsulta(item);
  }
  const tabDestino = (_orcContexto === 'ambiente') ? 'simulador' : 'simquadro';
  // Mantem o ID da consulta em edicao para salvar com PUT ao voltar ao orcamento.
  fecharOrcamento(false);
  switchTab(tabDestino);
}

// Fechar modal clicando fora
document.addEventListener('DOMContentLoaded', function() {
  _roomInitCatalog();
  const roomModal=document.getElementById('roomNameModal');
  if(roomModal){
    roomModal.addEventListener('click', function(e){
      if(e.target===roomModal) fecharRoomNameModal();
    });
  }
  const roomDeleteModal=document.getElementById('roomDeleteModal');
  if(roomDeleteModal){
    roomDeleteModal.addEventListener('click', function(e){
      if(e.target===roomDeleteModal) fecharRoomDeleteModal();
    });
  }
  const roomNameInput=document.getElementById('roomNameInput');
  if(roomNameInput){
    roomNameInput.addEventListener('keydown', function(e){
      if(e.key==='Enter'){ e.preventDefault(); confirmarRoomNameModal(); }
      if(e.key==='Escape'){ e.preventDefault(); fecharRoomNameModal(); }
    });
  }
  const orcModal = document.getElementById('orcModal');
  if (orcModal) {
    orcModal.addEventListener('click', function(e) {
      if (e.target === orcModal) fecharOrcamento();
    });
  }
  ffCatalogInit();
  ffCatalogRender();
  cancelarEdicaoUsuario();
  carregarUsuariosSistema();
  carregarClientes();
});