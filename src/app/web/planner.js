const sourceInput = document.querySelector('#source-json');
const existingInput = document.querySelector('#existing-json');
const form = document.querySelector('#planner-form');
const alertBox = document.querySelector('#planner-alert');
const summary = document.querySelector('#result-summary');
const diagnostics = document.querySelector('#diagnostics');
const rows = document.querySelector('#scene-rows');

const sample = {
  durationMs: 12000,
  captions: [
    { id: 1, startMs: 0, endMs: 1800, text: '이 표현, 일본어로 어떻게 말할까요?' },
    { id: 2, startMs: 1800, endMs: 4200, text: '오늘은 일상에서 자주 쓰는 표현을 살펴봅니다.' },
    { id: 3, startMs: 4200, endMs: 7200, text: '한국어와 일본어의 뉘앙스는 조금 다릅니다.' },
    { id: 4, startMs: 7200, endMs: 12000, text: '예문과 함께 기억해 보세요.' },
  ],
};

function setAlert(message = '') {
  alertBox.textContent = message;
  alertBox.hidden = !message;
}

function diagnosticsView(items = []) {
  diagnostics.replaceChildren();
  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'diagnostic-empty';
    empty.textContent = '진단 메시지가 없습니다.';
    diagnostics.append(empty);
    return;
  }
  for (const item of items) {
    const node = document.createElement('p');
    node.className = `diagnostic diagnostic-${item.severity}`;
    node.textContent = `${item.severity === 'error' ? '오류' : '경고'} · ${item.path}: ${item.message}`;
    diagnostics.append(node);
  }
}

function sceneRows(scenes = []) {
  rows.replaceChildren();
  if (!scenes.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 6;
    cell.className = 'empty';
    cell.textContent = '생성된 장면이 없습니다.';
    row.append(cell);
    rows.append(row);
    return;
  }
  for (const scene of scenes) {
    const row = document.createElement('tr');
    const values = [
      scene.id,
      scene.type,
      `${(scene.sourceStartMs / 1000).toFixed(1)}–${(scene.sourceEndMs / 1000).toFixed(1)}초`,
      scene.content?.mainText || scene.content?.sourceText || '',
      `${Math.round(scene.confidence * 100)}%`,
      scene.locked ? '잠금 보존' : '자동 생성',
    ];
    for (const value of values) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    }
    rows.append(row);
  }
}

async function requestPlan(source, existingScenes) {
  const response = await fetch('/api/auto-planner/plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ source, existingScenes }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message || 'AutoPlanner 요청에 실패했습니다.');
  return payload.data;
}

document.querySelector('#load-sample').addEventListener('click', () => {
  sourceInput.value = JSON.stringify(sample, null, 2);
  existingInput.value = '[]';
  setAlert();
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  setAlert();
  try {
    const source = JSON.parse(sourceInput.value);
    const existingScenes = JSON.parse(existingInput.value || '[]');
    summary.textContent = '계획을 생성하는 중입니다.';
    const result = await requestPlan(source, existingScenes);
    const errorCount = result.diagnostics.filter((item) => item.severity === 'error').length;
    const warningCount = result.diagnostics.filter((item) => item.severity === 'warning').length;
    summary.textContent = `${result.scenes.length}개 장면 · 오류 ${errorCount}개 · 경고 ${warningCount}개`;
    diagnosticsView(result.diagnostics);
    sceneRows(result.scenes);
  } catch (error) {
    summary.textContent = '계획을 생성하지 못했습니다.';
    diagnosticsView();
    sceneRows();
    setAlert(error instanceof SyntaxError ? 'JSON 형식을 확인하세요.' : error.message);
  }
});

sourceInput.value = JSON.stringify(sample, null, 2);
existingInput.value = '[]';
