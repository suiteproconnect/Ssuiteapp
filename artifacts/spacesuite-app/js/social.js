import { iconBack, iconClose, iconReaction, renderBrandWordmarkHtml } from './icons.js';

const SOCIAL_TABS = [
  ['feed', 'Estilo de Vida'],
  ['discover', 'Descubrir'],
  ['chat', 'Mensajes'],
  ['profile', 'Mi perfil'],
];

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char]);
}

function initials(value = '') {
  return String(value).trim().split(/\s+/).slice(0, 2).map((part) => part[0] || '').join('').toUpperCase() || 'S';
}

function formatTime(value) {
  const date = new Date(Number(value) || Date.now());
  return date.toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
}

function date18() {
  const date = new Date();
  date.setFullYear(date.getFullYear() - 18);
  return date.toISOString().slice(0, 10);
}

export class SocialController {
  constructor(mountEl, { user, initialTab = 'discover', onClose, onEnterRoom }) {
    this.mountEl = mountEl;
    this.user = user;
    this.tab = SOCIAL_TABS.some(([id]) => id === initialTab) ? initialTab : 'discover';
    this.onClose = onClose;
    this.onEnterRoom = onEnterRoom;
    this.profile = null;
    this.birthDate = '';
    this.profileReady = false;
    this.discoverProfiles = [];
    this.matches = [];
    this.blockedProfiles = [];
    this.posts = [];
    this.selectedPeer = null;
    this.messageLastId = 0;
    this.messages = [];
    this.revealedPosts = new Set();
    this.reportTarget = null;
    this.toastTimer = null;
    this.pollTimer = null;
    this.destroyed = false;
    this._renderShell();
    this._bindEvents();
    this._loadProfile();
  }

  _renderShell() {
    this.mountEl.innerHTML = `
      <section class="ss-social-page" aria-label="Estilo de Vida y conexiones">
        <header class="ss-social-header">
          <button class="ss-social-back" type="button" data-action="back" aria-label="Volver a mi espacio">${iconBack()}<span>Volver</span></button>
          <div class="ss-social-brand">${renderBrandWordmarkHtml()}</div>
          <span class="ss-adult-badge">18+</span>
        </header>
        <div class="ss-social-intro">
          <div>
            <p class="ss-kicker">TU ESPACIO SOCIAL</p>
            <h1>Vida y conexiones</h1>
            <p>Comparte momentos y encuentra hombres con intereses en común.</p>
          </div>
        </div>
        <nav class="ss-social-tabs" aria-label="Secciones sociales">
          ${SOCIAL_TABS.map(([id, label]) => `<button type="button" data-tab="${id}" class="${id === this.tab ? 'active' : ''}">${label}</button>`).join('')}
        </nav>
        <main class="ss-social-content" id="ss-social-content" tabindex="-1"></main>
        <div class="ss-social-toast" id="ss-social-toast" role="status" aria-live="polite"></div>
      </section>
    `;
    this.contentEl = this.mountEl.querySelector('#ss-social-content');
    this.toastEl = this.mountEl.querySelector('#ss-social-toast');
  }

  _bindEvents() {
    this.mountEl.addEventListener('click', (event) => {
      const tab = event.target.closest('[data-tab]')?.getAttribute('data-tab');
      if (tab) {
        this._setTab(tab);
        return;
      }
      const button = event.target.closest('[data-action]');
      if (!button) return;
      const action = button.getAttribute('data-action');
      const userId = button.getAttribute('data-user-id') || '';
      const postId = button.getAttribute('data-post-id') || '';

      if (action === 'back') this.onClose?.();
      else if (action === 'edit-profile') this._setTab('profile');
      else if (action === 'back-chat') {
        this.selectedPeer = null;
        this._loadMatches();
      }
      else if (action === 'follow') this._follow(userId);
      else if (action === 'unfollow') this._unfollow(userId);
      else if (action === 'open-chat') {
        const peer = this._findProfile(userId);
        if (peer) this._openChat(peer);
      } else if (action === 'select-chat') {
        const peer = this.matches.find((item) => item.userId === userId);
        if (peer) this._openChat(peer);
      } else if (action === 'enter-room') {
        const code = button.getAttribute('data-room-code') || '';
        if (code) this.onEnterRoom?.(code, button.getAttribute('data-room-name') || '');
      } else if (action === 'like') this._toggleLike(postId);
      else if (action === 'delete-post') this._deletePost(postId);
      else if (action === 'reveal') {
        this.revealedPosts.add(postId);
        this._renderFeed();
      } else if (action === 'report') {
        this.reportTarget = {
          type: button.getAttribute('data-target-type') || 'user',
          id: button.getAttribute('data-target-id') || userId || postId,
        };
        this._renderContent();
      } else if (action === 'cancel-report') {
        this.reportTarget = null;
        this._renderContent();
      } else if (action === 'block') this._block(userId);
      else if (action === 'unblock') this._unblock(userId);
      else if (action === 'refresh') this._loadCurrent();
    });

    this.mountEl.addEventListener('input', (event) => {
      if (event.target.matches('[data-filter="discover"]')) this._applyDiscoverFilter(event.target.value);
    });

    this.mountEl.addEventListener('change', (event) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || !input.files?.[0]) return;
      if (input.dataset.file === 'avatar') this._previewFile(input.files[0], '#ss-avatar-preview');
      if (input.dataset.file === 'post') this._previewFile(input.files[0], '#ss-post-preview');
    });

    this.mountEl.addEventListener('submit', (event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      event.preventDefault();
      if (form.id === 'ss-profile-form') this._saveProfile(form);
      else if (form.id === 'ss-post-form') this._createPost(form);
      else if (form.id === 'ss-message-form') this._sendMessage(form);
      else if (form.id === 'ss-report-form') this._submitReport(form);
    });
  }

  async _api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: {
        ...(options.body instanceof Uint8Array ? {} : {}),
        Authorization: `Bearer ${this.user?.token || ''}`,
        ...(options.headers || {}),
      },
    });
    let result = {};
    try {
      result = await response.json();
    } catch {}
    if (response.status === 401) {
      this._toast('Tu sesión terminó. Vuelve a entrar a tu cuenta.');
      window.setTimeout(() => this.onClose?.(), 1200);
      throw new Error('La sesión terminó.');
    }
    if (!response.ok || result.ok === false) {
      throw new Error(result.error || 'No se pudo completar la solicitud.');
    }
    return result;
  }

  async _loadProfile() {
    this.contentEl.innerHTML = '<div class="ss-social-loading"><span class="ss-spinner"></span><p>Cargando tu espacio…</p></div>';
    try {
      const result = await this._api('/api/social?view=profile');
      this.profile = result.profile || null;
      this.birthDate = this.profile?.birthDate || result.birthDate || '';
      this.profileReady = Boolean(this.profile && this.profile.age >= 18);
      this._renderContent();
    } catch (error) {
      this._errorState(error.message);
    }
  }

  _setTab(tab) {
    if (!SOCIAL_TABS.some(([id]) => id === tab)) return;
    this.tab = tab;
    this.selectedPeer = tab === 'chat' ? this.selectedPeer : null;
    this._stopPolling();
    this.mountEl.querySelectorAll('[data-tab]').forEach((button) => {
      button.classList.toggle('active', button.getAttribute('data-tab') === tab);
    });
    this._loadCurrent();
  }

  _renderContent() {
    if (!this.profileReady) {
      this._renderProfileForm(true);
      return;
    }
    if (this.tab === 'feed') this._loadFeed();
    else if (this.tab === 'discover') this._loadDiscover();
    else if (this.tab === 'chat') this.selectedPeer ? this._renderChat() : this._loadMatches();
    else this._renderProfileForm(false);
  }

  _loadCurrent() {
    if (!this.profileReady) return this._renderProfileForm(true);
    this._renderContent();
  }

  _renderProfileForm(onboarding) {
    const profile = this.profile || {};
    this._stopPolling();
    this.contentEl.innerHTML = `
      <section class="ss-panel ss-profile-setup">
        <div class="ss-panel-title">
          <span class="ss-panel-mark">${iconReaction('heart')}</span>
          <div>
            <p class="ss-kicker">${onboarding ? 'ANTES DE EMPEZAR' : 'TU PERFIL SOCIAL'}</p>
            <h2>${onboarding ? 'Completa tu perfil' : 'Así te encuentran'}</h2>
            <p>${onboarding ? 'Esta comunidad es exclusiva para personas adultas.' : 'Actualiza lo que quieres compartir con la comunidad.'}</p>
          </div>
        </div>
        ${onboarding ? '<div class="ss-age-notice">Para usar el muro y las conexiones debes tener 18 años o más. La fecha de nacimiento no se muestra a otras personas.</div>' : ''}
        <form id="ss-profile-form" class="ss-form">
          <div class="ss-profile-photo-row">
            <div class="ss-avatar-preview" id="ss-avatar-preview">
              ${profile.avatarUrl ? `<img src="${escapeHtml(profile.avatarUrl)}" alt="Tu foto de perfil" />` : `<span>${escapeHtml(initials(profile.displayName || this.user?.name))}</span>`}
            </div>
            <label class="ss-file-control">Foto de perfil<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" data-file="avatar" /></label>
          </div>
          <div class="ss-form-grid">
            <label>Nombre para mostrar<input name="displayName" maxlength="32" required value="${escapeHtml(profile.displayName || this.user?.name || '')}" autocomplete="nickname" /></label>
            <label>Cómo te identificas
              <select name="gender" required>
                ${['Hombre', 'No binario', 'Mujer', 'Prefiero no decir'].map((value) => `<option ${profile.gender === value || (!profile.gender && value === 'Hombre') ? 'selected' : ''}>${value}</option>`).join('')}
              </select>
            </label>
            <label>Fecha de nacimiento<input name="birthDate" type="date" max="${date18()}" required value="${escapeHtml(profile.birthDate || this.birthDate)}" /></label>
            <label>Ciudad (opcional)<input name="city" maxlength="72" value="${escapeHtml(profile.city || '')}" placeholder="Ciudad o zona" /></label>
          </div>
          <label>Sobre ti<textarea name="bio" maxlength="280" rows="3" placeholder="Cuéntale a la comunidad qué te gusta">${escapeHtml(profile.bio || '')}</textarea></label>
          <label>Intereses, separados por coma<input name="interests" maxlength="240" value="${escapeHtml((profile.interests || []).join(', '))}" placeholder="Música, viajes, cocina…" /></label>
          <label class="ss-check"><input name="discoverable" type="checkbox" ${profile.discoverable === false ? '' : 'checked'} /><span>Aparecer en Descubrir</span></label>
          <div class="ss-form-actions">
            <button class="ss-primary" type="submit">Guardar perfil</button>
            ${!onboarding ? '<button class="ss-quiet" type="button" data-action="refresh">Cancelar cambios</button>' : ''}
          </div>
        </form>
      </section>
    `;
  }

  async _saveProfile(form) {
    const data = new FormData(form);
    const file = form.querySelector('[data-file="avatar"]')?.files?.[0];
    const submit = form.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;
    try {
      let avatarMediaId = this.profile?.avatarMediaId || null;
      if (file) {
        const uploaded = await this._upload(file, 'avatar');
        avatarMediaId = uploaded.id;
      }
      const result = await this._api('/api/social', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save-profile',
          displayName: data.get('displayName'),
          gender: data.get('gender'),
          birthDate: data.get('birthDate'),
          city: data.get('city'),
          bio: data.get('bio'),
          interests: String(data.get('interests') || '').split(','),
          avatarMediaId,
          discoverable: data.get('discoverable') === 'on',
        }),
      });
      this.profile = result.profile;
      this.birthDate = result.profile?.birthDate || '';
      this.profileReady = Boolean(this.profile && this.profile.age >= 18);
      this._toast('Perfil guardado');
      this._renderContent();
    } catch (error) {
      this._toast(error.message);
      if (submit) submit.disabled = false;
    }
  }

  async _loadFeed() {
    this.contentEl.innerHTML = '<div class="ss-social-loading"><span class="ss-spinner"></span><p>Cargando publicaciones…</p></div>';
    try {
      const result = await this._api('/api/social?view=feed');
      this.posts = Array.isArray(result.posts) ? result.posts : [];
      this._renderFeed();
    } catch (error) {
      this._errorState(error.message);
    }
  }

  _renderFeed() {
    const postsHtml = this.posts.length
      ? this.posts.map((post) => this._postCard(post)).join('')
      : '<div class="ss-empty"><span class="ss-empty-orbit"></span><h3>Aquí empieza tu muro</h3><p>Publica una foto, un video o un momento para abrir la conversación.</p></div>';
    this.contentEl.innerHTML = `
      <section class="ss-feed-layout">
        <div class="ss-feed-main">
          <form id="ss-post-form" class="ss-panel ss-compose">
            <div class="ss-compose-head"><div class="ss-avatar">${escapeHtml(initials(this.profile?.displayName))}</div><div><b>Comparte algo, ${escapeHtml(this.profile?.displayName || 'amigo')}</b><small>Fotos y videos con personas adultas de la comunidad</small></div></div>
            <textarea name="caption" maxlength="600" rows="3" placeholder="¿Qué te gustaría compartir hoy?"></textarea>
            <div id="ss-post-preview" class="ss-file-preview"></div>
            <div class="ss-compose-actions">
              <label class="ss-file-control">Añadir foto o video<input type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm" data-file="post" /></label>
              <label class="ss-check ss-warning"><input name="contentWarning" type="checkbox" /><span>Marcar como contenido sensible</span></label>
              <button class="ss-primary" type="submit">Publicar</button>
            </div>
            <p class="ss-subtle">Límite: 12 MB por foto y 24 MB por video.</p>
          </form>
          <div class="ss-feed-heading"><div><p class="ss-kicker">EL MURO</p><h2>Estilo de Vida</h2></div><button class="ss-icon-button" type="button" data-action="refresh" aria-label="Actualizar muro">Actualizar</button></div>
          <div class="ss-post-list">${postsHtml}</div>
        </div>
        <aside class="ss-panel ss-community-note"><span class="ss-adult-badge">18+</span><h3>Tu espacio, tus límites</h3><p>Comparte solo contenido propio o con permiso. Puedes marcar contenido sensible, reportar publicaciones o bloquear perfiles.</p><button type="button" class="ss-quiet" data-tab="discover">Conocer personas</button></aside>
      </section>
      ${this.reportTarget ? this._reportForm() : ''}
    `;
  }

  _postCard(post) {
    const isOwn = post.userId === this.user?.id;
    const sensitive = post.contentWarning && !this.revealedPosts.has(post.id);
    const avatar = post.avatarUrl
      ? `<img src="${escapeHtml(post.avatarUrl)}" alt="" />`
      : `<span>${escapeHtml(initials(post.displayName))}</span>`;
    const media = post.mediaUrl
      ? post.mediaKind === 'video'
        ? `<video src="${escapeHtml(post.mediaUrl)}" controls playsinline preload="metadata" ${sensitive ? 'class="ss-sensitive"' : ''}></video>`
        : `<img src="${escapeHtml(post.mediaUrl)}" alt="Foto compartida por ${escapeHtml(post.displayName)}" loading="lazy" ${sensitive ? 'class="ss-sensitive"' : ''} />`
      : '';
    return `
      <article class="ss-panel ss-post" data-post-card="${escapeHtml(post.id)}">
        <div class="ss-post-head">
          <div class="ss-avatar">${avatar}</div>
          <div class="ss-post-author"><b>${escapeHtml(post.displayName)}</b><small>${escapeHtml(post.city || 'spaceSUITE')} · ${escapeHtml(formatTime(post.createdAt))}</small></div>
          ${isOwn
            ? `<button type="button" class="ss-post-menu" data-action="delete-post" data-post-id="${escapeHtml(post.id)}">Eliminar</button>`
            : `<button type="button" class="ss-post-menu" data-action="report" data-target-type="post" data-target-id="${escapeHtml(post.id)}">Reportar</button>`}
        </div>
        ${post.caption ? `<p class="ss-post-caption">${escapeHtml(post.caption)}</p>` : ''}
        ${post.mediaUrl ? `<div class="ss-post-media ${sensitive ? 'sensitive' : ''}">${media}${sensitive ? `<button type="button" class="ss-reveal" data-action="reveal" data-post-id="${escapeHtml(post.id)}"><b>Contenido sensible</b><span>Toca para ver</span></button>` : ''}</div>` : ''}
        <div class="ss-post-footer">
          <button type="button" class="ss-like ${post.liked ? 'liked' : ''}" data-action="like" data-post-id="${escapeHtml(post.id)}">${iconReaction('heart')}<span>${Number(post.likes || 0)} me gusta</span></button>
          ${!isOwn ? `<button type="button" class="ss-quiet ss-post-report" data-action="report" data-target-type="post" data-target-id="${escapeHtml(post.id)}">Reportar contenido</button>` : ''}
        </div>
      </article>
    `;
  }

  async _createPost(form) {
    const data = new FormData(form);
    const file = form.querySelector('[data-file="post"]')?.files?.[0];
    const button = form.querySelector('button[type="submit"]');
    if (button) {
      button.disabled = true;
      button.textContent = 'Publicando…';
    }
    try {
      let mediaId = '';
      if (file) mediaId = (await this._upload(file, 'post')).id;
      await this._api('/api/social', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create-post',
          caption: data.get('caption'),
          mediaId,
          contentWarning: data.get('contentWarning') === 'on',
        }),
      });
      this.revealedPosts.clear();
      this._toast('Publicación compartida');
      await this._loadFeed();
    } catch (error) {
      this._toast(error.message);
      if (button) {
        button.disabled = false;
        button.textContent = 'Publicar';
      }
    }
  }

  async _upload(file, purpose) {
    const allowed = new Set([
      'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm',
    ]);
    if (!allowed.has(file.type)) throw new Error('Formato no admitido. Usa JPG, PNG, WebP, GIF, MP4 o WebM.');
    const limit = file.type.startsWith('video/') ? 24 * 1024 * 1024 : 12 * 1024 * 1024;
    if (file.size > limit) throw new Error(`El archivo supera el límite de ${Math.round(limit / 1024 / 1024)} MB.`);
    const result = await this._api('/api/social/media', {
      method: 'POST',
      headers: {
        'Content-Type': file.type,
        'X-Media-Purpose': purpose,
        'X-File-Name': encodeURIComponent(file.name.slice(0, 100)),
      },
      body: new Uint8Array(await file.arrayBuffer()),
    });
    return result.media;
  }

  async _loadDiscover() {
    this.contentEl.innerHTML = '<div class="ss-social-loading"><span class="ss-spinner"></span><p>Buscando afinidades…</p></div>';
    try {
      const result = await this._api('/api/social?view=discover');
      this.discoverProfiles = Array.isArray(result.profiles) ? result.profiles : [];
      this._renderDiscover();
    } catch (error) {
      this._errorState(error.message);
    }
  }

  _renderDiscover() {
    const profiles = this.discoverProfiles;
    this.contentEl.innerHTML = `
      <section class="ss-discover">
        <div class="ss-section-heading">
          <div><p class="ss-kicker">CONEXIONES</p><h2>Hombres afines a ti</h2><p>Los intereses en común aparecen primero. Síguense mutuamente para abrir el chat.</p></div>
          <label class="ss-search"><span>Buscar</span><input data-filter="discover" type="search" placeholder="Nombre, ciudad o interés" /></label>
        </div>
        ${profiles.length
          ? `<div class="ss-profile-grid" id="ss-profile-grid">${profiles.map((profile) => this._profileCard(profile)).join('')}</div>`
          : '<div class="ss-empty"><span class="ss-empty-orbit"></span><h3>Aún no hay perfiles para mostrar</h3><p>Cuando más personas completen su perfil, aparecerán aquí.</p><button class="ss-quiet" type="button" data-action="refresh">Actualizar</button></div>'}
      </section>
      ${this.reportTarget ? this._reportForm() : ''}
    `;
  }

  _profileCard(profile) {
    const avatar = profile.avatarUrl
      ? `<img src="${escapeHtml(profile.avatarUrl)}" alt="Foto de ${escapeHtml(profile.displayName)}" loading="lazy" />`
      : `<span>${escapeHtml(initials(profile.displayName))}</span>`;
    const interests = (profile.interests || []).map((item) => `<span class="ss-interest">${escapeHtml(item)}</span>`).join('');
    const common = (profile.commonInterests || []).map((item) => `<span class="ss-interest common">${escapeHtml(item)}</span>`).join('');
    return `
      <article class="ss-panel ss-person-card" data-search-text="${escapeHtml(`${profile.displayName} ${profile.city || ''} ${(profile.interests || []).join(' ')}`.toLowerCase())}">
        <div class="ss-person-photo">${avatar}<span class="ss-age">${Number(profile.age)} años</span></div>
        <div class="ss-person-details">
          <div class="ss-person-title"><h3>${escapeHtml(profile.displayName)}</h3>${profile.city ? `<span>${escapeHtml(profile.city)}</span>` : ''}</div>
          ${profile.bio ? `<p class="ss-person-bio">${escapeHtml(profile.bio)}</p>` : '<p class="ss-person-bio ss-muted">Aún no ha añadido una descripción.</p>'}
          ${common ? `<div class="ss-common-note">Intereses en común</div><div class="ss-interest-list">${common}</div>` : ''}
          ${interests ? `<div class="ss-interest-list">${interests}</div>` : ''}
          <div class="ss-person-actions">
            ${profile.isMatch
              ? `<button type="button" class="ss-primary" data-action="open-chat" data-user-id="${escapeHtml(profile.userId)}">Abrir chat</button>`
              : profile.isFollowing
                ? `<button type="button" class="ss-following" data-action="unfollow" data-user-id="${escapeHtml(profile.userId)}">Siguiendo</button>`
                : `<button type="button" class="ss-primary" data-action="follow" data-user-id="${escapeHtml(profile.userId)}">Seguir</button>`}
            ${profile.suiteCode ? `<button type="button" class="ss-quiet" data-action="enter-room" data-room-code="${escapeHtml(profile.suiteCode)}" data-room-name="${escapeHtml(profile.displayName)}">Ir a su sala</button>` : ''}
          </div>
          ${profile.followsYou && !profile.isFollowing ? '<p class="ss-follow-hint">Te sigue. Síguelo para hacer match.</p>' : ''}
          <div class="ss-person-safety"><button type="button" data-action="report" data-target-type="user" data-target-id="${escapeHtml(profile.userId)}">Reportar</button><button type="button" data-action="block" data-user-id="${escapeHtml(profile.userId)}">Bloquear</button></div>
        </div>
      </article>
    `;
  }

  _applyDiscoverFilter(value) {
    const needle = String(value || '').trim().toLowerCase();
    this.contentEl.querySelectorAll('[data-search-text]').forEach((card) => {
      card.hidden = Boolean(needle && !card.getAttribute('data-search-text')?.includes(needle));
    });
  }

  async _loadMatches() {
    this.contentEl.innerHTML = '<div class="ss-social-loading"><span class="ss-spinner"></span><p>Cargando tus conexiones…</p></div>';
    try {
      const result = await this._api('/api/social?view=matches');
      this.matches = Array.isArray(result.profiles) ? result.profiles : [];
      this.blockedProfiles = Array.isArray(result.blocked) ? result.blocked : [];
      this._renderMatches();
    } catch (error) {
      this._errorState(error.message);
    }
  }

  _renderMatches() {
    this._stopPolling();
    const matchList = this.matches.length
      ? `<div class="ss-match-list">${this.matches.map((profile) => `
          <article class="ss-panel ss-match-card">
            <div class="ss-avatar">${profile.avatarUrl ? `<img src="${escapeHtml(profile.avatarUrl)}" alt="" />` : `<span>${escapeHtml(initials(profile.displayName))}</span>`}</div>
            <div class="ss-match-copy"><b>${escapeHtml(profile.displayName)}</b><small>${Number(profile.age)} años${profile.city ? ` · ${escapeHtml(profile.city)}` : ''}</small></div>
            <button type="button" class="ss-primary" data-action="select-chat" data-user-id="${escapeHtml(profile.userId)}">Abrir chat</button>
            ${profile.suiteCode ? `<button type="button" class="ss-quiet" data-action="enter-room" data-room-code="${escapeHtml(profile.suiteCode)}">Sala</button>` : ''}
          </article>
        `).join('')}</div>`
      : '<div class="ss-empty ss-empty-small"><span class="ss-empty-orbit"></span><h3>Tus chats aparecen aquí</h3><p>Cuando ambos se sigan, podrán escribirse directamente.</p><button class="ss-primary" type="button" data-tab="discover">Descubrir hombres</button></div>';
    const blockedList = this.blockedProfiles.length
      ? `<section class="ss-blocked-section"><h3>Perfiles bloqueados</h3>${this.blockedProfiles.map((profile) => `<div class="ss-blocked-row"><span>${escapeHtml(profile.displayName)}</span><button type="button" class="ss-quiet" data-action="unblock" data-user-id="${escapeHtml(profile.userId)}">Desbloquear</button></div>`).join('')}</section>`
      : '';
    this.contentEl.innerHTML = `
      <section class="ss-matches">
        <div class="ss-section-heading"><div><p class="ss-kicker">CHAT PRIVADO</p><h2>Conexiones mutuas</h2><p>Mensajes en vivo y acceso directo a sus salas.</p></div></div>
        ${matchList}
        ${blockedList}
      </section>
      ${this.reportTarget ? this._reportForm() : ''}
    `;
  }

  _openChat(peer) {
    this.selectedPeer = peer;
    this.tab = 'chat';
    this.messages = [];
    this.messageLastId = 0;
    this._stopPolling();
    this.mountEl.querySelectorAll('[data-tab]').forEach((button) => {
      button.classList.toggle('active', button.getAttribute('data-tab') === 'chat');
    });
    this._renderChat();
  }

  _renderChat() {
    const peer = this.selectedPeer;
    if (!peer) return this._loadMatches();
    this._stopPolling();
    this.contentEl.innerHTML = `
      <section class="ss-panel ss-chat">
        <header class="ss-chat-head">
          <button class="ss-back-small" type="button" data-action="back-chat">‹ Conexiones</button>
          <div class="ss-chat-peer">
            <div class="ss-avatar">${peer.avatarUrl ? `<img src="${escapeHtml(peer.avatarUrl)}" alt="" />` : `<span>${escapeHtml(initials(peer.displayName))}</span>`}</div>
            <div><b>${escapeHtml(peer.displayName)}</b><small>Chat entre conexiones mutuas</small></div>
          </div>
          ${peer.suiteCode ? `<button class="ss-quiet" type="button" data-action="enter-room" data-room-code="${escapeHtml(peer.suiteCode)}" data-room-name="${escapeHtml(peer.displayName)}">Videollamada</button>` : ''}
        </header>
        <div class="ss-chat-live"><span></span> Mensajes sincronizados en vivo</div>
        <div class="ss-message-list" id="ss-message-list"><div class="ss-social-loading"><span class="ss-spinner"></span><p>Cargando conversación…</p></div></div>
        <form id="ss-message-form" class="ss-message-form">
          <textarea name="text" rows="1" maxlength="1200" placeholder="Escribe un mensaje…" required></textarea>
          <button class="ss-primary" type="submit" aria-label="Enviar mensaje">Enviar</button>
        </form>
      </section>
      ${this.reportTarget ? this._reportForm() : ''}
    `;
    this._loadMessages(true);
    this.pollTimer = window.setInterval(() => this._loadMessages(false), 1400);
  }

  async _loadMessages(initial) {
    const peer = this.selectedPeer;
    if (!peer || this.destroyed) return;
    const after = initial ? 0 : this.messageLastId;
    try {
      const result = await this._api(`/api/social?view=messages&peerId=${encodeURIComponent(peer.userId)}&after=${after}`);
      const incoming = Array.isArray(result.messages) ? result.messages : [];
      if (initial) this.messages = incoming;
      else {
        const known = new Set(this.messages.map((message) => Number(message.id)));
        this.messages.push(...incoming.filter((message) => !known.has(Number(message.id))));
      }
      for (const message of this.messages) this.messageLastId = Math.max(this.messageLastId, Number(message.id) || 0);
      this._renderMessages();
    } catch (error) {
      if (initial) this._toast(error.message);
    }
  }

  _renderMessages() {
    const list = this.contentEl.querySelector('#ss-message-list');
    if (!list) return;
    const wasNearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    list.innerHTML = this.messages.length
      ? this.messages.map((message) => `
          <div class="ss-message ${message.senderId === this.user?.id ? 'mine' : 'theirs'}">
            <div>${escapeHtml(message.text)}</div>
            <time>${escapeHtml(formatTime(message.createdAt))}</time>
          </div>
        `).join('')
      : '<div class="ss-empty-chat"><span class="ss-empty-orbit"></span><p>Saluda para empezar la conversación.</p></div>';
    if (wasNearBottom || this.messages.length <= 1) list.scrollTop = list.scrollHeight;
  }

  async _sendMessage(form) {
    const input = form.querySelector('[name="text"]');
    const text = input?.value?.trim();
    if (!text || !this.selectedPeer) return;
    const button = form.querySelector('button[type="submit"]');
    if (button) button.disabled = true;
    try {
      const result = await this._api('/api/social', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send-message', userId: this.selectedPeer.userId, text }),
      });
      if (input) input.value = '';
      if (result.message) {
        this.messages.push(result.message);
        this.messageLastId = Math.max(this.messageLastId, Number(result.message.id) || 0);
        this._renderMessages();
      }
    } catch (error) {
      this._toast(error.message);
    } finally {
      if (button) button.disabled = false;
      input?.focus();
    }
  }

  async _follow(userId) {
    try {
      const result = await this._post({ action: 'follow', userId });
      const profile = this.discoverProfiles.find((item) => item.userId === userId);
      if (profile) Object.assign(profile, result);
      if (result.isMatch) this._toast('Conexión mutua. Ya pueden chatear.');
      else this._toast('Ahora sigues este perfil');
      this._renderDiscover();
    } catch (error) {
      this._toast(error.message);
    }
  }

  async _unfollow(userId) {
    try {
      await this._post({ action: 'unfollow', userId });
      const profile = this.discoverProfiles.find((item) => item.userId === userId);
      if (profile) {
        profile.isFollowing = false;
        profile.isMatch = false;
      }
      this._toast('Dejaste de seguir este perfil');
      this._renderDiscover();
    } catch (error) {
      this._toast(error.message);
    }
  }

  async _toggleLike(postId) {
    try {
      const result = await this._post({ action: 'toggle-like', postId });
      const post = this.posts.find((item) => item.id === postId);
      if (post) {
        post.liked = result.liked;
        post.likes = result.likes;
        const card = this.contentEl.querySelector(`[data-post-card="${CSS.escape(postId)}"]`);
        if (card) {
          const button = card.querySelector('[data-action="like"]');
          button?.classList.toggle('liked', post.liked);
          if (button) button.innerHTML = `${iconReaction('heart')}<span>${post.likes} me gusta</span>`;
        }
      }
    } catch (error) {
      this._toast(error.message);
    }
  }

  async _deletePost(postId) {
    if (!window.confirm('¿Eliminar esta publicación?')) return;
    try {
      await this._post({ action: 'delete-post', postId });
      this.posts = this.posts.filter((post) => post.id !== postId);
      this._toast('Publicación eliminada');
      this._renderFeed();
    } catch (error) {
      this._toast(error.message);
    }
  }

  async _block(userId) {
    if (!window.confirm('¿Bloquear este perfil? Ya no aparecerán entre sí ni podrán chatear.')) return;
    try {
      await this._post({ action: 'block', userId });
      this.discoverProfiles = this.discoverProfiles.filter((profile) => profile.userId !== userId);
      this._toast('Perfil bloqueado');
      this._renderDiscover();
    } catch (error) {
      this._toast(error.message);
    }
  }

  async _unblock(userId) {
    try {
      await this._post({ action: 'unblock', userId });
      this.blockedProfiles = this.blockedProfiles.filter((profile) => profile.userId !== userId);
      this._toast('Perfil desbloqueado');
      this._renderMatches();
    } catch (error) {
      this._toast(error.message);
    }
  }

  async _submitReport(form) {
    if (!this.reportTarget) return;
    const data = new FormData(form);
    try {
      await this._post({
        action: 'report',
        targetType: this.reportTarget.type,
        targetId: this.reportTarget.id,
        reason: data.get('reason'),
        details: data.get('details'),
      });
      this.reportTarget = null;
      this._toast('Reporte recibido');
      this._renderContent();
    } catch (error) {
      this._toast(error.message);
    }
  }

  _reportForm() {
    return `
      <div class="ss-report-backdrop">
        <section class="ss-panel ss-report-panel" role="dialog" aria-modal="true" aria-labelledby="ss-report-title">
          <button class="ss-close" type="button" data-action="cancel-report" aria-label="Cerrar">${iconClose()}</button>
          <p class="ss-kicker">COMUNIDAD SEGURA</p>
          <h2 id="ss-report-title">Reportar contenido</h2>
          <form id="ss-report-form" class="ss-form">
            <label>Motivo<select name="reason" required>
              <option value="acoso">Acoso o amenazas</option>
              <option value="suplantacion">Suplantación</option>
              <option value="contenido-no-consensuado">Contenido sin consentimiento</option>
              <option value="menor-de-edad">Posible menor de edad</option>
              <option value="spam">Spam</option>
              <option value="otro">Otro</option>
            </select></label>
            <label>Detalles (opcional)<textarea name="details" rows="3" maxlength="500"></textarea></label>
            <button class="ss-primary" type="submit">Enviar reporte</button>
          </form>
        </section>
      </div>
    `;
  }

  async _post(payload) {
    return this._api('/api/social', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  _findProfile(userId) {
    return this.discoverProfiles.find((profile) => profile.userId === userId) ||
      this.matches.find((profile) => profile.userId === userId) ||
      this.blockedProfiles.find((profile) => profile.userId === userId) ||
      null;
  }

  _previewFile(file, targetSelector) {
    const target = this.contentEl.querySelector(targetSelector);
    if (!target) return;
    if (this.previewUrl) URL.revokeObjectURL(this.previewUrl);
    this.previewUrl = URL.createObjectURL(file);
    if (file.type.startsWith('video/')) {
      target.innerHTML = `<video src="${this.previewUrl}" controls playsinline></video>`;
    } else {
      target.innerHTML = `<img src="${this.previewUrl}" alt="Vista previa" />`;
    }
  }

  _errorState(message) {
    if (this.destroyed) return;
    this.contentEl.innerHTML = `
      <div class="ss-empty ss-error-state">
        <span class="ss-empty-orbit"></span>
        <h3>No se pudo cargar este espacio</h3>
        <p>${escapeHtml(message)}</p>
        <button class="ss-primary" type="button" data-action="refresh">Intentar de nuevo</button>
      </div>
    `;
  }

  _toast(message) {
    if (!this.toastEl) return;
    this.toastEl.textContent = message;
    this.toastEl.classList.add('visible');
    if (this.toastTimer) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl?.classList.remove('visible'), 2800);
  }

  _stopPolling() {
    if (this.pollTimer) window.clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  destroy() {
    this.destroyed = true;
    this._stopPolling();
    if (this.toastTimer) window.clearTimeout(this.toastTimer);
    if (this.previewUrl) URL.revokeObjectURL(this.previewUrl);
    this.mountEl.innerHTML = '';
  }
}
