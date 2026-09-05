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

- 사용자는 00_Master와만 대화해도 된다.
- 기능 변경 시 영향 범위를 분석한다.
- Interface 변경은 관련 쓰레드 전체에 전파한다.
- 각 단계는 테스트 후 완료 처리한다.
- CURRENT_STATUS.md 갱신은 Master가 책임진다.
- 설계 결정은 DECISIONS.md.
- 사용자 체감 기능 변경은 CHANGELOG.md.
