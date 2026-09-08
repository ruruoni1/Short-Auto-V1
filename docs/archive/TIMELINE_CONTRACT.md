# Output Timeline 계산·검증 계약

기존 Core Schema를 변경하지 않는 순수 정수 millisecond 계산 기능이다. 모든 구간은 `[startMs, endMs)`이며 frame 반올림이나 미디어 로딩을 하지 않는다.

## 공개 API

```ts
import { resolveTimeline, validateResolvedTimeline } from '@short-auto/core';

const input = { production, source, overrides };
const result = resolveTimeline(input);
if (result.valid) {
  const check = validateResolvedTimeline(input, result.timeline);
  // check.valid는 데이터 시간축 검증 결과이며 렌더 성공 증거가 아니다.
}
```

- `TimelineInputSchema`, `TimelineInput`: 정확히 `{production, source, overrides}`를 받는다. ProjectBundle에 approval이 있다면 세 필드만 선택해서 전달한다. Pack/Content 관계 및 제작 승인은 기존 Workspace/준비 검증의 책임이다.
- `resolveTimeline(input: unknown): ResolveTimelineResult`: 성공은 `{valid: true, timeline: ResolvedTimeline, diagnostics}`. 오류가 하나라도 있으면 `{valid: false, timeline: null, diagnostics}`이다. 부분 성공 시간축이나 자동 보정은 없다.
- `validateResolvedTimeline(input: unknown, timeline: unknown): ValidationResult`: 입력과 저장된 Output을 대조한다. 입력 오류를 먼저 반환하고, Output 구조 오류가 있으면 의미 검증을 생략한다.
- 모든 함수는 입력을 변경하지 않는다. 결과 구간은 입력과 참조를 공유하지 않는다. JSON 저장·파일 쓰기 및 approval 변경은 하지 않는다.

## 시간 정책

1. Source `0..durationMs` 전체를 시간순으로 정확히 한 번 보존한다. 첫 cue 전, cue 사이, 마지막 cue 뒤 무음도 TTS 구간이다. Caption 원문·번호·start/end는 수정하지 않는다. 빈 Caption 배열도 명시 duration이 양수이고 Scene 참조가 유효하면 warning과 함께 계산한다.
2. `caption_before`는 해당 cue 시작, `caption_after`는 종료다. ID는 연속일 필요가 없다. `source_time`은 Source 0과 끝을 포함한다. insert/pause는 cue 내부에서 정지할 수 없지만 정확한 경계 및 무음 구간에서는 허용한다. overlay는 cue 내부도 허용한다.
3. 이벤트를 Source 시각 순으로 정렬한다. 같은 시각의 insert/pause는 **production.inserts 배열 순서**로 실행한다. ID의 사전순이나 anchor 종류에 우선권을 주지 않는다.
4. 같은 Source 시각의 overlay는 그 시각의 **모든 insert/pause 뒤**에서 시작한다. 공식은 `overlay.outputStart = sourceAnchor + sum(stop.duration where stop.anchor <= sourceAnchor)`다. 같은 시각의 overlay끼리는 production 배열 순서를 보존한다.
5. overlay 길이는 연속된 Output 시간이다. 시작 이후 다른 insert/pause를 만나도 overlay 자체를 정지하거나 길이를 늘리지 않는다. Overlay끼리 겹침을 허용한다. TTS 분할도 유발하지 않는다.
6. overlay는 ending 이전 Output 영역 안에 완전히 들어와야 한다. 종료가 그 경계와 정확히 같으면 허용한다. Source 끝에 놓인 양수 길이 overlay, ending으로 넘어가는 overlay는 오류다. 자동 자르기·길이 확장·ending 시간 차용은 없다.
7. Insert의 유효 길이는 `overrides.inserts[id].trim` → 원본 `insert.trim` → `insert.durationMs` 순서로 구한다. trim이 있으면 `endMs-startMs`다. 원본 trim과 원본 duration의 일치는 기존 Schema가 검사한다. Override는 더 짧거나 긴 길이를 허용한다. PAUSE의 trim도 현 Schema가 허용하므로 같은 계산 규칙을 적용하며 미디어를 의미하지 않는다.
8. Asset에 duration 메타데이터가 있으면 유효 trim의 end 또는 untrimmed duration이 이를 넘지 않는지 검사한다. Asset의 실제 길이를 측정하지 않는다. 미해결 상태의 등록 Asset은 계산을 막지 않지만 없는 Asset 및 ANIME/DRAMA 종류 불일치는 오류다. 참조 조회는 own-property만 인정한다.
9. `duration = source.duration + sum(effective insert/pause duration) + enabled ending duration`이다. ending은 모든 TTS와 Source 끝의 정지 이벤트 뒤에 딱 한 번 추가한다. disabled ending은 duration 값이 있어도 무시한다. enabled + 0ms ending은 양수 구간 Schema와 맞지 않으므로 명시 오류다.
10. 결과 segments는 outputStart 오름차순이다. 동일 시작이면 기본 구간(TTS/insert/pause/ending)을 overlay보다 먼저 둔다. 기본 구간만 Output의 연속성을 구성하며 overlay는 병렬 구간이다.
11. 안전한 정수 ms 범위를 넘는 덧셈은 `TIMELINE_DURATION_OVERFLOW` 오류다. 입력 개별 정수도 Core/Zod 안전 범위 안이어야 한다.

## Override와 지원 경계

Insert trim만 여기서 적용한다. Scene `outputTiming`은 `TIMELINE_UNSUPPORTED_OUTPUT_TIMING` 오류로 거절한다. Scene type, caption/visual/motion 등과 global 표시 Override는 `TIMELINE_DEFERRED_OVERRIDE` warning을 반환하고 Scene/렌더 담당이 나중에 적용해야 한다. 반환된 시간축을 모든 Override가 적용된 영상으로 해석하면 안 된다.

Scene ID, captionRange 끝점, Asset 및 Override 참조도 검사한다. Scene 겹침과 미할당 Caption은 warning이다. Cue 밖 무음에는 Scene 할당을 요구하지 않는다. 과도한 Insert 개수/비율의 임계값은 현 계약에 없으므로 임의 경고 정책을 추가하지 않았다. Pack별 제한은 `validateWorkspace`로 별도 검증한다.

Source duration의 provenance는 SourceTimeline에 포함되지 않는다. SRT parser가 추론한 길이를 전달하면 그 길이까지만 보존하며 실제 TTS 뒤 무음을 복원할 수 없다. 호출자가 duration 메타데이터를 관리해야 한다.

## 심화 검증

`validateResolvedTimeline`은 다음을 검사한다.

- projectId 및 production/overrides revision이 현재 입력과 일치하는가.
- 기본 Output 구간이 0에서 총 duration까지 빈틈·중복 없이 연속적인가.
- TTS가 Source 전체를 순서대로 정확히 한 번 덮고 길이를 보존하는가.
- TTS Source→Output offset이 정지 이벤트와 일치하며 정지 이벤트를 가로지르지 않는가.
- 모든 Insert/Overlay/Pause가 정확히 한 번 나타나며 ID/종류/anchor/유효 길이가 입력과 일치하는가.
- Overlay 경계, ending의 존재·횟수·위치·길이, 총 duration이 일치하는가.

검증기는 기본 연속성/Source 보존을 직접 검사하며, 이벤트의 예상 시각은 Resolver를 재실행해 대조한다. 수동 정답 fixture로 Resolver 계산도 별도 테스트한다. TTS를 더 잘게 나눈 저장 결과도 동일한 매핑과 순서를 보존하면 허용한다. 구간 배열은 outputStart 순이어야 하지만 같은 시각의 병렬 overlay 나열 순서만 다른 결과는 허용한다.

Revision은 입력 값과의 일치 검사다. revision을 올리지 않은 내용 변경을 감지하는 hash 기능은 없다. 실제 파일, media duration, 렌더, Scene/Caption 표시 결과, 음량, frame 변환, 업로드는 검증하지 않는다.

## 주요 진단

진단 형식은 Core의 `{severity, code, path, message}`다. path는 입력 루트 또는 Output 루트 기준이다.

| Code | 의미 |
| --- | --- |
| TIMELINE_INPUT_SCHEMA / TIMELINE_OUTPUT_SCHEMA | strict Schema/구간 구조 오류 |
| CAPTION_* | 기존 Caption 검증 오류/빈 Caption 경고 (path 앞에 source 추가) |
| TIMELINE_PROJECT_REF / TIMELINE_REVISION | 프로젝트 또는 revision 불일치 |
| TIMELINE_DUPLICATE_ID | Scene/Insert 중복 ID |
| TIMELINE_CAPTION_REF / TIMELINE_SCENE_REF / TIMELINE_ASSET_REF / TIMELINE_INSERT_REF | 잘못된 참조 |
| TIMELINE_ANCHOR_TIME | Source 범위 초과 또는 cue 중간 정지 |
| TIMELINE_ASSET_TYPE / TIMELINE_ASSET_DURATION | Asset 종류/선언 길이 불일치 |
| TIMELINE_OVERLAY_BOUNDS | Overlay가 ending 이전 영역을 벗어남 |
| TIMELINE_ENDING_DURATION / TIMELINE_ENDING | ending 길이/배치/개수 오류 |
| TIMELINE_DURATION_OVERFLOW / TIMELINE_DURATION | 안전 정수 초과/총 길이 불일치 |
| TIMELINE_SEGMENT_ORDER / TIMELINE_OUTPUT_CONTINUITY | 정렬 또는 기본 Output 연속성 오류 |
| TIMELINE_SOURCE_COVERAGE / TIMELINE_TTS_MAPPING | TTS 보존/매핑 오류 |
| TIMELINE_INSERT_MISSING / TIMELINE_INSERT_DUPLICATE / TIMELINE_INSERT_TIMING | Insert 완전성/정확성 오류 |
| TIMELINE_UNSUPPORTED_OUTPUT_TIMING | 적용 불가능한 Scene 타이밍 Override |
| TIMELINE_DEFERRED_OVERRIDE | 후속 표시 Override 적용 필요 (warning) |
| TIMELINE_SCENE_OVERLAP / TIMELINE_UNASSIGNED_CAPTION | Scene 할당 경고 |

테스트: `tests/timeline.test.ts`. 검증 명령: `npm run typecheck`, `npm test`, `npm run build`, 빌드 후 `@short-auto/core` 공개 import 확인.
