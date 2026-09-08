# Theme / Motion 순수 계산 계약 — 최초 기능

Core Schema와 Scene Runtime 파일은 변경하지 않는다. 이 모듈은 주입된 Pack 선택과 millisecond 계산만 수행한다. React/Remotion, frame 변환, 실제 시각 적용 및 렌더 통합은 후속 기능이다.

## 공개 API와 선택

`resolveTheme(pack: unknown, {packId, themeId, profileId}, policy?)`는 `{valid, selection, diagnostics}` 판별 결과를 반환한다. 실패 시 selection은 null이다. 등록되지 않은 Theme/Profile, Pack 불일치, 중복 Theme/Profile ID, 잘못된 Schema/정책은 오류다. 배열의 첫 Theme로 대체하지 않는다.

selection은 Theme snapshot, 네 font role의 fonts, 이름별 colors, SceneRuntimePolicy와 `fontVerification: not_performed`를 제공한다. `selectThemeFont(selection, role)`는 명시 role 문자열을 선택한다. 임의의 Caption/JP_TEXT 역할 매핑이나 fallback 폰트를 추정하지 않는다. `selectThemeColor(selection, name)`은 own-property만 조회하고 미등록 색상은 null이다. 폰트 이름과 색상 문자열은 데이터 선언이며 설치·로딩·glyph·CSS 유효성 검증이 아니다. 원본 Pack의 sans-serif/흑백은 임시 데이터이며 최종 채널 디자인이 아니다.

주입 정책 내부 순서: **명시 타입별 policy > Profile.motionPreset > Theme.defaultMotion**. 모두 없으면 타입별 항목을 비워 기존 Scene Runtime 기본값을 사용한다. `createThemedSceneRuntime(input, timeline, pack, policy?)`는 이 정책을 기존 `createSceneRuntime`에 주입한다. 따라서 최종 Motion 순서는 **Scene Override > 원본 non-null > 주입 정책 > 기존 타입 기본값**이다. Override의 유효 Scene type으로 정책을 조회한다. 어댑터는 Profile contentType도 검사하며 기존 Timeline 검증/진단과 snapshot 동작을 유지한다. Workspace 전체 관계/allowedSceneTypes 검증은 기존 Workspace 계층 책임이다.

`selectTransition(original?, theme?)`은 **원본 > Theme.defaultTransition > CUT**이다. 명시 CUT/MATCH도 그대로 보존한다. 현 Schema에는 transition Override가 없으므로 새 Override 필드는 만들지 않는다. settings.transitionStyle/captionStyle, Profile.typographyPreset은 향후 preset registry 참조로 보존하며 이 모듈에서 해석하지 않는다. CUT 비율 70~80%는 Planner의 편집 가이드이며 이 계산 모듈은 시퀀스 비율을 강제하거나 랜덤 전환을 생성하지 않는다.

## Motion sampling

```ts
import { resolveTheme, createThemedSceneRuntime, samplePlannedSceneMotion,
  selectTransition, sampleTransition } from '@short-auto/core';

const selected = resolveTheme(pack, {
  packId: input.production.project.channelPack,
  themeId: input.production.settings.theme,
  profileId: input.production.project.contentProfile,
});
const result = createThemedSceneRuntime(input, timeline, pack);
if (selected.valid && result.valid) {
  const state = result.runtime.getState(outputTimeMs);
  if (state.kind === 'tts' && state.sourceTimeMs !== null) {
    for (const plan of state.scenes) {
      // STAGGER는 실제 표시 항목별 index/count를 추가로 전달한다.
      const motion = samplePlannedSceneMotion(plan, state.sourceTimeMs);
      // supported/active 확인 후 renderer에서 변환을 적용한다.
      const transition = selectTransition(plan.scene.transition, selected.selection.theme);
      // 전환 시작/길이와 인접 두 장면은 호출자가 별도로 결정한다.
      const layers = sampleTransition(transition, transitionElapsedMs, 250);
    }
  }
}
```

`sampleMotion({motion, sceneType, elapsedMs, durationMs, item?})`는 `{supported, active, progress, requestedMotion, effectiveMotion, values, diagnostics}`를 반환한다. values는 opacity, translateX/Y, scale이다. translate는 **대상 너비/높이에 대한 비율**, scale은 배율이며 특정 pixel 좌표/transform 순서/anchor를 지정하지 않는다. Editor의 visual/mainText/caption transform은 덮어쓰거나 합성하지 않는다. 렌더러가 정적 변환과 애니메이션 변환의 적용 대상과 순서를 결정해야 한다.

- elapsedMs는 Scene 로컬 시각이다. 안전한 정수 음수는 허용하고 progress는 [0,1]로 clamp한다. durationMs는 0 이상의 안전한 정수다. NaN/Infinity/소수/안전 정수 범위 밖 및 음수 길이는 RangeError다. motion.durationMs는 기존 Schema대로 양수 정수이며 추가 안전 정수 검사를 한다. 잘못된 Motion/Scene type enum 및 Motion Schema 값은 ZodError다.
- active는 `0 <= elapsedMs < durationMs`이다. 밖에서도 clamped endpoint 값을 반환하므로 renderer가 active=false를 숨겨야 한다. 0 길이는 항상 비활성이고 시각 0부터 완료 progress=1이다. 0으로 나누지 않는다.
- entrance 기본 길이는 400ms, SLOW_ZOOM/PAN은 전체 Scene 길이다. 명시 motion.durationMs가 있으면 사용하며 Scene 길이로 제한한다. 완료 후 최종 값을 유지한다.
- amplitude a는 subtle=0.015, normal=0.03, strong=0.05다. 강한 Motion은 HOOK/KEYWORD/CONCEPT만 허용한다. 다른 타입은 effectiveMotion.intensity=normal 및 `MOTION_INTENSITY_LIMITED` warning을 반환한다. 요청 원본과 runtime 계획은 그대로 보존한다. allowed 목록을 채널별로 하드코딩하지 않는다.

시간 progress t와 잔여량 r=(1-t)^3 기준:

| Preset | 계산 / 지원 범위 |
| --- | --- |
| CUT | 즉시 identity(opacity=1, translate=0, scale=1); active는 여전히 Scene 범위 기준 |
| FADE_UP | opacity=1-r, y=a*r |
| SCALE_IN | opacity=1-r, scale=1-a*r |
| SLIDE_IN | opacity=1-r, x=-a*r |
| STAGGER | FADE_UP를 항목별 지연; 실제 index/count 필수 |
| SLOW_ZOOM | scale=1+a*t; 최대 5% 확대 |
| PAN | x=a*(t-0.5), scale=1+a; 최대 좌우 2.5% 이동; 실제 crop/coverage는 renderer 책임 |
| FREEZE_FOCUS | **미지원**, values=null, MOTION_FREEZE_FOCUS_UNSUPPORTED 오류. media frame/time과 focus geometry 및 freeze/focus 구현 필요 |

STAGGER의 item.index는 0부터, count는 1 이상의 안전한 정수이고 index<count여야 한다. 단일 항목 지연은 0이다. 복수 항목의 지연은 `index/(count-1) * windowMs * 0.5`; 각 항목 보간 길이는 `windowMs-delay`다. 마지막 항목도 같은 window 끝에서 완료한다. 아주 짧은 구간의 내부 계산은 소수 ms를 허용하지만 공개 시각 입력은 정수다. item 미입력은 values=null과 `MOTION_STAGGER_CONTEXT_REQUIRED` 오류이며 빈 배열(count=0)은 RangeError다. 빈 목록은 호출자가 sampling하지 않는다.

`samplePlannedSceneMotion(plan, sourceTimeMs, item?)`는 이미 합성된 plan.scene.motion을 그대로 계산한다. Scene sourceStart/end로 로컬 길이/시각을 계산하여 stop Insert에서 진행/재시작하지 않는다. `getState`가 반환한 활성 TTS 계획에만 사용한다. Insert/Pause/ending에는 Scene이 없으며 이 함수로 임의 hold 장면을 만들지 않는다. Source 무음도 Scene 범위 안에서는 진행한다.

## Transition sampling

`sampleTransition(transition, elapsedMs, durationMs=250)`은 incoming/outgoing 두 레이어의 MotionValues와 progress/diagnostics를 반환한다. 이 시간은 **호출자가 결정한 전환 시작으로부터의 상대 시각**이다. Scene 끝이나 stop/overlay 경계에서 전환을 자동 배치하지 않는다.

| Transition | 지원 |
| --- | --- |
| CUT | 시각 0에서 incoming opacity=1, outgoing=0. 그 전에는 반대; duration 무관 |
| FADE | 선형 incoming opacity=t, outgoing=1-t |
| PUSH | 선형 incoming x=1-t, outgoing x=-t; 양쪽 opacity=1 |
| MATCH | **미지원**, 두 레이어 null, TRANSITION_MATCH_UNSUPPORTED 오류. 대응 대상과 이전/다음 시각 geometry mapping 구현 필요 |

전환 시각/길이의 안전 정수 검사는 Motion과 동일하다. 0 길이는 즉시 완료하며 범위 밖은 endpoints로 clamp한다. CUT/FADE/PUSH의 레이어 stacking, clipping, transform origin, 미디어 freeze, 합성 및 전환 종료 레이어 제거는 renderer 책임이다. MATCH를 FADE로 조용히 대체하지 않는다.

## 한계 및 검증

8개 preset 이름 모두 분기하며 7개 수식 지원(STAGGER는 문맥 필수), FREEZE_FOCUS는 명시 미지원이다. 전환은 3개 수식 지원, MATCH는 명시 미지원이다. supported=true는 계산 지원이며 asset/font/시각 품질/최종 render 준비 판정이 아니다. 순수 입력 계산이며 랜덤/현재 시각/파일/네트워크/채널 전용 조건문은 없다.

`tests/theme-motion.test.ts`: 주입 Pack 선택/잘못된 참조/중복/우선순위/snapshot, 8 preset × 3 intensity, 알려진 수식 값, STAGGER context/짧은 구간/항목 순서, 9 Scene type 강도 제한, 전환 양쪽 레이어, zero/boundary/NaN/Infinity/안전 정수, stop Insert 전후 Source 진행을 검증한다.

검증 명령: `npx tsx --test tests/theme-motion.test.ts`, `npm run typecheck`, `npm test`, `npm run build`, 빌드 후 `@short-auto/core` 공개 ESM API 호출. 실제 frame/render/font 검증은 수행하지 않는다.
