# CHANGELOG

## Unreleased - Asset Resolver - 2026-09-06

- Asset Registry 검증, 명시 시각 전략 보존, auto 대체 선택과 Preview Placeholder/생성 요청 계획 추가.
- 원래 Asset 상태·출처·Override를 보존하고 Preview와 최종 Asset 데이터 준비 조건을 구분한다.
- Master 검증: 전체 213개 테스트, 타입 검사, 빌드, 공개 API 통과. 파일 접근·생성·렌더는 미포함.

## Unreleased - Scene Runtime - 2026-09-06

- 9개 Scene Type의 순수 계획/시점 조회와 표시 Override 합성 추가.
- Source 무음/정지 Insert/Overlay/ending 및 Caption 노출 상태를 분리하고 원문을 보존한다.
- Master 검증: 전체 171개 테스트, 타입 검사, 빌드, 공개 API 경계 확인 통과. 시각 컴포넌트 및 렌더는 미포함.

## Unreleased - Timeline - 2026-09-06

- Source 전체를 보존하며 Insert/Pause/Overlay/trim/ending을 계산하는 resolveTimeline 추가.
- 저장된 시간축의 참조·revision·연속성·Source 커버리지·누락/중복·총길이 심화 검증 추가.
- Master 검증: 전체 144개 테스트, 타입 검사, 빌드, 공개 API 통과. 실제 미디어 확인과 렌더는 미포함.

## Unreleased - Caption 파싱 - 2026-09-06

- parseSrt 및 validateCaptions 공개 API 추가. BOM/CRLF/LF와 한일 다중행 원문, 번호 및 ms 시간을 보존한다.
- 잘못된 번호/시간/중복/겹침/순서를 진단하고 실제 미디어 길이와 마지막 cue 기반 추론을 구분한다.
- Master 검증: 기존 Core 포함 87개 테스트, 타입 검사, 빌드와 공개 import/파싱 통과. 자막 표시용 분할과 렌더는 후속 범위다.

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
