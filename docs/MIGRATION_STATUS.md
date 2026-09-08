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

Phase A 완료: 고정 루트·12개 활성 문서 허용 목록, 구버전 링크 정리, 로컬 데이터 Git 제외. typecheck/build 및 전체 344개 테스트 통과. Phase B 구현 착수. 오전 06:40 재개 예약은 유지한다.
