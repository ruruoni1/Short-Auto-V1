# Scene Runtime 계약 — 최초 기능

렌더 독립 millisecond Scene 계획 및 시점 조회 계약이다. 기존 Core Schema/Timeline 계산은 변경하지 않는다. React/Remotion 시각 컴포넌트 구현 완료를 의미하지 않는다.

## 공개 API

```ts
import { createSceneRuntime, resolveTimeline } from '@short-auto/core';
const input = { production, source, overrides };
const resolved = resolveTimeline(input);
if (resolved.valid) {
  const result = createSceneRuntime(input, resolved.timeline);
  if (result.valid) {
    const plan = result.runtime.scenes;
    const state = result.runtime.getState(1500);
  }
}
```

`createSceneRuntime(input: unknown, timeline: unknown, policy?: SceneRuntimePolicy)`는 `CreateSceneRuntimeResult` 판별 union을 반환한다. 성공은 `{valid: true, runtime, diagnostics}`, 실패는 `{valid: false, runtime: null, diagnostics}`다. 입력과 저장 Output은 기존 `validateResolvedTimeline`로 먼저 심화 검증한다. 프로젝트/revision, 참조, Source 커버리지, stop/overlay/ending이 일치해야 한다. 검증됐다는 호출자 주장만으로 통과시키지 않는다. Pack/Profile/승인 검증은 기존 Workspace 계층 책임이다.

`SceneRuntime`은 `durationMs`, `scenes: PlannedScene[]`, `getState(outputTimeMs)`를 제공한다. 함께 공개하는 타입은 `SceneRuntimePolicy`, `SceneOutputSpan`, `PlannedScene`, `SceneOperation`, `SceneRuntimeState`, `CreateSceneRuntimeResult`다. 런타임은 JSON 저장 모델이 아니다. 원본/Output/정책의 snapshot을 내부에 보관한다. 입력, 공개 계획, 조회 반환값을 수정해도 이후 조회는 바뀌지 않는다. 편집 후 새 runtime을 생성해야 한다.

## 범위와 시점 정책

- 모든 시간 구간은 `[start, end)`다. `getState`는 안전한 정수 ms만 받는다. NaN/Infinity/소수/안전 범위 밖 값은 RangeError다. 음수 정수 및 `time >= durationMs`는 `kind: outside`와 빈 활성 상태다.
- Scene의 Source 구간은 captionRange.start ID cue의 시작부터 captionRange.end ID cue의 종료까지다. ID는 배열 인덱스가 아니며 sparse ID를 Map으로 조회한다. 양 끝 사이 무음에서도 Scene은 유지된다. 첫 Scene 전/마지막 Scene 후 무음은 임의 확장하지 않는다.
- `PlannedScene.spans`는 이 Source 구간을 검증된 각 TTS 구간과 교차시켜 Output으로 옮긴 구간들이다. Insert/Pause는 spans에 포함하지 않는다. 추가 분할된 유효 TTS는 여러 span이 될 수 있다. span 전체를 하나의 연속 Output 범위로 해석하면 안 된다.
- 동시 Scene은 production.scenes 배열 순서로 모두 반환한다. 우선 Scene이나 z-index를 임의 선택하지 않는다. Scene 겹침/미할당 Caption warning은 Timeline 진단 그대로 유지한다. 미할당 구간에는 EXPLAIN 등을 생성하지 않는다.
- `kind: tts`에서만 Source 시각과 원본 cue를 조회한다. Source 무음은 여전히 tts이며 `caption: null`이다. Caption 번호/시간/공백/줄바꿈/원문은 보존한다.
- `kind: insert | pause`에서는 `sourceTimeMs/caption`이 null, scenes가 빈 배열이다. 정지 직전/직후 Scene을 hold하지 않는다. 모든 정지 Insert와 Pause에 같은 규칙을 적용하므로 원작 Clip에서 TTS Caption도 표시되지 않는다. anchor는 operation.insert.anchor에서 확인한다.
- Overlay는 active overlays 배열로 기본 tts/insert/pause 상태와 병렬 반환한다. Overlay가 재생되어도 TTS Caption을 일괄 숨기지 않는다. 같은 시각의 Overlay 순서는 제공된 검증 Output 순서를 따른다. Overlay가 stop을 가로질러도 elapsed는 연속 Output 시간이다.
- ending에서는 ending 설정만 반환하며 Source Scene/Caption은 없다. Source 끝 stop은 ending 전에 실행된다. disabled ending은 표시하지 않는다.
- `SceneOperation`은 원본 Insert, 등록 Asset 또는 null, Output 범위, elapsedMs, mediaTimeMs를 제공한다. mediaTimeMs는 유효 trim(Override > 원본)의 start + elapsed, trim이 없으면 elapsed다. PAUSE는 mediaTimeMs=null이다. 실제 decoder seek/미디어 존재/음량을 보증하지 않는다.

## 표시 Override 합성

- Scene type/captionMode는 local Override > 원본 순서다. content(mainText/subText/jpText/sourceText/emphasis)는 원본 값 그대로다. mainText Override는 텍스트 교체가 아니라 transform이다.
- caption transform offsetY는 Scene 값 > global.captionOffsetY > 0 순서로 선택한다. 합산하지 않는다. 나머지 transform 필드는 지정된 값만 보존하고, 좌표/폰트/scale의 렌더 기본값을 추정하지 않는다. 미할당 Caption에는 state.unassignedCaption의 global offsetY를 사용한다.
- caption.lines는 표시용 전체 배열 교체로 보관하며 원본 Caption.text는 수정하지 않는다. 빈 배열도 원문으로 자동 대체하지 않는다. cue별 배분, 분할, 자동 줄바꿈은 후속 Caption renderer 책임이다.
- Scene별 captionVisible은 원본 cue 존재 AND production.captions.show AND 유효 captionMode != hidden이다. subtle은 visible이다. 미할당 구간은 unassignedCaptionVisible을 사용한다. captionVisible=true는 텍스트 layout/pixel이 생성됐다는 뜻이 아니다.
- visual.assetId는 Override가 지정되면 교체하며 visual.strategy는 원본을 보존한다. text_only/auto 등에서 assetId의 실제 사용 여부는 후속 renderer/planner 정책이다. visual transform은 별도 필드로 반환한다. Asset registry는 own-property 조회만 허용하고, 등록된 required/missing/rejected 상태를 그대로 노출한다. 파일 생성/Placeholder 렌더는 수행하지 않는다.
- motion은 Override > 원본 non-null > 주입된 policy.motionDefaults[유효 Scene type] > 아래 결정적 기본값 순서다. policy는 선택적인 타입별 Motion 데이터 맵이며 callback/랜덤을 사용하지 않는다. 잘못된 정책은 SCENE_POLICY_SCHEMA 오류다.

| Scene type | 기본 preset |
| --- | --- |
| HOOK / KEYWORD / CONCEPT | SCALE_IN |
| QUESTION / EXPLAIN / RECAP | FADE_UP |
| COMPARE / RELATION | STAGGER |
| QUOTE_ANALYSIS | FREEZE_FOCUS |

기본 intensity는 normal이고 durationMs는 미지정이다. 이는 animation 수식/전환 길이가 아닌 렌더 독립 선택값이다. 원본 transition은 보존하며 Theme 기본 transition/font/layout을 조회하거나 채널별 값을 하드코딩하지 않는다.

## 진단과 후속 범위

입력/Output 오류는 기존 TIMELINE_*/CAPTION_* 진단을 유지하고 부분 runtime을 반환하지 않는다. Scene outputTiming은 TIMELINE_UNSUPPORTED_OUTPUT_TIMING 오류로 유지한다. 이번 기능은 Scene 시간 Override 지원을 확장하지 않는다. 성공 시 표시 합성이 완료됐으므로 TIMELINE_DEFERRED_OVERRIDE만 제거한다. 이를 시각 렌더 완료로 해석하지 않는다.

9개 Scene Type의 순수 계획/조회만 구현했다. 9개 React/Remotion 컴포넌트, frame 변환 및 render 통합, Motion 보간/전환, Typography/Caption 분할, Asset 로딩, CLIP_CAPTION 생성, ending 시각 표현, Editor outputTiming은 후속 기능이다. 조회는 배열 선형 탐색이며 대규모 타임라인 성능 최적화/렌더 부하 검증은 수행하지 않았다.

## 검증

`tests/scene.test.ts`: 9종 Motion, 수동 경계 oracle, Source 무음, sparse ID, stop/Overlay 동시 상태, trim media time, ending, Scene overlap/미할당, Override 합성, own-property, 오류/정책, snapshot 불변성과 추가 TTS 분할을 검증한다.

명령: `npx tsx --test tests/scene.test.ts`, `npm run typecheck`, `npm test`, `npm run build`, 빌드 후 `@short-auto/core` 공개 ESM import/호출.
