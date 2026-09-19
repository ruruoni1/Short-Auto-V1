const state = {
  channels: [],
  clips: [],
  activeClip: null,
  activeView: 'library',
  channelJobs: new Map(),
  lastDetailTrigger: null,
  voicevox: { voices: [], selectedSpeakerUuid: '', selectedStyleId: '', profile: null, audioUrl: null, busy: false },
  voicestudio: { installed: false, busy: false, running: false, providerReady: false, model: 'kittentts', voices: [], selectedVoiceId: '', audioUrl: null },
};

const ui = {
  navButtons: [...document.querySelectorAll('[data-view]')],
  views: {
    library: document.querySelector('#library-view'),
    channels: document.querySelector('#channels-view'),
    voicevox: document.querySelector('#voicevox-view'),
  },
  clipFilters: document.querySelector('#clip-filters'),
  filterChannel: document.querySelector('#filter-channel'),
  clipList: document.querySelector('#clip-list'),
  clipCount: document.querySelector('#clip-count'),
  libraryAlert: document.querySelector('#library-alert'),
  channelList: document.querySelector('#channel-list'),
  channelAlert: document.querySelector('#channel-alert'),
  channelDialog: document.querySelector('#channel-dialog'),
  channelForm: document.querySelector('#channel-form'),
  channelFormError: document.querySelector('#channel-form-error'),
  detail: document.querySelector('#clip-detail'),
  detailBackdrop: document.querySelector('#detail-backdrop'),
  detailContent: document.querySelector('#detail-content'),
  toastRegion: document.querySelector('#toast-region'),
  voicevox: {
    status: document.querySelector('#voicevox-status'), dot: document.querySelector('#voicevox-status-dot'),
    statusTitle: document.querySelector('#voicevox-status-title'), statusCopy: document.querySelector('#voicevox-status-copy'),
    alert: document.querySelector('#voicevox-alert'), retry: document.querySelector('#voicevox-retry'),
    speaker: document.querySelector('#voicevox-speaker'), style: document.querySelector('#voicevox-style'),
    profileName: document.querySelector('#voicevox-profile-name'), save: document.querySelector('#voicevox-save-profile'), profileStatus: document.querySelector('#voicevox-profile-status'),
    text: document.querySelector('#voicevox-text'), contentId: document.querySelector('#voicevox-content-id'), preview: document.querySelector('#voicevox-preview'), generate: document.querySelector('#voicevox-generate'), audio: document.querySelector('#voicevox-audio'), result: document.querySelector('#voicevox-result'),
    params: { speedScale: document.querySelector('#voicevox-speed'), pitchScale: document.querySelector('#voicevox-pitch'), intonationScale: document.querySelector('#voicevox-intonation'), volumeScale: document.querySelector('#voicevox-volume') },
    values: { speedScale: document.querySelector('#voicevox-speed-value'), pitchScale: document.querySelector('#voicevox-pitch-value'), intonationScale: document.querySelector('#voicevox-intonation-value'), volumeScale: document.querySelector('#voicevox-volume-value') },
  },
  voicestudio: {
    status: document.querySelector('#voicestudio-install-status'), dot: document.querySelector('#voicestudio-install-dot'),
    title: document.querySelector('#voicestudio-install-title-text'), copy: document.querySelector('#voicestudio-install-copy'),
    install: document.querySelector('#voicestudio-install'), start: document.querySelector('#voicestudio-start'), help: document.querySelector('#voicestudio-install-help'),
    providerStatus: document.querySelector('#voicestudio-provider-status'), providerDot: document.querySelector('#voicestudio-provider-dot'), providerTitle: document.querySelector('#voicestudio-provider-title'), providerCopy: document.querySelector('#voicestudio-provider-copy'),
    model: document.querySelector('#voicestudio-model'), voice: document.querySelector('#voicestudio-voice'), text: document.querySelector('#voicestudio-text'), preview: document.querySelector('#voicestudio-preview'), audio: document.querySelector('#voicestudio-audio'), result: document.querySelector('#voicestudio-result'),
  },
};

const labels = {
  category: { anime: '애니', drama: '일드' },
  clipType: {
    scene: '본편 장면', highlight: '하이라이트', short: 'Shorts', cutout: '키리누키',
    digest: '다이제스트', preview: '선행 공개', pv: 'PV·예고', other: '기타',
  },
  status: {
    NEW: '신규', ANALYZED: '분석됨', REVIEWED: '검수됨', CANDIDATE: '후보',
    SELECTED: '선택됨', DOWNLOADED: '다운로드됨', REJECTED: '제외됨',
  },
  job: { QUEUED: '대기 중', RUNNING: '처리 중', SUCCEEDED: '완료', FAILED: '실패' },
};

class ApiError extends Error {
  constructor(message, code, status, details = null) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

async function request(path, options = {}) {
  const init = { ...options, headers: { Accept: 'application/json', ...(options.headers || {}) } };
  if (Object.hasOwn(options, 'body')) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }
  let response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new ApiError('로컬 서버에 연결할 수 없습니다. 서버가 실행 중인지 확인하세요.', 'NETWORK_ERROR', 0);
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    if (response.ok) return null;
  }
  if (!response.ok) {
    throw new ApiError(
      payload?.error?.message || '요청을 처리하지 못했습니다.',
      payload?.error?.code || 'REQUEST_FAILED',
      response.status,
      payload?.error || null,
    );
  }
  return payload;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function svgIcon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#icon-${name}`);
  svg.append(use);
  return svg;
}

function actionButton(text, className = 'button button-secondary') {
  const button = element('button', className, text);
  button.type = 'button';
  return button;
}

function setAlert(node, message) {
  node.textContent = message || '';
  node.hidden = !message;
}

function errorMessage(error) {
  if (error instanceof ApiError) {
    return error.code && error.code !== 'REQUEST_FAILED' ? `${error.message} (${error.code})` : error.message;
  }
  return '예상하지 못한 오류가 발생했습니다. 다시 시도하세요.';
}

function showToast(message) {
  const toast = element('div', 'toast', message);
  ui.toastRegion.append(toast);
  window.setTimeout(() => toast.remove(), 3600);
}

function formatDate(value, includeTime = false) {
  if (!value) return '아직 없음';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '날짜 정보 없음';
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric', month: 'short', day: 'numeric',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(date);
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return '';
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function safeWebUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function channelName(channelId) {
  return state.channels.find((channel) => channel.id === channelId)?.channelName || '채널 정보 없음';
}

function renderSkeletons(target, count = 3) {
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < count; index += 1) {
    const row = element('div', 'skeleton-row');
    row.append(element('div', 'skeleton skeleton-thumb'));
    const copy = element('div', 'skeleton-copy');
    copy.append(element('div', 'skeleton skeleton-line short'), element('div', 'skeleton skeleton-line'), element('div', 'skeleton skeleton-line short'));
    row.append(copy);
    fragment.append(row);
  }
  target.replaceChildren(fragment);
}

function renderEmpty(target, title, copy, action) {
  const empty = element('div', 'empty-state');
  const mark = element('div', 'empty-mark');
  mark.append(svgIcon('library'));
  empty.append(mark, element('h2', '', title), element('p', '', copy));
  if (action) empty.append(action);
  target.replaceChildren(empty);
}

async function loadHealth() {
  const dot = document.querySelector('#health-dot');
  const title = document.querySelector('#health-title');
  const copy = document.querySelector('#health-copy');
  try {
    const payload = await request('/api/health');
    const configured = Boolean(payload?.data?.youtubeConfigured);
    dot.className = `status-dot ${configured ? 'is-good' : 'is-bad'}`;
    title.textContent = configured ? 'YouTube API 준비됨' : 'API 키 설정 필요';
    copy.textContent = configured ? '공식 채널을 동기화할 수 있습니다.' : 'YOUTUBE_API_KEY를 확인하세요.';
  } catch {
    dot.className = 'status-dot is-bad';
    title.textContent = '서버 연결 실패';
    copy.textContent = '로컬 앱 서버를 확인하세요.';
  }
}

function setView(view) {
  if (!ui.views[view]) return;
  state.activeView = view;
  Object.entries(ui.views).forEach(([name, node]) => { node.hidden = name !== view; });
  ui.navButtons.forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle('is-active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  document.querySelector('#main-content').focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function updateChannelFilter() {
  const selected = ui.filterChannel.value;
  const all = element('option', '', '전체 채널');
  all.value = '';
  const options = state.channels.map((channel) => {
    const option = element('option', '', channel.channelName);
    option.value = channel.id;
    return option;
  });
  ui.filterChannel.replaceChildren(all, ...options);
  if (state.channels.some((channel) => channel.id === selected)) ui.filterChannel.value = selected;
}

async function loadChannels({ quiet = false } = {}) {
  if (!quiet) {
    ui.channelList.setAttribute('aria-busy', 'true');
    renderSkeletons(ui.channelList, 3);
  }
  setAlert(ui.channelAlert, '');
  try {
    const payload = await request('/api/channels');
    state.channels = Array.isArray(payload?.data) ? payload.data : payload?.data ? [payload.data] : [];
    updateChannelFilter();
    renderChannels();
  } catch (error) {
    state.channels = [];
    updateChannelFilter();
    renderEmpty(ui.channelList, '채널을 불러오지 못했습니다', '서버 연결을 확인한 뒤 다시 시도하세요.', retryButton(loadChannels));
    setAlert(ui.channelAlert, errorMessage(error));
  } finally {
    ui.channelList.setAttribute('aria-busy', 'false');
  }
}

function retryButton(handler) {
  const button = actionButton('다시 시도');
  button.addEventListener('click', handler);
  return button;
}

function renderChannels() {
  if (state.channels.length === 0) {
    const add = actionButton('첫 채널 추가', 'button button-primary');
    add.prepend(svgIcon('plus'));
    add.addEventListener('click', () => openChannelDialog());
    renderEmpty(ui.channelList, '등록된 공식 채널이 없습니다', '권리자가 운영하는 채널임을 직접 확인한 뒤 첫 채널을 추가하세요.', add);
    return;
  }

  const fragment = document.createDocumentFragment();
  state.channels.forEach((channel, index) => {
    const item = element('article', 'channel-item');
    item.style.setProperty('--item-index', index);

    const identity = element('div', 'channel-name');
    identity.append(element('span', 'tier', channel.sourcePriority));
    const nameCopy = element('div');
    nameCopy.append(element('h2', '', channel.channelName), element('p', '', channel.youtubeChannelId));
    identity.append(nameCopy);

    const synced = element('div', 'channel-stat');
    synced.append(element('p', '', '마지막 동기화'), element('strong', '', formatDate(channel.lastSyncedAt, true)));
    const category = element('div', 'channel-stat');
    category.append(element('p', '', '분류 및 상태'));
    const categoryValue = element('strong', `channel-state${channel.enabled ? '' : ' is-off'}`, `${labels.category[channel.category] || channel.category} · ${channel.enabled ? '활성' : '비활성'}`);
    category.append(categoryValue);

    const actions = element('div', 'channel-actions');
    const sync = actionButton('동기화');
    sync.prepend(svgIcon('refresh'));
    sync.disabled = !channel.enabled || ['QUEUED', 'RUNNING'].includes(state.channelJobs.get(channel.id)?.state);
    sync.setAttribute('aria-label', `${channel.channelName} 동기화`);
    sync.addEventListener('click', () => syncChannel(channel, sync));
    const edit = actionButton('수정', 'button button-ghost');
    edit.setAttribute('aria-label', `${channel.channelName} 수정`);
    edit.addEventListener('click', () => openChannelDialog(channel));
    actions.append(sync, edit);
    if (channel.enabled) {
      const disable = actionButton('비활성화', 'button button-danger');
      disable.setAttribute('aria-label', `${channel.channelName} 비활성화`);
      disable.addEventListener('click', () => disableChannel(channel, disable));
      actions.append(disable);
    }

    item.append(identity, synced, category, actions);
    const job = state.channelJobs.get(channel.id);
    if (job) item.append(renderJobLine(job));
    fragment.append(item);
  });
  ui.channelList.replaceChildren(fragment);
}

function renderJobLine(job) {
  const line = element('div', `job-line${job.state === 'FAILED' ? ' is-failed' : ''}`);
  line.setAttribute('role', 'status');
  const status = labels.job[job.state] || job.state;
  const detail = job.state === 'FAILED' ? job.errorMessage || job.error?.message || '처리에 실패했습니다.' : '공식 채널의 새 영상을 확인합니다.';
  line.append(element('strong', '', status), element('span', '', detail));
  return line;
}

function openChannelDialog(channel = null) {
  ui.channelForm.reset();
  setAlert(ui.channelFormError, '');
  const fields = ui.channelForm.elements;
  fields.id.value = channel?.id || '';
  fields.revision.value = channel?.revision ?? '';
  fields.youtubeChannelId.value = channel?.youtubeChannelId || '';
  fields.youtubeChannelId.readOnly = Boolean(channel);
  fields.channelName.value = channel?.channelName || '';
  fields.category.value = channel?.category || 'anime';
  fields.sourcePriority.value = channel?.sourcePriority || 'S';
  fields.notes.value = channel?.notes || '';
  fields.enabled.checked = channel?.enabled ?? true;
  fields.officialVerified.checked = channel?.officialVerified ?? false;
  document.querySelector('#channel-dialog-title').textContent = channel ? '공식 채널 수정' : '공식 채널 추가';
  document.querySelector('#save-channel').textContent = channel ? '변경 저장' : '채널 저장';
  ui.channelDialog.showModal();
  window.setTimeout(() => (channel ? fields.channelName : fields.youtubeChannelId).focus(), 0);
}

function closeChannelDialog() {
  if (ui.channelDialog.open) ui.channelDialog.close();
}

async function submitChannel(event) {
  event.preventDefault();
  const form = ui.channelForm;
  if (!form.reportValidity()) return;
  const fields = form.elements;
  if (!fields.officialVerified.checked) {
    setAlert(ui.channelFormError, '공식 채널임을 직접 확인한 뒤 확인란을 선택하세요.');
    fields.officialVerified.focus();
    return;
  }

  const editing = Boolean(fields.id.value);
  const payload = {
    channelName: fields.channelName.value.trim(),
    category: fields.category.value,
    sourcePriority: fields.sourcePriority.value,
    officialVerified: fields.officialVerified.checked,
    enabled: fields.enabled.checked,
    notes: fields.notes.value.trim(),
  };
  if (editing) payload.expectedRevision = Number(fields.revision.value);
  else payload.youtubeChannelId = fields.youtubeChannelId.value.trim();

  const submit = document.querySelector('#save-channel');
  submit.disabled = true;
  submit.textContent = '저장 중';
  setAlert(ui.channelFormError, '');
  try {
    await request(editing ? `/api/channels/${encodeURIComponent(fields.id.value)}` : '/api/channels', {
      method: editing ? 'PATCH' : 'POST', body: payload,
    });
    closeChannelDialog();
    showToast(editing ? '채널 정보를 수정했습니다.' : '공식 채널을 추가했습니다.');
    await loadChannels({ quiet: true });
  } catch (error) {
    setAlert(ui.channelFormError, errorMessage(error));
  } finally {
    submit.disabled = false;
    submit.textContent = editing ? '변경 저장' : '채널 저장';
  }
}

async function disableChannel(channel, button) {
  button.disabled = true;
  setAlert(ui.channelAlert, '');
  try {
    await request(`/api/channels/${encodeURIComponent(channel.id)}`, {
      method: 'DELETE', body: { expectedRevision: channel.revision },
    });
    showToast('채널을 비활성화했습니다.');
    await loadChannels({ quiet: true });
  } catch (error) {
    setAlert(ui.channelAlert, errorMessage(error));
    button.disabled = false;
  }
}

async function syncChannel(channel, button) {
  button.disabled = true;
  setAlert(ui.channelAlert, '');
  try {
    const payload = await request(`/api/channels/${encodeURIComponent(channel.id)}/sync`, { method: 'POST', body: {} });
    const job = payload?.data;
    state.channelJobs.set(channel.id, job);
    renderChannels();
    await pollJob(job.id, (nextJob) => {
      state.channelJobs.set(channel.id, nextJob);
      renderChannels();
    });
    const finished = state.channelJobs.get(channel.id);
    if (finished?.state === 'SUCCEEDED') {
      showToast(`${channel.channelName} 동기화를 마쳤습니다.`);
      await Promise.all([loadChannels({ quiet: true }), loadClips({ quiet: true })]);
    }
  } catch (error) {
    state.channelJobs.delete(channel.id);
    renderChannels();
    setAlert(ui.channelAlert, errorMessage(error));
    button.disabled = false;
  }
}

function filtersQuery() {
  const data = new FormData(ui.clipFilters);
  const params = new URLSearchParams();
  for (const [key, rawValue] of data.entries()) {
    const value = String(rawValue).trim();
    if (value) params.set(key, value);
  }
  return params.toString();
}

async function loadClips({ quiet = false } = {}) {
  if (!quiet) {
    ui.clipList.setAttribute('aria-busy', 'true');
    ui.clipCount.textContent = '불러오는 중';
    renderSkeletons(ui.clipList, 4);
  }
  setAlert(ui.libraryAlert, '');
  try {
    const query = filtersQuery();
    const payload = await request(`/api/clips${query ? `?${query}` : ''}`);
    state.clips = Array.isArray(payload?.data) ? payload.data : [];
    renderClips(payload?.total ?? state.clips.length);
  } catch (error) {
    state.clips = [];
    ui.clipCount.textContent = '불러오기 실패';
    renderEmpty(ui.clipList, '클립을 불러오지 못했습니다', '서버 연결과 필터 조건을 확인한 뒤 다시 시도하세요.', retryButton(loadClips));
    setAlert(ui.libraryAlert, errorMessage(error));
  } finally {
    ui.clipList.setAttribute('aria-busy', 'false');
  }
}

function renderClips(total) {
  ui.clipCount.textContent = `${new Intl.NumberFormat('ko-KR').format(total)}개`;
  if (state.clips.length === 0) {
    renderEmpty(ui.clipList, '조건에 맞는 클립이 없습니다', '필터를 바꾸거나 공식 채널을 동기화해 새 메타데이터를 수집하세요.');
    return;
  }
  const fragment = document.createDocumentFragment();
  state.clips.forEach((clip, index) => fragment.append(renderClip(clip, index)));
  ui.clipList.replaceChildren(fragment);
}

function renderClip(clip, index) {
  const item = element('article', 'clip-item');
  item.style.setProperty('--item-index', index);
  const thumb = element('div', 'clip-thumb');
  const thumbUrl = safeWebUrl(clip.thumbnailUrl);
  if (thumbUrl) {
    const image = document.createElement('img');
    image.src = thumbUrl;
    image.alt = '';
    image.loading = 'lazy';
    image.referrerPolicy = 'no-referrer';
    thumb.append(image);
  }
  const duration = formatDuration(clip.durationSeconds);
  if (duration) thumb.append(element('span', 'clip-duration', duration));

  const body = element('div', 'clip-body');
  const meta = element('div', 'clip-meta');
  meta.append(element('span', '', channelName(clip.channelId)), element('span', '', '·'), element('time', '', formatDate(clip.publishedAt)));
  const title = element('h2', 'clip-title', clip.title);
  const description = element('p', 'clip-description', clip.description || '설명이 없습니다.');
  const tags = element('div', 'clip-tags');
  tags.append(
    element('span', 'tag', labels.category[clip.contentType] || clip.contentType),
    element('span', 'tag', labels.clipType[clip.clipType] || clip.clipType),
    element('span', `tag status-${String(clip.status).toLowerCase()}`, labels.status[clip.status] || clip.status),
  );
  if (clip.workTitle) tags.append(element('span', 'tag', clip.workTitle));
  body.append(meta, title, description, tags);

  const actions = element('div', 'clip-actions');
  const review = actionButton(clip.status === 'NEW' ? '검수 시작' : '검수 열기', 'button button-primary');
  review.setAttribute('aria-label', `${clip.title} 검수 열기`);
  review.addEventListener('click', () => openClipDetail(clip.id, review));
  actions.append(review);
  const sourceUrl = safeWebUrl(clip.youtubeUrl);
  if (sourceUrl) {
    const source = element('a', 'button button-ghost source-link', '원본 보기');
    source.href = sourceUrl;
    source.target = '_blank';
    source.rel = 'noopener noreferrer';
    source.append(svgIcon('external'));
    source.setAttribute('aria-label', `${clip.title} YouTube 원본 새 창에서 열기`);
    actions.append(source);
  }
  item.append(thumb, body, actions);
  return item;
}

async function openClipDetail(id, trigger) {
  state.lastDetailTrigger = trigger || document.activeElement;
  ui.detailBackdrop.hidden = false;
  ui.detail.setAttribute('aria-hidden', 'false');
  ui.detail.classList.add('is-open');
  document.body.style.overflow = 'hidden';
  renderSkeletons(ui.detailContent, 2);
  document.querySelector('#close-detail').focus();
  try {
    const payload = await request(`/api/clips/${encodeURIComponent(id)}`);
    state.activeClip = payload?.data;
    renderClipDetail(state.activeClip);
  } catch (error) {
    const retry = retryButton(() => openClipDetail(id, trigger));
    renderEmpty(ui.detailContent, '클립 정보를 불러오지 못했습니다', errorMessage(error), retry);
  }
}

function closeClipDetail() {
  ui.detail.classList.remove('is-open');
  ui.detail.setAttribute('aria-hidden', 'true');
  ui.detailBackdrop.hidden = true;
  document.body.style.overflow = '';
  state.activeClip = null;
  if (state.lastDetailTrigger?.isConnected) state.lastDetailTrigger.focus();
}

function field(label, name, value, options = {}) {
  const wrapper = element('label', `field${options.wide ? ' field-wide' : ''}`);
  wrapper.append(element('span', '', label));
  let control;
  if (options.type === 'textarea') {
    control = document.createElement('textarea');
    control.rows = options.rows || 3;
  } else if (options.options) {
    control = document.createElement('select');
    options.options.forEach(([optionValue, optionLabel]) => {
      const option = element('option', '', optionLabel);
      option.value = optionValue;
      control.append(option);
    });
  } else {
    control = document.createElement('input');
    control.type = options.type || 'text';
  }
  control.name = name;
  control.value = value ?? '';
  if (options.placeholder) control.placeholder = options.placeholder;
  wrapper.append(control);
  if (options.help) wrapper.append(element('small', '', options.help));
  return wrapper;
}

function renderClipDetail(clip) {
  const content = document.createDocumentFragment();
  const imageUrl = safeWebUrl(clip.thumbnailUrl);
  if (imageUrl) {
    const media = element('div', 'detail-media');
    const image = document.createElement('img');
    image.src = imageUrl;
    image.alt = `${clip.title} 썸네일`;
    image.referrerPolicy = 'no-referrer';
    media.append(image);
    content.append(media);
  }

  const summary = element('section', 'detail-summary');
  const tags = element('div', 'clip-tags');
  tags.append(
    element('span', 'tag', channelName(clip.channelId)),
    element('span', `tag status-${String(clip.status).toLowerCase()}`, labels.status[clip.status] || clip.status),
    element('span', 'tag', labels.clipType[clip.clipType] || clip.clipType),
  );
  summary.append(tags, element('h3', '', clip.title), element('p', '', clip.description || '설명이 없습니다.'));
  const sourceUrl = safeWebUrl(clip.youtubeUrl);
  if (sourceUrl) {
    const source = element('a', 'button button-secondary', 'YouTube 원본 확인');
    source.href = sourceUrl;
    source.target = '_blank';
    source.rel = 'noopener noreferrer';
    source.append(svgIcon('external'));
    summary.append(source);
  }
  content.append(summary, element('hr', 'detail-separator'));

  const form = element('form', 'review-form');
  form.id = 'review-form';
  form.noValidate = true;
  form.append(element('h3', '', '검수 정보'), element('p', 'section-copy', '자동 분석값을 원본 장면과 대조해 수정하세요. 저장 실패 시 입력은 그대로 유지됩니다.'));
  const grid = element('div', 'form-grid');
  grid.append(
    field('작품명', 'workTitle', clip.workTitle, { placeholder: '원작의 정확한 작품명' }),
    field('화수', 'episode', clip.episode, { placeholder: '예: 제3화' }),
    field('클립 유형', 'clipType', clip.clipType, { options: Object.entries(labels.clipType) }),
    field('대사 후보', 'dialogueCandidate', clip.dialogueCandidate, { placeholder: '일본어 원문', wide: true }),
    field('한국어 독음', 'readingKo', clip.readingKo, { placeholder: '실제 발음에 맞춘 독음', wide: true }),
    field('한국어 의미', 'meaningKo', clip.meaningKo, { type: 'textarea', placeholder: '문맥에 맞는 의미', wide: true }),
    field('앞뒤 문맥', 'contextNotes', clip.contextNotes, { type: 'textarea', placeholder: '화자, 청자, 관계와 장면 맥락', wide: true }),
    field('검수 메모', 'reviewNotes', clip.reviewNotes, { type: 'textarea', placeholder: '확인 내용과 남은 검토 사항', wide: true }),
  );
  form.append(grid);

  const checklist = element('fieldset', 'checklist');
  const legend = element('legend', 'sr-only', '사람 검수 체크리스트');
  checklist.append(legend);
  [
    ['official', '공식 채널과 원본 URL을 확인했습니다.'],
    ['scene', '실제 애니·일드 장면과 클립 유형을 확인했습니다.'],
    ['work', '작품명과 화수 정보를 확인했습니다.'],
    ['dialogue', '대사 원문, 독음, 의미가 장면과 일치합니다.'],
    ['context', '화자·청자·관계와 앞뒤 문맥을 확인했습니다.'],
  ].forEach(([name, copy]) => {
    const row = element('label', 'check-row');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.name = `check-${name}`;
    const span = element('span');
    span.append(element('strong', '', copy));
    row.append(checkbox, span);
    checklist.append(row);
  });
  form.append(checklist);

  const confirm = element('label', 'check-row check-confirm');
  const confirmBox = document.createElement('input');
  confirmBox.type = 'checkbox';
  confirmBox.name = 'humanConfirmed';
  const confirmCopy = element('span');
  confirmCopy.append(element('strong', '', '제가 원본을 직접 검수했고 이 클립을 선택할 준비가 되었습니다.'), element('small', '', '이 확인은 선택 버튼을 누를 때만 서버에 전달됩니다.'));
  confirm.append(confirmBox, confirmCopy);
  form.append(confirm);
  const formError = element('div', 'form-error');
  formError.id = 'review-form-error';
  formError.setAttribute('role', 'alert');
  formError.setAttribute('aria-live', 'assertive');
  formError.hidden = true;
  form.append(formError);

  const actions = element('div', 'review-actions');
  [
    ['save', '입력 저장', 'button button-secondary'],
    ['hold', '후보 보류', 'button button-secondary'],
    ['reject', '제외', 'button button-danger'],
    ['select', '검수 후 선택', 'button button-primary'],
  ].forEach(([decision, copy, className]) => {
    const button = actionButton(copy, className);
    button.type = 'submit';
    button.dataset.decision = decision;
    actions.append(button);
  });
  form.append(actions);
  form.addEventListener('submit', submitReview);
  content.append(form);

  if (clip.status === 'SELECTED' || clip.status === 'DOWNLOADED') {
    content.append(element('hr', 'detail-separator'), renderDownloadPanel(clip));
  }
  ui.detailContent.replaceChildren(content);
}

function collectReviewPatch(form) {
  const data = new FormData(form);
  return {
    workTitle: String(data.get('workTitle') || '').trim(),
    episode: String(data.get('episode') || '').trim(),
    clipType: String(data.get('clipType') || ''),
    dialogueCandidate: String(data.get('dialogueCandidate') || '').trim(),
    readingKo: String(data.get('readingKo') || '').trim(),
    meaningKo: String(data.get('meaningKo') || '').trim(),
    contextNotes: String(data.get('contextNotes') || '').trim(),
    reviewNotes: String(data.get('reviewNotes') || '').trim(),
  };
}

async function submitReview(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const decision = event.submitter?.dataset.decision || 'save';
  const error = form.querySelector('#review-form-error');
  setAlert(error, '');

  const payload = {
    expectedRevision: state.activeClip.revision,
    decision,
    patch: collectReviewPatch(form),
  };
  if (decision === 'select') {
    const checklist = [...form.querySelectorAll('.checklist input[type="checkbox"]')];
    const humanConfirmed = form.elements.humanConfirmed.checked;
    if (!checklist.every((box) => box.checked) || !humanConfirmed) {
      setAlert(error, '선택 전 검수 항목을 모두 확인하고 직접 검수 확인란을 선택하세요.');
      (checklist.find((box) => !box.checked) || form.elements.humanConfirmed).focus();
      return;
    }
    payload.humanConfirmed = true;
  }

  const buttons = [...form.querySelectorAll('button[type="submit"]')];
  buttons.forEach((button) => { button.disabled = true; });
  try {
    const response = await request(`/api/clips/${encodeURIComponent(state.activeClip.id)}/review`, { method: 'PATCH', body: payload });
    state.activeClip = response?.data;
    showToast(decision === 'select' ? '클립을 선택했습니다. 이제 다운로드할 수 있습니다.' : decision === 'reject' ? '클립을 제외했습니다.' : '검수 내용을 저장했습니다.');
    renderClipDetail(state.activeClip);
    await loadClips({ quiet: true });
  } catch (requestError) {
    setAlert(error, errorMessage(requestError));
    buttons.forEach((button) => { button.disabled = false; });
  }
}

function renderDownloadPanel(clip) {
  const panel = element('section', 'download-panel');
  panel.append(element('h3', '', clip.status === 'DOWNLOADED' ? '다운로드 완료' : '선택한 소스 다운로드'), element('p', 'section-copy', '사람이 선택한 이 클립만 yt-dlp 처리 대상으로 보냅니다.'));
  if (clip.localVideoPath) panel.append(element('p', 'local-path', clip.localVideoPath));
  if (clip.status === 'DOWNLOADED') return panel;

  const form = element('form', 'download-controls');
  const quality = field('영상 품질', 'quality', 'best', { options: [['best', '최고 품질'], ['1080p', '1080p'], ['720p', '720p']] });
  const subtitle = element('label', 'check-row');
  const subtitleBox = document.createElement('input');
  subtitleBox.type = 'checkbox';
  subtitleBox.name = 'subtitles';
  subtitleBox.checked = true;
  const subtitleCopy = element('span');
  subtitleCopy.append(element('strong', '', '자막도 함께 확인'));
  subtitle.append(subtitleBox, subtitleCopy);
  const submit = actionButton('다운로드 시작', 'button button-primary');
  submit.type = 'submit';
  submit.prepend(svgIcon('download'));
  form.append(quality, subtitle, submit);
  form.addEventListener('submit', submitDownload);
  panel.append(form);
  const status = element('p', 'job-status');
  status.id = 'download-job-status';
  status.hidden = true;
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  panel.append(status);
  return panel;
}

async function submitDownload(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('button[type="submit"]');
  const status = document.querySelector('#download-job-status');
  const clipId = state.activeClip.id;
  submit.disabled = true;
  status.hidden = false;
  status.className = 'job-status';
  status.textContent = '다운로드 작업을 요청합니다.';
  try {
    const payload = await request(`/api/clips/${encodeURIComponent(clipId)}/download`, {
      method: 'POST',
      body: { quality: form.elements.quality.value, subtitles: form.elements.subtitles.checked },
    });
    const finished = await pollJob(payload.data.id, (job) => {
      status.className = `job-status${job.state === 'FAILED' ? ' is-failed' : ''}`;
      status.textContent = job.state === 'FAILED'
        ? `${labels.job[job.state]}: ${job.errorMessage || job.error?.message || '다운로드에 실패했습니다.'}`
        : `${labels.job[job.state] || job.state}: 선택한 소스를 처리하고 있습니다.`;
    });
    if (finished.state === 'FAILED') return;

    const detail = await request(`/api/clips/${encodeURIComponent(clipId)}`);
    if (state.activeClip?.id === clipId) {
      state.activeClip = detail.data;
      showToast('클립 다운로드를 완료했습니다.');
      renderClipDetail(state.activeClip);
    }
    await loadClips({ quiet: true });
  } catch (error) {
    status.className = 'job-status is-failed';
    status.textContent = errorMessage(error);
  } finally {
    submit.disabled = false;
  }
}

async function pollJob(id, onUpdate) {
  const terminal = new Set(['SUCCEEDED', 'FAILED']);
  for (;;) {
    const payload = await request(`/api/jobs/${encodeURIComponent(id)}`);
    const job = payload?.data;
    onUpdate(job);
    if (terminal.has(job.state)) return job;
    await new Promise((resolve) => window.setTimeout(resolve, 1200));
  }
}

function voicevoxParameters() {
  return Object.fromEntries(Object.entries(ui.voicevox.params).map(([key, node]) => [key, Number(node.value)]));
}

function setVoicevoxStatus(kind, title, copy) {
  ui.voicevox.dot.className = `status-dot ${kind === 'ready' ? 'is-good' : kind === 'loading' ? '' : 'is-bad'}`;
  ui.voicevox.statusTitle.textContent = title;
  ui.voicevox.statusCopy.textContent = copy;
}

function voicevoxSelectedVoice() {
  return state.voicevox.voices.find((voice) => voice.speakerUuid === state.voicevox.selectedSpeakerUuid && String(voice.styleId) === String(state.voicevox.selectedStyleId));
}

function renderVoicevox() {
  const speakers = [...new Map(state.voicevox.voices.map((voice) => [voice.speakerUuid, voice])).values()];
  const currentSpeaker = state.voicevox.selectedSpeakerUuid;
  ui.voicevox.speaker.replaceChildren(element('option', '', '화자를 선택하세요'));
  ui.voicevox.speaker.firstChild.value = '';
  speakers.forEach((voice) => { const option = element('option', '', voice.speakerName); option.value = voice.speakerUuid; ui.voicevox.speaker.append(option); });
  ui.voicevox.speaker.value = currentSpeaker;
  const styles = state.voicevox.voices.filter((voice) => voice.speakerUuid === currentSpeaker);
  ui.voicevox.style.replaceChildren(element('option', '', currentSpeaker ? '스타일을 선택하세요' : '먼저 화자를 선택하세요'));
  ui.voicevox.style.firstChild.value = '';
  styles.forEach((voice) => { const option = element('option', '', voice.styleName); option.value = String(voice.styleId); ui.voicevox.style.append(option); });
  ui.voicevox.style.value = String(state.voicevox.selectedStyleId || '');
  const ready = state.voicevox.voices.length > 0;
  ui.voicevox.speaker.disabled = !ready;
  ui.voicevox.style.disabled = !ready || !currentSpeaker;
  const selected = Boolean(voicevoxSelectedVoice());
  ui.voicevox.save.disabled = !selected || !ui.voicevox.profileName.value.trim() || state.voicevox.busy;
  ui.voicevox.preview.disabled = !selected || state.voicevox.busy;
  ui.voicevox.generate.disabled = !selected || state.voicevox.busy;
  Object.entries(ui.voicevox.params).forEach(([key, node]) => { ui.voicevox.values[key].textContent = Number(node.value).toFixed(2); });
}

async function loadVoicevox() {
  state.voicevox.busy = true;
  setVoicevoxStatus('loading', 'VOICEVOX 연결 확인 중', '로컬 엔진과 화자 목록을 불러오고 있습니다.');
  setAlert(ui.voicevox.alert, '');
  renderVoicevox();
  try {
    const health = await request('/api/voicevox/health');
    if (health?.data?.status && health.data.status !== 'success') throw new ApiError('VOICEVOX 엔진을 사용할 수 없습니다.', 'ENGINE_UNAVAILABLE', 503, health.data);
    const [speakerPayload, profilePayload] = await Promise.all([request('/api/voicevox/speakers'), request('/api/voicevox/profile')]);
    state.voicevox.voices = Array.isArray(speakerPayload?.data?.voices) ? speakerPayload.data.voices : [];
    state.voicevox.profile = profilePayload?.data || null;
    state.voicevox.selectedSpeakerUuid = '';
    state.voicevox.selectedStyleId = '';
    if (state.voicevox.profile && state.voicevox.voices.some((voice) => voice.speakerUuid === state.voicevox.profile.speakerUuid && String(voice.styleId) === String(state.voicevox.profile.styleId))) {
      state.voicevox.selectedSpeakerUuid = state.voicevox.profile.speakerUuid;
      state.voicevox.selectedStyleId = state.voicevox.profile.styleId;
      ui.voicevox.profileName.value = state.voicevox.profile.profileName || '';
      Object.entries(state.voicevox.profile.parameters || {}).forEach(([key, value]) => { if (ui.voicevox.params[key]) ui.voicevox.params[key].value = value; });
    } else if (state.voicevox.profile) {
      ui.voicevox.profileStatus.textContent = '저장된 화자 또는 스타일이 없어 다시 선택하세요.';
    }
    setVoicevoxStatus('ready', 'VOICEVOX 준비됨', `${state.voicevox.voices.length}개 스타일을 불러왔습니다. 화자와 스타일을 직접 선택하세요.`);
  } catch (error) {
    state.voicevox.voices = [];
    setVoicevoxStatus('unavailable', 'VOICEVOX를 사용할 수 없습니다', '엔진 상태를 확인한 뒤 다시 시도하세요. 클립 라이브러리는 계속 사용할 수 있습니다.');
    setAlert(ui.voicevox.alert, errorMessage(error));
  } finally {
    state.voicevox.busy = false;
    renderVoicevox();
  }
}

function renderVoiceStudioInstall() {
  const installed = state.voicestudio.installed;
  ui.voicestudio.install.disabled = installed || state.voicestudio.busy;
  ui.voicestudio.install.textContent = installed ? '설치됨' : state.voicestudio.busy ? '설치 중…' : 'VoiceStudio 설치';
  ui.voicestudio.start.disabled = !installed || state.voicestudio.busy || state.voicestudio.running;
  ui.voicestudio.start.textContent = state.voicestudio.running ? '실행 중' : 'VoiceStudio 실행';
}

const voiceStudioKittenVoices = ['Bella', 'Jasper', 'Luna', 'Bruno', 'Rosie', 'Hugo', 'Kiki', 'Leo'].map((id) => ({ id, name: id, language: 'English' }));

function setVoiceStudioProviderStatus(kind, title, copy) {
  ui.voicestudio.providerDot.className = `status-dot ${kind === 'ready' ? 'is-good' : kind === 'loading' ? '' : 'is-bad'}`;
  ui.voicestudio.providerTitle.textContent = title;
  ui.voicestudio.providerCopy.textContent = copy;
}

function voiceStudioModelVoices() {
  if (state.voicestudio.model === 'kittentts') return voiceStudioKittenVoices;
  return state.voicestudio.voices;
}

function renderVoiceStudioWorkspace() {
  const voices = voiceStudioModelVoices();
  const selected = state.voicestudio.selectedVoiceId;
  ui.voicestudio.model.value = state.voicestudio.model;
  ui.voicestudio.voice.replaceChildren(element('option', '', voices.length ? '음성을 선택하세요' : '사용 가능한 음성이 없습니다'));
  ui.voicestudio.voice.firstChild.value = '';
  voices.forEach((voice) => {
    const option = element('option', '', voice.language ? `${voice.name} · ${voice.language}` : voice.name);
    option.value = voice.id;
    ui.voicestudio.voice.append(option);
  });
  ui.voicestudio.voice.value = selected;
  const ready = state.voicestudio.providerReady;
  ui.voicestudio.model.disabled = !ready || state.voicestudio.busy;
  ui.voicestudio.voice.disabled = !ready || !voices.length || state.voicestudio.busy;
  ui.voicestudio.preview.disabled = !ready || !selected || !ui.voicestudio.text.value.trim() || state.voicestudio.busy;
  ui.voicestudio.preview.textContent = state.voicestudio.busy ? '음성 생성 중…' : 'VoiceStudio 미리듣기';
}

async function loadVoiceStudioProvider() {
  setVoiceStudioProviderStatus('loading', 'backend 상태 확인 중', 'VoiceStudio provider와 음성 목록을 확인하고 있습니다.');
  try {
    const payload = await request('/api/tts/providers');
    const provider = Array.isArray(payload?.data) ? payload.data.find((item) => item.provider === 'voicestudio') : null;
    state.voicestudio.providerReady = provider?.state === 'ready';
    state.voicestudio.running = state.voicestudio.providerReady;
    if (!state.voicestudio.providerReady) {
      state.voicestudio.voices = [];
      state.voicestudio.selectedVoiceId = '';
      setVoiceStudioProviderStatus('unavailable', 'VoiceStudio backend 미연결', '설치 상태 카드에서 VoiceStudio 실행을 선택하세요.');
      return;
    }
    const voices = await request('/api/tts/providers/voicestudio/voices');
    state.voicestudio.voices = Array.isArray(voices?.data) ? voices.data : [];
    setVoiceStudioProviderStatus('ready', 'VoiceStudio backend 준비됨', `${state.voicestudio.voices.length}개 기본 음성을 확인했습니다.`);
  } catch (error) {
    state.voicestudio.providerReady = false;
    setVoiceStudioProviderStatus('unavailable', 'VoiceStudio backend 확인 실패', errorMessage(error));
  } finally {
    renderVoiceStudioWorkspace();
  }
}

function setVoiceStudioInstallStatus(kind, title, copy) {
  ui.voicestudio.dot.className = `status-dot ${kind === 'ready' ? 'is-good' : kind === 'loading' ? '' : 'is-bad'}`;
  ui.voicestudio.title.textContent = title;
  ui.voicestudio.copy.textContent = copy;
}

async function loadVoiceStudio() {
  setVoiceStudioInstallStatus('loading', '설치 상태 확인 중', 'VoiceStudio 설치 여부를 확인하고 있습니다.');
  try {
    const payload = await request('/api/tts/providers/voicestudio/installation');
    state.voicestudio.installed = Boolean(payload?.data?.installed);
    if (state.voicestudio.installed) {
      setVoiceStudioInstallStatus('ready', 'VoiceStudio 설치됨', 'VoiceStudio를 실행하면 로컬 backend에 연결할 수 있습니다.');
      ui.voicestudio.help.textContent = '앱을 실행한 뒤 연결 상태를 다시 확인하세요.';
    } else {
      setVoiceStudioInstallStatus('unavailable', 'VoiceStudio 미설치', '필요할 때 공식 Windows x64 설치 파일로 설치할 수 있습니다.');
    }
  } catch (error) {
    setVoiceStudioInstallStatus('unavailable', '설치 상태를 확인할 수 없습니다', errorMessage(error));
  } finally {
    renderVoiceStudioInstall();
    await loadVoiceStudioProvider();
  }
}

async function installVoiceStudio() {
  if (state.voicestudio.busy || state.voicestudio.installed) return;
  if (!window.confirm('공식 VoiceStudio 설치 파일을 다운로드하고 설치 프로그램을 실행할까요?')) return;
  state.voicestudio.busy = true;
  renderVoiceStudioInstall();
  setVoiceStudioInstallStatus('loading', 'VoiceStudio 설치 중', 'Release 확인, checksum 검증, 설치 프로그램 실행을 진행합니다.');
  try {
    const payload = await request('/api/tts/providers/voicestudio/install', { method: 'POST', body: { consent: true } });
    state.voicestudio.installed = Boolean(payload?.data?.installation?.installed);
    setVoiceStudioInstallStatus('ready', 'VoiceStudio 설치 완료', 'VoiceStudio를 실행한 뒤 연결 상태를 다시 확인하세요.');
    ui.voicestudio.help.textContent = '설치가 완료되었습니다. VoiceStudio를 실행하면 backend를 연결합니다.';
    showToast('VoiceStudio 설치가 완료되었습니다.');
  } catch (error) {
    setVoiceStudioInstallStatus('unavailable', 'VoiceStudio 설치 실패', errorMessage(error));
  } finally {
    state.voicestudio.busy = false;
    renderVoiceStudioInstall();
  }
}

async function startVoiceStudio() {
  if (!state.voicestudio.installed || state.voicestudio.busy || state.voicestudio.running) return;
  if (!window.confirm('설치된 VoiceStudio를 실행하고 backend 연결을 기다릴까요?')) return;
  state.voicestudio.busy = true;
  renderVoiceStudioInstall();
  setVoiceStudioInstallStatus('loading', 'VoiceStudio 실행 중', '설치된 앱을 실행하고 backend 준비를 기다립니다.');
  try {
    const payload = await request('/api/tts/providers/voicestudio/start', { method: 'POST', body: { consent: true } });
    state.voicestudio.running = payload?.data?.ownership === 'external' || payload?.data?.ownership === 'nihon-managed';
    setVoiceStudioInstallStatus('ready', 'VoiceStudio backend 준비됨', '이제 VoiceStudio provider로 음성을 생성할 수 있습니다.');
    ui.voicestudio.help.textContent = payload?.data?.ownership === 'external' ? '기존에 실행 중인 VoiceStudio backend에 연결했습니다.' : 'Short-auto가 시작한 VoiceStudio backend에 연결했습니다.';
    await loadVoiceStudioProvider();
    showToast('VoiceStudio backend에 연결했습니다.');
  } catch (error) {
    setVoiceStudioInstallStatus('unavailable', 'VoiceStudio 실행 실패', errorMessage(error));
  } finally {
    state.voicestudio.busy = false;
    renderVoiceStudioInstall();
  }
}

async function previewVoiceStudio() {
  const text = ui.voicestudio.text.value.trim();
  if (!state.voicestudio.selectedVoiceId) { setVoiceStudioProviderStatus('unavailable', '음성을 선택하세요', '미리듣기 전에 VoiceStudio 음성을 선택해야 합니다.'); return; }
  if (!text) { ui.voicestudio.text.focus(); return; }
  state.voicestudio.busy = true;
  renderVoiceStudioWorkspace();
  try {
    const url = await voicevoxAudio('/api/tts/providers/voicestudio/synthesize', {
      text,
      voiceId: state.voicestudio.selectedVoiceId,
      providerOptions: { model: state.voicestudio.model },
    });
    if (state.voicestudio.audioUrl) URL.revokeObjectURL(state.voicestudio.audioUrl);
    state.voicestudio.audioUrl = url;
    ui.voicestudio.audio.src = url;
    ui.voicestudio.audio.hidden = false;
    ui.voicestudio.result.hidden = false;
    ui.voicestudio.result.textContent = `${state.voicestudio.selectedVoiceId} 음성 미리듣기를 준비했습니다.`;
  } catch (error) {
    ui.voicestudio.result.hidden = false;
    ui.voicestudio.result.textContent = errorMessage(error);
  } finally {
    state.voicestudio.busy = false;
    renderVoiceStudioWorkspace();
  }
}

async function voicevoxAudio(path, body) {
  let response;
  try { response = await fetch(path, { method: 'POST', headers: { Accept: 'audio/wav', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
  catch { throw new ApiError('로컬 서버에 연결할 수 없습니다.', 'NETWORK_ERROR', 0); }
  if (!response.ok) { let payload = null; try { payload = await response.json(); } catch {} throw new ApiError(payload?.error?.message || '음성을 만들지 못했습니다.', payload?.error?.code || 'REQUEST_FAILED', response.status, payload?.error); }
  return URL.createObjectURL(await response.blob());
}

function voicevoxSelectionRequired() {
  if (!voicevoxSelectedVoice()) { setAlert(ui.voicevox.alert, '화자와 스타일을 먼저 선택하세요.'); return false; }
  return true;
}

async function previewVoicevox() {
  if (!voicevoxSelectionRequired()) return;
  const text = ui.voicevox.text.value.trim();
  if (!text) { setAlert(ui.voicevox.alert, '미리들을 문장을 입력하세요.'); ui.voicevox.text.focus(); return; }
  state.voicevox.busy = true; renderVoicevox(); setAlert(ui.voicevox.alert, '');
  try { const url = await voicevoxAudio('/api/voicevox/preview', { text, styleId: Number(state.voicevox.selectedStyleId), parameters: voicevoxParameters() }); if (state.voicevox.audioUrl) URL.revokeObjectURL(state.voicevox.audioUrl); state.voicevox.audioUrl = url; ui.voicevox.audio.src = url; ui.voicevox.audio.hidden = false; setAlert(ui.voicevox.alert, ''); ui.voicevox.result.hidden = false; ui.voicevox.result.textContent = '미리듣기 파일을 준비했습니다.'; }
  catch (error) { setAlert(ui.voicevox.alert, errorMessage(error)); }
  finally { state.voicevox.busy = false; renderVoicevox(); }
}

async function generateVoicevox() {
  if (!voicevoxSelectionRequired()) return;
  const lines = ui.voicevox.text.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const contentId = ui.voicevox.contentId.value.trim();
  if (!lines.length) { setAlert(ui.voicevox.alert, '생성할 문장을 입력하세요.'); ui.voicevox.text.focus(); return; }
  if (!contentId) { setAlert(ui.voicevox.alert, '콘텐츠 ID를 입력하세요.'); ui.voicevox.contentId.focus(); return; }
  state.voicevox.busy = true; renderVoicevox(); setAlert(ui.voicevox.alert, '');
  try { const payload = await request('/api/voicevox/generations', { method: 'POST', body: { contentId, sentences: lines.map((text, index) => ({ id: `sentence_${String(index + 1).padStart(3, '0')}`, text })) } }); const result = payload?.data; ui.voicevox.result.hidden = false; ui.voicevox.result.textContent = `${lines.length}개 문장을 생성했습니다. 매니페스트: ${result?.manifestPath || '저장 경로 확인 필요'}`; }
  catch (error) { setAlert(ui.voicevox.alert, errorMessage(error)); }
  finally { state.voicevox.busy = false; renderVoicevox(); }
}

async function saveVoicevoxProfile() {
  if (!voicevoxSelectionRequired()) return;
  const profileName = ui.voicevox.profileName.value.trim();
  if (!profileName) { setAlert(ui.voicevox.alert, '프로필 이름을 입력하세요.'); ui.voicevox.profileName.focus(); return; }
  state.voicevox.busy = true; renderVoicevox(); setAlert(ui.voicevox.alert, '');
  try { const payload = await request('/api/voicevox/profile', { method: 'PUT', body: { profileName, speakerUuid: state.voicevox.selectedSpeakerUuid, styleId: Number(state.voicevox.selectedStyleId), parameters: voicevoxParameters() } }); state.voicevox.profile = payload?.data || null; ui.voicevox.profileStatus.textContent = '보이스 프로필을 저장했습니다.'; showToast('VOICEVOX 보이스 프로필을 저장했습니다.'); }
  catch (error) { setAlert(ui.voicevox.alert, errorMessage(error)); }
  finally { state.voicevox.busy = false; renderVoicevox(); }
}

function bindEvents() {
  ui.navButtons.forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));
  ui.voicevox.retry.addEventListener('click', loadVoicevox);
  ui.voicestudio.install.addEventListener('click', installVoiceStudio);
  ui.voicestudio.start.addEventListener('click', startVoiceStudio);
  ui.voicestudio.model.addEventListener('change', () => { state.voicestudio.model = ui.voicestudio.model.value; state.voicestudio.selectedVoiceId = ''; renderVoiceStudioWorkspace(); });
  ui.voicestudio.voice.addEventListener('change', () => { state.voicestudio.selectedVoiceId = ui.voicestudio.voice.value; renderVoiceStudioWorkspace(); });
  ui.voicestudio.text.addEventListener('input', renderVoiceStudioWorkspace);
  ui.voicestudio.preview.addEventListener('click', previewVoiceStudio);
  ui.voicevox.speaker.addEventListener('change', () => { state.voicevox.selectedSpeakerUuid = ui.voicevox.speaker.value; state.voicevox.selectedStyleId = ''; renderVoicevox(); });
  ui.voicevox.style.addEventListener('change', () => { state.voicevox.selectedStyleId = ui.voicevox.style.value; renderVoicevox(); });
  ui.voicevox.profileName.addEventListener('input', renderVoicevox);
  Object.entries(ui.voicevox.params).forEach(([key, node]) => node.addEventListener('input', () => { ui.voicevox.values[key].textContent = Number(node.value).toFixed(2); }));
  ui.voicevox.save.addEventListener('click', saveVoicevoxProfile);
  ui.voicevox.preview.addEventListener('click', previewVoicevox);
  ui.voicevox.generate.addEventListener('click', generateVoicevox);
  ui.clipFilters.addEventListener('submit', (event) => { event.preventDefault(); loadClips(); });
  document.querySelector('#refresh-clips').addEventListener('click', () => loadClips());
  document.querySelector('#open-channel-form').addEventListener('click', () => openChannelDialog());
  ui.channelForm.addEventListener('submit', submitChannel);
  document.querySelectorAll('[data-close-dialog]').forEach((button) => button.addEventListener('click', closeChannelDialog));
  document.querySelector('#close-detail').addEventListener('click', closeClipDetail);
  ui.detailBackdrop.addEventListener('click', closeClipDetail);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && ui.detail.classList.contains('is-open')) closeClipDetail();
  });
}

async function start() {
  bindEvents();
  renderSkeletons(ui.clipList, 4);
  renderSkeletons(ui.channelList, 3);
  await Promise.all([loadHealth(), loadChannels(), loadClips()]);
  loadVoicevox();
  loadVoiceStudio();
}

start();
