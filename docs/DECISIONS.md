# DECISIONS

## 2026-09-05 — Master 최초 명세 검토

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
