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
| 08_ReviewEditor | 08_ReviewEditor_v2 (`01a09ac0-0a86-7ca0-a096-741010f80b6b`) | gpt-5.6-sol / high | Thumbnail Studio 화면·Canvas 편집기 |
| 12_Integration | 12_Integration_v2 (`01a09ac0-13ea-7333-94c3-ad4c36ab536c`) | gpt-6-astra / high | 서버/API·폰트 번들·통합 테스트 |

9월 13일 최초 실행은 사용량 한도로 실패했다. 9월 14일 02:20 예약 실행에서 사용 가능 상태를 확인하고 같은 포크에 재개 지시했다. 일회 예약 short-auto-9-14-2-20은 실행 후 PAUSED 처리했다. Phase C 중단 API 연결은 아직 모델 파일이 없어 미완성이므로 현재 트리를 빌드 완료 상태로 보지 않는다. 담당 결과를 통합 검증한 뒤 기능별 커밋·푸시한다. 기존 Caption 렌더 변경은 보존한다.

2026-09-14 Phase B 커밋 후보: 독립 Git index 스냅샷에서 TypeScript 검사 및 전체 359개 테스트 통과. 모바일 390×844 메뉴 검증 완료. C 구현과 기존 Caption 변경은 작업트리에 보존한다.
