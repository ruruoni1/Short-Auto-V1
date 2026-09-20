# 마이그레이션 실행 상태 — 2026-09-09

이 문서는 Master의 작업 기록이다. 구현 요구사항은 이관 v3 문서의 허용 목록만 사용한다. archive는 기준에서 제외한다.

## 감사 결과와 결정

- 현재 Core/Caption/Timeline/Scene/Asset/Theme 구현에는 Nadeshiko·Apify·vidIQ 필수 런타임, 일괄 다운로드, AI 썸네일 문구 생성, 고정 TTS 화자 의존이 없다. 기존 데이터는 보존한다.
- README의 폐기 계약 링크를 최신 문서 안내로 교체한다. Node 전용 설정에 고정 루트와 활성 문서 허용 목록을 둔다.
- 이관 §9의 channel_plan v1.3, 기타 문서의 v1.0/v2.0 참조는 최신 목록의 v1.4/v1.1/v2.1로 해석한다.
- REVIEWED 프레임은 후보로 관리할 수 있지만 제작용 썸네일 베이스는 채택된 소스와 권리 검토를 요구한다.
- TTS는 문장/장면별 WAV와 manifest를 기본 산출물로 한다. 제작 대본·원문·표시 텍스트·발화 텍스트를 분리한다.
- 기존 긴 자막 렌더 변경은 미완성이다. 정책이 ScenePreview에 전달되지 않으므로 분할 표시 렌더 완료로 취급하지 않는다. 변경 파일과 기존 렌더는 보존한다.

## 순서와 담당

1. Phase A: Master 통합, Core 담당 하위 에이전트 Sol/high — 루트 설정·문서 허용 목록·회귀 검증.
2. Phase B: Official Clip Library — 로컬 DB, 공식 채널 CRUD, 업로드 목록 증분 동기화, 사람 검수, SELECTED 다운로드, 관리 UI.
3. Phase C: Thumbnail Studio — 편집 가능한 4개 템플릿·베이스/텍스트 레이어·저장/복원·PNG/JPG.
4. Phase D: VOICEVOX — 동적 화자·명시 선택·미리듣기·프로필·문장 WAV.
5. Phase E: 소스 프레임·콘텐츠·썸네일 A/B 연계.

감사: Astra/high 코드 감사와 Sol/high 최신 콘텐츠 규칙 검토 완료. 기능별 검증 후 커밋·푸시한다. 실제 API/미디어/엔진 미검증을 완료로 보고하지 않는다.

## 현재 진행

Phase A 완료: 고정 루트·12개 활성 문서 허용 목록, 구버전 링크 정리, 로컬 데이터 Git 제외. 커밋 95284a6 반영 완료.

2026-09-13 Phase B: SQLite 저장소, 공식 채널 CRUD, 증분 동기화, 사람 검수, SELECTED 다운로드와 관리 UI 구현. 전체 358개 테스트와 TypeScript 빌드 통과. 브라우저에서 검수 차단·채택·실패 후 재시도·채널 비활성화 확인. 모바일 탐색 메뉴 수정은 시각 재검증 대기. 실제 YouTube API 및 미디어 다운로드 검증은 API 키와 사용자 채택 소스가 필요한 상태. 다음 단계는 Thumbnail Studio. 만료된 9월 9일 06:40 예약은 반복 호출을 막기 위해 PAUSED 처리했다.


## 2026-09-14 담당 작업 전환

Master 직속 구현 하위 에이전트는 중단한 상태로 유지한다. 기존 담당 작업을 같은 프로젝트 폴더에 포크하고 모델/추론 수준을 명시해 구현을 배정했다. 원본 작업은 대기한다.

| 원본 | 활성 포크 | 모델 / 추론 | 소유 범위 |
| --- | --- | --- | --- |
| 01_Core | 01_Core_v2 (`01a09ac0-0148-7b41-a51c-79cd9d9cf446`) | gpt-5.6-sol / high | ThumbnailRepository·모델·저장소 테스트 |
| 08_ReviewEditor | 08_ReviewEditor_v2 (`01a09ac0-0a86-7ca0-a096-741010f80b6b`) | gpt-5.6-luna / medium | Thumbnail Studio 화면·Canvas 편집기 |
| 12_Integration | 12_Integration_v2 (`01a09ac0-13ea-7333-94c3-ad4c36ab536c`) | gpt-5.6-sol / medium | 서버/API·폰트 번들·VOICEVOX 통합 테스트 |

9월 13일 최초 실행은 사용량 한도로 실패했다. 9월 14일 02:20 예약 실행에서 사용 가능 상태를 확인하고 같은 포크에 재개 지시했다. 일회 예약 short-auto-9-14-2-20은 실행 후 PAUSED 처리했다. 이후 Phase C API·폰트·UI 포크를 재개했고 브라우저 QA까지 완료했다. 담당 결과를 통합 검증한 뒤 기능별 커밋·푸시한다. 기존 Caption 렌더 변경은 보존한다.

2026-09-14 Phase B 검증 기록: 독립 Git index 스냅샷에서 TypeScript 검사 및 전체 359개 테스트를 통과했고, `dfe3828`로 커밋·푸시했다. 모바일 390×844 메뉴 검증도 완료했다. C 구현과 기존 Caption 변경은 별도 작업으로 보존했다.

## 2026-09-14 오전 재개 및 일회 예약

현재 조정 Master는 `00_Master (3)` (`01a09f6f-ef84-78d0-95ce-301aa743e6fd`)다. 최신 중단 지점은 Phase C Thumbnail Studio 통합 검증이었다. Phase B는 `dfe3828`로 커밋·푸시됐다. 기존 포크 `01_Core_v2`와 `08_ReviewEditor_v2`에는 작업별 모델·추론 수준을 명시하여 재개했고, `12_Integration_v2`도 API 검증을 완료했다. 원본 담당 작업은 대기하며 기존 Caption 변경은 보존한다.

2026-09-14 14:00 Asia/Seoul에 이 Master에서 최신 중단 지점을 이어가는 일회 예약 `short-auto-9-14-2`를 설정했고 실행 후 PAUSED 처리했다. 실제 Git·상태 문서·담당 작업 상태를 먼저 확인하여 중복 배정을 막았다.

## 2026-09-14 Phase C Thumbnail Studio 검증 완료

- `01_Core_v2`: ThumbnailRepository·모델·저장소 테스트 완료. 4개 템플릿, revision 충돌, PNG/JPEG 구조 검증, 폰트 family/weight gate, 프로젝트 영속화를 확인했다.
- `12_Integration_v2`: Thumbnail API, exact JSON media type, 동시 mutation 충돌, Noto Sans CJK KR 번들·해시·라이선스 self route를 확인했다.
- `08_ReviewEditor_v2`: 실제 Chrome QA 완료. 4개 템플릿, 베이스 업로드, 한글·일본어 혼합 줄바꿈, 레이어 이동·리사이즈·잠금·숨김·삭제, 저장·복원, PNG/JPG export, 폰트 실패 차단, 390×844 모바일을 확인했다.
- 자동 검증: `npm run typecheck` 통과, `npm run build` 통과, `npm test` 380/380 통과, `node --check src/app/web/studio.js` 통과, `git diff --check` 통과.
- QA 증거: `temp/thumbnail-ui-qa.md`, `temp/thumbnail-studio-desktop.png`, `temp/thumbnail-studio-mobile.png`. 해당 파일은 임시 증거이며 Git에는 넣지 않는다.
- 남은 제한: 공식 클립 프레임 연결과 A/B·crop/brightness UI는 Phase E 또는 후속 범위다. 브라우저 다운로드 경로 자체는 자동화 환경에서 확인하지 않고 서버 export 메타데이터와 다운로드 트리거를 확인했다.

## 2026-09-14 긴 Caption 렌더 연결 완료

- 기존 cue-level 표시 경로를 보존하면서 선택적 `CaptionDisplayPolicy`를 `prepareScenePreview`와 `ScenePreview`에 연결했다.
- Runtime `sourceTimeMs`와 원본 caption ID의 반개방 구간으로 표시 단위를 선택하고, `caption.lines` override·Insert/Pause 숨김·Source 재개 동작을 검증했다.
- `CaptionLongLandscape`와 `CaptionLongPortrait`를 각각 30fps, 585 video frames, 19.5초로 렌더했다. 두 MP4 full decode와 대표 프레임 검증이 통과했다.
- 검증: `npm run typecheck`, `npm run build`, `npm test` 388/388, `npm run caption:verify` 통과.
- 기존 13초 Scene Preview MP4는 보존했다. 픽셀 fit은 grapheme 수 기반 정책이며 실제 fixture 표본 범위에서 검증한다.

## 2026-09-14 Phase D VOICEVOX 백엔드 계약 완료

- `12_Integration_v2`: localhost 전용 endpoint, health 3상태, 동적 speaker/style 목록, 명시적 `speaker_uuid`·`style_id` 프로필, `audio_query`·`synthesis`, 문장별 WAV와 재현 manifest, 구조화 오류와 원자적 프로필 저장을 구현했다.
- 검증: `npx tsx --test tests/voicevox.test.ts` 7/7, `npm run typecheck`, `npm run build`, `npm test` 395/395, `git diff --check` 통과.
- 실제 VOICEVOX 엔진은 호출하지 않고 fetch 모킹으로 계약을 검증했다. 외부 endpoint 차단, 동적 identity 보존, 파라미터 검증, 경로 탈출 차단, 실패 시 script/profile/output 상태 보존을 확인했다.
- UI 연결 전까지 예약 `short-auto-9-15-00-20`은 사용량 제한 재개용으로 활성 유지한다.

## 2026-09-14 Phase D VOICEVOX UI 연결 완료

- `08_ReviewEditor_v2`: 기존 `준비 중` 메뉴를 실제 VOICEVOX 작업 공간으로 교체하고 health/unavailable/retry 상태, 동적 화자·스타일 선택, 프로필 저장, 파라미터 조절, WAV 미리듣기, 문장 생성 결과 표시를 연결했다.
- 엔진이 꺼진 상태에서도 클립 라이브러리를 막지 않고 안내와 재시도만 표시하는 것을 로컬 앱에서 확인했다. 선택·입력은 오류 뒤 보존하도록 구현했다.
- 검증: `node --check src/app/web/app.js`, `npm run typecheck`, `npm run build`, `npm test` 395/395, `git diff --check` 통과. 브라우저에서 `http://127.0.0.1:4310`의 unavailable 상태와 VOICEVOX 패널을 확인했다.
- 실제 VOICEVOX 엔진의 동적 목록·청취·음질·실제 WAV 생성은 아직 미검증이다. 이 확인은 사용자 PC에서 엔진을 실행한 뒤 별도 수행한다. 다음 단위는 Phase E 소스 프레임·콘텐츠·썸네일 A/B 연계다.

## 2026-09-14 Phase E SourceClip → SourceFrame 백엔드 완료

- `01_Core_v2`: 선택된/다운로드된 SourceClip의 project-relative 영상에서 timestamp 프레임을 추출하고, SourceFrame SQLite 저장소와 조회 API를 연결했다. FFprobe/FFmpeg는 `shell:false` runner로 호출하며, PNG/JPEG 구조·dimensions·SHA-256·심볼릭 링크·경로 탈출·원본 identity를 검증한다.
- API: `POST /api/source-clips/:clipId/frames`, `GET /api/source-frames?clipId=...`, `GET /api/source-frames/:id`, `GET /api/source-frames/:id/image`. 같은 clip/timestamp 요청은 기존 프레임을 재사용하고 실패 시 임시 파일·DB row를 남기지 않는다.
- 검증: `npx tsx --test tests/source-frame.test.ts` 11/11, `npm run typecheck`, `npm run build`, `npm test` 406/406, `git diff --check` 통과.
- 실제 FFmpeg 바이너리와 사용자 영상은 실행하지 않고 fake runner로 성공·실패 경계를 검증했다. 다음 단위는 SourceFrame → ThumbnailProject 연결이며, 실제 추출은 FFmpeg가 설치된 사용자 환경에서 별도 확인한다.

## 2026-09-14 Phase E SourceFrame → ThumbnailProject 연결 완료

- `12_Integration_v2`: `POST /api/thumbnail-projects/from-source-frame`를 추가했다. 저장된 SourceFrame의 실제 이미지 bytes·MIME·dimensions·byteLength·SHA-256을 재검증하고, 출처·권리·YouTube identity를 OFFICIAL_CLIP_FRAME 프로젝트에 복사한다.
- 프로젝트는 원본 SourceFrame을 이동하거나 삭제하지 않고 독립된 베이스 이미지 복사본과 `project.json`을 원자적으로 저장한다. 누락·변조·경로 주입은 구조화 오류로 거부한다.
- 검증: `npx tsx --test tests/source-frame-thumbnail.test.ts tests/thumbnail-http.test.ts` 9/9, `npm run typecheck`, `npm run build`, `npm test` 408/408, `git diff --check` 통과.
- 실제 영상/FFmpeg 실행은 하지 않고 합성 PNG와 기존 JPEG fixture로 검증했다. 다음 단위는 이 endpoint를 사용하는 Thumbnail Studio UI와 ContentPlan/A-B variant 연계다.

## 2026-09-14 Phase E A/B ThumbnailProject variant 완료

- `01_Core_v2`: `POST /api/thumbnail-projects/:projectId/variants`를 추가했다. 원본 레이어·캔버스·안전영역·베이스 출처를 보존하면서 새 UUID와 `variantOfProjectId`를 만들고, 베이스 이미지가 있으면 독립 파일로 복사한다.
- variant는 revision 0과 빈 exports로 시작하며 원본을 변경하지 않는다. 누락·변조·경로 주입은 새 디렉터리를 남기지 않고 거부한다. 이름과 channel profile override는 strict schema를 따른다.
- 검증: `npx tsx --test tests/thumbnail-variant.test.ts tests/thumbnail-http.test.ts` 11/11, `npm run typecheck`, `npm run build`, `npm test` 412/412, `git diff --check` 통과.
- 다음 단위는 Thumbnail Studio UI에서 SourceFrame 프로젝트 생성과 A/B variant endpoint를 사용하는 흐름이다. ContentPlan 모델은 아직 구현하지 않았다.

## 2026-09-15 Thumbnail Studio SourceFrame/A-B UI 연결 완료

- `08_ReviewEditor_v2`: Thumbnail Studio에 A/B 변형 이름 입력과 변형 생성, SourceFrame ID 입력과 프로젝트 생성 흐름을 연결했다. 성공 응답만 새 프로젝트로 열고 variant lineage와 원본 보존 상태를 표시한다.
- 요청 중복 클릭은 기존 operation 잠금으로 차단하며, 늦은 응답이 다른 편집 상태를 덮어쓰지 않도록 요청 전 project snapshot을 확인한다. SourceFrame 오류는 입력을 유지한 채 aria-live 오류 영역에 표시한다.
- 검증: `node --check src/app/web/studio.js`, `npm run typecheck`, `npm run build`, `npm test` 412/412, `git diff --check` 통과. 로컬 `/studio`에서 SourceFrame 누락 오류와 새 UI 컨트롤을 확인했다.
- 실제 SourceFrame/FFmpeg 실행과 성공 생성은 아직 사용자 미디어가 없어 미검증이다. 다음 작업은 ContentPlan 연결 여부를 설계한 뒤 필요한 경우 구현하는 것이다.

## 2026-09-18 Phase E ContentPlan·ThumbnailProject 관계 구현 완료

- `09_Content_Manager_v2`: ContentPlan JSON 영속성 및 `GET/POST/PATCH /api/content-plans`를 추가했다. 필수 필드는 `contentId`, `contentType`, `title`, `status`, `createdAt`, `updatedAt`로 고정하고 hook/source/published 필드는 선택적으로 저장한다. ContentPlan에는 `thumbnailProjectId`를 두지 않는다.
- ContentPlan의 `contentType`은 기존 Core의 4개 값(`discovery_long`, `training_long`, `discovery_short`, `learning_short`)을 재사용한다. 계획 상태는 `DRAFT`, `PLANNED`, `IN_PROGRESS`, `READY`, `PUBLISHED`로 두며 READY/PUBLISHED 전이는 검수 완료 프레임만 허용한다.
- ThumbnailProject는 기존 JSON과 호환되도록 `contentId: null` 기본값을 지원한다. ContentPlan에 연결된 PRIMARY는 콘텐츠별 1개로 제한하고, VARIANT는 PRIMARY의 `variantOfProjectId`와 `contentId`를 보존한다. ContentPlan 조회 응답에는 연결된 썸네일 목록을 포함한다.
- SourceFrame `unchecked`는 생성·편집·미리보기와 계획의 비최종 상태에서 허용하고 경고를 반환한다. `reviewed`만 최종 export 및 READY/PUBLISHED 상태에 사용할 수 있으며 `rejected`는 생성·업로드·편집·변형·자산 조회를 차단한다.
- 검증: `npm test` 416/416, `npm run typecheck`, `npm run build`, `git diff --check` 통과. 실제 FFmpeg/VOICEVOX 엔진과 외부 게시 호출은 여전히 사용자 환경 검증 대상이다.

## 2026-09-18 SourceFrame 권리 검수 게이트 보강 완료

- `01_Core_v2`: SourceFrame에 revision 기반 검수 전이를 추가하고 `PATCH /api/source-frames/:id/review`를 연결했다. `unchecked → reviewed/rejected`, `reviewed → rejected`만 허용하며 `rejected`는 종단 상태다.
- ThumbnailProject의 공식 프레임 업로드는 클라이언트가 보낸 권리 상태를 사용하지 않고 `sourceFrameId`로 현재 SourceFrame 메타데이터·원본 bytes·hash·MIME·dimensions를 재검증한다. ID 없는 공식 프레임 업로드와 가짜 `reviewed` 상태를 차단한다.
- 프로젝트 조회·편집·변형·자산 조회·export·베이스 교체 시 authoritative 검수 상태를 재조회한다. `unchecked`는 편집/미리보기만 허용하고, `reviewed`만 export를 허용하며, `rejected`는 모든 사용을 차단한다.
- 검증: 집중 40/40, 전체 `npm test` 418/418, `npm run typecheck`, `npm run build`, `git diff --check` 통과. 실제 FFmpeg/VOICEVOX 엔진 호출은 하지 않았다.

## 2026-09-18 Thumbnail Studio ContentPlan UI 연결 완료

- `08_ReviewEditor_v2`: Studio에서 ContentPlan 목록 조회·선택과 최소 생성 폼을 제공한다. 선택한 `contentId`를 SourceFrame 기반 ThumbnailProject 생성 요청에 전달하고, 연결된 PRIMARY/VARIANT 목록과 `unchecked` 검수 경고를 표시한다.
- 기존 A/B 변형·SourceFrame 요청 잠금, 늦은 응답 보호, 오류 시 입력 보존, 반응형 레이아웃을 유지했다.
- 검증: `node --check src/app/web/studio.js`, `npm run typecheck`, `npm run build`, `npm test` 418/418, `git diff --check` 통과. 로컬 `/studio`에서 ContentPlan 선택/생성 UI와 경고 영역을 확인했다. 실제 SourceFrame 생성과 외부 게시 호출은 사용자 미디어·서비스 환경 검증 대상이다.

## 2026-09-18 실제 엔진 검증

- FFmpeg/FFprobe PATH 실행 확인: FFmpeg 8.1.1, FFprobe 8.1.1.
- 합성 fixture를 생성한 뒤 `npm run render:fixture`와 `npm run render:portrait`를 실행해 가로 1280x720·세로 720x1280 MP4를 실제 인코딩했다. `npm run render:verify`에서 두 파일 모두 390 frames, H.264/AAC, 48 kHz, full decode `PASS`와 프레임 추출·오디오 RMS 검증을 확인했다.
- VOICEVOX 실제 엔진은 `127.0.0.1:50021/version` 및 `/speakers` 요청이 모두 connection refused였다. 실행 중인 VOICEVOX 프로세스와 PATH 명령도 확인되지 않아 동적 화자 목록·audio_query·synthesis·청취 품질은 아직 검증할 수 없다.

## 2026-09-20 VoiceStudio 통합 기반 1단계

- 첨부 인계 명세를 기준으로 현재 구조를 분석했다. 기존 저장소에는 VoiceVox 전용 client/service/routes만 있고 공통 TTS Provider, 외부 TTS 설치 관리자, backend 프로세스 수명주기 관리자는 아직 없다.
- `src/app/tts/types.ts`에 Provider 상태·voice·합성 요청/결과 계약을 추가하고, `src/app/tts/registry.ts`에 중복 등록을 거부하는 Provider registry를 추가했다.
- `src/app/voicevox/provider.ts`에 기존 VoiceVox service를 공통 Provider 계약으로 연결하는 어댑터를 추가했다. 동적 style identity, health 상태, speed parameter, 선택적 WAV 저장을 보존한다.
- 검증: 새 Provider 테스트 4/4, 전체 `npm test` 422/422, `npm run typecheck`, `npm run build`, `git diff --check` 통과. 실제 VoiceVox Engine은 계속 실행되지 않아 외부 엔진 합성 검증은 별도 상태다.
- 다음 단위는 VoiceStudio 설치 경로 탐지와 이미 실행 중인 localhost backend attach이며, 설치·자동 다운로드·backend spawn은 그 뒤에 진행한다.

## 2026-09-20 VoiceStudio localhost attach 기반

- `src/app/voicestudio/models.ts`에 localhost 전용 endpoint와 구조화 오류·health 상태 계약을 추가했다.
- `src/app/voicestudio/client.ts`에 `/health`와 `/system/info` 조회 client를 추가했다. `ready`·`starting`·`unavailable`·`error`를 구분하고 timeout/HTTP 오류를 정규화한다.
- `src/app/voicestudio/detector.ts`에 기존 backend를 `external` 소유로 탐지하는 경로를 추가했다. 이 단계에서는 외부 프로세스를 시작하거나 종료하지 않는다.
- 검증: VoiceStudio client/detector 테스트 4/4, 전체 `npm test` 426/426, `npm run typecheck`, `npm run build`, `git diff --check` 통과.
- 다음 단위는 공식 VoiceStudio 설치 경로와 Release asset 탐지이며, 자동 다운로드 전에 checksum·동의·설치 완료 감지를 설계한다.

## 2026-09-20 VoiceStudio Release 탐지 기반

- `src/app/voicestudio/installer.ts`에 GitHub latest stable Release에서 Windows x64 Electron installer asset을 동적으로 선택하는 resolver를 추가했다.
- `SHA256SUMS-Windows.x64.txt` manifest에서 설치 파일의 SHA256을 찾아 반환하며, HTTPS GitHub URL·단일 installer asset·stable release 조건을 검증한다.
- 실제 다운로드·설치·silent flag 실행은 아직 수행하지 않는다. 설치 동의, `.part` 다운로드, checksum 비교 후 실행, 설치 완료 감지는 다음 단위다.
- 검증: installer resolver 테스트 3/3, 전체 `npm test` 429/429, `npm run typecheck`, `npm run build`, `git diff --check` 통과.
- 다음 단위는 사용자 동의 후 checksum 검증 다운로드와 설치 완료 감지다. VoiceStudio 바이너리는 저장소에 커밋하지 않는다.

## 2026-09-20 VoiceStudio 검증 다운로드 기반

- `VoiceStudioInstaller.downloadVerifiedInstaller`를 추가했다. 대상 파일을 `.part`로 스트리밍하고, 최대 크기·timeout·취소·HTTP 오류를 처리한 뒤 SHA256 일치 시에만 최종 이름으로 원자적 rename한다.
- checksum 불일치·실패 시 부분 파일을 제거하며, 이미 검증된 동일 파일은 재사용한다. installer 실행이나 외부 프로그램 설치는 이 단위에서 수행하지 않는다.
- 검증: VoiceStudio installer 테스트 5/5, 전체 `npm test` 431/431, `npm run typecheck`, `npm run build`, `git diff --check` 통과.
- 다음 단위는 명시적 사용자 동의 이후 installer 실행과 설치 완료 감지이며, silent install 옵션은 upstream 확인 전 하드코딩하지 않는다.

## 2026-09-20 VoiceStudio 설치 실행·완료 감지 기반

- `src/app/voicestudio/install-manager.ts`에 사용자 동의 후 installer를 표시 실행하고, 설치 프로세스 종료 코드와 예상 설치 경로 탐지를 확인하는 관리자를 추가했다.
- 기본 실행은 `shell:false`, `windowsHide:false`로 설치 UI를 표시하며, `external` backend를 종료하지 않는 다음 수명주기 단계와 분리했다. 기본 후보 경로는 사용자 LocalAppData와 Program Files이며 후보를 주입할 수 있다.
- 설치가 성공 코드로 끝나도 설치 실행 파일이 감지되지 않으면 완료로 처리하지 않는다. silent flag는 사용하지 않는다.
- 검증: install manager 테스트 3/3, 전체 `npm test` 434/434, `npm run typecheck`, `npm run build`, `git diff --check` 통과.
- 다음 단위는 설치된 VoiceStudio executable에서 backend를 안전하게 시작하고 `/health` readiness를 기다리는 process manager다.

## 2026-09-20 VoiceStudio backend process manager 기반

- `src/app/voicestudio/process-manager.ts`에 external attach와 nihon-managed spawn을 분리하는 process manager를 추가했다.
- 이미 backend가 `ready` 또는 `starting`이면 spawn하지 않고 `external`로 attach한다. backend가 없을 때만 호출자가 지정한 executable/args를 `shell:false`, `windowsHide:true`로 실행하고 `/health`가 `ready`가 될 때까지 기다린다.
- readiness timeout 시 시작한 child만 종료하고, `stop()`도 manager가 소유한 child만 종료한다. VoiceStudio 내부 실행 명령과 포트는 하드코딩하지 않았다.
- 검증: process manager 테스트 3/3, 전체 `npm test` 437/437, `npm run typecheck`, `npm run build`, `git diff --check` 통과.
- 다음 단위는 이 manager를 VoiceStudioProvider와 앱 서버/UI에 연결해 상태·voice 목록·실제 synthesis를 제공하는 통합이다.

## 2026-09-20 VoiceStudio Provider synthesis 기반

- `src/app/voicestudio/client.ts`에 `/v1/audio/voices`, `/engines`, `/v1/audio/speech` 호출을 추가하고 WAV 응답 구조를 검증한다.
- `src/app/voicestudio/provider.ts`에 VoiceStudio를 공통 `TTSProvider`로 연결했다. 유연한 voice payload를 정규화하고 model/voice/input/response format/language/speed를 OpenAI-compatible speech 요청으로 전달하며 선택적 WAV 저장을 지원한다.
- 기존 VoiceVox API와 UI는 변경하지 않았다. 아직 Provider registry를 앱 서버와 UI에 연결하지 않았으며, 실제 VoiceStudio backend 호출도 수행하지 않았다.
- 검증: VoiceStudio Provider 테스트 3/3, 전체 `npm test` 440/440, `npm run typecheck`, `npm run build`, `git diff --check` 통과.
- 다음 단위는 TTS Provider registry를 앱 서버에 연결해 provider 상태·voice 목록·synthesis API를 노출하는 통합이다.

## 2026-09-20 TTS Provider API 통합 완료

- `src/app/tts/routes.ts`를 추가해 등록된 provider의 상태·voice 목록·WAV 합성 API를 `/api/tts/providers` 아래에 노출했다.
- `start.ts`에서 기존 VoiceVox adapter와 VoiceStudio provider를 하나의 registry에 등록했다. 기존 `/api/voicevox/*` API는 호환성을 유지한다.
- HTTP 합성 입력은 strict schema로 검증하고 `outputPath`를 허용하지 않아 서버 파일 경로를 외부 요청에 노출하지 않는다. 합성 응답은 `audio/wav`와 provider/engine 헤더를 반환한다.
- 검증: TTS HTTP 테스트 2/2, 전체 `npm test` 442/442, `npm run typecheck`, `npm run build`, `git diff --check` 통과. 실제 VoiceStudio backend 연결·음성 목록·합성은 아직 사용자 환경 검증 대상이다.
- 다음 단위는 실제 VoiceStudio backend가 실행된 사용자 환경에서 health·voice 목록·WAV 합성을 확인하고, 필요하면 UI 연결을 진행하는 것이다.

## 2026-09-20 로컬 음성 엔진 실행 상태 확인

- FFmpeg/FFprobe는 PATH에서 확인됐다.
- 현재 검증 시점에는 VoiceVox(`127.0.0.1:50021`)와 VoiceStudio(`127.0.0.1:3900`) 프로세스 및 health/voice endpoint가 모두 실행되지 않았다.
- 외부 엔진을 임의로 시작하거나 종료하지 않았으며, 실제 음성 목록·WAV 합성 품질은 엔진 실행 후 재검증해야 한다.

## 2026-09-20 VoiceStudio 명시적 설치 API 완료

- `/api/tts/providers/voicestudio/installation`으로 설치 감지 상태를 조회하고, `/api/tts/providers/voicestudio/install`에 `{ "consent": true }`를 보낼 때만 공식 stable Release 탐지·checksum 다운로드·표시형 설치를 실행하도록 연결했다.
- 설치 대상 디렉터리는 서버 설정으로 고정하고 요청의 `targetDirectory` 주입을 거부한다. 앱 시작 시 자동 설치하거나 silent flag를 사용하지 않는다.
- 검증: TTS HTTP 테스트 3/3, 전체 `npm test` 443/443, `npm run typecheck`, `npm run build`, `git diff --check` 통과. 실제 설치는 사용자의 명시적 실행 요청 전까지 수행하지 않았다.
- 다음 단위는 설치 후 VoiceStudio 실행 파일의 backend 시작 계약을 확인하고, 확인된 실행 인자만 process manager에 연결하는 것이다.

## 2026-09-20 VoiceStudio 설치 UI 연결 완료

- 기존 VOICEVOX 화면에 VoiceStudio 설치 상태와 설치 버튼을 추가했다. 설치 버튼은 확인 대화상자와 `{ "consent": true }` 요청을 거쳐야 실행된다.
- 설치 후 VoiceStudio를 자동 실행하지 않고 사용자가 앱을 열도록 안내한다. 설치되지 않은 상태에서도 기존 VOICEVOX 작업 화면은 계속 사용할 수 있다.
- 검증: `node --check src/app/web/app.js`, 로컬 서버 `/` 및 설치 상태 API 200 응답, 전체 `npm test` 443/443, `npm run typecheck`, `npm run build`, `git diff --check` 통과.
- 공식 VoiceStudio 문서상 Electron 앱이 backend를 관리하고 실행 인자는 공개된 안정 계약으로 확인되지 않아, 임의의 executable spawn 연결은 보류한다. [공식 Windows 설치 문서](https://github.com/debpalash/VoiceStudio/blob/main/docs/install/windows.md)

## 2026-09-20 VoiceStudio 실행·attach API 완료

- `/api/tts/providers/voicestudio/start`를 추가했다. 설치 감지기의 실행 파일만 사용하고 빈 인자로 VoiceStudio Electron을 실행한 뒤 `/health`가 준비될 때까지 기다린다.
- 이미 backend가 실행 중이면 spawn하지 않고 `external` 소유로 attach한다. Short-auto가 시작한 child만 종료 시 정리한다.
- UI에 `VoiceStudio 실행` 버튼을 추가했으며 설치·실행 모두 확인 대화상자와 동의 payload가 필요하다.
- 검증: TTS HTTP 테스트 4/4, 전체 `npm test` 444/444, `npm run typecheck`, `npm run build`, `node --check src/app/web/app.js`, `git diff --check` 통과. 실제 VoiceStudio 미설치 상태이므로 실제 실행·WAV 합성은 아직 미검증이다.
- 다음 단위는 VoiceStudio 설치 후 실제 backend health·`/openapi.json`·voice 목록·WAV 합성을 사용자 환경에서 확인하는 것이다.

## 2026-09-20 VoiceStudio Release checksum 호환 보강

- 실제 공식 `v0.5.3` Release를 조회한 결과 Electron EXE는 checksum manifest에 없고 Current User MSI만 등록되어 있음을 확인했다.
- resolver는 checksum이 검증되는 Electron EXE를 우선하고, 없으면 Current User MSI, 마지막으로 per-machine MSI를 선택한다. checksum이 없는 파일은 절대 설치 대상으로 사용하지 않는다.
- MSI는 `msiexec.exe /i` 표시 실행으로 처리하고, Current User 설치 경로를 기본 탐지 후보에 추가했다.
- 검증: 실제 GitHub Release resolver가 `VoiceStudio_Current_User_0.5.3_x64_en-US.msi`와 SHA256 `579005a0af35ba3004927188be040fda157b34400123dcc9c3d2c9e8f1195630`을 반환했고, 전체 `npm test` 445/445, `npm run typecheck`, `npm run build`, `git diff --check`가 통과했다.

## 2026-09-20 VoiceStudio 실제 설치 후 bootstrap 진단

- Current User MSI는 `C:\\Users\\Administrator\\AppData\\Local\\VoiceStudio (Current User)\\omnivoice-studio.exe`를 설치했으며, 기존 `VoiceStudio.exe` 후보만으로는 설치 완료를 감지하지 못했다. 설치 locator에 실제 제품 실행 파일명과 기존 호환 후보를 함께 등록했다.
- 첫 실행 bootstrap은 `C:\\Python313\\python.exe`를 사용해 `curated-tokenizers==0.0.9` Cython 빌드에서 실패했다. 로그상 `Python 3.11` 인터프리터가 시스템에 존재하므로, Clean & Retry에서 Python 3.11을 선택하고 실패한 `.venv`를 재생성해야 한다.
- 이 실패는 네트워크 오류가 아니라 Python 3.13 환경에서의 native dependency 빌드 호환성 문제이며, `uv` managed Python의 신뢰할 수 없는 탑재 지점 오류도 함께 기록됐다. Short-auto는 설치 후 실제 backend health·voice 목록·WAV 합성 검증을 아직 완료하지 못했다.
- 검증: 설치 후보 회귀 테스트 포함 전체 `npm test` 446/446, `npm run typecheck` 통과.

## 2026-09-20 VoiceStudio 실제 엔진 검증 완료

- Python 3.11 정식 런타임을 사용자 범위에 설치하고, VoiceStudio `v0.5.3` 프로젝트 `.venv`를 Python 3.11로 재생성했다. `uv sync --no-dev`가 217개 패키지를 설치했으며 `curated-tokenizers==0.0.9`를 포함한 의존성 설치가 완료됐다.
- VoiceStudio Electron이 CUDA(`NVIDIA GeForce RTX 3060`) backend로 실행되어 `http://127.0.0.1:3900/health`가 `status=ok`, `version=0.5.3`을 반환했다. `/openapi.json`과 `/v1/audio/voices`도 정상 응답했다.
- KittenTTS `Bella` voice로 직접 WAV 합성(202,444 bytes, RIFF/WAVE)과 Short-auto `/api/tts/providers/voicestudio/synthesize` 연결을 확인했다. 첫 모델 로딩이 5초를 넘을 수 있어 VoiceStudio synthesis timeout을 120초로 분리했다.
- 생성 WAV는 FFprobe에서 `pcm_s16le`, 24 kHz, mono, 4.791667초, `format_name=wav`로 확인했고 FFmpeg decode 검사도 오류 없이 통과했다.
- 현재 `/api/tts/providers`에서 VoiceStudio는 `ready`, VOICEVOX는 별도 프로세스가 없어 `unavailable`이다. OmniVoice 기본 모델은 아직 다운로드하지 않았고, 용량이 작은 KittenTTS 경로로 엔진 연결을 검증했다.

## 2026-09-20 VoiceStudio 미리듣기 UI 연결

- 기존 설치·실행 카드 아래에 VoiceStudio 엔진 선택, 음성 선택, 문장 입력, WAV 미리듣기 UI를 추가했다.
- 기본 엔진은 `kittentts`로 두고 Bella/Jasper/Luna/Bruno/Rosie/Hugo/Kiki/Leo preset을 제공한다. `default` 선택 시 backend가 제공하는 VoiceStudio voice 목록을 사용한다.
- backend가 이미 실행 중이면 provider 상태와 voice 목록을 자동으로 읽고, 설치 카드에서 실행한 뒤에도 동일한 상태를 다시 로드한다. 합성은 기존 `/api/tts/providers/voicestudio/synthesize` 계약을 사용하며 출력 경로를 브라우저에 노출하지 않는다.
- 검증: `node --check src/app/web/app.js`, `npm test` 446/446, `npm run typecheck`, `npm run build`, 실제 HTML 요소 확인, provider `ready`·7개 voice 목록·WAV 200 응답 확인.

## 2026-09-20 OmniVoice 기본 모델·일본어 합성 검증 완료

- VoiceStudio 모델 카탈로그에서 `k2-fsa/OmniVoice`가 로컬 Hugging Face 캐시에 설치 완료 상태임을 확인했다. 설치 파일은 저장소에 포함하지 않으며 VoiceStudio 캐시(`C:\Users\Administrator\AppData\Local\OmniVoice\hf_cache`)에서 관리한다.
- `POST /setup/warmup` 후 `/model/status`가 `ready`·`loaded=true`·`checkpoint=k2-fsa/OmniVoice`를 반환했다. `/model/loaded`에서 활성 TTS 모델이 `cuda:0`에 로드되고 VRAM 사용량 약 2,711.7MB로 확인됐다.
- `POST /v1/audio/speech`에 `model=omnivoice`, `voice=demo0001`, `language=ja`, WAV 응답을 요청해 일본어 문장을 합성했다. 응답은 HTTP 200, 418,604 bytes RIFF/WAVE, 약 8.72초였다.
- FFprobe에서 `pcm_s16le`, 24kHz, mono, `format_name=wav`를 확인했고 FFmpeg decode 검사도 오류 없이 통과했다. VoiceStudio 엔진 실행 증거는 `evidence_state=loaded`, `actual_execution_provider=cuda:0`, `precision=torch.float16`이다.
- 이전 항목의 “OmniVoice 기본 모델은 아직 다운로드하지 않았다”는 기록은 이번 검증으로 해소되었다. KittenTTS 경로와 함께 OmniVoice 일본어 합성 경로도 실제 환경에서 검증되었다.
- 다음 단위는 Short-auto 미리듣기 UI에서 OmniVoice/일본어를 선택해 동일 경로를 호출하는 통합 검증과, 완료 후 기능 단위 테스트·상태 문서 갱신이다.

## 2026-09-20 OmniVoice Short-auto 미리듣기 통합 검증 완료

- VoiceStudio OpenAI-compatible API가 `default` 모델 문자열을 허용하지 않고 HTTP 400을 반환하는 동작을 확인했다. Short-auto provider는 UI 호환값 `default`를 실제 엔진 ID `omnivoice`로 정규화하고, UI 엔진 선택도 `OmniVoice` 엔진 ID를 직접 사용하도록 수정했다.
- 회귀 테스트를 추가해 `default → omnivoice` 매핑을 고정했다. 전체 `npm test` 447/447, `npm run typecheck`, `npm run build`, `node --check src/app/web/app.js`, `git diff --check`를 통과했다.
- 실행 중인 VoiceStudio backend에 대해 Short-auto `POST /api/tts/providers/voicestudio/synthesize`로 일본어 문장을 전송했다. 응답은 HTTP 200, `Content-Type: audio/wav`, `X-TTS-Engine: omnivoice`, 255,404 bytes였다.
- 통합 WAV는 FFprobe에서 `pcm_s16le`, 24kHz, mono, 5.32초로 확인했고 FFmpeg decode 검사도 오류 없이 통과했다. 이제 UI에서 KittenTTS(영어)와 OmniVoice(다국어·일본어)를 각각 선택할 수 있다.

## 2026-09-20 VoiceStudio 미리듣기 언어 선택 완료

- VoiceStudio 미리듣기 UI에 언어 선택(`자동 감지`, `한국어`, `일본어`, `영어`)을 추가했다. `자동 감지`는 기존 요청 계약을 유지하고, 명시 언어는 TTS API의 `language` 필드로 전달한다.
- OmniVoice 선택 시 일본어를 명시한 Short-auto 요청이 HTTP 200과 `X-TTS-Engine: omnivoice`를 반환했다. 응답 WAV는 253,484 bytes, 24kHz mono PCM, 5.28초였고 FFmpeg decode 검사를 통과했다.
- UI HTML의 `voicestudio-language` 요소와 API 경로를 실제 로컬 서버에서 확인했다. 전체 `npm test` 447/447, `npm run typecheck`, `npm run build`, `node --check src/app/web/app.js`, `git diff --check`가 통과했다.

## 2026-09-20 VoiceBox 제외 및 AutoPlanner MVP 완료

- 사용자 결정에 따라 VoiceBox/VOICEVOX 엔진 검증·설치·추가 기능은 자동 진행 범위에서 제외한다. 기존 VoiceVox 호환 코드와 테스트는 삭제하지 않고 보존하며, 현재 로컬 TTS 경로는 검증된 VoiceStudio provider를 사용한다.
- `planScenes`를 추가해 SourceTimeline 자막을 deterministic Scene으로 분류한다. HOOK/CONCEPT/COMPARE/RELATION/QUOTE_ANALYSIS/KEYWORD/QUESTION/RECAP/EXPLAIN 우선 규칙, 1~7어절 mainText, visual strategy, confidence와 저신뢰 review warning을 제공한다.
- `locked=true` 기존 Scene은 재실행 시 원문·문구·ID를 보존하고, 잘못된 자막 범위·중복 잠금·잘못된 입력은 명확한 진단으로 중단한다. Planner는 파일·Asset·외부 API를 생성하거나 수정하지 않는다.
- 검증: AutoPlanner 4/4, 전체 `npm test` 451/451, `npm run typecheck`, `npm run build`, `git diff --check` 통과. 공개 `@short-auto/core` export에 `planScenes`를 추가했다.
- 다음 자동 단위는 Planner 결과를 Review Editor/ContentPlan 흐름에서 선택·검토할 수 있도록 연결하는 것이다. VoiceBox/VOICEVOX 작업은 재개하지 않는다.

## 2026-09-20 AutoPlanner 로컬 API 연결 완료

- `POST /api/auto-planner/plan`을 추가해 앱 서버가 SourceTimeline·선택적 Asset registry·기존 잠금 Scene을 받아 Planner 결과와 진단을 반환하도록 연결했다.
- 잘못된 입력은 `400 PLANNER_INVALID`와 구조화 진단으로 반환하고, 외부 API·파일·TTS 엔진을 호출하지 않는다. 기존 로컬 Host/Origin/JSON 검증 경계를 그대로 적용한다.
- 검증: AutoPlanner core/API 6/6, `npm run typecheck`, `npm run build` 통과. 다음 단위는 이 API 결과를 Review Editor의 제작 계획 검토 화면에 연결하는 것이다.

## 2026-09-20 AutoPlanner 검토 화면 연결 완료

- `/planner` 로컬 화면을 추가해 SourceTimeline JSON과 선택적 잠금 Scene을 입력하고 `POST /api/auto-planner/plan` 결과를 검토할 수 있게 했다. 장면 유형·시간·문구·신뢰도·잠금 보존 상태를 표로 표시하고 오류·경고 진단을 분리한다.
- 메인 작업 공간에 `자동 장면 계획` 링크를 추가했고, 정적 파일은 기존 same-origin/CSP 경계를 그대로 사용한다. 이 화면은 계획과 검토만 수행하며 파일·렌더·게시를 자동 실행하지 않는다.
- 검증: `node --check src/app/web/planner.js`, 전체 `npm test` 453/453, `npm run typecheck`, `npm run build`, `git diff --check` 통과.
- 다음 자동 단위는 검토 승인 이후에만 Preview 입력으로 넘길 수 있는 Review Editor 연계이며, VoiceBox/VOICEVOX는 계속 제외한다.

## 2026-09-20 Review Editor 검토 완료 handoff 완료

- `/planner` 결과가 오류 0개이고 장면이 1개 이상일 때만 `검토 완료 계획 JSON 복사` 버튼을 활성화한다. 복사 payload는 `{ version: 1, reviewedAt, scenes, diagnostics }`이며 새 계획 생성·실패 시 이전 검토 상태를 초기화한다.
- 브라우저 클립보드 API가 없거나 권한이 거부되면 안내를 표시하고, 서버·Core·ContentPlan·Thumbnail Studio·TTS 경로는 변경하지 않았다. 이 handoff는 Preview·렌더·게시를 자동 승인하지 않는 읽기 전용 경계다.
- 검증: `node --check src/app/web/planner.js`, 전체 `npm test` 453/453, `npm run typecheck`, `npm run build`, `git diff --check` 통과.
- 다음 단위는 `reviewed` handoff를 Preview 입력으로 소비하는 통합 경계이며, VoiceBox/VOICEVOX는 계속 제외한다.

## 2026-09-20 Reviewed Scene Plan Preview 어댑터 완료

- `applyReviewedScenePlan(input, handoff)`를 추가해 Review Editor의 version 1 handoff를 기존 TimelineInput의 `production.scenes`에 적용한다. 기존 source·assets·overrides·project status/revision은 보존하며 입력과 handoff를 변경하지 않는다.
- handoff schema, 오류 진단, 빈 Scene, Source Caption ID 범위, Scene 중복·겹침, 기존 Timeline/override 참조를 모두 검증한다. 실패 시 partial Preview 입력을 반환하지 않고 구조화 진단만 반환한다.
- 이 어댑터는 Preview 입력 변환만 수행하며 승인·최종 렌더·게시·TTS 실행을 수행하지 않는다. VoiceBox/VOICEVOX는 계속 제외한다.
- 검증: adapter 7/7, 전체 `npm test` 460/460, `npm run typecheck`, `npm run build`, 공개 export import, `git diff --check` 통과.
- 다음 자동 단위는 이 Preview 입력을 Review Editor 화면에서 실제 미리보기 호출로 연결하는 작업이다.

## 2026-09-20 Reviewed Scene Plan 로컬 API 통합 완료

- `POST /api/auto-planner/preview-input`을 추가해 `input`과 version 1 reviewed handoff를 Core adapter에 전달한다. 성공은 `{ data: { input, diagnostics } }`, 실패는 `SCENE_PLAN_INVALID`와 구조화 diagnostics를 반환한다.
- 기존 Host/Origin/JSON 요청 검증 경계를 유지하고 파일·렌더·TTS·게시를 실행하지 않는다. malformed JSON과 adapter 실패도 안정된 오류 envelope로 반환한다.
- 검증: AutoPlanner/Preview API 4개, 전체 `npm test` 462/462, `npm run typecheck`, `npm run build`, `git diff --check` 통과.
- 다음 자동 단위는 Review Editor에서 이 Preview API를 호출하고 결과를 실제 Preview 준비 상태로 표시하는 UI 연계다. VoiceBox/VOICEVOX는 계속 제외한다.

## 2026-09-20 Review Editor Preview 입력 UI 연계 완료

- `/planner`에 기본 TimelineInput JSON 입력과 `Preview 입력 준비` 버튼을 추가했다. 검토 완료 handoff가 있는 경우에만 `/api/auto-planner/preview-input`을 호출하고, 반환된 Preview 입력과 diagnostics를 읽기 전용 JSON 영역에 표시한다.
- 새 계획 생성·실패 시 Preview 준비 결과를 초기화하고, 렌더·게시·TTS 실행은 수행하지 않는다. 기존 검토 완료 JSON 복사 흐름과 오류 안내를 보존했다.
- 검증: `node --check src/app/web/planner.js`, 전체 `npm test` 462/462, `npm run typecheck`, `npm run build`, `git diff --check` 통과.
- 다음 자동 단위는 실제 Preview renderer 호출 전 입력·Asset readiness를 통합 검증하는 단계이며, VoiceBox/VOICEVOX는 계속 제외한다.

## 2026-09-20 Preview 입력 Asset readiness 노출

- `POST /api/auto-planner/preview-input` 성공 응답에 reviewed input을 기준으로 한 `resolveAssets` 결과를 `data.assets.plan`과 `data.assets.diagnostics`로 추가했다. 기존 `data.input`, `data.diagnostics`와 `SCENE_PLAN_INVALID` 오류 envelope는 유지한다.
- `/planner`는 Asset readiness, `fileVerification`, `renderVerification`, Asset diagnostics를 읽기 전용 textContent/pre로 표시한다. Asset resolver는 파일·렌더·TTS·게시를 실행하지 않으며 검증 상태는 `not_performed`로 노출된다.
- 검증: route targeted test, `node --check src/app/web/planner.js`, `npm run typecheck`, `npm test`, `npm run build`, `git diff --check`.

## 2026-09-20 Reviewed Scene Plan Remotion Preview 경계 완료

- `prepareReviewedScenePreview(input, handoff, pack, captionDisplayPolicy?)`를 추가해 reviewed handoff를 검증한 뒤 기존 `prepareScenePreview`에 전달한다. 실패 시 `SceneRenderError`의 구조화 diagnostics만 반환하며 partial runtime을 만들지 않는다.
- 기존 Preview 계획·CaptionDisplayPolicy·SceneRender 동작은 보존하고, input/handoff 불변성·렌더 미지원 Scene 진단을 회귀 테스트로 고정했다. 승인·최종 렌더·FFmpeg·TTS·게시를 실행하지 않는다.
- 검증: reviewed Preview adapter 5/5, 전체 `npm test` 467/467, `npm run typecheck`, `npm run build`, 공개 `@short-auto/core/render` import, `git diff --check` 통과.
- 다음 자동 단위는 실제 Remotion Composition/MP4 검증이며, 미디어 파일·Asset readiness와 함께 별도 확인한다. VoiceBox/VOICEVOX는 계속 제외한다.

## 2026-09-20 Remotion·FFmpeg Preview 렌더 검증 완료

- `npm run render:fixture`와 `npm run render:portrait`를 순서대로 실행해 landscape/portrait Preview MP4를 각각 390/390 프레임으로 생성했다.
- 가로 결과: `dist/render/scene-preview-landscape.mp4`, H.264 1280×720, 30fps, 13.000000초, 전체 FFmpeg decode 통과, SHA256 `7D9B9AE23DF12DC11DC9CFA35348F323EAA83544A121D5431FD19AD7057C5204`.
- 세로 결과: `dist/render/scene-preview-portrait.mp4`, H.264 720×1280, 30fps, 13.000000초, 전체 FFmpeg decode 통과, SHA256 `5220F268C570E33AD9849774089C9441322C1C012263BF8171830003B3D869BE`.
- 이번 단위는 기존 fixture 렌더 검증이며 실제 사용자 미디어·Asset 파일 검증·최종 게시를 의미하지 않는다. VoiceBox/VOICEVOX는 실행하지 않았다.

## 2026-09-20 ContentPlan 제작 시작 UI 연결 완료

- `/planner`가 기존 ContentPlan 목록과 상세 상태를 불러오고, Preview 입력 준비가 끝난 경우에만 `DRAFT` 또는 `PLANNED` 계획을 `IN_PROGRESS`로 전환할 수 있게 연결했다.
- READY/PUBLISHED 전환 UI는 추가하지 않았으며, SourceFrame `reviewed` 검수와 최종 상태 전환은 기존 서버 게이트가 계속 담당한다. ContentPlan 스키마와 ThumbnailProject 관계는 변경하지 않았다.
- 검증: `node --check src/app/web/planner.js`, 전체 `npm test` 467/467, `npm run typecheck`, `npm run build`, `git diff --check` 통과. VoiceBox/VOICEVOX는 실행하지 않았다.

## 2026-09-20 YouTube 게시 경계 검증 완료

- `src/app/youtube/publishing.ts`에 주입형 `YouTubePublishingBoundary`를 추가했다. 실제 OAuth·YouTube 업로드·예약 호출 없이 로컬 dry-run 검수와 Publisher 결과 매핑만 수행한다.
- 게시 전 Core 최종 렌더 승인·revision, ContentPlan `READY`, SourceFrame 최신 `reviewed` 권리 상태, 연결된 ThumbnailProject export와 파일 해시, 프로젝트 루트 내부 MP4 경로·symlink 탈출을 검증한다. 검수 실패 시 주입된 Publisher를 호출하지 않는다.
- 성공·실패·예외 결과는 기존 `Publisher`/`PublishingResult` 계약으로 매핑하며 외부 오류 메시지와 토큰을 노출하지 않는다. 실제 YouTube 인증·업로드와 Desktop 패키징은 다음 단계로 남긴다.
- 검증: 집중 테스트 7/7, 전체 `npm test` 474/474, `npm run typecheck`, `npm run build`, `git diff --check` 통과. 실제 MP4 디코드는 기존 Remotion·FFmpeg 검증 증거를 입력으로만 사용했으며 VoiceBox/VOICEVOX는 실행하지 않았다.

## 2026-09-20 Desktop Workspace·Release 계약 완료

- `deriveDesktopWorkspaceLayout`을 추가해 설치 경로와 사용자 Workspace를 분리하고, `projects`, `presets`, `cache`, `exports` 하위 경로를 플랫폼 경로 규칙으로 결정한다. 디렉터리 생성이나 파일 쓰기는 수행하지 않는다.
- `validateReleaseManifest`를 추가해 Stable/Beta 채널, semantic version과 `v<version>` 태그, 안전한 상대 artifact 경로, 선택적 SHA-256을 검증하고 traversal·절대 경로·secret-like 필드를 차단한다. Electron·Installer·GitHub 네트워크 동작은 아직 연결하지 않았다.
- 공개 Core export와 회귀 테스트를 추가했다. 검증: Desktop 집중 테스트 5/5, 전체 `npm test` 479/479, `npm run typecheck`, `npm run build`, `git diff --check` 통과. VoiceBox/VOICEVOX는 실행하지 않았다.

## 2026-09-20 Desktop 업데이트 판정 정책 완료

- `decideDesktopUpdate`를 추가해 네트워크 없이 현재 semantic version·채널과 검증된 ReleaseManifest를 비교한다. Stable은 stable release만, Beta는 stable과 beta release를 고려하고 prerelease 우선순위를 반영한다.
- 동일·낮은 버전, 채널 불일치, 잘못된 현재 버전/manifest는 파일·설치·네트워크 부작용 없이 구조화된 결정과 진단으로 반환한다. Electron·Installer·GitHub API 연결은 아직 하지 않았다.
- 검증: Desktop 업데이트 집중 테스트 5/5, 전체 `npm test` 484/484, `npm run typecheck`, `npm run build`, `git diff --check` 통과. VoiceBox/VOICEVOX는 실행하지 않았다.

## 2026-09-20 YouTube 게시 검수 API 연결 완료

- `POST /api/youtube/publishing/review` 로컬 route를 추가해 기존 `YouTubePublishingBoundary`의 dry-run 검수를 HTTP에서 호출할 수 있게 했다. 검수 성공은 200 응답으로 상태·진단·metadata를, 차단은 409 `YOUTUBE_PUBLISHING_BLOCKED` envelope로 반환한다.
- 서버에는 optional route hook만 추가했으며 현재 `start.ts`에 임의 Workspace/OAuth/Publisher를 연결하지 않았다. 외부 YouTube 업로드·예약·인증 호출은 실행하지 않는다.
- 검증: route 집중 테스트 3/3, 전체 `npm test` 487/487, `npm run typecheck`, `npm run build`, `git diff --check` 통과. VoiceBox/VOICEVOX는 실행하지 않았다.

## 2026-09-20 GitHub Release manifest 어댑터 완료

- `fetchGitHubReleaseManifest`를 추가해 주입된 HTTP 응답만으로 공식 `api.github.com` Release JSON을 검증된 ReleaseManifest로 변환한다. 요청 tag와 응답 `tag_name` 일치, semantic version, draft/private 상태, 안전한 artifact 경로를 확인한다.
- 공식 GitHub checksum asset이 있으면 SHA-256을 artifact에 연결하고, 없으면 해시를 생략한다. 실제 GitHub 호출·파일 다운로드·설치·Electron 실행은 수행하지 않으며 오류 응답에 secret-like 값을 노출하지 않는다.
- 검증: GitHub Release 집중 테스트 5/5, 전체 `npm test` 492/492, `npm run typecheck`, `npm run build`, `git diff --check` 통과. VoiceBox/VOICEVOX는 실행하지 않았다.

## 2026-09-20 Desktop artifact 다운로드 경계 완료

- `downloadGitHubArtifact`를 추가해 공식 GitHub HTTPS artifact를 주입된 fetch로 읽고, projectRoot 내부의 상대 destination·symlink 경계를 확인한 뒤 `.part` 파일에 기록한다.
- 다운로드 bytes는 비어 있지 않은지·크기 제한·SHA-256을 확인한 뒤 원자적으로 교체한다. HTTP 실패·네트워크 예외·hash mismatch·경로 탈출 시 최종 파일과 partial 파일을 남기지 않는다.
- 검증: artifact 다운로드 집중 테스트 5/5, 전체 `npm test` 497/497, `npm run typecheck`, `npm run build`, `git diff --check` 통과. 실제 GitHub 다운로드·설치·Electron 실행과 VoiceBox/VOICEVOX는 수행하지 않았다.

## 2026-09-20 Desktop 업데이트 staging 트랜잭션 완료

- `stageDesktopUpdate`를 추가해 `decideDesktopUpdate`가 `update_available`을 반환할 때만 검증된 artifact를 `installRoot/.updates/<version>`에 staging한다. Workspace root와 설치 root가 겹치거나 artifact path/hash가 일치하지 않으면 다운로드하지 않는다.
- staging은 기존 checksum·symlink·원자 교체 경계를 재사용하며 실패 시 해당 버전 staging 디렉터리를 정리한다. 실행 중인 앱 교체·재시작·Electron 동작은 수행하지 않는다.
- 검증: 업데이트 staging 집중 테스트 5/5, 전체 `npm test` 502/502, `npm run typecheck`, `npm run build`, `git diff --check` 통과. 실제 GitHub 다운로드·설치와 VoiceBox/VOICEVOX는 실행하지 않았다.

## 2026-09-20 12_Integration 제작 경계 통합 회귀 완료

- AutoPlanner가 만든 Scene 계획을 version 1 reviewed handoff로 넘기고, `applyReviewedScenePlan`과 `prepareReviewedScenePreview`를 순서대로 호출하는 통합 회귀 테스트를 추가했다.
- Preview 입력에서 SourceTimeline·Scene ID·프로젝트 status/revision이 보존되고, 오류 진단이 포함된 handoff와 잘못된 reviewedAt은 렌더 runtime 전에 차단되는 것을 확인했다. 실제 FFmpeg·TTS·YouTube·파일 네트워크 동작은 실행하지 않았다.
- 검증: 통합 집중 테스트 1/1, 전체 `npm test` 503/503, `npm run typecheck`, `npm run build`, `git diff --check` 통과. VoiceBox/VOICEVOX는 실행하지 않았다.

## 2026-09-20 YouTube 게시 attempt API 연결 완료

- `/api/youtube/publishing/attempt`를 추가해 주입된 Publisher 결과를 uploaded(200), 검수 차단(409), 게시 실패(502)로 구분해 반환한다. 기존 review route와 Core readiness·권리 검수 경계는 그대로 유지한다.
- 현재 `start.ts`에는 실제 OAuth/Publisher를 연결하지 않았으므로 외부 업로드는 자동 실행되지 않는다. 이 route는 이후 명시적으로 승인된 YouTube adapter를 주입할 수 있는 로컬 경계다.
- 검증: attempt route 집중 테스트 4/4, 전체 `npm test` 507/507, `npm run typecheck`, `npm run build`, `git diff --check` 통과. VoiceBox/VOICEVOX는 실행하지 않았다.

## 2026-09-20 YouTube Data API Publisher adapter 추가

- `src/app/youtube/api-publisher.ts`에 OAuth 중립적인 주입형 `YouTubeApiPublisher`를 추가했다. 호출자가 제공한 access token과 fetch 구현으로만 YouTube `videos.insert` multipart 요청을 만들며, OAuth 브라우저 흐름·refresh token·예약·thumbnail/playlist API는 포함하지 않는다.
- 프로젝트 루트 내부의 로컬 MP4만 읽고 traversal, 절대 경로, 심볼릭 링크 탈출, 디렉터리·누락 파일을 차단한다. 토큰·응답 본문·예외 메시지는 결과에 노출하지 않고 기존 `PublishingResult` 실패 코드와 retryable 플래그로 매핑한다.
- `tests/youtube-api-publisher.test.ts`에서 multipart 바이트 보존, 성공 video ID 매핑, 토큰/경로/심볼릭 링크/스케줄 차단, HTTP·네트워크·응답 오류 비노출을 검증했다. `npm test` 514/514, `npm run typecheck`, `npm run build`, `git diff --check` 통과.
- 실제 OAuth 자격 증명이나 외부 업로드는 연결하지 않았다. 이후 작업은 명시적 인증 공급자와 운영 승인 경계를 `start.ts`에 연결하는 것이다.

## 2026-09-20 로컬 미디어/TTS 엔진 환경 검증

- `ffmpeg -version`과 `ffprobe -version`을 실제 PATH에서 실행해 FFmpeg 8.1.1 essentials build를 확인했다.
- VoiceVox CLI/엔진 명령은 PATH에서 발견되지 않았다. 프로젝트 설치 locator가 `C:\Users\Administrator\AppData\Local\VoiceStudio (Current User)\omnivoice-studio.exe`(OmniVoice Studio 0.5.3)를 발견했지만, `127.0.0.1:3900/health`, `/v1/audio/voices`와 VoiceVox 기본 `127.0.0.1:50021/version`은 모두 연결 거부 상태였다.
- 따라서 현재 코드의 VoiceVox/VoiceStudio 검증은 fetch 모킹·가짜 프로세스 기반 계약 테스트까지 완료된 상태이며, 실제 화자 목록·WAV 합성은 백엔드 기동 후 별도 검증이 필요하다. VoiceBox는 범위에서 제외한다.
- 추가로 실제 FFmpeg 8.1.1 smoke 검증을 수행했다. 320x180 1초 MP4를 생성하고 ffprobe로 1.000000초를 확인한 뒤 0.5초 PNG 프레임 추출까지 성공했으며 임시 파일은 삭제했다.
- 런타임 토큰 공급자가 문자열 외 값(number/object)을 반환하는 경우도 ACCESS_TOKEN_MISSING으로 안정 처리하고 fetch를 호출하지 않는 회귀 테스트를 추가했다. 전체 npm test는 515/515 통과했다.

## 2026-09-20 YouTube 게시 startup wiring 완료

- `src/app/start.ts`가 `createStartupYouTubePublishingRoute`를 연결해 로컬 앱에서도 게시 검수 route를 노출한다. 현재 Core Workspace reader가 연결되지 않은 상태는 검수 진단으로 표시되고, Publisher·승인 공급자가 없으면 attempt가 409로 fail-closed 처리된다.
- 별도 `PublishingApprovalProvider` seam은 명시적으로 주입된 경우에만 검수 통과 후 Publisher를 제공하며, 승인 뒤에도 boundary가 Workspace·권리·파일 증거를 다시 검수한다. OAuth 흐름·토큰 저장·실제 외부 업로드는 자동 연결하지 않았다.
- `tests/youtube-startup-wiring.test.ts`에서 승인 공급자 없음, 검수 실패 전 호출 차단, fresh review 후 fake Publisher 실행, malformed/secret 값 비노출을 검증했다. 집중 테스트 3/3, 전체 `npm test` 518/518, typecheck, build, diff check 통과.
- 남은 연결 대상은 실제 Core Workspace reader와 사용자가 명시적으로 승인한 인증 공급자다. VoiceBox/VOICEVOX는 범위에서 제외한다.

## 2026-09-20 Core Workspace snapshot 계약 고정

- 실제 파일 저장 위치를 임의로 정하지 않고, `src/workspace-snapshot.ts`에 `schemaVersion: 1`, nonnegative safe `revision`, 기존 `WorkspaceSchema`를 감싼 순수 read-only snapshot envelope을 정의했다.
- `parseWorkspaceSnapshot`/`validateWorkspaceSnapshot`은 unknown field, 미지원 버전, 잘못된 revision, malformed workspace, cross-reference 오류를 결정적인 진단으로 반환하고 성공 결과를 deep clone한다. 파일·네트워크·프로세스·입력 변이는 수행하지 않는다.
- `tests/workspace-snapshot.test.ts`에서 정상 clone, 버전·revision 오류, strict field, malformed workspace, cross-reference, 입력 불변성을 검증했다. 집중 테스트 7/7, 전체 `npm test` 525/525, typecheck, build, diff check 통과.
- 다음 단계는 이 계약에 맞는 canonical Workspace 저장 위치와 file reader를 별도 결정한 뒤에만 startup의 `getWorkspace`를 연결하는 것이다.

## 2026-09-20 worktree 재개: Workspace 파일 reader

- 사용자 지정 worktree `C:\Users\Administrator\.codex\worktrees\040c\Short-auto`에서 기존 `01_Core_v2` 담당 작업을 재개했다. 원본 checkout은 수정하지 않았다.
- `FileWorkspaceReader`는 명시적 root와 상대 snapshot 경로를 받아 매번 최신 파일을 읽고 기존 snapshot 계약을 검증한다. 기본 16 MiB 제한, 경로·symlink 탈출 차단, regular file 검사, 열린 파일 identity와 읽기 전후 변경 검사, UTF-8·JSON 검증을 적용했다.
- 저장 파일 생성·기본 경로 추정·승인 생성은 하지 않는다. 집중 reader/snapshot 12개와 전체 530개 테스트, typecheck, build가 통과했고 Master reader 집중 테스트 5개도 통과했다.
- 다음 단위는 서버 설정에 명시된 snapshot 경로를 reader와 연결하고 게시 검수마다 최신 Workspace를 읽는 통합이다.

## 2026-09-20 파일 기반 Workspace 게시 검수 연결

- 기존 `12_Integration_v2`가 같은 worktree에서 `SHORT_AUTO_WORKSPACE_SNAPSHOT` 서버 설정과 reader를 연결했다. 경로는 현재 APP_PATHS.projectRoot 기준 상대 경로이며 자동 생성·예제 fallback 없이 매 검수마다 읽는다.
- 게시 boundary는 동기/비동기 Workspace 공급자를 지원한다. 미설정·삭제·손상·계약 오류는 검수를 차단하고 원시 OS 오류나 파일 경로를 응답에 노출하지 않는다.
- 승인 처리 중 snapshot 삭제 또는 production revision 변경이 발생하면 게시 직전 재검수에서 차단하여 fake Publisher 호출이 0회임을 확인했다. snapshot revision은 승인 증거를 대체하지 않는다.
- 전체 535개 테스트, typecheck, build, diff check 통과. Master가 파일 연결 집중 테스트 5개를 별도 확인했다. 앱의 고정 데이터 root가 원본 D:를 가리키므로 앱 자체를 시작하지 않고 임시 root의 route 통합 테스트를 사용했다.
- README에 설정·envelope·파일 제한을 기록했다. 인증 공급자, snapshot 작성/편집 UI, 최종 렌더 증거 생성은 후속 구현이며 실제 업로드를 수행한 것은 아니다.
