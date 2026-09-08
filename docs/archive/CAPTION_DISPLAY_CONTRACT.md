# Source 불변 Caption 표시 분할

이 기능은 순수 표시 데이터 생성이다. 기존 Core Schema, SRT parser, SourceTimeline, Scene Runtime, renderer를 변경하지 않는다. 공개 진입점 `@short-auto/core`에 React/Remotion 의존성을 추가하지 않는다.

## 공개 API

```ts
import { buildCaptionDisplay } from '@short-auto/core';

const result = buildCaptionDisplay(sourceTimeline, {
  maxGraphemesPerLine: 20,
  maxLinesPerUnit: 2,
  minUnitDurationMs: 300,
});
if (result.valid) {
  // result.units: Source cue에 연결된 표시 데이터. Renderer 연결은 별도다.
} else {
  // result.units === null; result.diagnostics로 오류 확인
}
```

`buildCaptionDisplay(source: unknown, policy: CaptionDisplayPolicy): CaptionDisplayResult`.
입력은 Caption 배열이 아닌 Core SourceTimeline이다. `validateCaptions`의 기존 구조/의미 검증을 그대로 적용한다. 정책의 세 필드는 모두 필수 양수 안전 정수이며 미등록 정책 필드는 오류다. 임의 기본값이나 자동 정책 완화는 없다. 예시의 20/2/300은 사용 예시이며 채널 기본 정책 확정이 아니다.

성공 결과는 `{valid: true, policy, units, diagnostics}`다. `policy`는 복사한 검증 결과다. 실패는 `{valid: false, units: null, diagnostics}`이며 한 cue라도 실패하면 부분 표시 계획을 반환하지 않는다. 입력과 연결된 mutable 객체를 반환하지 않으므로 출력 수정이 원본이나 다음 호출을 바꾸지 않는다.

## 분할 정책

1. `Intl.Segmenter('und', {granularity: 'grapheme'})`로 원문을 순회한다. 한글 음절/조합 자모, 일본어, 영문, 결합문자, emoji ZWJ/피부색/국기 등은 런타임 Unicode grapheme 규칙을 따른다. code unit이나 code point 단위로 자르지 않는다.
2. 내용 grapheme를 `maxGraphemesPerLine`개까지 채우고 다음 grapheme 앞에서 줄을 나눈다. 긴 영단어도 이 규칙으로 분할한다. 언어 판정, 단어 우선 배치, 일본어 금칙 처리, 문장 의미 분석, 하이픈 삽입은 하지 않는다.
3. CRLF(한 grapheme), LF, CR, U+2028/U+2029는 강제 개행이며 줄당 grapheme 수에 포함하지 않는다. 개행은 앞줄의 `lineEnding`으로 보존한다. 이미 한도에 도달한 줄 뒤 개행도 그 줄에 속한다. 마지막 개행 뒤 가상의 빈 줄/페이지를 추가하지 않는다.
4. 연속/선행 개행은 빈 표시 줄로 보존하며 최대 줄수에 포함한다. 공백/탭/NBSP는 일반 grapheme 한 개로 세고 제거하거나 합치지 않는다. 공백만 있는 일부 줄·단위도 순서와 원문 보존을 위해 남긴다.
5. 줄들을 `maxLinesPerUnit`개씩 순서대로 묶는다. 다음 Source cue와 합치지 않는다.

동일 입력·정책·Unicode/ICU 런타임에서 결정적이다. 새 Unicode 버전에 추가된 문자 조합의 분할은 런타임 버전에 따라 달라질 수 있다. 배포 간 동일 결과가 필요하면 동일 런타임 버전을 고정하거나 생성 계획을 보관해야 한다. Intl.Segmenter가 없으면 오류이며 안전하지 않은 대체 분할은 없다.

**grapheme 수는 픽셀 폭이 아니다.** 탭/전각/emoji/폰트별 glyph 폭과 줄 높이를 측정하지 않으므로 실제 화면 fit을 보증하지 않는다. 화면 overflow, 언어별 읽기 품질, 폰트 fallback, 시각 검수는 renderer 연결 단계의 책임이다.

## 원문 참조와 복원

각 `CaptionDisplayUnit`:

- `origin: 'source'`, `sourceCaptionId`, `sourceCaptionIndex`(0부터), `unitIndex`(cue 안 0부터).
- `sourceStart/sourceEnd`: 원래 `Caption.text` 안 UTF-16 `[start,end)` 범위. SRT 파일 전체 offset이 아니다.
- `text`: 해당 범위의 정확한 원문 slice. 삽입된 soft wrap 개행을 포함하지 않는다.
- `startMs/endMs`: Source ms 안의 `[start,end)` 표시 구간.
- `lines`: `CaptionDisplayLine[]`.

각 줄은 `sourceStart/sourceEnd`, `text`, `lineEnding`, `graphemeCount`를 갖는다. 줄 범위는 원래 강제 개행까지 포함하며, 줄 `text`는 해당 개행만 제외한다. 자동 줄바꿈의 `lineEnding`은 빈 문자열이다.

cue별 단위의 `text`를 순서대로 `join('')`하면 원래 Caption.text와 정확히 같다. 각 단위의 줄을 `text + lineEnding`으로 이어도 단위 원문이 된다. 모든 범위는 인접하고 누락/중복이 없으며 grapheme 경계에서만 나뉜다. 화면용 줄 배열을 개행으로 연결한 결과는 원문 복원용 문자열이 아니다.

원본 ID, text, startMs/endMs, Source duration, 다른 cue, parser의 originalSrt/raw/offset은 수정하지 않는다. 출력은 새로운 Caption이나 SourceTimeline이 아니며 기존 Caption ID를 재번호하지 않는다. SRT 원문/파일 위치가 필요하면 `sourceCaptionId`와 parser 결과를 연결한다.

## 시간 배분과 예외

cue 길이 D와 표시 단위 수 N에 대해 `q = D div N`, `r = D mod N`을 구한다. 앞 r개 단위는 q+1ms, 나머지는 q ms다. BigInt 중간 연산으로 안전 정수 상한에서도 곱셈/누적 오차를 방지한다. 반환 ms는 기존 계약에 맞는 number다.

`D < N × minUnitDurationMs`면 `CAPTION_DISPLAY_TOO_SHORT` 오류다. 줄/페이지 제한을 몰래 늘리거나 내용을 생략하거나 주변 cue 시간을 빌리지 않는다. 성공 시 모든 단위가 최소 표시 시간 이상이고 cue 시작부터 종료까지 빈틈/겹침 없이 완전 분할한다. 무음 gap 및 Source 전체 duration은 그대로다.

균등 배분은 발화 정렬이나 글자수 가중 시간이 아니다. 1ms 단위가 허용되더라도 실제 프레임에 포착되거나 읽을 수 있다는 보증은 없다. frame 양자화, Source→Output Insert/Pause 매핑은 후속 renderer/Timeline 소비 계층이 처리해야 한다. 표시 경계는 원본 cue 경계가 아니므로 새 Insert anchor로 간주하지 않는다.

- 0길이/역전/비정상 시간: 기존 `CAPTION_SCHEMA` 오류.
- 빈 text: 기존 Schema 오류. 공백/개행만 있는 cue: `CAPTION_EMPTY_TEXT` 오류.
- 양수 Source duration + 빈 captions: 성공, `units: []`, 기존 `CAPTION_EMPTY` warning.
- 일부 단위만 공백/개행인 경우: 원문 보존을 위해 유지하고 같은 시간 배분을 적용한다.
- 정책 오류: `CAPTION_DISPLAY_POLICY`.
- Segmenter 미지원: `CAPTION_DISPLAY_SEGMENTER`.
- 기타 ID 중복/역순/겹침/duration 초과: 기존 Caption validator 진단을 그대로 전달한다.

## Override와 unsafe HTML 경계

이 API는 원문 표시만 생성하며 Override lines를 받거나 적용하지 않는다. `origin: 'source'`와 범위는 원문 기반임을 뜻한다. Override lines는 원문과 다를 수 있는 별도 사용자 표시 데이터이며 원문 범위가 있는 것처럼 이 계획에 섞으면 안 된다. 기존 Runtime/renderer의 Override 우선순위는 그대로 유지되며 실제 연결 방법은 후속 인수 범위다.

HTML/SRT 태그, entity, script처럼 보이는 문자열도 **그대로인 일반 텍스트**다. 해석·제거·escape·sanitize하지 않는다. 따라서 출력은 sanitized HTML이 아니다. 소비자는 React text children/textContent 같은 안전한 텍스트 출력 경로를 사용해야 하며 innerHTML/dangerouslySetInnerHTML에 전달하면 안 된다. 표시를 위해 임의로 HTML을 제거하면 원문 범위/복원 계약을 유지한 별도 변환 계층이 필요하다.

## 검증 범위

`tests/caption-display.test.ts`는 한글·일본어·영문 장단어·emoji·결합문자, CRLF/LF/연속 개행, 공백, 명시 정책, 시간 부족/최소 경계/안전 정수 상한, 불변성, sparse ID/gap 및 parser 결과 보존을 검증한다. 100개 고정 seed 혼합 Unicode 입력에 대해 grapheme 경계, 줄 제한, 텍스트 완전 복원, 시간 완전 분할을 추가 확인한다.

실행: `npm run typecheck`, `npm test`, `npm run build`, 빌드 후 공개 ESM import/실제 API 호출. 이 단위는 renderer 연결이나 MP4 생성 기능이 아니며 기존 가로/세로 렌더 산출물을 수정하지 않는다.
