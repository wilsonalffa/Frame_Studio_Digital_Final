// static/assets/js/camera-sync.js

// ── Estilos do modal injetados via JS ─────────────────────
(function injectCameraSyncStyles() {
  const style = document.createElement('style');
  style.textContent = `
    /* ── Overlay / Modal ── */
    #cameraSyncModal {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(26,48,81,.72);
      z-index: 9999;
      align-items: center;
      justify-content: center;
      padding: 16px;
    }
    #cameraSyncModal.active { display: flex; }

    .csm-box {
      background: #fff;
      border-radius: 12px;
      box-shadow: 0 8px 40px rgba(26,48,81,.28);
      max-width: 520px;
      width: 100%;
      overflow: hidden;
      animation: csmIn .22s ease;
    }
    @keyframes csmIn {
      from { transform: scale(.94); opacity: 0; }
      to   { transform: scale(1);   opacity: 1; }
    }

    .csm-header {
      background: #1A3051;
      color: #1A3051;
      padding: 16px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-family: 'Raleway', sans-serif;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 1.5px;
      text-transform: uppercase;
    }
    .csm-header button {
      background: none;
      border: none;
      color: rgba(255,255,255,.7);
      font-size: 20px;
      cursor: pointer;
      line-height: 1;
      padding: 0 4px;
    }
    .csm-header button:hover { color: #fff; }

    .csm-preview {
      background: #111;
      display: flex;
      align-items: center;
      justify-content: center;
      max-height: 320px;
      overflow: hidden;
    }
    .csm-preview img {
      max-width: 100%;
      max-height: 320px;
      object-fit: contain;
      display: block;
    }

    .csm-meta {
      padding: 10px 20px;
      font-size: 12px;
      color: #666;
      border-bottom: 1px solid #eee;
    }

    .csm-body {
      padding: 18px 20px 22px;
    }

    .csm-save-btn {
      width: 100%;
      background: #B22222;
      color: #fff;
      border: none;
      border-radius: 8px;
      padding: 14px;
      font-family: 'Raleway', sans-serif;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 1px;
      text-transform: uppercase;
      cursor: pointer;
      transition: background .18s;
    }
    .csm-save-btn:hover { background: #8B0000; }

    /* ── Badge de nova foto no header ── */
    #syncBadge {
      display: none;
      position: fixed;
      top: 76px;
      right: 20px;
      background: #B22222;
      color: #fff;
      border-radius: 20px;
      padding: 7px 16px;
      font-size: 12px;
      font-weight: 700;
      font-family: 'Raleway', sans-serif;
      cursor: pointer;
      z-index: 8000;
      box-shadow: 0 3px 14px rgba(178,34,34,.35);
      animation: badgePulse 1.8s ease infinite;
    }
    @keyframes badgePulse {
      0%,100% { box-shadow: 0 3px 14px rgba(178,34,34,.35); }
      50%      { box-shadow: 0 3px 22px rgba(178,34,34,.65); }
    }
    #syncBadge.visible { display: block; }

    #cameraLaunchBtn {
      width: 36px;
      height: 36px;
      padding: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: #F0F4FA;
      color: #1A3051;
      border: 1px solid #C9D8EA;
      border-radius: 50%;
      font-weight: 700;
      font-family: 'Raleway', sans-serif;
      cursor: pointer;
      transition: transform .15s ease, box-shadow .15s ease, background .15s ease;
    }
    #cameraLaunchBtn svg {
      width: 18px;
      height: 18px;
      display: block;
      stroke: currentColor;
      fill: none;
      stroke-width: 1.8;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    #cameraLaunchBtn:hover {
      background: #E4ECF7;
      box-shadow: 0 6px 14px rgba(26,48,81,.16);
      transform: translateY(-1px);
    }

    #cameraAccessModal {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(26,48,81,.74);
      z-index: 9998;
      align-items: center;
      justify-content: center;
      padding: 18px;
    }
    #cameraAccessModal.active { display: flex; }

    .cam-access-box {
      width: 100%;
      max-width: 430px;
      background: #fff;
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 18px 48px rgba(26,48,81,.32);
    }
    .cam-access-head {
      background: linear-gradient(135deg, #1A3051, #24497E);
      color: #fff;
      padding: 16px 18px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    .cam-access-head strong {
      display: block;
      font-size: 14px;
      letter-spacing: .7px;
      text-transform: uppercase;
      font-family: 'Raleway', sans-serif;
    }
    .cam-access-head span {
      display: block;
      font-size: 12px;
      color: rgba(255,255,255,.82);
      margin-top: 4px;
    }
    .cam-access-close {
      background: none;
      border: none;
      color: rgba(255,255,255,.8);
      font-size: 24px;
      cursor: pointer;
      line-height: 1;
    }
    .cam-access-close:hover { color: #fff; }
    .cam-access-body {
      padding: 20px;
      text-align: center;
    }
    .cam-access-body p {
      margin: 0 0 14px;
      font-size: 13px;
      color: #5B6574;
      line-height: 1.6;
    }
    #cameraQrWrap {
      width: 240px;
      height: 240px;
      margin: 0 auto 14px;
      border-radius: 18px;
      background: linear-gradient(180deg, #F8FAFD, #EEF3FA);
      border: 1px solid #D7E1F0;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
    }
    #cameraQrWrap img,
    #cameraQrWrap canvas {
      max-width: 100%;
      height: auto;
      display: block;
    }
    #cameraLinkField {
      width: 100%;
      border: 1px solid #CBD6E5;
      border-radius: 10px;
      padding: 11px 12px;
      font-size: 12px;
      color: #1A3051;
      background: #F8FAFD;
      margin-bottom: 10px;
    }
    .cam-access-actions {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin-top: 10px;
    }
    .cam-access-btn {
      border: 0;
      border-radius: 10px;
      padding: 12px 14px;
      font-size: 12px;
      font-weight: 700;
      font-family: 'Raleway', sans-serif;
      letter-spacing: .5px;
      cursor: pointer;
    }
    .cam-access-btn.primary {
      background: #B22222;
      color: #fff;
    }
    .cam-access-btn.secondary {
      background: #E7EEF8;
      color: #1F3F69;
      border: 1px solid #AFC2DB;
    }
    .cam-access-note {
      margin-top: 12px;
      font-size: 11px;
      color: #708099;
    }

    @media (max-width: 900px) {
      #cameraLaunchBtn { display: none; }
    }
  `;
  document.head.appendChild(style);
})();

// ── Classe principal ───────────────────────────────────────
class CameraSync {
  constructor() {
    this.socket = null;
    this.isConnected = false;
    this.mobileCount = 0;
    this.incomingFrames = [];
    this._modalReady = false;
    this.cameraUrl = `${window.location.origin}/camera`;
    this.qrCode = null;
  }

  // ── WebSocket ──────────────────────────────────────────
  connect() {
    this.socket = io('/', {
      query: { device: 'desktop' },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 5,
    });

    this.socket.on('connect', () => {
      this.isConnected = true;
      this.updateSyncStatus();
    });

    this.socket.on('disconnect', () => {
      this.isConnected = false;
      this.mobileCount = 0;
      this.updateSyncStatus();
    });

    this.socket.on('new_frame', (data) => this.handleNewFrame(data));

    this.socket.on('camera_presence', (data) => {
      this.mobileCount = Number(data && data.mobile_count) || 0;
      this.updateSyncStatus();
    });

    this.socket.on('error', () => {
      this.isConnected = false;
      this.mobileCount = 0;
      this.updateSyncStatus();
    });
  }

  // ── Recebe nova foto ───────────────────────────────────
  handleNewFrame(data) {
    console.log('📸 Nova imagem recebida:', data);
    this.incomingFrames.push(data);
    this._ensureModal();
    this.openModal(data);
  }

  // ── Garante que o modal está no DOM ───────────────────
  _ensureModal() {
    if (this._modalReady) return;
    this._modalReady = true;

    const el = document.createElement('div');
    el.id = 'cameraSyncModal';
    el.innerHTML = `
      <div class="csm-box">
        <div class="csm-header">
          <span>📸 Foto recebida do celular</span>
          <button onclick="cameraSync.closeModal()" title="Fechar">✕</button>
        </div>
        <div class="csm-preview">
          <img id="csmPreviewImg" src="" alt="preview">
        </div>
        <div class="csm-meta" id="csmMeta"></div>
        <div class="csm-body">
          <button class="csm-save-btn" onclick="cameraSync.saveToCatalog()">
            📁 Salvar no Catálogo — pasta Câmera
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(el);

    // Fecha ao clicar fora do box
    el.addEventListener('click', (e) => {
      if (e.target === el) this.closeModal();
    });

    // Badge flutuante no canto
    const badge = document.createElement('div');
    badge.id = 'syncBadge';
    badge.textContent = '📸 Nova foto do celular';
    badge.addEventListener('click', () => {
      const frame = this.incomingFrames[this.incomingFrames.length - 1];
      if (frame) this.openModal(frame);
    });
    document.body.appendChild(badge);
  }

  _ensureLauncher() {
    if (document.getElementById('cameraLaunchBtn')) return;
    const host = document.querySelector('header .hinner > div:last-child') || document.querySelector('header .hinner');
    if (!host) return;

    const btn = document.createElement('button');
    btn.id = 'cameraLaunchBtn';
    btn.type = 'button';
    btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z"></path><circle cx="12" cy="13" r="4"></circle></svg>';
    btn.title = 'Abrir câmera no celular';
    btn.setAttribute('aria-label', 'Abrir câmera no celular');
    btn.addEventListener('click', () => this.openCameraAccess());
    host.prepend(btn);
  }

  _ensureCameraAccessModal() {
    if (document.getElementById('cameraAccessModal')) return;

    const modal = document.createElement('div');
    modal.id = 'cameraAccessModal';
    modal.innerHTML = `
      <div class="cam-access-box">
        <div class="cam-access-head">
          <div>
            <strong>Abra a câmera no celular</strong>
            <span>Escaneie o QR Code ou envie o link</span>
          </div>
          <button class="cam-access-close" type="button" onclick="cameraSync.closeCameraAccess()" aria-label="Fechar">✕</button>
        </div>
        <div class="cam-access-body">
          <p>Use o mesmo login no celular. Ao abrir o link, a página já entra direto na câmera.</p>
          <div id="cameraQrWrap"></div>
          <input id="cameraLinkField" type="text" readonly>
          <div class="cam-access-actions">
            <button class="cam-access-btn primary" type="button" onclick="cameraSync.copyCameraLink()">Copiar link</button>
            <button class="cam-access-btn secondary" type="button" onclick="cameraSync.openCameraTab()">Abrir /camera</button>
          </div>
          <div class="cam-access-note">No iPhone use Safari. No Android use Chrome.</div>
        </div>
      </div>
    `;
    modal.addEventListener('click', (event) => {
      if (event.target === modal) this.closeCameraAccess();
    });
    document.body.appendChild(modal);
  }

  renderCameraQr() {
    this._ensureCameraAccessModal();
    const input = document.getElementById('cameraLinkField');
    const wrap = document.getElementById('cameraQrWrap');
    if (input) input.value = this.cameraUrl;
    if (!wrap) return;

    if (typeof QRCode === 'undefined') {
      wrap.innerHTML = '<div style="font-size:12px;color:#5B6574;line-height:1.5">QR Code indisponível agora.<br>Use o botão de copiar link.</div>';
      return;
    }

    if (!this.qrCode) {
      wrap.innerHTML = '';
      this.qrCode = new QRCode(wrap, {
        text: this.cameraUrl,
        width: 200,
        height: 200,
        colorDark: '#1A3051',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M,
      });
      return;
    }

    this.qrCode.makeCode(this.cameraUrl);
  }

  openCameraAccess() {
    this.renderCameraQr();
    const modal = document.getElementById('cameraAccessModal');
    if (modal) modal.classList.add('active');
  }

  closeCameraAccess() {
    const modal = document.getElementById('cameraAccessModal');
    if (modal) modal.classList.remove('active');
  }

  openCameraTab() {
    window.open(this.cameraUrl, '_blank', 'noopener');
  }

  async copyCameraLink() {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(this.cameraUrl);
      } else {
        const input = document.getElementById('cameraLinkField');
        if (input) {
          input.focus();
          input.select();
          document.execCommand('copy');
        }
      }
      toast('Link da câmera copiado.');
    } catch (err) {
      toast('Nao foi possivel copiar o link.');
    }
  }

    // ── Abre modal com a foto recebida ───────────────────
  openModal(data) {
    const modal = document.getElementById('cameraSyncModal');
    const img   = document.getElementById('csmPreviewImg');
    const meta  = document.getElementById('csmMeta');

    img.src = data.image_url;
    meta.textContent = `${data.width} × ${data.height}px  ·  Enviada às ${data.timestamp ? data.timestamp.slice(11,16) : '--:--'}`;

    modal.classList.add('active');
    document.getElementById('syncBadge').classList.remove('visible');
  }

  closeModal() {
    const modal = document.getElementById('cameraSyncModal');
    if (modal) modal.classList.remove('active');

    // Mostra badge se ainda houver frames na fila
    if (this.incomingFrames.length > 0) {
      const badge = document.getElementById('syncBadge');
      if (badge) badge.classList.add('visible');
    }
  }

  // ── Garante pasta "Câmera" no catálogo e retorna o id ─
  _ensureCameraFolder() {
    if (typeof ffCatalogInit === 'function') ffCatalogInit();
    const folders = (_ffCatalogData && _ffCatalogData.folders) || [];
    let folder = folders.find(f => String(f.name || '').toLowerCase() === 'câmera' ||
                                   String(f.name || '').toLowerCase() === 'camera');
    if (!folder) {
      folder = {
        id: _ffCatalogId('folder'),
        name: 'Câmera',
        createdAt: new Date().toISOString(),
      };
      _ffCatalogData.folders.push(folder);
    }
    return folder.id;
  }

  // ── Salva a foto no catálogo (pasta Câmera) ───────────
  saveToCatalog() {
    const frame = this.incomingFrames[this.incomingFrames.length - 1];
    if (!frame) return;

    try {
      const folderId = this._ensureCameraFolder();
      const now = new Date();
      const label = `Câmera ${now.toLocaleDateString('pt-BR')} ${now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;

      _ffCatalogData.items.push({
        id:         _ffCatalogId('item'),
        folderId,
        type:       'image',
        title:      label,
        tags:       'camera, mobile',
        sourceName: `frame_${frame.frame_id}.jpg`,
        src:        frame.image_url,
        createdAt:  now.toISOString(),
      });

      if (typeof _ffCatalogPersist === 'function') _ffCatalogPersist();
      if (typeof ffCatalogRender === 'function') ffCatalogRender();

      this.incomingFrames.pop();
      this.closeModal();

      const badge = document.getElementById('syncBadge');
      if (badge && this.incomingFrames.length === 0) badge.classList.remove('visible');

      toast('✅ Foto salva no catálogo — pasta Câmera');
    } catch (err) {
      toast('❌ Erro ao salvar no catálogo: ' + err.message);
      console.error(err);
    }
  }

  // ── Status no header ───────────────────────────────────
  updateSyncStatus() {
    let el = document.getElementById('syncStatus');
    if (!el) {
      el = document.createElement('div');
      el.id = 'syncStatus';
      el.style.cssText = 'display:none;font-size:11px;color:#B22222;font-weight:600;font-family:Raleway,sans-serif;margin-left:12px;';
      const header = document.querySelector('header');
      if (header) header.appendChild(el);
    }
    if (!this.isConnected || this.mobileCount < 1) {
      el.textContent = '';
      el.style.display = 'none';
      return;
    }

    const suffix = this.mobileCount === 1 ? 'celular conectado' : 'celulares conectados';
    el.textContent = `🟢 Câmera sincronizada • ${this.mobileCount} ${suffix}`;
    el.style.display = 'block';
  }

  disconnect() {
    if (this.socket) this.socket.disconnect();
    this.isConnected = false;
    this.mobileCount = 0;
    this.updateSyncStatus();
  }
}

// ── Inicialização global ───────────────────────────────────
const cameraSync = new CameraSync();

document.addEventListener('DOMContentLoaded', () => {
  cameraSync._ensureLauncher();
  cameraSync._ensureCameraAccessModal();
  cameraSync.connect();
});