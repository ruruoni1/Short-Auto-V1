# Core 공통 계약 0.1.0

기준: docs 명세 20개 및 DECISIONS의 2026-09-05/06 결정. 문서 v1.1과 Production `schemaVersion: "1.0"`은 별개입니다. 2026-09-06 Master가 아래 범위와 제한을 초기 Core 계약으로 인수했습니다. 계약 변경은 Master 검토를 거칩니다.

## 공개 진입점

- `@short-auto/core`: src/index.ts에서 모든 모델 Schema, 추론 TypeScript 타입, Workspace/ProjectBundle Schema, validateWorkspace, checkFinalRenderReadiness를 export합니다. Core 런타임 의존성은 Zod 4 하나입니다. 브라우저에서 Node 파일 API 없이 사용할 수 있습니다.
- `@short-auto/core/nihon-zupzup`: 별도 channel-packs/nihon-zupzup/index.ts의 nihonZupzupPack 등록 데이터입니다. Core는 해당 데이터나 ID를 import하지 않습니다.
- npm ESM과 타입 선언을 지원합니다. CommonJS 빌드는 제공하지 않습니다. build 산출물은 dist이며 Git에 넣지 않습니다.

## 저장 및 검증 경계

Production은 원래 최상위 project/audio/captions/settings/assets/scenes/inserts/ending 구조를 유지합니다. Caption 배열은 별도 SourceTimeline `{durationMs, captions}`로 주입합니다. Workspace는 pack registry, project bundle 목록, content record 목록을 함께 검증하기 위한 컨테이너로, 하나의 거대한 저장 파일을 강제하지 않습니다. 파일별 저장·로딩은 후속 담당입니다.

Zod strict object로 오타/미등록 필드를 거부합니다. 시간은 0 이상의 정수 ms, 실제 구간 길이는 양수입니다. ID는 영문자/숫자로 시작하고 영문자/숫자/underscore/dot/hyphen만 사용합니다. Caption ID는 1 이상의 정수이며 시간순으로 증가해야 합니다(연속일 필요는 없습니다). Scene captionRange는 양 끝을 포함합니다. 로컬 미디어 경로는 workspace 상대 경로이며 절대 경로/상위 탐색을 거부합니다. Source URL은 Asset metadata에 별도로 보관할 수 있습니다.

`validateWorkspace(unknown)`은 구조 오류를 먼저 보고하고, 성공하면 중복 ID, Pack/Profile/Theme, Caption/Asset/Scene/Insert/Override 참조, contentType, Content↔Project, Long↔Short 관계를 검증합니다. 반환값은 `{valid, diagnostics: [{severity, code, path, message}]}`입니다. Scene 겹침과 미할당 Caption은 warning입니다. 관련 자료가 빠진 부분 Workspace에는 참조 오류가 발생하므로 검증 대상의 관계 폐쇄 집합을 로드해야 합니다.

## Source/Output와 Insert

SourceTimeline과 Production을 검증 중 변경하지 않습니다. Source시간은 Caption startMs/endMs입니다. Output 수정은 Override의 outputTiming에만 저장합니다. Insert type은 ANIME_CLIP/DRAMA_CLIP/MEDIA/PAUSE이고 timingMode는 overlay/insert/pause입니다. PAUSE와 pause는 함께 사용합니다. 미디어 Insert는 Asset ID와 명시적 durationMs가 필요합니다. 원본 trim이 있으면 길이가 durationMs와 같아야 합니다. Override trim은 새 길이를 허용하며 후속 Resolver가 유효 길이를 재계산해야 합니다.

caption_before/after는 존재하는 Caption만 참조합니다. source_time은 Source duration 이내여야 하며 insert/pause는 Caption 내부를 가를 수 없습니다. Cue 사이 무음 구간과 정확한 경계는 허용합니다. overlay는 Caption 내부에서도 허용하며 Output 총시간 증가에 포함하지 않습니다.

ResolvedTimeline은 project/revision 정보와 tts/insert/pause/overlay/ending 구간을 갖습니다. Schema는 구간 순서의 시작/끝 및 TTS 길이 보존을 검사합니다. **전체 구간 연속성, Source 완전 커버리지, Insert 누락/중복, 누적 Output 계산은 아직 검사하지 않습니다.** 실제 Timeline Resolver와 이 심화 검증은 03_Timeline 범위입니다. Core는 시간축을 생성하지 않습니다.

## Scene, Asset, Theme, Profile

Scene 9종은 동일한 최소 content/visual/motion 구조를 공유하며 렌더 함수는 없습니다. motion=null이 유효합니다. MAIN_TEXT/JP_TEXT/subText는 null을 허용합니다. Theme는 4개 font role, named colors, 기본 transition, 선택적 motion을 등록합니다.

Asset Registry 키가 Asset ID입니다. ready에는 src가 필요합니다. required/missing/rejected는 저장 가능한 상태입니다. 없는 Registry 키를 참조하는 것은 오류이며, 존재하는 required/missing 자료는 Preview placeholder 대상입니다.

Profile은 contentType과 선택 정책을 갖습니다. 등록된 allowedSceneTypes와 insertPolicy는 강제합니다. preferredSceneSequence 등 추천·연출 정책 실행은 Planner/Theme 담당입니다. 초기 17개 Profile ID와 contentType 매핑은 CONTENT_PROFILES_SPEC를 따릅니다. 편집 규칙은 임의로 채우지 않았습니다. 기본 Theme의 sans-serif/흑백 값은 임시 데이터이며 최종 채널 디자인이 아닙니다. captionStyle/transitionStyle은 향후 preset resolver 참조 ID로 보존하며 현재 존재 여부를 검사하지 않습니다.

## Content 및 파생 관계

Production project.status는 제작 enum, ContentRecord.status는 운영 enum으로 별개이며 자동 동기화하지 않습니다. project.origin은 independent 또는 derived입니다. derived에는 sourceLongProjectId/derivativeIndex(1부터)/derivativeReason이 필수입니다. 파생 인덱스는 원본 Long별 고유합니다. 독립 Shorts는 independent로 표현합니다.

ContentRecord.productionProjectId가 Production을 연결합니다(콘텐츠별 선택적, 연결 시 일대일). relationship.parentLongId는 Content ID이며 project ID가 아닙니다. derivedShortIds는 부모와 자식의 양방향 일치가 필요합니다. sourceType은 relationship 내부에 둡니다. 파생 대상은 같은 Pack의 Long, 파생 결과는 Short여야 합니다. 관련 content IDs는 방향성이며 양방향을 강제하지 않습니다.

## Override, 승인, 최종 준비

overrides.json은 `{schemaVersion, projectId, revision, global, scenes, inserts}`입니다. 예시 문서의 최상위 scene ID는 명명 충돌을 피하도록 scenes 아래에 정규화했습니다. Caption/MAIN_TEXT/Visual transform, caption mode/lines, Scene type/motion/outputTiming, Insert trim을 저장합니다. 생산 결과에 Override를 적용하는 엔진은 구현하지 않았습니다.

Approval은 projectId, productionRevision, overridesRevision, approvedAt, approvedBy를 기록합니다. Editor/저장 계층이 **모든 변경 때 revision을 증가**시켜야 합니다. 이 Core는 immutable editor나 content hash 저장소가 아니므로 같은 revision에 몰래 수정한 데이터를 감지하지 못합니다. 승인 이벤트 생성도 하지 않습니다.

최종 준비 검사는 승인 상태(approved 또는 기존 rendered), 양쪽 revision 일치, 유효한 참조, 실제 사용 Asset의 ready, Registry의 미해결 required 유무를 확인합니다. visual override가 교체한 Asset은 유효 사용 대상으로 검사합니다. rendered 문자열이나 준비 판정은 렌더 실행 증거가 아닙니다. 파일 존재, 폰트/미디어 확인, 전체 디코드, resolved timeline 검증 및 최종 렌더 산출물 확인은 Integration이 추가해야 합니다.

## Publishing / Analytics 확장

PublishingMetadata는 content/project ID, 상대 video/thumbnail 경로, 제목/설명/tags/hashtags/playlistIds, visibility, timezone 포함 예약 시각을 받습니다. PublishingResult는 uploaded(필수 videoId/시각) 또는 failed(코드/메시지/retryable)의 판별 union입니다. Publisher/AnalyticsProvider는 구현 없는 타입 인터페이스입니다. Analytics는 알려진 지표와 number/string/boolean/null 추가 지표를 제공합니다. 토큰/키 필드나 저장은 없습니다.

현재 Publishing Schema는 데이터 구조만 검증합니다. 실제 업로드 전 메타데이터 승인·현재 렌더 증거·Content 연결·YouTube 예약/제한·재시도 동작은 10_YouTube에서 구현해야 합니다.

## 검증 및 남은 결정

Node 24.13.0/npm 11.6.2에서 의존성 설치 및 lockfile 생성. npm ci, typecheck, test, build 결과는 완료 보고에 기록합니다. examples는 가상 데이터이며 미디어 파일을 포함하지 않습니다. 테스트는 정상/오류 참조, 독립/파생 관계, Profile, 시간, 승인 revision, placeholder/최종 준비 구분을 다룹니다.

Master가 초기 범위로 인수한 선택: ID 문자 규칙, revision 책임, normalized Override 형태, 명시적 Insert duration과 trim 정책, 같은 Pack 내 파생 제한, Content↔Project 일대일 연결, 최소 Profile/Theme 정책 형태. 라이선스 선택과 배포 package 공개 설정은 아직 정하지 않았습니다.

이번 범위 밖: SRT parser, Timeline resolver, Scene renderer, Editor, OAuth/업로드, Installer, 실제 렌더와 미디어 QA.
