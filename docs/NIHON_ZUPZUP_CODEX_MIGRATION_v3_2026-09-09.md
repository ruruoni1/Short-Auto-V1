# 니혼줍줍 Codex 문서 마이그레이션 안내 v3 — 2026-09-09

이 파일을 Codex가 **가장 먼저 읽는다.**

이번 마이그레이션은 두 번의 결정 변경을 모두 반영한다.

1. Nadeshiko/외부 SaaS 중심 → **공식 YouTube + YouTube Data API + yt-dlp + 로컬 DB**
2. AI가 썸네일 문구까지 렌더링 → **무텍스트 베이스 이미지 + 편집 가능한 텍스트 레이어**
3. 외부/임시 TTS 전제 → **로컬 설치 VOICEVOX Engine + 동적 화자/스타일 선택**
4. 개발/문서 기준 경로 → **`D:\\coding\\Short-auto` / `D:\\coding\\Short-auto\\docs`로 고정**

---

# 1. 최신 기준 파일

아래 파일만 현재 기준본으로 사용한다.

1. `nihon_zupzup_channel_plan_v1.4_2026-09-09.md`
2. `nihon_zupzup_channel_settings_and_operation_v1.3_FINAL_2026-09-09.md`
3. `nihon_zupzup_official_youtube_clip_source_rules_v1.1_FINAL_2026-09-09.md`
4. `nihon_zupzup_anime_drama_quote_research_rules_v2.1_FINAL_2026-09-09.md`
5. `nihon_zupzup_anime_speech_series_rules_v1.2_FINAL_2026-09-09.md`
6. `nihon_zupzup_longform_thumbnail_rules_v1.4_FINAL_2026-09-09.md`
7. `nihon_zupzup_shorts_thumbnail_rules_v1.1_FINAL_2026-09-09.md`
8. `nihon_zupzup_thumbnail_editor_and_generation_rules_v1.0_FINAL_2026-09-09.md`
9. `nihon_zupzup_tts_script_rules_v1.1_FINAL_2026-09-09.md`
10. `nihon_zupzup_voicevox_integration_rules_v1.0_FINAL_2026-09-09.md`
11. `vidiq_2026_youtube_thumbnail_research.md`

---

# 2. 폐기/구버전으로 취급

다음 전제와 파일 버전은 개발 기준에서 제외한다.

- Nadeshiko API가 필수
- Nadeshiko Sentence URL이 후보 저장 필수 조건
- Apify/vidIQ가 런타임 필수 수집 서비스
- 수집한 YouTube 영상을 전부 자동 다운로드
- AI가 썸네일 한글/일본어 문구까지 이미지 내부에 생성
- 애니/일드 원본 장면을 썸네일에서 기본적으로 피한다는 이전 규칙

구버전 파일이 저장소에 남아 있다면 `docs/archive/`로 이동하거나 삭제하고, 런타임/프롬프트 로더가 읽지 않도록 한다.

---


# 2-A. 고정 프로젝트/문서 경로

Codex는 아래 경로를 기준으로 구현한다.

```text
D:\coding\Short-auto
├─ docs\
│  ├─ 최신 기준 MD
│  └─ archive\        # 구버전/폐기 문서
├─ data\
├─ assets\
├─ output\
├─ temp\
└─ src\              # 실제 코드 구조에 맞게 조정 가능
```

- `D:\coding\Short-auto\docs`가 유일한 활성 문서 루트다.
- 기존 MD가 이미 `docs`에 있으므로 버전이 충돌하면 구버전은 `docs\archive`로 이동한다.
- Codex는 `archive`를 구현 규칙으로 읽지 않는다.
- 절대경로를 코드 전역에 흩뿌리지 말고 `PROJECT_ROOT`/설정 객체에서 한 번만 정의한다.
- 실제 런타임 파일 경로는 `pathlib` 등 Windows 경로 안전 방식으로 조합한다.

---
# 3. 클립 수집 아키텍처

```text
Official YouTube Channels
        ↓
YouTube Data API
        ↓
Local Source DB
        ↓
AI/Rule Analysis
        ↓
Human Review
        ↓
SELECTED
        ↓
yt-dlp
        ↓
Production Assets
```

역할:
- YouTube Data API: 채널/영상 메타데이터, 증분 동기화
- yt-dlp: 선택된 미디어/자막/메타데이터 확보
- Local DB: 상태/표현/작품/화수/소스/로컬파일 관리

---

# 4. 썸네일 아키텍처

```text
Base Image
  ├─ AI_GENERATED (no text)
  ├─ OFFICIAL_CLIP_FRAME
  ├─ USER_IMAGE
  └─ RECREATED_IMAGE
        ↓
Thumbnail Studio
        ↓
Editable Text Layers
        ↓
Project JSON + Final JPG/PNG
```

AI 이미지 생성 프롬프트에 텍스트를 넣지 않는다.

썸네일 문구는 반드시 편집기의 텍스트 레이어에서 처리한다.

---

# 5. 애니·일드 썸네일 규칙

특정 작품/캐릭터가 클릭 훅인 경우:
- 해당 작품의 실제 장면 프레임을 우선 검토
- 내부 공식 클립 라이브러리 소스 우선
- 대사/표정/상황이 콘텐츠 질문과 연결되는 프레임 선호

언어 개념이 훅인 경우:
- 특정 작품 이미지 강제 금지
- 오브젝트/재현/AI 이미지 허용

원작 프레임은 `rights_review_status`를 별도 관리한다.

---

# 6. 폰트 구현 규칙

기본 폰트는 라이선스 레지스트리 방식으로 관리한다.

초기 후보:
- Pretendard
- Noto Sans/Serif KR/JP
- IBM Plex Sans KR/JP

번들 시:
- 공식 source URL
- 고정 version
- license ID
- license text/notice

를 함께 기록한다.

`무료 폰트`라는 이름만 보고 번들하지 않는다.

---


# 6-A. VOICEVOX TTS 아키텍처

니혼줍줍 TTS의 기본 엔진은 사용자의 Windows PC에 설치된 **VOICEVOX**다.

기본 흐름:

```text
VOICEVOX Engine 상태 확인
        ↓
GET /speakers
        ↓
화자 + 스타일 목록 UI 표시
        ↓
사용자 선택
        ↓
선택 style_id 저장
        ↓
POST /audio_query
        ↓
속도/피치/억양/볼륨 등 적용
        ↓
POST /synthesis
        ↓
WAV 저장 + 콘텐츠 프로젝트 연결
```

구현 원칙:
- 화자 이름이나 ID를 코드에 하드코딩하지 않는다.
- `/speakers`에서 현재 설치 환경의 목록을 매번 가져올 수 있어야 한다.
- UI에서는 `화자명 / 스타일명`으로 보여주고 내부 합성 값은 style `id`를 사용한다.
- 최초 선택 전에는 자동으로 특정 목소리를 확정하지 않는다.
- 선택 후에는 프로젝트/앱 설정에 저장하고 다음 실행에서 복원한다.
- 사용자가 `새로고침`하면 VOICEVOX에서 화자 목록을 다시 가져온다.
- 엔진이 실행 중이 아니면 명확한 연결 오류와 실행 안내를 표시한다.
- 기본 엔드포인트는 `http://127.0.0.1:50021`이며 설정에서 변경 가능하게 한다.

세부 규칙은 `nihon_zupzup_voicevox_integration_rules_v1.0_FINAL_2026-09-09.md`를 따른다.

---
# 7. 데이터 모델 신규/변경

필수 신규 모델 후보:

```text
SourceChannel
SourceClip
ExpressionCandidate
SourceFrame
ThumbnailProject
ThumbnailLayer
FontRegistryEntry
TtsVoiceProfile
TtsGenerationJob
```

`SourceFrame`은 공식 클립의 특정 timestamp에서 추출한 썸네일/스토리보드 후보 프레임을 관리한다.

`ThumbnailProject`는 최종 JPG만이 아니라 베이스 이미지와 레이어 정보를 저장한다.

---

# 8. 구현 우선순위

## Phase A — 기존 진행 코드 마이그레이션
- 구버전 문서 참조 제거
- Nadeshiko 필수 구조 제거
- 최신 문서 경로로 교체

## Phase B — Official Clip Library MVP
- 공식 채널 CRUD
- YouTube Data API sync
- SourceClip 리스트/검색/상태
- SELECTED만 yt-dlp

## Phase C — Thumbnail Studio MVP
- 16:9/9:16 캔버스
- 베이스 이미지
- 텍스트 레이어
- 드래그/리사이즈
- 폰트/색/외곽선
- 프로젝트 저장/불러오기
- JPG/PNG export
- 4개 니혼줍줍 템플릿

## Phase D — VOICEVOX TTS MVP
- 로컬 Engine health check
- `/speakers` 화자/스타일 동적 조회
- 화자 선택 UI + 미리듣기
- 선택 profile 저장/복원
- `/audio_query` + `/synthesis` WAV 생성
- 속도/피치/억양/볼륨 기본 조정
- 콘텐츠/TTS 대본 → 생성 파일 연결

## Phase E — 연계
- SourceClip → SourceFrame
- SourceFrame → ThumbnailProject
- ContentPlan → ThumbnailProject
- A/B variants

---

# 9. 충돌 시 문서 우선순위

1. `NIHON_ZUPZUP_CODEX_MIGRATION_v3_2026-09-09.md`
2. 기능 전용 최신 지침 (`official_youtube_clip...`, `thumbnail_editor...`)
3. `channel_plan_v1.3`
4. 콘텐츠별 최신 지침
5. VOICEVOX/TTS 최신 지침
6. vidIQ 공용 연구

동일 주제에서 구버전과 최신 버전이 충돌하면 최신 버전을 따른다.

---

# 10. Codex에 전달할 첫 지시문

> `docs` 폴더의 `NIHON_ZUPZUP_CODEX_MIGRATION_v3_2026-09-09.md`를 가장 먼저 읽고, 거기에 명시된 최신 기준 파일만 활성 문서로 취급해. 기존 구현과 충돌하는 항목을 먼저 찾아 마이그레이션 계획을 작성한 뒤, 현재 코드에서 Nadeshiko/외부 SaaS 필수 의존, 전체 영상 자동 다운로드, AI 썸네일 텍스트 직접 렌더링 전제가 남아 있는지 점검하고 수정해. 이후 Official Clip Library, Thumbnail Studio, VOICEVOX TTS를 최신 문서의 Phase 순서대로 구현해. 프로젝트 루트는 `D:\coding\Short-auto`, 활성 문서 루트는 `D:\coding\Short-auto\docs`로 고정해.

---

# 한 줄 결론

**현재 니혼줍줍 관리 프로그램은 공식 YouTube 소스를 자체 수집·선별하는 클립 라이브러리, 무텍스트 이미지 위에 텍스트를 별도 조판하는 Thumbnail Studio, 로컬 VOICEVOX 화자 목록을 동적으로 불러와 사용자가 선택한 목소리로 합성하는 TTS 모듈을 핵심 제작 인프라로 구현한다.**
