# Caption 파싱·검증 계약

기존 Core 모델을 변경하지 않는 최초 기능이다. 공개 진입점은 `@short-auto/core`이며 Node 파일 API에 의존하지 않는다.

## API

```ts
parseSrt(originalSrt: string, options?: { durationMs?: number }): ParseSrtResult
validateCaptions(input: unknown): ValidationResult
```

`parseSrt`는 디코딩된 문자열을 받는다. 파일 읽기·인코딩 감지는 호출자의 책임이다. 반환값은 `valid`, `originalSrt`, `cues`, `diagnostics`, `duration`, `source`다. 오류가 하나라도 있으면 `valid: false`, `source: null`이다. 잘못된 cue를 버리고 부분 성공 Timeline을 만들지 않는다. `cues[].caption`은 해당 블록의 구문 파싱 결과일 뿐이며, cue 간 순서·겹침 검증을 통과했다는 의미가 아니다.

`validateCaptions`의 입력은 Caption 배열 자체가 아니라 Core `SourceTimeline {durationMs, captions}`다. 먼저 Core strict Schema를 검사하고, 성공하면 중복 ID·ID 증가·시간 역순·겹침·duration 초과·공백만 있는 내용을 검사한다. 반환은 기존 `ValidationResult {valid, diagnostics}` 형식이다. 원본 객체와 배열을 변경하지 않는다. 겹침 확인용 임시 배열만 정렬한다. 겹침 진단은 해당 cue와 앞선 교차 구간 하나를 가리키며 모든 교차 쌍을 나열하지 않는다.

## 원본 보존

- `originalSrt`는 BOM, 줄바꿈, 공백, 구분 빈 줄까지 입력 문자열 그대로다.
- 각 `SrtCue`는 `index`(0부터), `line`(1부터), `startOffset/endOffset`(JS UTF-16 문자열 인덱스, 끝 제외), `raw`, `numberLine`, `timingLine`, `text`, `caption`을 갖는다.
- `raw`는 번호 줄 시작부터 마지막 내용 줄 끝까지다. 뒤의 줄바꿈·블록 구분 빈 줄은 제외한다. 전체 복원 기준은 `originalSrt`다. 첫 cue에 붙은 BOM은 `raw`와 `numberLine`에도 남는다.
- `text`와 Core `Caption.text`에는 내용 줄의 원래 CRLF/LF, 앞뒤 공백, 한글·일본어·태그를 그대로 보존한다. 태그 해석·제거·Unicode 정규화·줄 수 제한을 하지 않는다.
- 시간은 정확한 정수 ms로 변환한다. 원문 시간 표현은 `timingLine`에 남는다. frame 반올림이나 cue 시간 수정은 없다.
- 번호 `0003`은 Core의 숫자 ID `3`이며 원문 `0003`은 보존된다. ID는 1 이상 안전한 정수이고 증가해야 하며, 연속일 필요는 없다. 자동 재번호·정렬·분할·병합은 없다.
- 표시용 분할 구조는 이번에 생성하지 않는다. 후속 표시 단위는 이 원본 cue/ID 참조를 유지해야 한다.

## 허용 문법 및 오류 경계

입력 시작의 BOM, LF/CRLF 및 혼합, 여러 줄 내용, 마지막 개행 유무, 선행/후행 빈 줄을 지원한다. 공백만 있는 줄은 블록 구분자다. 내용 내부의 빈 줄은 SRT 블록 구분자로 해석한다.

번호 줄 앞뒤 공백을 허용한다. 시간은 `HH:MM:SS,mmm --> HH:MM:SS,mmm`이다. 시는 2자리 이상, 분·초는 00–59, 밀리초는 3자리다. 화살표 양옆에는 공백 또는 탭이 필요하다. 시간 줄 앞뒤 공백/탭도 허용한다. 모든 시간·ID·입력 duration은 안전한 정수 범위다.

bare CR, 소수점 방식 시간, 타임스탬프 설정 확장, 음수/역전/0길이 구간은 오류다. 내용 속 `숫자 줄 + 정상 시간 줄`은 구분 빈 줄이 빠졌을 가능성으로 진단한다. 이런 두 줄을 실제 내용으로 쓰는 경우도 모호하므로 오류로 처리한다. 잘못된 블록 복구는 빈 줄 경계에서만 한다.

구문 오류가 있으면 cue 간 의미 검증을 생략한다. 모든 블록이 파싱되고 유효한 duration이 있을 때 전체 SourceTimeline 검증을 실행한다. 따라서 구문 오류를 수정한 뒤 추가 의미 오류가 나타날 수 있다. 이 API는 오류를 자동 수정하지 않는다.

## Duration과 빈 입력

`duration`은 다음 판별 union이다.

| kind | 의미 |
| --- | --- |
| `provided` | 호출자가 양수 정수 `durationMs`를 입력했다. 미디어를 직접 검사했다는 뜻은 아니다. |
| `inferred-last-cue` | 입력 duration이 없고 모든 블록이 파싱되어, 파일상 마지막 cue의 종료 시각을 사용했다. |
| `unavailable` | 유효한 입력 duration이나 추론 가능한 cue가 없다. `durationMs: null`. |

추론 시 `SRT_DURATION_INFERRED` warning을 항상 반환한다. 추론값은 실제 TTS 길이가 아니며 뒤 무음 길이를 알 수 없다. 최대 cue 종료 시각을 사용하거나 source duration을 자동 확장하지 않는다. 역순 cue 등으로 결과가 invalid인 경우에도 추론 메타데이터가 남을 수 있으므로 `source`와 `valid`를 함께 확인한다.

명시 duration이 마지막 cue보다 길면 뒤 무음을 보존하고, 짧으면 오류다. 잘못된 입력 duration은 추론값으로 대체하지 않는다. 빈 SRT는 duration 입력 여부와 무관하게 `SRT_EMPTY` 오류다. 독립 validator는 Core가 허용하는 양수 duration + 빈 captions를 `CAPTION_EMPTY` warning으로 처리한다.

## 진단

공통 필드는 `severity`, `code`, `path`, `message`다. parser는 cue 관련 진단에 `cueIndex`, 원문 `line`을 추가한다. 구문 진단 path는 `cues.N.*`, 의미 진단은 Core 경로인 `captions.N.*`다. 의미 진단의 line은 cue 시작 줄이다.

| code | 의미 |
| --- | --- |
| `SRT_EMPTY` | cue 없는 입력 |
| `SRT_NUMBER` | 비정상·0·음수·안전 범위 밖 번호 |
| `SRT_TIME_FORMAT` | 시간 줄 누락 또는 문법 오류 |
| `SRT_TIME_RANGE` | 안전 정수 ms 범위 초과 |
| `SRT_TIME_INTERVAL` | 종료가 시작 이하 |
| `SRT_EMPTY_TEXT` | 내용 누락/공백 |
| `SRT_LINE_ENDING` | bare CR |
| `SRT_MISSING_SEPARATOR` | 내용에 cue 헤더로 보이는 줄이 있음 |
| `SRT_DURATION` | 비정상 입력 duration |
| `SRT_DURATION_INFERRED` | 마지막 cue로만 추론한 duration (warning) |
| `CAPTION_SCHEMA` | Core 구조·필드 오류 |
| `CAPTION_DUPLICATE_ID` | 중복 ID |
| `CAPTION_ID_ORDER` | 증가하지 않는 ID |
| `CAPTION_TIME_ORDER` | 시작 시각 역순 |
| `CAPTION_OVERLAP` | 실제 시간 구간 겹침 (맞닿은 경계는 허용) |
| `CAPTION_OUTSIDE_DURATION` | source duration 초과 |
| `CAPTION_EMPTY_TEXT` | 공백만 있는 Core caption |
| `CAPTION_EMPTY` | 비어 있는 Core caption 배열 (warning) |

## 검증 및 후속 범위

`tests/caption.test.ts`의 문자열 fixture로 BOM/CRLF/LF/한일 다중행 보존, 비정상 구문, ID, 순서, 중첩 구간, duration, 불변성 및 기존 Workspace 연결을 검증한다. 기존 Core 테스트를 유지한다.

줄바꿈·분할 UI, Caption 렌더, Timeline Resolver, SRT 쓰기, 파일 인코딩 자동 감지, 미디어 duration 측정은 후속 범위다. `source`를 영속 저장할 때 추론 provenance가 필요하면 parser 결과의 `duration` 메타데이터도 별도로 보관해야 한다. Core SourceTimeline 자체에는 provenance 필드가 없다.
