# DECISIONS

## 2026-09-06 — 순수 Scene Runtime 인수

- SCENE_CONTRACT.md의 계획/조회 계약을 인수한다. sparse Caption ID의 Source 범위를 TTS Output 구간에 매핑하고 모든 구간은 [start,end)로 처리한다.
- 중첩 Scene은 원본 배열 순서로 모두 반환하고 미할당을 임의 Scene으로 채우지 않는다. 정지 Insert/Pause에서는 Source Scene/Caption을 반환하지 않으며 Overlay는 병렬 상태다.
- Caption offsetY는 local > global > 0, Motion은 override > original > 주입 정책 > 결정적 기본값 순서다. 원본 Caption과 표시용 lines를 분리한다.
- Runtime은 입력 snapshot을 사용한다. 반환 상태 변경이 다음 조회에 영향을 주지 않는다. 시각 컴포넌트와 실제 렌더는 별도 기능으로 관리한다.

## 2026-09-06 — Timeline Resolver 인수

- TIMELINE_CONTRACT.md의 ms 계산/검증 정책을 인수한다. 같은 Source anchor의 정지 Insert는 배열 순서, Overlay는 해당 anchor의 정지 Insert가 모두 끝난 뒤 시작한다.
- Overlay는 연속 Output 길이를 사용하고 ending 이전 영역을 넘어가면 오류다. Source 전체 무음을 보존하며 enabled ending은 양수 길이로 한 번 추가한다.
- Scene outputTiming은 현재 명시 오류이며 Scene/Editor 단계에서 지원한다. 표현 Override는 후속 적용 warning으로 남긴다. 원본 시간을 고치거나 미지원 Override를 조용히 무시하지 않는다.

## 2026-09-06 — Caption 파싱 기능 인수

- CAPTION_CONTRACT.md의 strict SRT 파싱/진단 계약을 인수한다. 오류 시 부분 SourceTimeline을 반환하지 않는다. 자동 재번호/정렬/시간 보정 없이 원문을 보존한다.
- source duration을 미입력하면 마지막 cue로만 추론하고 warning/provenance를 남긴다. 이 값을 실제 TTS 길이로 간주하지 않는다. 저장/Timeline 호출 계층이 실제 길이 및 provenance를 관리한다.
- 이번 기능은 SRT 파싱과 검증이다. 표시용 분할/렌더는 후속으로 남기고 SourceTimeline 계약을 사용하는 03_Timeline을 진행한다.

## 2026-09-06 — Core 0.1.0 인수

- CORE_CONTRACT.md의 최소 계약을 후속 구현 기준으로 인수한다. 영숫자 기반 ID, 명시적 Insert duration/trim, 정규화된 Overrides(global/scenes/inserts), 같은 Pack 내 파생 및 Content↔Project 일대일 연결을 초기 범위로 사용한다.
- Editor/저장 계층은 수정 시 revision을 올리고 승인을 무효화해야 한다. Core의 최종 준비 판정은 데이터 계약 검증이며 실제 파일/렌더 성공 증거가 아니다.
- Timeline 완전성은 03_Timeline, 채널 디자인은 06_Theme_Motion, 업로드 실행은 10_YouTube 후속 범위다. 초기 Profile은 17개 ID/포맷 매핑만 확정한다.
- Dictionary 참조는 own-property로 조회한다. Object prototype의 이름도 명시 등록된 경우에만 유효하다.

## 2026-09-05 — Master 최초 명세 검토

- 사용자 확정 개발 규칙: 기능 단위로 테스트 후 커밋한다. Master는 해당 기능 및 영향 범위 검증 결과를 확인하고 관련 문서를 갱신한 뒤 기능별 커밋/푸시를 관리한다. 전체 모듈 완료를 커밋의 필수 조건으로 두지 않는다.

- 사용자 지정 GitHub 저장소명: `Short-Auto-V1`. 기존 공개 저장소 명세에 따라 `ruruoni1/Short-Auto-V1`을 사용한다. 최초 커밋은 검토 완료된 명세 기준본이며, 진행 중인 Core 코드는 테스트 검토 후 별도 반영한다.

20개 명세 문서를 검토했다. 아래 결정으로 초기 Core 구현의 명명/범위 불일치를 정리한다. 기능별 상세 계약은 Core 구현 결과를 Master가 검증한 뒤 확정한다.

- 명세의 실제 기준 경로는 `docs/`다.
- 문서 묶음 버전 v1.1과 `production.json.schemaVersion = "1.0"`은 별개다. 예시 객체의 빈 필드는 완성된 JSON Schema를 의미하지 않는다.
- `production.project.status`는 제작 상태(`draft`, `auto_generated`, `reviewing`, `approved`, `rendered`)다. Content Manager의 상태는 별도 `ContentRecord.status`로 관리한다. 두 상태를 동일 enum으로 합치거나 무조건 동기화하지 않는다.
- 초기 Profile ID와 contentType 연결은 `CONTENT_PROFILES_SPEC.md`가 기준이다. 통합 명세의 `practical_japanese`, `discovery_fact_short`는 개념 예시이며 등록 ID가 아니다. `practical_explainer` 등 세부 명세의 ID를 사용한다.
- Pack ID는 `nihon_zupzup`, 디렉터리는 `channel-packs/nihon-zupzup/`이다. Core에는 Pack ID/Profile 목록/채널 문구를 하드코딩하지 않고 등록 데이터를 주입한다.
- Production project에 `channelPack`, `contentProfile` 참조를 추가한다. ContentRecord ID와 Production project ID는 구분하고 명시적으로 연결한다. ContentRecord의 `parentLongId` 등은 콘텐츠 ID, 파생 Project의 `sourceLongProjectId`는 프로젝트 ID다.
- Source 시간은 불변이다. Output 시간 증가에는 `insert`와 `pause`만 포함하며 `overlay`는 포함하지 않는다. Scene/Insert 편집은 Override/Output에 적용한다. `source_time` anchor를 사용하는 정지 Insert/Pause도 Caption 중간을 가를 수 없다.
- Asset의 `required`/`missing`은 유효한 제작 데이터 상태다. Preview에서는 Placeholder를 허용하고, 참조 오류와 최종 렌더 준비 검증을 구분한다. 미해결 필수 Asset을 정상 최종 렌더로 처리하지 않는다.
- 제작 승인은 최종 렌더의 선행 조건이다. 수정 후에는 재검수가 필요하다. 초기 Core는 관련 계약/검증만 제공하고 렌더나 업로드를 실행하지 않는다.
- Long→Shorts는 07_AutoPlanner가 후보/재구성, 09_Content_Manager가 관계 관리, 08_ReviewEditor가 검수, 12_Integration이 E2E를 담당한다. 공통 계약은 01_Core, 변경 승인은 Master가 담당한다.
- `CURRENT_STATUS`의 설계 COMPLETE는 개념 명세 작성 완료다. 실행/구현/테스트 완료를 뜻하지 않는다. 초기 Core 다음 단계 배정은 Master의 테스트 검토 후 진행한다.
- 공유 작업공간에서 담당자는 다른 작업의 변경을 되돌리지 않는다. Master가 상태/결정/변경 이력을 관리하고, 담당 작업은 변경 파일·계약·테스트 명령과 결과·잔여 제한을 보고한다.

## 2026-09-04

### v1 제품은 니혼줍줍 전용 운영 툴
영상 생성뿐 아니라 콘텐츠 플랜, 제작, 검수, 파생 Shorts, YouTube 업로드까지 관리한다.

### 내부 Core는 범용 구조
향후 여러 채널/주제에 재사용하기 위해
Channel Pack / Content Profile을 분리한다.

### 콘텐츠 포맷은 4종
- discovery_long
- training_long
- discovery_short
- learning_short

### Long→Shorts는 독립 기능
단순 Crop이 아니라 Hook/Scene/Layout을 Shorts용으로 재구성한다.

### Content Manager 도입
8주 플랜, 주간 일정, 제작 상태, Long/Short 관계, 선제 제작 상태를 관리한다.

### YouTube Publishing 도입
최종 렌더 이후 프로그램 안에서 메타데이터 검수와 업로드까지 이어진다.

### Remotion은 메인 영상 엔진
### Electron은 데스크톱 Shell
### production.json과 overrides.json은 분리
### ANIME_CLIP/DRAMA_CLIP은 Insert
### Windows 우선 + 크로스플랫폼 호환
### GitHub 공개 + 자동 업데이트
### Codex 멀티쓰레드 개발
