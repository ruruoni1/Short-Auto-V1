# CHANGELOG

## 0.1.0 - 2026-09-06

- 공통 TypeScript/JSON 모델, 런타임 구조·참조·관계 검증, 승인 revision과 Asset 준비 상태 검사 추가.
- 범용 Core와 니혼줍줍 17개 Profile 등록 데이터 분리, Long/Short 샘플 및 공개 ESM export 제공.
- 미등록 prototype 이름을 Asset으로 인정하던 오류 수정.
- Master 검증: 42개 테스트, 타입 검사, 빌드, 공개 import 통과. 영상 제작 UI/실제 렌더 기능은 아직 포함하지 않음.

## Unreleased - 2026-09-05

- Master가 전체 20개 명세 검토를 완료하고 제작/운영 상태, Profile ID, Pack 참조, Long/Short ID 관계, Timeline 및 Preview 검증 경계를 정리했다.
- 최초 Core 작업의 범위와 테스트 인수 기준을 준비했다. 사용자 기능 구현 완료나 릴리스를 의미하지 않는다.

## v1.1 - 2026-09-04

### Added
- Content Manager
- 8주/주간 콘텐츠 플랜 관리
- Channel Pack Architecture
- Content Profiles
- Long-form → Shorts 자동 파생
- YouTube Publishing
- Long/Shorts 관계 데이터
- 범용 Core / 니혼줍줍 Pack 분리
- Codex thread 09_Content_Manager
- Codex thread 10_YouTube
- Desktop/Integration thread renumbering

### Changed
- 제품 범위를 영상 자동 생성기에서 니혼줍줍 운영·제작·업로드 관리 툴로 확대
- 최종 쓰레드 구조를 00~12로 개편

## v1.0 - 2026-09-04
- 최초 Remotion 자동화 아키텍처
- Review Editor
- Timeline/Caption/Scene/Asset/Motion
- GitHub/자동 업데이트 방향
