import test from 'node:test';
import assert from 'node:assert/strict';
import { planScenes } from '../src/auto-planner.js';

const source = {
  durationMs: 12000,
  captions: [
    { id: 1, startMs: 0, endMs: 1800, text: '왜 애니 말투는 현실에서 어색할까요?' },
    { id: 2, startMs: 1800, endMs: 4200, text: '말투의 차이를 비교해 보겠습니다.' },
    { id: 3, startMs: 4200, endMs: 7600, text: '이 표현은 관계와 거리감을 보여 줍니다.' },
    { id: 4, startMs: 7600, endMs: 12000, text: '정리하면 상황에 맞게 바꿔야 합니다.' },
  ],
};

test('planner classifies captions and preserves source text', () => {
  const result = planScenes({ source });
  assert.equal(result.valid, true);
  assert.deepEqual(result.scenes?.map(scene => scene.type), ['HOOK', 'COMPARE', 'RELATION', 'RECAP']);
  assert.equal(result.scenes?.[0]?.content.sourceText, source.captions[0]!.text);
  assert.equal(result.scenes?.[0]?.visual.strategy, 'auto');
  assert.equal(result.scenes?.[1]?.visual.strategy, 'generated_graphic');
});

test('planner emits a review warning for ambiguous explanation', () => {
  const result = planScenes({ source: { durationMs: 1000, captions: [{ id: 1, startMs: 0, endMs: 1000, text: '오늘은 새로운 이야기를 천천히 살펴봅니다.' }] } });
  assert.equal(result.valid, true);
  assert.equal(result.scenes?.[0]?.type, 'EXPLAIN');
  assert.ok(result.diagnostics.some(item => item.code === 'PLANNER_REVIEW' && item.severity === 'warning'));
});

test('planner carries locked scenes forward and does not overwrite them', () => {
  const baseline = planScenes({ source }).scenes!;
  const locked = { ...baseline[1]!, id: 'locked-compare', locked: true, content: { ...baseline[1]!.content, mainText: '사용자 지정 문구', sourceText: '보존된 원문' } };
  const result = planScenes({ source, existingScenes: [locked] });
  assert.equal(result.valid, true);
  assert.equal(result.scenes?.[1]?.id, 'locked-compare');
  assert.equal(result.scenes?.[1]?.content.mainText, '사용자 지정 문구');
  assert.equal(result.scenes?.[1]?.locked, true);
});

test('planner rejects malformed source instead of inventing captions', () => {
  const result = planScenes({ source: { durationMs: 1000, captions: [{ id: 1, startMs: 500, endMs: 400, text: 'bad' }] } });
  assert.equal(result.valid, false);
  assert.equal(result.scenes, null);
  assert.ok(result.diagnostics.some(item => item.code === 'PLANNER_SCHEMA'));
});
