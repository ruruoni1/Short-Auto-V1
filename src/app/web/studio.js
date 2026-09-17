const API = {
  templates: '/api/thumbnail-templates',
  fonts: '/api/font-registry',
  projects: '/api/thumbnail-projects',
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const els = {
  projectName: $('#project-name'), saveState: $('#save-state'), projectLineage: $('#project-lineage'), save: $('#save-project'),
  exportButtons: $$('[data-export]'), projectList: $('#project-list'), templateList: $('#template-list'),
  dialogTemplateList: $('#dialog-template-list'), newProject: $('#new-project'), emptyNewProject: $('#empty-new-project'),
  dialog: $('#new-project-dialog'), newProjectForm: $('#new-project-form'), newProjectName: $('#new-project-name'),
  createProject: $('#create-project'), dialogError: $('#dialog-error'), baseUpload: $('#base-upload'),
  variantName: $('#variant-name'), createVariant: $('#create-variant'), sourceFrameId: $('#source-frame-id'), createFromSource: $('#create-from-source'), projectFlowHelp: $('#project-flow-help'),
  contentPlanSelect: $('#content-plan-select'), contentPlanSummary: $('#content-plan-summary'), contentPlanId: $('#content-plan-id'), contentPlanTitle: $('#content-plan-title'), contentPlanType: $('#content-plan-type'), contentPlanStatus: $('#content-plan-status'), createContentPlan: $('#create-content-plan'),
  baseSourceType: $('#base-source-type'), uploadDrop: $('#upload-drop'), canvas: $('#editor-canvas'),
  canvasWrap: $('#canvas-wrap'), canvasViewport: $('#canvas-viewport'), studioEmpty: $('#studio-empty'),
  canvasPreset: $('#canvas-preset'), canvasSize: $('#canvas-size'), workspaceError: $('#workspace-error'),
  leftError: $('#left-error'), fontWarning: $('#font-warning'), addText: $('#add-text'),
  inspector: $('#text-inspector'), inspectorEmpty: $('#inspector-empty'), layerText: $('#layer-text'),
  layerFont: $('#layer-font'), layerWeight: $('#layer-weight'), layerSize: $('#layer-size'),
  layerAlign: $('#layer-align'), layerColor: $('#layer-color'), layerStrokeColor: $('#layer-stroke-color'),
  layerStrokeWidth: $('#layer-stroke-width'), layerUp: $('#layer-up'), layerDown: $('#layer-down'),
  layerLock: $('#layer-lock'), layerVisible: $('#layer-visible'), deleteLayer: $('#delete-layer'),
  layerList: $('#layer-list'), layerCount: $('#layer-count'), undo: $('#undo'), redo: $('#redo'),
  zoomOut: $('#zoom-out'), zoomIn: $('#zoom-in'), zoomValue: $('#zoom-value'), fit: $('#fit-canvas'),
  toggleSafe: $('#toggle-safe'), toastRegion: $('#toast-region'),
};

const state = {
  templates: [], projects: [], fonts: [], project: null, selectedLayerId: null,
  baseImage: null, baseImageUrl: null, zoom: 1, fitScale: 1, fontReady: false,
  history: [], historyIndex: -1, dirty: false, pointer: null, selectedTemplateId: null,
  operation: null,
  contentPlans: [], selectedPlan: null,
};

const clone = (value) => structuredClone(value);
const projectUrl = (id, suffix = '') => `${API.projects}/${encodeURIComponent(id)}${suffix}`;
const sampleText = '한글 日本語 ABC 123';

function errorMessage(error) {
  if (error?.payload?.error?.message) return error.payload.error.message;
  if (error instanceof Error && error.message) return error.message;
  return '요청을 처리하지 못했습니다.';
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: options.body ? { 'Content-Type': 'application/json', ...(options.headers || {}) } : options.headers,
  });
  const payload = response.headers.get('content-type')?.includes('application/json')
    ? await response.json()
    : null;
  if (!response.ok) {
    const error = new Error(payload?.error?.message || `요청 실패 (${response.status})`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  if (payload?.data !== undefined) {
    const data = payload.data;
    if (payload.meta && data && typeof data === 'object') Object.defineProperty(data, '__meta', { value: payload.meta, enumerable: false });
    return data;
  }
  return payload;
}

function setBusy(button, busy, label) {
  if (!button) return;
  if (busy) {
    button.dataset.label = button.textContent.trim();
    button.textContent = label;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
  } else {
    button.textContent = button.dataset.label || button.textContent;
    button.removeAttribute('aria-busy');
    refreshControls();
  }
}

function showError(element, message) {
  element.textContent = message;
  element.hidden = !message;
}

function toast(message, kind = 'success') {
  const item = document.createElement('div');
  item.className = `toast toast-${kind}`;
  item.textContent = message;
  els.toastRegion.append(item);
  window.setTimeout(() => item.remove(), 3800);
}

function normalizeTemplate(template) {
  const id = template.id || template.templateId;
  const canvas = template.canvas || { width: template.width, height: template.height };
  return {
    ...template,
    id,
    name: template.name || template.label || id,
    description: template.description || template.summary || '편집 가능한 기본 조판',
    canvas,
  };
}

function normalizeProject(project) {
  return {
    ...project,
    id: project.id || project.projectId,
    name: project.name || project.title || '이름 없는 프로젝트',
    revision: Number(project.revision ?? 0),
    canvas: project.canvas || { width: 1280, height: 720 },
    layers: Array.isArray(project.layers) ? project.layers.map(normalizeLayer) : [],
    sourceRefs: project.sourceRefs || [],
    exports: project.exports || [],
    safeAreaVisible: project.safeAreaVisible ?? true,
    baseImageTransform: project.baseImageTransform || project.baseImage?.transform,
  };
}

function normalizeLayer(layer) {
  return {
    id: layer.id || `text_${crypto.randomUUID()}`,
    type: 'text', text: layer.text ?? '', x: Number(layer.x ?? 80), y: Number(layer.y ?? 80),
    width: Number(layer.width ?? 520), height: Number(layer.height ?? 180), rotation: Number(layer.rotation ?? 0),
    fontFamily: layer.fontFamily || layer.font_family || state.fonts[0]?.family || 'sans-serif',
    fontWeight: Number(layer.fontWeight ?? layer.font_weight ?? 700),
    fontSize: Number(layer.fontSize ?? layer.font_size ?? 72), color: layer.color || '#FFFFFF',
    align: layer.align || 'left', letterSpacing: Number(layer.letterSpacing ?? layer.letter_spacing ?? 0),
    lineHeight: Number(layer.lineHeight ?? layer.line_height ?? 1.08),
    strokeColor: layer.strokeColor || layer.stroke_color || '#111111',
    strokeWidth: Number(layer.strokeWidth ?? layer.stroke_width ?? 3),
    shadow: layer.shadow || { enabled: true, x: 2, y: 3, blur: 6, opacity: 0.35 },
    locked: Boolean(layer.locked), visible: layer.visible !== false,
  };
}

function selectedLayer() {
  return state.project?.layers.find((layer) => layer.id === state.selectedLayerId) || null;
}

function templateForProject() {
  return state.templates.find((template) => template.id === state.project?.templateId) || null;
}

function snapshot() {
  if (!state.project) return null;
  return clone({ name: state.project.name, layers: state.project.layers,
    safeAreaVisible: state.project.safeAreaVisible, baseImageTransform: state.project.baseImageTransform });
}

function restoreSnapshot(value) {
  if (!state.project || !value) return;
  state.project.name = value.name;
  state.project.layers = clone(value.layers);
  state.project.safeAreaVisible = value.safeAreaVisible;
  state.project.baseImageTransform = clone(value.baseImageTransform);
  if (!selectedLayer()) state.selectedLayerId = state.project.layers.at(-1)?.id || null;
  markDirty();
  renderAll();
}

function resetHistory() {
  state.history = state.project ? [snapshot()] : [];
  state.historyIndex = state.project ? 0 : -1;
  refreshControls();
}

function commitHistory() {
  if (!state.project || state.operation) return;
  const next = snapshot();
  const current = state.history[state.historyIndex];
  if (current && JSON.stringify(current) === JSON.stringify(next)) return;
  state.history = state.history.slice(0, state.historyIndex + 1);
  state.history.push(next);
  if (state.history.length > 60) state.history.shift();
  state.historyIndex = state.history.length - 1;
  markDirty();
  refreshControls();
}

function undo() {
  if (state.operation || state.historyIndex <= 0) return;
  state.historyIndex -= 1;
  restoreSnapshot(state.history[state.historyIndex]);
}

function redo() {
  if (state.operation || state.historyIndex >= state.history.length - 1) return;
  state.historyIndex += 1;
  restoreSnapshot(state.history[state.historyIndex]);
}

function markDirty() {
  if (!state.project) return;
  state.dirty = true;
  els.saveState.textContent = '저장되지 않은 변경';
  els.saveState.className = 'save-state is-dirty';
  refreshControls();
}

function markSaved() {
  state.dirty = false;
  els.saveState.textContent = `저장됨 · r${state.project?.revision ?? 0}`;
  els.saveState.className = 'save-state is-saved';
  refreshControls();
}

function templateKind(template) {
  return template.canvas?.height > template.canvas?.width ? 'Shorts · 9:16' : 'Long-form · 16:9';
}

function templateCard(template, dialog = false) {
  const item = document.createElement(dialog ? 'label' : 'button');
  item.className = dialog ? 'template-choice' : 'template-card';
  if (!dialog) item.type = 'button';
  const ratio = template.canvas.height > template.canvas.width ? 'portrait' : 'landscape';
  item.innerHTML = `${dialog ? `<input type="radio" name="templateId" value="${escapeHtml(template.id)}" required />` : ''}
    <span class="template-preview ${ratio}" aria-hidden="true"><i></i><b></b></span>
    <span class="template-copy"><strong>${escapeHtml(template.name)}</strong><small>${escapeHtml(templateKind(template))}</small><span>${escapeHtml(template.description)}</span></span>`;
  if (!dialog) item.addEventListener('click', () => openNewProject(template.id));
  return item;
}

function renderTemplates() {
  els.templateList.replaceChildren();
  els.dialogTemplateList.replaceChildren();
  state.templates.forEach((template) => {
    els.templateList.append(templateCard(template));
    els.dialogTemplateList.append(templateCard(template, true));
  });
  els.templateList.setAttribute('aria-busy', 'false');
  if (!state.templates.length) {
    els.templateList.innerHTML = '<p class="panel-empty">사용할 수 있는 템플릿이 없습니다.</p>';
    els.dialogTemplateList.innerHTML = '<p class="panel-empty">템플릿을 불러오지 못했습니다.</p>';
  }
}

function renderProjects() {
  els.projectList.replaceChildren();
  state.projects.forEach((project) => {
    const item = document.createElement('div');
    item.className = `project-card${project.id === state.project?.id ? ' is-active' : ''}`;
    const open = document.createElement('button');
    open.type = 'button';
    open.disabled = Boolean(state.operation);
    open.className = 'project-open';
    open.innerHTML = `<span class="project-thumb ${project.canvas?.height > project.canvas?.width ? 'portrait' : ''}" aria-hidden="true"></span><span><strong>${escapeHtml(project.name)}</strong><small>${escapeHtml(project.canvas?.width || 0)} × ${escapeHtml(project.canvas?.height || 0)} · r${escapeHtml(project.revision ?? 0)}</small>${project.variantOfProjectId ? `<small class="project-variant-label">A/B · 원본 보존</small>` : ''}</span>`;
    open.addEventListener('click', () => loadProject(project.id));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.disabled = Boolean(state.operation);
    remove.className = 'project-delete';
    remove.setAttribute('aria-label', `${project.name} 삭제`);
    remove.innerHTML = '<svg aria-hidden="true"><use href="#i-trash"></use></svg>';
    remove.addEventListener('click', () => deleteProject(project));
    item.append(open, remove);
    els.projectList.append(item);
  });
  els.projectList.setAttribute('aria-busy', 'false');
  if (!state.projects.length) els.projectList.innerHTML = '<p class="panel-empty">저장된 프로젝트가 없습니다.<br />새 프로젝트를 만들어 시작하세요.</p>';
}

function renderLayers() {
  els.layerList.replaceChildren();
  if (!state.project) {
    els.layerCount.textContent = '0개';
    return;
  }
  [...state.project.layers].reverse().forEach((layer, reverseIndex) => {
    const index = state.project.layers.length - 1 - reverseIndex;
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `layer-item${layer.id === state.selectedLayerId ? ' is-active' : ''}${layer.visible ? '' : ' is-hidden'}`;
    item.setAttribute('aria-pressed', String(layer.id === state.selectedLayerId));
    item.innerHTML = `<span class="layer-type" aria-hidden="true">T</span><span><strong>${escapeHtml(layer.text || '빈 텍스트')}</strong><small>${escapeHtml(layer.fontFamily)} · ${escapeHtml(layer.fontSize)}px</small></span><span class="layer-flags">${layer.locked ? '잠금' : ''}${layer.visible ? '' : '숨김'}</span>`;
    item.addEventListener('click', () => { state.selectedLayerId = layer.id; renderAll(); els.canvas.focus(); });
    item.dataset.index = String(index);
    els.layerList.append(item);
  });
  els.layerCount.textContent = `${state.project.layers.length}개`;
}

function renderInspector() {
  const layer = selectedLayer();
  els.inspector.hidden = !layer;
  els.inspectorEmpty.hidden = Boolean(layer);
  if (!layer) return;
  els.layerText.value = layer.text;
  els.layerFont.value = layer.fontFamily;
  updateWeightOptions(layer.fontFamily, layer.fontWeight);
  els.layerSize.value = String(layer.fontSize);
  els.layerAlign.value = layer.align;
  els.layerColor.value = layer.color;
  els.layerStrokeColor.value = layer.strokeColor;
  els.layerStrokeWidth.value = String(layer.strokeWidth);
  els.layerLock.setAttribute('aria-pressed', String(layer.locked));
  els.layerVisible.setAttribute('aria-pressed', String(layer.visible));
  els.layerLock.classList.toggle('is-active', layer.locked);
  els.layerVisible.classList.toggle('is-active', layer.visible);
}

function updateWeightOptions(family, selected) {
  const font = state.fonts.find((entry) => entry.family === family);
  const weights = font?.weights?.length ? font.weights : [400, 700];
  els.layerWeight.replaceChildren(...weights.map((weight) => {
    const option = document.createElement('option');
    option.value = String(weight);
    option.textContent = weight === 400 ? 'Regular' : weight === 700 ? 'Bold' : String(weight);
    return option;
  }));
  const closest = weights.includes(Number(selected)) ? Number(selected) : weights.reduce((a, b) => Math.abs(b - selected) < Math.abs(a - selected) ? b : a);
  els.layerWeight.value = String(closest);
  if (closest !== selected) selectedLayer().fontWeight = closest;
}

function refreshControls() {
  const hasProject = Boolean(state.project);
  const hasLayer = Boolean(selectedLayer());
  const busy = Boolean(state.operation);
  const exportable = hasProject && state.fontReady && !busy;
  els.projectName.disabled = !hasProject || busy;
  els.newProject.disabled = busy;
  els.emptyNewProject.disabled = busy;
  els.createVariant.disabled = !hasProject || busy;
  els.createFromSource.disabled = busy;
  els.save.disabled = !hasProject || !state.dirty || busy;
  els.exportButtons.forEach((button) => { button.disabled = !exportable; });
  [els.addText, els.baseUpload, els.baseSourceType, els.zoomOut, els.zoomIn, els.fit, els.toggleSafe].forEach((element) => { element.disabled = !hasProject || busy; });
  els.undo.disabled = !hasProject || state.historyIndex <= 0 || busy;
  els.redo.disabled = !hasProject || state.historyIndex >= state.history.length - 1 || busy;
  [els.layerUp, els.layerDown, els.layerLock, els.layerVisible, els.deleteLayer].forEach((element) => { element.disabled = !hasLayer || busy; });
  els.toggleSafe.setAttribute('aria-pressed', String(state.project?.safeAreaVisible ?? true));
}

function renderAll() {
  const project = state.project;
  els.projectName.disabled = !project;
  els.projectName.value = project?.name || '프로젝트를 선택하세요';
  els.projectLineage.textContent = project?.variantOfProjectId ? `A/B 변형 · 원본 ${project.variantOfProjectId} 보존됨` : project ? '원본 프로젝트' : '';
  els.canvasWrap.hidden = !project;
  els.studioEmpty.hidden = Boolean(project);
  els.canvasPreset.textContent = project ? (templateForProject()?.name || project.templateId) : '캔버스 없음';
  els.canvasSize.textContent = project ? `${project.canvas.width} × ${project.canvas.height}` : '프로젝트를 선택하세요';
  renderProjects();
  renderLayers();
  renderInspector();
  refreshControls();
  if (project) {
    resizeCanvas();
    drawEditor();
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[character]);
}

function openNewProject(templateId = state.templates[0]?.id) {
  if (state.operation) return;
  state.selectedTemplateId = templateId;
  els.newProjectForm.reset();
  els.newProjectName.value = `썸네일 ${new Date().toLocaleDateString('ko-KR')}`;
  const radio = els.dialogTemplateList.querySelector(`input[value="${CSS.escape(templateId || '')}"]`);
  if (radio) radio.checked = true;
  showError(els.dialogError, '');
  els.dialog.showModal();
  window.setTimeout(() => els.newProjectName.focus(), 0);
}

async function createProject(event) {
  event.preventDefault();
  const form = new FormData(els.newProjectForm);
  const name = String(form.get('name') || els.newProjectName.value).trim();
  const templateId = String(form.get('templateId') || '');
  if (!name || !templateId) {
    showError(els.dialogError, '프로젝트 이름과 템플릿을 선택하세요.');
    return;
  }
  if (state.operation) return;
  state.operation = 'create';
  setBusy(els.createProject, true, '만드는 중…');
  try {
    const project = normalizeProject(await api(API.projects, { method:'POST', body:JSON.stringify({ name, templateId, channelProfile:'nihon_zupzup' }) }));
    state.projects.unshift(project);
    els.dialog.close();
    await setProject(project);
    toast('새 프로젝트를 만들었습니다.');
  } catch (error) {
    showError(els.dialogError, errorMessage(error));
  } finally {
    state.operation = null;
    setBusy(els.createProject, false);
    renderProjects();
  }
}

function currentProjectSnapshot() {
  return state.project ? { id: state.project.id, revision: state.project.revision, name: state.project.name } : null;
}

function snapshotStillCurrent(snapshot) {
  return Boolean(snapshot && state.project && state.project.id === snapshot.id && state.project.revision === snapshot.revision && state.project.name === snapshot.name);
}

function renderContentPlanSummary(plan = state.selectedPlan, warnings = []) {
  if (!plan) { els.contentPlanSummary.textContent = '선택한 ContentPlan의 썸네일 프로젝트와 검수 경고가 표시됩니다.'; return; }
  const projects = Array.isArray(plan.thumbnailProjects) ? plan.thumbnailProjects : [];
  const lineage = projects.length ? projects.map((project) => `${project.variantOfProjectId ? 'VARIANT' : 'PRIMARY'} · ${project.name}`).join(' / ') : '연결된 ThumbnailProject 없음';
  const warningText = warnings.length ? ` ⚠ ${warnings.map((warning) => warning.message || warning.code || '검수 경고').join(' · ')}` : '';
  els.contentPlanSummary.textContent = `${plan.contentId} · ${plan.title} · ${plan.status} · ${lineage}${warningText}`;
}

function renderContentPlans() {
  els.contentPlanSelect.replaceChildren(new Option('ContentPlan을 선택하세요', ''));
  state.contentPlans.forEach((plan) => els.contentPlanSelect.append(new Option(`${plan.contentId} · ${plan.title}`, plan.contentId)));
  els.contentPlanSelect.value = state.selectedPlan?.contentId || '';
  renderContentPlanSummary();
}

async function loadContentPlan(contentId) {
  if (!contentId) { state.selectedPlan = null; renderContentPlans(); return; }
  try {
    const plan = await api(`/api/content-plans/${encodeURIComponent(contentId)}`);
    state.selectedPlan = plan;
    renderContentPlanSummary(plan, plan.__meta?.warnings || []);
  } catch (error) { showError(els.leftError, errorMessage(error)); }
}

async function loadContentPlans() {
  try {
    const response = await api('/api/content-plans');
    state.contentPlans = Array.isArray(response) ? response : [];
    renderContentPlans();
  } catch (error) { showError(els.leftError, `ContentPlan을 불러오지 못했습니다. ${errorMessage(error)}`); }
}

async function createContentPlan() {
  if (state.operation) return;
  const contentId = els.contentPlanId.value.trim();
  const title = els.contentPlanTitle.value.trim();
  if (!contentId || !title) { showError(els.leftError, 'ContentPlan 콘텐츠 ID와 제목을 입력하세요.'); return; }
  state.operation = 'content-plan';
  setBusy(els.createContentPlan, true, '저장 중…');
  try {
    const plan = await api('/api/content-plans', { method: 'POST', body: JSON.stringify({ contentId, title, contentType: els.contentPlanType.value, status: els.contentPlanStatus.value }) });
    state.contentPlans = [plan, ...state.contentPlans.filter((item) => item.contentId !== plan.contentId)];
    state.selectedPlan = plan;
    renderContentPlans();
    els.contentPlanId.value = ''; els.contentPlanTitle.value = '';
  } catch (error) { showError(els.leftError, errorMessage(error)); }
  finally { state.operation = null; setBusy(els.createContentPlan, false); renderProjects(); }
}

async function createVariant() {
  if (!state.project || state.operation) return;
  const snapshot = currentProjectSnapshot();
  const name = els.variantName.value.trim();
  state.operation = 'variant';
  setBusy(els.createVariant, true, '복제 중…');
  showError(els.leftError, '');
  try {
    const variant = normalizeProject(await api(projectUrl(snapshot.id, '/variants'), {
      method: 'POST', body: JSON.stringify(name ? { name } : {}),
    }));
    if (!snapshotStillCurrent(snapshot)) throw new Error('현재 편집 중인 프로젝트가 바뀌어 변형을 열지 않았습니다.');
    state.projects = [variant, ...state.projects.filter((project) => project.id !== variant.id)];
    if (state.selectedPlan && variant.contentId === state.selectedPlan.contentId) {
      state.selectedPlan.thumbnailProjects = [...(state.selectedPlan.thumbnailProjects || []), variant];
      renderContentPlanSummary();
    }
    await setProject(variant);
    els.variantName.value = '';
    toast(`A/B 변형을 열었습니다. 원본 ${snapshot.id}는 유지됩니다.`);
  } catch (error) {
    showError(els.leftError, errorMessage(error));
  } finally {
    state.operation = null;
    setBusy(els.createVariant, false);
    renderProjects();
  }
}

async function createFromSourceFrame() {
  if (state.operation) return;
  const sourceFrameId = els.sourceFrameId.value.trim();
  if (!sourceFrameId) { showError(els.leftError, 'SourceFrame ID를 입력하세요.'); els.sourceFrameId.focus(); return; }
  const snapshot = currentProjectSnapshot();
  state.operation = 'source-frame';
  setBusy(els.createFromSource, true, '가져오는 중…');
  showError(els.leftError, '');
  els.projectFlowHelp.textContent = 'A/B 변형은 원본을 보존하고 새 프로젝트로 엽니다.';
  try {
    const rawProject = await api(`${API.projects}/from-source-frame`, {
      method: 'POST', body: JSON.stringify({ sourceFrameId, contentId: state.selectedPlan?.contentId || null }),
    });
    const project = normalizeProject(rawProject);
    if (rawProject.__meta?.warnings?.length) {
      els.projectFlowHelp.textContent = `⚠ ${rawProject.__meta.warnings.map((warning) => warning.message || warning.code).join(' · ')}`;
    }
    if (snapshot && !snapshotStillCurrent(snapshot)) throw new Error('현재 편집 중인 프로젝트가 바뀌어 새 프로젝트를 열지 않았습니다.');
    state.projects = [project, ...state.projects.filter((item) => item.id !== project.id)];
    if (state.selectedPlan && project.contentId === state.selectedPlan.contentId) {
      state.selectedPlan.thumbnailProjects = [...(state.selectedPlan.thumbnailProjects || []), project];
      renderContentPlanSummary();
    }
    await setProject(project);
    toast(`소스 프레임으로 새 프로젝트를 열었습니다: ${project.name}`);
  } catch (error) {
    showError(els.leftError, errorMessage(error));
  } finally {
    state.operation = null;
    setBusy(els.createFromSource, false);
    renderProjects();
  }
}

async function loadProject(id) {
  if (state.operation) return;
  if (state.dirty && !window.confirm('저장되지 않은 변경이 있습니다. 다른 프로젝트를 여시겠어요?')) return;
  state.operation = 'load';
  refreshControls(); renderProjects();
  showError(els.leftError, '');
  try {
    await setProject(normalizeProject(await api(projectUrl(id))));
  } catch (error) {
    showError(els.leftError, errorMessage(error));
  } finally {
    state.operation = null;
    refreshControls(); renderProjects();
  }
}

async function setProject(project) {
  state.project = normalizeProject(project);
  const fontAdjusted = harmonizeProjectFonts();
  state.selectedLayerId = state.project.layers.at(-1)?.id || null;
  state.dirty = fontAdjusted;
  state.zoom = 1;
  state.baseImage = null;
  if (state.baseImageUrl) URL.revokeObjectURL(state.baseImageUrl);
  state.baseImageUrl = null;
  resetHistory();
  if (fontAdjusted) markDirty(); else markSaved();
  renderAll();
  await loadBaseImage();
}

function harmonizeProjectFonts() {
  if (!state.project || !state.fonts.length) return false;
  let changed = false;
  const fallback = state.fonts[0];
  const generic = new Set(['sans-serif','serif','monospace','system-ui']);
  state.project.layers.forEach((layer) => {
    let registered = state.fonts.find((font) => font.family === layer.fontFamily);
    if (!registered && generic.has(layer.fontFamily)) {
      layer.fontFamily = fallback.family;
      registered = fallback;
      changed = true;
    }
    if (!registered) return;
    if (!registered.weights.includes(Number(layer.fontWeight))) {
      layer.fontWeight = registered.weights.reduce((a, b) => Math.abs(b - layer.fontWeight) < Math.abs(a - layer.fontWeight) ? b : a);
      changed = true;
    }
  });
  return changed;
}

async function deleteProject(project) {
  if (state.operation) return;
  if (!window.confirm(`“${project.name}” 프로젝트를 삭제할까요? 이 작업은 되돌릴 수 없습니다.`)) return;
  state.operation = 'delete';
  refreshControls(); renderProjects();
  try {
    await api(projectUrl(project.id), { method:'DELETE', body:JSON.stringify({ expectedRevision:project.revision }) });
    state.projects = state.projects.filter((item) => item.id !== project.id);
    if (state.project?.id === project.id) {
      state.project = null; state.selectedLayerId = null; state.baseImage = null; state.dirty = false;
      els.saveState.textContent = '저장된 프로젝트 없음'; els.saveState.className = 'save-state';
    }
    renderAll();
    toast('프로젝트를 삭제했습니다.');
  } catch (error) {
    showError(els.leftError, errorMessage(error));
  } finally {
    state.operation = null;
    refreshControls(); renderProjects();
  }
}

async function saveProject({ quiet = false, lock = true } = {}) {
  if (!state.project || !state.dirty) return state.project;
  if (state.operation && lock) return state.project;
  if (lock) state.operation = 'save';
  state.project.name = state.project.name.trim();
  if (!state.project.name) {
    showError(els.workspaceError, '프로젝트 이름을 입력하세요.');
    els.projectName.focus();
    throw new Error('프로젝트 이름을 입력하세요.');
  }
  setBusy(els.save, true, '저장 중…');
  try {
    const updated = normalizeProject(await api(projectUrl(state.project.id), {
      method:'PATCH',
      body:JSON.stringify({ expectedRevision:state.project.revision, name:state.project.name,
        layers:state.project.layers, baseImageTransform:state.project.baseImageTransform,
        safeAreaVisible:state.project.safeAreaVisible }),
    }));
    state.project = updated;
    const index = state.projects.findIndex((project) => project.id === updated.id);
    if (index >= 0) state.projects[index] = updated; else state.projects.unshift(updated);
    markSaved();
    resetHistory();
    renderAll();
    if (!quiet) toast('프로젝트를 저장했습니다.');
    return updated;
  } catch (error) {
    if (error.status === 409) showError(els.workspaceError, '다른 작업에서 프로젝트가 변경되었습니다. 프로젝트 목록에서 다시 열고 변경을 적용하세요.');
    else showError(els.workspaceError, errorMessage(error));
    throw error;
  } finally {
    if (lock) state.operation = null;
    setBusy(els.save, false);
    renderProjects();
  }
}

async function loadBaseImage() {
  state.baseImage = null;
  if (state.baseImageUrl) URL.revokeObjectURL(state.baseImageUrl);
  state.baseImageUrl = null;
  drawEditor();
  if (!state.project?.baseImage) return;
  const fileName = state.project.baseImage.fileName || state.project.baseImage.filename || state.project.baseImage.path?.split(/[\\/]/).pop();
  if (!fileName) { showError(els.workspaceError, '베이스 이미지 파일 정보를 읽을 수 없습니다.'); return; }
  try {
    const response = await fetch(projectUrl(state.project.id, `/assets/${encodeURIComponent(fileName)}`), { cache:'no-store' });
    if (!response.ok) throw new Error('베이스 이미지를 불러오지 못했습니다.');
    const blob = await response.blob();
    state.baseImageUrl = URL.createObjectURL(blob);
    const image = new Image();
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('이미지 형식을 읽을 수 없습니다.')); image.src = state.baseImageUrl; });
    state.baseImage = image;
    drawEditor();
  } catch (error) {
    showError(els.workspaceError, errorMessage(error));
  }
}

async function fileToBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  return btoa(binary);
}

async function uploadBaseImage() {
  const file = els.baseUpload.files?.[0];
  if (!file || !state.project || state.operation) return;
  showError(els.leftError, '');
  if (!['image/png','image/jpeg'].includes(file.type) || file.size > 20 * 1024 * 1024) {
    showError(els.leftError, 'PNG 또는 JPEG 이미지를 20MB 이하로 선택하세요.');
    els.baseUpload.value = '';
    return;
  }
  state.operation = 'upload';
  els.uploadDrop.classList.add('is-loading');
  els.baseUpload.disabled = true;
  try {
    if (state.dirty) await saveProject({ quiet:true, lock:false });
    const result = await api(projectUrl(state.project.id, '/assets'), {
      method:'POST',
      body:JSON.stringify({ expectedRevision:state.project.revision, sourceType:els.baseSourceType.value, dataBase64:await fileToBase64(file) }),
    });
    state.project = normalizeProject(result.project || result);
    const index = state.projects.findIndex((project) => project.id === state.project.id);
    if (index >= 0) state.projects[index] = state.project;
    markSaved(); resetHistory(); renderAll(); await loadBaseImage();
    toast('베이스 이미지를 적용했습니다.');
  } catch (error) {
    showError(els.leftError, errorMessage(error));
  } finally {
    state.operation = null;
    els.uploadDrop.classList.remove('is-loading');
    els.baseUpload.value = '';
    refreshControls();
  }
}

function addTextLayer() {
  if (!state.project || state.operation) return;
  const canvas = state.project.canvas;
  const font = state.fonts[0];
  const layer = normalizeLayer({
    id:`text_${crypto.randomUUID()}`, text:'새 텍스트', x:Math.round(canvas.width * .1), y:Math.round(canvas.height * .12),
    width:Math.round(canvas.width * .55), height:Math.round(canvas.height * .2),
    fontFamily:font?.family || 'sans-serif', fontWeight:font?.weights?.at(-1) || 700,
    fontSize:Math.round(Math.min(canvas.width, canvas.height) * .105),
  });
  state.project.layers.push(layer);
  state.selectedLayerId = layer.id;
  commitHistory(); renderAll(); els.layerText.focus(); els.layerText.select();
}

function deleteSelectedLayer() {
  if (!state.project || !selectedLayer() || state.operation) return;
  const index = state.project.layers.findIndex((layer) => layer.id === state.selectedLayerId);
  state.project.layers.splice(index, 1);
  state.selectedLayerId = state.project.layers.at(-1)?.id || null;
  commitHistory(); renderAll();
}

function moveLayer(direction) {
  const layer = selectedLayer();
  if (!state.project || !layer || state.operation) return;
  const index = state.project.layers.indexOf(layer);
  const target = index + direction;
  if (target < 0 || target >= state.project.layers.length) return;
  [state.project.layers[index], state.project.layers[target]] = [state.project.layers[target], state.project.layers[index]];
  commitHistory(); renderAll();
}

function updateSelected(property, value, commit = false) {
  const layer = selectedLayer();
  if (!layer || state.operation) return;
  layer[property] = value;
  markDirty();
  if (commit) commitHistory();
  renderLayers(); refreshControls(); drawEditor();
}

function resizeCanvas() {
  if (!state.project) return;
  const { width, height } = state.project.canvas;
  if (els.canvas.width !== width) els.canvas.width = width;
  if (els.canvas.height !== height) els.canvas.height = height;
  const viewport = els.canvasViewport.getBoundingClientRect();
  const padding = window.innerWidth < 720 ? 24 : 72;
  state.fitScale = Math.min((viewport.width - padding) / width, (viewport.height - padding) / height, 1);
  const scale = Math.max(.08, state.fitScale * state.zoom);
  els.canvas.style.width = `${Math.round(width * scale)}px`;
  els.canvas.style.height = `${Math.round(height * scale)}px`;
  els.zoomValue.textContent = `${Math.round(state.zoom * 100)}%`;
}

function drawBase(ctx, canvas) {
  ctx.fillStyle = '#252b27';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!state.baseImage) return;
  const image = state.baseImage;
  const transform = state.project?.baseImageTransform || state.project?.baseImage?.transform || {};
  const cover = Math.max(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
  const scale = Number(transform.scale ?? cover);
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  const x = Number(transform.x ?? canvas.width / 2);
  const y = Number(transform.y ?? canvas.height / 2);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Number(transform.rotation ?? 0) * Math.PI / 180);
  ctx.filter = `blur(${Number(transform.blur ?? 0)}px) brightness(${Number(transform.brightness ?? 1)}) contrast(${Number(transform.contrast ?? 1)})`;
  ctx.drawImage(image, -width / 2, -height / 2, width, height);
  ctx.filter = 'none';
  ctx.restore();
  if (Number(transform.dim ?? 0) > 0) {
    ctx.fillStyle = `rgba(0,0,0,${Math.min(1, Number(transform.dim))})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
}

function graphemes(text) {
  if (Intl.Segmenter) return [...new Intl.Segmenter(['ko','ja'], { granularity:'grapheme' }).segment(text)].map((part) => part.segment);
  return [...text];
}

function textWidth(ctx, text, spacing) {
  const units = graphemes(text);
  return units.reduce((sum, unit) => sum + ctx.measureText(unit).width, 0) + Math.max(0, units.length - 1) * spacing;
}

function wrapText(ctx, text, maxWidth, spacing) {
  const output = [];
  text.split('\n').forEach((paragraph) => {
    if (!paragraph) { output.push(''); return; }
    let line = '';
    graphemes(paragraph).forEach((unit) => {
      const candidate = line + unit;
      if (line && textWidth(ctx, candidate, spacing) > maxWidth) { output.push(line.trimEnd()); line = unit.trimStart(); }
      else line = candidate;
    });
    output.push(line);
  });
  return output;
}

function drawSpacedLine(ctx, text, x, y, spacing, mode) {
  const units = graphemes(text);
  const total = textWidth(ctx, text, spacing);
  let cursor = ctx.textAlign === 'center' ? x - total / 2 : ctx.textAlign === 'right' ? x - total : x;
  const originalAlign = ctx.textAlign;
  ctx.textAlign = 'left';
  units.forEach((unit) => {
    if (mode === 'stroke') ctx.strokeText(unit, cursor, y); else ctx.fillText(unit, cursor, y);
    cursor += ctx.measureText(unit).width + spacing;
  });
  ctx.textAlign = originalAlign;
}

function drawTextLayer(ctx, layer) {
  if (!layer.visible) return;
  ctx.save();
  const centerX = layer.x + layer.width / 2;
  const centerY = layer.y + layer.height / 2;
  ctx.translate(centerX, centerY);
  ctx.rotate(layer.rotation * Math.PI / 180);
  ctx.translate(-centerX, -centerY);
  ctx.font = `${layer.fontWeight} ${layer.fontSize}px "${layer.fontFamily}"`;
  ctx.textBaseline = 'top';
  ctx.textAlign = layer.align;
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  const spacing = layer.letterSpacing || 0;
  const lines = wrapText(ctx, layer.text, layer.width, spacing);
  const lineHeight = layer.fontSize * layer.lineHeight;
  const maxLines = Math.max(1, Math.floor(layer.height / lineHeight));
  const x = layer.align === 'center' ? layer.x + layer.width / 2 : layer.align === 'right' ? layer.x + layer.width : layer.x;
  lines.slice(0, maxLines).forEach((line, index) => {
    const y = layer.y + index * lineHeight;
    if (layer.shadow?.enabled) {
      ctx.shadowColor = `rgba(0,0,0,${Number(layer.shadow.opacity ?? .35)})`;
      ctx.shadowOffsetX = Number(layer.shadow.x ?? 2); ctx.shadowOffsetY = Number(layer.shadow.y ?? 3);
      ctx.shadowBlur = Number(layer.shadow.blur ?? 6);
    }
    if (layer.strokeWidth > 0) {
      ctx.strokeStyle = layer.strokeColor; ctx.lineWidth = layer.strokeWidth * 2;
      drawSpacedLine(ctx, line, x, y, spacing, 'stroke');
    }
    ctx.fillStyle = layer.color;
    drawSpacedLine(ctx, line, x, y, spacing, 'fill');
    ctx.shadowColor = 'transparent';
  });
  ctx.restore();
}

function safeArea() {
  const template = templateForProject();
  if (template?.safeArea) return template.safeArea;
  const { width, height } = state.project.canvas;
  return height > width
    ? { x:Math.round(width * .085), y:Math.round(height * .12), width:Math.round(width * .83), height:Math.round(height * .7) }
    : { x:Math.round(width * .05), y:Math.round(height * .075), width:Math.round(width * .9), height:Math.round(height * .85) };
}

function drawSelection(ctx, layer) {
  if (!layer || !layer.visible) return;
  ctx.save();
  const centerX = layer.x + layer.width / 2, centerY = layer.y + layer.height / 2;
  ctx.translate(centerX, centerY); ctx.rotate(layer.rotation * Math.PI / 180); ctx.translate(-centerX, -centerY);
  ctx.strokeStyle = layer.locked ? '#b36b31' : '#4ce0a7'; ctx.lineWidth = 3 / Math.max(state.fitScale * state.zoom, .1);
  ctx.setLineDash([10, 7]); ctx.strokeRect(layer.x, layer.y, layer.width, layer.height); ctx.setLineDash([]);
  if (!layer.locked) {
    const size = 18 / Math.max(state.fitScale * state.zoom, .1);
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#26715b'; ctx.lineWidth = 3 / Math.max(state.fitScale * state.zoom, .1);
    ctx.fillRect(layer.x + layer.width - size / 2, layer.y + layer.height - size / 2, size, size);
    ctx.strokeRect(layer.x + layer.width - size / 2, layer.y + layer.height - size / 2, size, size);
  }
  ctx.restore();
}

function drawScene(ctx, { guides = false } = {}) {
  const canvas = state.project.canvas;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawBase(ctx, canvas);
  state.project.layers.forEach((layer) => drawTextLayer(ctx, layer));
  if (guides && state.project.safeAreaVisible) {
    const safe = safeArea();
    ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,.72)'; ctx.lineWidth = 2 / Math.max(state.fitScale * state.zoom, .1);
    ctx.setLineDash([14, 10]); ctx.strokeRect(safe.x, safe.y, safe.width, safe.height); ctx.restore();
  }
  if (guides) drawSelection(ctx, selectedLayer());
}

function drawEditor() {
  if (!state.project) return;
  drawScene(els.canvas.getContext('2d'), { guides:true });
}

function pointFromEvent(event) {
  const rect = els.canvas.getBoundingClientRect();
  return { x:(event.clientX - rect.left) * els.canvas.width / rect.width, y:(event.clientY - rect.top) * els.canvas.height / rect.height };
}

function localPoint(layer, point) {
  const cx = layer.x + layer.width / 2, cy = layer.y + layer.height / 2;
  const angle = -layer.rotation * Math.PI / 180;
  const dx = point.x - cx, dy = point.y - cy;
  return { x:cx + dx * Math.cos(angle) - dy * Math.sin(angle), y:cy + dx * Math.sin(angle) + dy * Math.cos(angle) };
}

function hitLayer(point) {
  for (let index = state.project.layers.length - 1; index >= 0; index -= 1) {
    const layer = state.project.layers[index];
    if (!layer.visible) continue;
    const local = localPoint(layer, point);
    if (local.x >= layer.x && local.x <= layer.x + layer.width && local.y >= layer.y && local.y <= layer.y + layer.height) return layer;
  }
  return null;
}

function isResizeHandle(layer, point) {
  const local = localPoint(layer, point);
  const tolerance = 24 / Math.max(state.fitScale * state.zoom, .1);
  return Math.abs(local.x - (layer.x + layer.width)) <= tolerance && Math.abs(local.y - (layer.y + layer.height)) <= tolerance;
}

function pointerDown(event) {
  if (!state.project || state.operation) return;
  const point = pointFromEvent(event);
  let layer = selectedLayer();
  const resize = layer && !layer.locked && isResizeHandle(layer, point);
  if (!resize) layer = hitLayer(point);
  if (!layer) { state.selectedLayerId = null; renderAll(); return; }
  state.selectedLayerId = layer.id;
  if (layer.locked) { renderAll(); return; }
  const local = localPoint(layer, point);
  state.pointer = { mode:resize ? 'resize' : 'move', pointerId:event.pointerId, start:point,
    offset:{ x:local.x - layer.x, y:local.y - layer.y }, before:snapshot(),
    original:{ x:layer.x, y:layer.y, width:layer.width, height:layer.height } };
  els.canvas.setPointerCapture(event.pointerId);
  els.canvas.classList.add('is-dragging');
  event.preventDefault();
  renderAll();
}

function pointerMove(event) {
  if (!state.pointer || !state.project || event.pointerId !== state.pointer.pointerId) return;
  const layer = selectedLayer();
  if (!layer) return;
  const point = pointFromEvent(event);
  if (state.pointer.mode === 'move') {
    layer.x = Math.round(Math.max(0, Math.min(state.project.canvas.width - layer.width, state.pointer.original.x + point.x - state.pointer.start.x)));
    layer.y = Math.round(Math.max(0, Math.min(state.project.canvas.height - layer.height, state.pointer.original.y + point.y - state.pointer.start.y)));
  } else {
    layer.width = Math.round(Math.max(80, Math.min(state.project.canvas.width - layer.x, state.pointer.original.width + point.x - state.pointer.start.x)));
    layer.height = Math.round(Math.max(layer.fontSize * layer.lineHeight, Math.min(state.project.canvas.height - layer.y, state.pointer.original.height + point.y - state.pointer.start.y)));
  }
  markDirty(); drawEditor(); renderInspector();
}

function pointerUp(event) {
  if (!state.pointer || event.pointerId !== state.pointer.pointerId) return;
  els.canvas.classList.remove('is-dragging');
  state.pointer = null;
  commitHistory(); renderAll();
}

function keyboardCanvas(event) {
  const layer = selectedLayer();
  if (!layer || layer.locked || !state.project || state.operation) return;
  const step = event.shiftKey ? 10 : 1;
  const movement = { ArrowLeft:[-step,0], ArrowRight:[step,0], ArrowUp:[0,-step], ArrowDown:[0,step] }[event.key];
  if (movement) {
    layer.x = Math.max(0, Math.min(state.project.canvas.width - layer.width, layer.x + movement[0]));
    layer.y = Math.max(0, Math.min(state.project.canvas.height - layer.height, layer.y + movement[1]));
    commitHistory(); renderAll(); event.preventDefault();
  } else if (event.key === 'Delete' || event.key === 'Backspace') {
    deleteSelectedLayer(); event.preventDefault();
  }
}

async function verifyFontsForExport() {
  if (!state.fontReady) throw new Error('검증된 번들 폰트가 준비되지 않아 내보낼 수 없습니다.');
  const checks = state.project.layers.filter((layer) => layer.visible).map(async (layer) => {
    const registered = state.fonts.find((font) => font.family === layer.fontFamily);
    if (!registered || !registered.weights.includes(Number(layer.fontWeight))) throw new Error(`${layer.fontFamily} ${layer.fontWeight}는 검증된 폰트 레지스트리에 없습니다.`);
    await document.fonts.load(`${layer.fontWeight} 32px "${layer.fontFamily}"`, sampleText);
    if (!document.fonts.check(`${layer.fontWeight} 32px "${layer.fontFamily}"`, sampleText)) throw new Error(`${layer.fontFamily} 폰트를 브라우저가 불러오지 못했습니다.`);
  });
  await Promise.all(checks);
}

async function exportProject(format, button) {
  if (!state.project || state.operation) return;
  state.operation = 'export';
  setBusy(button, true, '내보내는 중…');
  showError(els.workspaceError, '');
  try {
    if (!state.baseImage) throw new Error('베이스 이미지를 먼저 업로드하세요.');
    if (state.dirty) await saveProject({ quiet:true, lock:false });
    await verifyFontsForExport();
    const output = document.createElement('canvas');
    output.width = state.project.canvas.width; output.height = state.project.canvas.height;
    drawScene(output.getContext('2d'));
    const mimeType = format === 'png' ? 'image/png' : 'image/jpeg';
    const blob = await new Promise((resolve, reject) => output.toBlob((value) => value ? resolve(value) : reject(new Error('이미지 인코딩에 실패했습니다.')), mimeType, format === 'png' ? undefined : .92));
    const result = await api(projectUrl(state.project.id, '/exports'), {
      method:'POST', body:JSON.stringify({ expectedRevision:state.project.revision, format:format === 'png' ? 'png' : 'jpeg', dataBase64:await fileToBase64(blob) }),
    });
    state.project = normalizeProject(result.project || result);
    const index = state.projects.findIndex((project) => project.id === state.project.id);
    if (index >= 0) state.projects[index] = state.project;
    markSaved(); resetHistory(); renderAll();
    const link = document.createElement('a');
    const fileName = result.fileName || `thumbnail.${format === 'png' ? 'png' : 'jpg'}`;
    link.href = URL.createObjectURL(blob); link.download = fileName; link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    toast(`${format.toUpperCase()} 파일을 저장하고 다운로드했습니다.`);
  } catch (error) {
    showError(els.workspaceError, errorMessage(error));
  } finally {
    state.operation = null;
    setBusy(button, false);
    renderProjects();
  }
}

async function loadFontRegistry(entries) {
  state.fonts = Array.isArray(entries) ? entries : [];
  els.layerFont.replaceChildren(...state.fonts.map((font) => {
    const option = document.createElement('option'); option.value = font.family; option.textContent = font.family; return option;
  }));
  const issues = [];
  for (const font of state.fonts) {
    try {
      if (!font.bundled || !font.licenseId || !font.licenseUrl || !Array.isArray(font.files) || !font.files.length) throw new Error('라이선스 또는 파일 메타데이터 누락');
      const license = await fetch(font.licenseUrl, { cache:'no-store' });
      if (!license.ok || (await license.text()).trim().length < 100) throw new Error('라이선스 원문 확인 실패');
      for (const file of font.files) {
        if (!/^[a-f\d]{64}$/i.test(file.sha256 || '')) throw new Error('SHA-256 누락');
        const face = new FontFace(font.family, `url(${JSON.stringify(file.url)}) format('${file.format || 'opentype'}')`, { weight:String(file.weight) });
        await face.load(); document.fonts.add(face);
        await document.fonts.load(`${file.weight} 32px "${font.family}"`, sampleText);
        if (!document.fonts.check(`${file.weight} 32px "${font.family}"`, sampleText)) throw new Error(`${file.weight} 폰트 로드 실패`);
      }
    } catch (error) { issues.push(`${font.family}: ${errorMessage(error)}`); }
  }
  state.fontReady = state.fonts.length > 0 && issues.length === 0;
  els.fontWarning.className = `registry-warning ${state.fontReady ? 'is-ready' : 'is-blocked'}`;
  els.fontWarning.textContent = state.fontReady
    ? `${state.fonts.map((font) => font.family).join(', ')} · 라이선스와 ${state.fonts.reduce((sum, font) => sum + font.files.length, 0)}개 폰트 파일 확인됨`
    : `내보내기 잠김 · ${issues.join(' / ') || '검증된 번들 폰트가 없습니다.'}`;
  refreshControls();
}

function bindEvents() {
  $$('.panel-tab').forEach((tab) => tab.addEventListener('click', () => {
    $$('.panel-tab').forEach((item) => { const active = item === tab; item.classList.toggle('is-active', active); item.setAttribute('aria-selected', String(active)); });
    $$('.source-panel').forEach((panel) => { panel.hidden = panel.id !== `panel-${tab.dataset.panel}`; });
  }));
  [els.newProject, els.emptyNewProject].forEach((button) => button.addEventListener('click', () => openNewProject()));
  els.createVariant.addEventListener('click', createVariant);
  els.createFromSource.addEventListener('click', createFromSourceFrame);
  els.contentPlanSelect.addEventListener('change', () => loadContentPlan(els.contentPlanSelect.value));
  els.createContentPlan.addEventListener('click', createContentPlan);
  $$('[data-close-new]').forEach((button) => button.addEventListener('click', () => els.dialog.close()));
  els.newProjectForm.addEventListener('submit', createProject);
  els.save.addEventListener('click', () => saveProject().catch(() => {}));
  els.baseUpload.addEventListener('change', uploadBaseImage);
  els.addText.addEventListener('click', addTextLayer);
  els.deleteLayer.addEventListener('click', deleteSelectedLayer);
  els.layerUp.addEventListener('click', () => moveLayer(1));
  els.layerDown.addEventListener('click', () => moveLayer(-1));
  els.layerLock.addEventListener('click', () => updateSelected('locked', !selectedLayer().locked, true));
  els.layerVisible.addEventListener('click', () => updateSelected('visible', !selectedLayer().visible, true));
  const inputs = [
    [els.layerText,'text',(value) => value], [els.layerSize,'fontSize',Number], [els.layerAlign,'align',(value) => value],
    [els.layerColor,'color',(value) => value], [els.layerStrokeColor,'strokeColor',(value) => value], [els.layerStrokeWidth,'strokeWidth',Number],
  ];
  inputs.forEach(([element, property, parse]) => {
    element.addEventListener('input', () => updateSelected(property, parse(element.value)));
    element.addEventListener('change', commitHistory);
  });
  els.layerFont.addEventListener('change', () => { updateSelected('fontFamily', els.layerFont.value); updateWeightOptions(els.layerFont.value, selectedLayer().fontWeight); updateSelected('fontWeight', Number(els.layerWeight.value), true); renderInspector(); });
  els.layerWeight.addEventListener('change', () => updateSelected('fontWeight', Number(els.layerWeight.value), true));
  els.projectName.addEventListener('input', () => { if (state.project && !state.operation) { state.project.name = els.projectName.value; markDirty(); renderProjects(); } });
  els.projectName.addEventListener('change', commitHistory);
  els.undo.addEventListener('click', undo); els.redo.addEventListener('click', redo);
  els.zoomOut.addEventListener('click', () => { state.zoom = Math.max(.25, state.zoom - .1); resizeCanvas(); drawEditor(); });
  els.zoomIn.addEventListener('click', () => { state.zoom = Math.min(2.5, state.zoom + .1); resizeCanvas(); drawEditor(); });
  els.fit.addEventListener('click', () => { state.zoom = 1; resizeCanvas(); drawEditor(); });
  els.toggleSafe.addEventListener('click', () => { state.project.safeAreaVisible = !state.project.safeAreaVisible; commitHistory(); renderAll(); });
  els.exportButtons.forEach((button) => button.addEventListener('click', () => exportProject(button.dataset.export, button)));
  els.canvas.addEventListener('pointerdown', pointerDown); els.canvas.addEventListener('pointermove', pointerMove);
  els.canvas.addEventListener('pointerup', pointerUp); els.canvas.addEventListener('pointercancel', pointerUp); els.canvas.addEventListener('keydown', keyboardCanvas);
  window.addEventListener('keydown', (event) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    if (event.key.toLowerCase() === 's') { event.preventDefault(); saveProject().catch(() => {}); }
    if (event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); }
    if (event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); }
  });
  window.addEventListener('beforeunload', (event) => { if (state.dirty) { event.preventDefault(); event.returnValue = ''; } });
  new ResizeObserver(() => { if (state.project) { resizeCanvas(); drawEditor(); } }).observe(els.canvasViewport);
}

async function start() {
  bindEvents();
  try {
    const [templates, fonts, projects] = await Promise.all([api(API.templates), api(API.fonts), api(API.projects), loadContentPlans()]);
    state.templates = (templates || []).map(normalizeTemplate);
    state.projects = (projects || []).map(normalizeProject);
    renderTemplates(); renderProjects();
    await loadFontRegistry(fonts);
    if (state.projects[0]) await setProject(normalizeProject(await api(projectUrl(state.projects[0].id))));
    else renderAll();
  } catch (error) {
    renderTemplates(); renderProjects();
    showError(els.leftError, `스튜디오 데이터를 불러오지 못했습니다. ${errorMessage(error)}`);
    els.fontWarning.className = 'registry-warning is-blocked';
    els.fontWarning.textContent = '내보내기 잠김 · 폰트 레지스트리를 확인할 수 없습니다.';
  }
}

start();
