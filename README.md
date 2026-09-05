# Short-Auto Core

Node.js/TypeScript 공통 데이터 계약 패키지 (`@short-auto/core`, 0.1.0).
React/Remotion/Electron 후속 모듈이 같은 Schema와 타입을 가져다 사용합니다.
현재 구현은 모델·런타임 검증과 SRT 파싱이며 영상 생성 앱이나 렌더러가 아닙니다.

## 실행

Node.js 22 이상과 npm이 필요합니다. 프로젝트 루트에서 실행합니다.

```sh
npm ci
npm run typecheck
npm test
npm run build
```

## 사용

```ts
import { ProductionSchema, validateWorkspace, checkFinalRenderReadiness } from '@short-auto/core';
import type { Production } from '@short-auto/core';
import { nihonZupzupPack } from '@short-auto/core/nihon-zupzup';

const production: Production = ProductionSchema.parse(jsonFromDisk);
const result = validateWorkspace({
  packs: [nihonZupzupPack],
  projects: [{ production, source, overrides }],
  contents: [],
});
// result.diagnostics: severity, code, path, message
```

먼저 `npm run build`로 export 대상 JS와 선언 파일을 만듭니다.
외부 JSON은 `unknown`으로 읽고 Schema.parse/safeParse 또는 validateWorkspace로 검사합니다.
단일 ProductionSchema 검사는 구조만 검사합니다. Pack, Caption, Asset, 관계 검증에는 전체 Workspace가 필요합니다.

`examples/workspace.json`은 Long과 파생 Short를 연결한 정상 Preview 데이터입니다.
`examples/invalid-workspace.json`은 Caption 중간 Insert 오류 예시입니다.
두 예시의 미디어 경로는 가상이며 실제 오디오·영상·렌더 결과가 없습니다.

`checkFinalRenderReadiness(workspace, projectId)`는 현재 revision 승인과 Asset 상태를 검사합니다.
통과해도 실제 파일 존재/디코딩/렌더 성공을 보증하지 않습니다. Editor는 제작 데이터나 Override 수정 때 해당 revision을 반드시 증가시켜야 합니다.

상세 계약과 후속 결정 사항은 [Core 계약](docs/CORE_CONTRACT.md)을 참고하세요.

## SRT 파싱·Caption 검증

```ts
import { parseSrt, validateCaptions } from '@short-auto/core';

const result = parseSrt('1\n00:00:00,000 --> 00:00:01,500\n안녕하세요\nこんにちは', {
  durationMs: 2000, // 호출자가 확인한 Source 길이(ms)
});
if (result.source) {
  const source = result.source; // Core SourceTimeline에 그대로 연결
  console.log(validateCaptions(source));
}
console.log(result.diagnostics, result.duration);
```

duration을 생략하면 마지막 cue 종료 시각만 추론하고 warning을 반환합니다. 실제 TTS 길이를 보증하지 않습니다.
원문은 `originalSrt`, 원본 cue와 위치는 `cues`에 보존합니다. 오류가 있으면 `source`는 null이며 자동 재번호·시간 수정·분할을 하지 않습니다.
지원 문법과 진단 코드는 [Caption 계약](docs/CAPTION_CONTRACT.md)을 참고하세요.
