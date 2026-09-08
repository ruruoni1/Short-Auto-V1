# DEVELOPMENT_PLAN v1.1

## Codex 쓰레드

### 00_Master
오케스트레이터 / Change Manager / 통합 관리자.

### 01_Core
프로젝트 구조, 공통 TypeScript 타입, 데이터 모델, Schema.

### 02_Caption
SRT 파싱, Caption JSON, 분할, Caption Validator.

### 03_Timeline
Source/Output Timeline, Insert/Pause, Resolver.

### 04_Scene
Scene Runtime 및 9개 기본 Scene.

### 05_Asset
Asset Registry, Resolver, Metadata, Placeholder.

### 06_Theme_Motion
Theme, Typography, Motion, Transition.

### 07_AutoPlanner
대본/SRT → Scene Plan → production.json.

### 08_ReviewEditor
Live Preview, Override Layer, Inspector, Undo/Redo.

### 09_Content_Manager
콘텐츠 플랜, Dashboard, Calendar, 상태, Long/Short 관계.

### 10_YouTube
업로드, 메타데이터, 인증 연동, 업로드 상태.

### 11_Desktop_Release
Electron, Workspace, Installer, GitHub Release, Auto Update.

### 12_Integration
전체 E2E 및 첫 니혼줍줍 실제 콘텐츠 통합.

## 개발 순서

Phase 1
01_Core
→ 02_Caption
→ 03_Timeline
→ 04_Scene
→ 05_Asset
→ 06_Theme_Motion

Phase 2
07_AutoPlanner
→ 08_ReviewEditor
→ 09_Content_Manager
→ Long→Shorts integration

Phase 3
10_YouTube
→ 11_Desktop_Release

Phase 4
12_Integration

## Master 규칙

### 하위 에이전트 배분 — 2026-09-08 사용자 승인

- 담당 작업은 기능별로 필요한 하위 에이전트와 모델/추론 수준을 자율 선택한다. 책임 작업(00~12)과 Master 인수/커밋 체계는 유지한다.
- 기본 구현/버그 수정: gpt-5.6-sol, high. 명확히 한정된 fixture/문서/반복 작업: gpt-5.6-luna, medium.
- 공통 계약·복잡한 시간축·승인/보안·어려운 회귀 분석: gpt-6-astra, high. 재현된 난제가 남을 때만 xhigh로 높인다.
- 모델은 호출 시 실제 가용성을 확인한다. 사용 불가 시 가능한 동급 모델로 대체하고 보고한다. 사용자에게 매번 선택을 묻지 않는다.
- 파일 소유권이 분리된 구체적인 작업만 병렬 위임한다. 구현자와 독립 검토자를 분리할 수 있으며 단순 작업은 불필요하게 분할하지 않는다.
- 각 지시에는 파일 소유권, 입력 계약, 인수 기준, 기존 변경 보존, Git/Master 문서 수정 금지를 명시한다. 모델 override 시 필요한 범위의 문맥과 지시를 제공한다.
- 담당 작업이 하위 결과를 통합·테스트한 뒤 Master에 보고한다. 중단 재개는 기존 파일/에이전트 상태를 확인하여 중복 실행하지 않는다.

- 사용자는 00_Master와만 대화해도 된다.
- 기능 변경 시 영향 범위를 분석한다.
- Interface 변경은 관련 쓰레드 전체에 전파한다.
- 각 단계는 테스트 후 완료 처리한다.
- 기능 단위로 구현하고 해당 기능 테스트 및 영향 범위의 회귀 검증을 통과한 뒤 커밋한다. 모듈 전체 완료를 기다릴 필요는 없지만 각 커밋은 독립적으로 검증 가능한 상태여야 한다.
- Master가 테스트 결과와 변경 범위를 확인하고 관련 문서와 함께 기능별 커밋을 만들어 GitHub에 푸시한다. 서로 무관한 기능이나 미완성 변경을 한 커밋에 섞지 않는다.
- CURRENT_STATUS.md 갱신은 Master가 책임진다.
- 설계 결정은 DECISIONS.md.
- 사용자 체감 기능 변경은 CHANGELOG.md.
