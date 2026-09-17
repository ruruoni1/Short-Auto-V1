# Short-Auto Core

프로젝트 루트는 `D:\coding\Short-auto`입니다. [이관 v3](docs/NIHON_ZUPZUP_CODEX_MIGRATION_v3_2026-09-09.md)를 먼저 읽고 지정된 docs 루트 최신 문서만 구현 기준으로 사용합니다. `docs/archive`는 활성 기준에서 제외합니다.

현재 순서는 기존 구현 마이그레이션 → Official Clip Library → Thumbnail Studio → VOICEVOX TTS입니다. [진행 기록](docs/MIGRATION_STATUS.md)에서 검증 상태를 관리합니다. VOICEVOX 백엔드와 UI 연결은 완료되었고 실제 엔진 청취 검증은 별도입니다.

Node.js/TypeScript 공통 데이터 계약 패키지 (`@short-auto/core`, 0.1.0).
React/Remotion/Electron 후속 모듈이 같은 Schema와 타입을 가져다 사용합니다.
순수 Core는 모델·검증·Caption·Timeline·Scene·Asset·Theme/Motion을 제공하며, 별도 React/Remotion 진입점에서 합성 fixture Preview/MP4 테스트 렌더를 실행할 수 있습니다. 전체 영상 제작 앱은 아직 구현 중입니다.

## 실행

Node.js 22.13 이상과 npm이 필요합니다. 프로젝트 루트에서 실행합니다. 현재 검증 환경은 Node.js 24.13입니다.

```sh
npm ci
npm run typecheck
npm test
npm run build
```

## 로컬 제작 관리 화면

```powershell
Set-Location D:\coding\Short-auto
npm run app
```

브라우저에서 `http://127.0.0.1:4310`에 접속합니다. 공식 채널을 직접 등록하고 공식 여부를 확인한 뒤 동기화합니다. YouTube 동기화에는 서버 환경변수 `YOUTUBE_API_KEY`가 필요합니다. 키는 화면·DB·Git에 저장하지 않습니다. 다운로드에는 PATH의 yt-dlp(없으면 python -m yt_dlp)와 FFmpeg가 필요하며 사람이 채택한 클립만 실행됩니다.

로컬 SQLite는 `data/sources.sqlite`, 소스 미디어는 `assets/media`에 저장되며 Git에서 제외됩니다. 수집한 메타데이터의 원본 URL과 검수 메모를 유지합니다. 현재 API 및 미디어 실연결 검증 여부는 [클립 검증 기록](docs/CLIP_LIBRARY_QA.md)을 확인하세요.

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

최신 구현 기준은 [문서 목록](docs/README.md)을 참고하세요.

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
현재 지원 문법과 진단은 src/caption.ts와 관련 테스트에 구현되어 있습니다.

## React/Remotion Scene Preview 테스트

순수 Core와 별도인 `@short-auto/core/render` 진입점을 제공합니다. 9개 Scene type과 합성 미디어를 사용하는 테스트 Composition이며, 사용자 제작의 승인된 Final Render 기능은 아닙니다.

FFmpeg/FFprobe를 PATH에 설치한 후 프로젝트 루트에서 실행합니다.

```sh
npm run render:assets
npm run preview
npm run render:fixture
npm run render:portrait
npm run render:verify
```

Studio에서 `ScenePreviewLandscape`(1280×720), `ScenePreviewPortrait`(720×1280)를 선택합니다. 둘 다 30fps, 영상 13초입니다. Preview URL은 실행 콘솔을 확인하세요. 출력 MP4와 probe/전체 decode/오디오 검사/대표 프레임 증거는 `dist/render/`에 생성됩니다.

합성 자료는 직접 만든 도형 영상·이미지·테스트음이며 실제 TTS 음성이나 사용자 미디어가 아닙니다. `remotion/public/` 생성물은 기존 파일을 덮어쓰지 않습니다. FREEZE_FOCUS/MATCH, 동시 Scene 레이아웃, Scene 내 비디오는 명시 오류로 남습니다. 임시 Theme와 OS 설치 폰트를 사용하며 최종 브랜드 디자인이 아닙니다.

이 Preview는 기존 구현의 회귀 확인용입니다. 신규 제작 기능은 최신 문서의 Phase 순서를 따릅니다.

## 긴 Caption 표시 단위 Preview

긴 자막 fixture와 정책 전달 연결은 Caption Preview에 반영되어 있습니다. 아래 명령으로 가로·세로 fixture를 생성하고 검증할 수 있습니다.

```sh
npm run render:assets
npm run caption:assets
npm run caption:preview
npm run caption:landscape
npm run caption:portrait
npm run caption:verify
```

가로/세로 MP4와 probe·대표 프레임은 `dist/render/caption-long*`에 생성됩니다. 기존 13초 Scene Preview MP4는 보존됩니다. `npm run caption:verify`는 두 MP4의 full decode와 정책 표시 표본을 검증합니다.

## VOICEVOX TTS 백엔드 계약

VOICEVOX는 기본적으로 `http://127.0.0.1:50021`만 사용합니다. 앱은 `/version` health와 `/speakers` 동적 목록을 확인하고, 사용자가 선택한 `speaker_uuid`와 `style_id`를 프로필로 저장합니다. 문장 생성은 `audio_query` → `synthesis` 순서로 실행하며 `output/tts/{contentId}` 아래에 문장별 WAV와 순서를 재현하는 manifest를 기록합니다.

```powershell
$env:VOICEVOX_ENDPOINT = "http://127.0.0.1:50021"
npm run app
```

실제 엔진이 실행되지 않아도 `npx tsx --test tests/voicevox.test.ts`로 endpoint 제한, 동적 화자 identity, 오류 보존, WAV/manifest 계약을 모킹 검증할 수 있습니다. 실제 VOICEVOX 청취와 최종 음질 확인은 UI 연결 후 별도로 수행합니다.

## ContentPlan 및 썸네일 관계

ContentPlan은 `contentId`, `contentType`, `title`, `status`, `createdAt`, `updatedAt`를 필수로 저장하며 hook·source·published 필드는 선택 사항입니다. 썸네일 참조는 ContentPlan에 역방향 ID를 저장하지 않고 ThumbnailProject의 `contentId`로 관리합니다. 콘텐츠마다 PRIMARY 썸네일 프로젝트 하나와 여러 VARIANT를 둘 수 있고, VARIANT는 PRIMARY의 `variantOfProjectId`를 가리킵니다.

SourceFrame이 `unchecked`이면 썸네일 생성·편집·미리보기는 경고와 함께 허용됩니다. 최종 export와 ContentPlan의 `READY`/`PUBLISHED` 전환은 `reviewed` 프레임만 허용하고, `rejected` 프레임은 차단합니다.

SourceFrame 권리 검수는 `PATCH /api/source-frames/:id/review`에서 `expectedRevision`, `status`, `notes`를 받아 처리합니다. 공식 프레임 업로드는 `sourceFrameId`를 기준으로 서버가 현재 프레임과 원본 이미지의 상태·출처·해시를 재검증합니다.

