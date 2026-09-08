# 니혼줍줍 공식 YouTube 클립 수집 및 소스 관리 지침 v1.1 FINAL

작성일: 2026-09-09  
적용 대상: 니혼줍줍 애니·일드 콘텐츠 리서치, 공식 클립 라이브러리, 관리 프로그램  
상태: 최종 운영/구현 기준본

---

# 1. 문서 목적

니혼줍줍에서 애니·일드 실제 대사를 활용할 때 외부 대사/클립 SaaS에 의존하지 않고,
**공식 YouTube 채널의 실제 클립을 자체적으로 수집·분류·검증·관리**하기 위한 기준을 정의한다.

핵심 기술 스택:

- **YouTube Data API**: 채널/영상 탐색, 메타데이터 수집, 주기적 동기화
- **yt-dlp**: 채택된 YouTube 영상의 미디어/오디오/자막/추가 메타데이터 처리
- **로컬 DB**: 공식 클립 라이브러리, 작품/대사 후보, 검증 상태 관리
- **AI 분석**: 제목/설명에서 작품명·화수·대사 후보·표현 후보 추출 및 콘텐츠 가치 보조 평가

외부 서비스는 필수 의존성으로 두지 않는다.

---

# 2. 최상위 원칙

> **공식 YouTube 소스를 우선하고, 다운로드는 채택된 후보에 대해서만 수행한다.**

1. 공식 채널 여부가 확인된 영상만 기본 클립 라이브러리에 등록한다.
2. 모든 수집 영상을 자동 다운로드하지 않는다.
3. 메타데이터 수집 → 후보 분석 → 사람 검수 → 채택 → 필요한 영상만 다운로드 순서를 지킨다.
4. YouTube에 공개되어 있다는 사실이 제3자의 자유로운 재사용 허락을 뜻하지 않는다.
5. 실제 영상 사용은 해설·분석·교육 목적에 필요한 최소 범위로 검토한다.
6. 원본 장면의 감상 대체물이 되도록 긴 클립을 연속 사용하지 않는다.

---

# 3. 소스 우선순위

## ANIME — S Tier

- Aniplex 공식
- TOHO animation 공식

특징:
- 실제 본편 장면/Shorts/Highlight가 많음
- 제목에 대사가 포함되는 경우가 많음
- 작품명/화수 정보가 비교적 명확함
- 최신 인기작 비중이 높음

## ANIME — A Tier

- Toei Animation 공식
- KADOKAWA Anime 공식
- 작품별 공식 YouTube 채널

## DRAMA — S Tier

- 日テレドラマ公式

특징:
- `切り抜き` 본편 클립
- 선행 공개
- 화수 기반 장면
- 대사형 Shorts

## DRAMA — A Tier

- TBS 공식 및 작품별 공식 채널
- フジテレビ 공식
- テレビ東京 공식/드라마 채널
- テレビ朝日 공식

※ 실제 채널 ID와 활성 상태는 설정 파일/DB에서 관리하며 코드에 하드코딩하지 않는다.

---

# 4. 두 가지 탐색 모드

## MODE A — 표현 우선 탐색

예: `貴様`, `お前`, `俺`

1. 내부 공식 클립 DB에서 표현 검색
2. 제목/자막/전사 데이터에서 후보 검색
3. 후보 작품·화수·클립 확인
4. 실제 문맥 검증
5. 부족하면 공식 YouTube 검색으로 확장
6. 적합 후보를 콘텐츠에 등록

## MODE B — 클립 우선 탐색

1. 공식 채널 최신 영상 자동 수집
2. 실제 장면/Shorts/Highlight 후보 자동 분류
3. 제목/설명/자막에서 대사·표현 후보 추출
4. 일본어 콘텐츠 가치 평가
5. 사람이 검수
6. 반응 가능성이 높은 표현을 Shorts/Long-form 후보로 등록

초기에는 MODE A와 MODE B를 병행한다.

---

# 5. YouTube Data API의 역할

YouTube Data API는 **탐색·동기화·메타데이터 관리**가 주 역할이다.

수집 대상 예:

- video_id
- channel_id
- channel_title
- video_title
- description
- published_at
- duration
- thumbnails
- view_count
- like_count(사용 가능 범위)
- comment_count
- playlist/source 정보

권장 흐름:

> 채널 등록 → uploads/검색 결과 수집 → 신규 video_id 판별 → 상세 메타데이터 저장

주의:
- API quota를 불필요한 반복 검색에 낭비하지 않는다.
- 이미 수집한 영상은 ETag/최종 동기화 시각/ID를 이용해 중복 처리를 줄인다.
- 검색 API보다 공식 채널의 업로드 목록 기반 증분 동기화를 우선 검토한다.

---

# 6. yt-dlp의 역할

yt-dlp는 **채택 후보의 실제 미디어 처리**에 사용한다.

가능한 역할:

- 영상/오디오 다운로드
- 가능한 경우 자막/자동자막 확인 및 저장
- 상세 포맷/해상도/코덱 확인
- 추가 메타데이터 확인
- 편집용 원본 파일 경로 생성

최상위 규칙:

> **메타데이터를 수집했다고 바로 다운로드하지 않는다.**

권장 상태 흐름:

`NEW → ANALYZED → REVIEWED → CANDIDATE → SELECTED → DOWNLOADED`

`REJECTED`는 다운로드하지 않는다.

---

# 7. 기본 자동 분류 규칙

제목/설명에서 다음 신호를 우선 탐지한다.

## 실제 장면 가능성이 높은 키워드

- 切り抜き
- Highlights / Highlight
- オススメシーン
- SELECTION
- 第○話
- #shorts / Shorts
- 本編
- 名場面
- 先行公開

## 제외/낮은 우선순위 후보

- PV
- Trailer
- Teaser
- CM
- OP / ED 단독
- Music Video
- Cast interview
- Event footage
- English Dub / ENGLISH DUB (일본어 학습 소스로 사용할 때)

단, 제외 키워드가 있다고 무조건 삭제하지 않고 `clip_type`과 우선순위를 낮춘다.

---

# 8. 클립 유형

`clip_type` 표준값:

- `scene` — 본편 장면
- `highlight` — 에피소드 하이라이트
- `short` — 공식 Shorts
- `cutout` — 切り抜き
- `digest` — 다이제스트
- `preview` — 선행 공개
- `pv` — PV/예고
- `other`

니혼줍줍 대사 사례에서는 `scene`, `highlight`, `short`, `cutout`을 우선한다.

---

# 9. DB 권장 필드

## SourceChannel

- id
- youtube_channel_id
- channel_name
- category: anime / drama
- source_priority: S / A / B
- official_verified: bool
- enabled: bool
- last_synced_at
- notes

## SourceClip

- id
- youtube_video_id
- channel_id
- content_type: anime / drama
- work_title
- episode
- clip_type
- title
- description
- dialogue_candidate
- published_at
- duration_seconds
- view_count
- like_count
- comment_count
- youtube_url
- thumbnail_url
- subtitle_available
- subtitle_path
- local_video_path
- local_audio_path
- source_priority
- work_tier: NOW / EVERGREEN / DISCOVERY
- language_value_score
- source_availability_score
- popularity_score
- final_score
- status: NEW / ANALYZED / REVIEWED / CANDIDATE / SELECTED / DOWNLOADED / REJECTED
- reviewed_at
- review_notes
- created_at
- updated_at

## ExpressionCandidate

- id
- clip_id
- expression_original
- reading_ko
- meaning_ko
- context_summary
- speaker
- listener
- language_value_score
- suggested_content_type
- suggested_hook
- verification_status
- notes

---

# 10. AI 자동 분석 범위

AI는 보조 도구이며 최종 검증자가 아니다.

자동 추출 후보:

- 작품명
- 화수
- 영상 유형
- 제목 속 실제 대사 후보
- 일본어 표현 후보
- 한국어 독음 초안
- 의미 초안
- 콘텐츠 가치 점수
- Shorts/Long-form 적합성
- 훅 초안

AI 결과는 `verification_status = UNVERIFIED`로 저장하고 사람이 검수하기 전에는 확정 자료로 사용하지 않는다.

---

# 11. 사람 검수 필수 항목

- 공식 채널이 맞는가?
- 실제 애니/일드 장면인가?
- 작품명이 맞는가?
- 화수가 맞는가?
- 대사 원문이 정확한가?
- 화자/청자/관계가 맞는가?
- 앞뒤 문맥이 설명하려는 의미와 맞는가?
- 자막/자동전사 오류가 없는가?
- 작품 인기 때문에 부적절한 사례를 억지로 선택하지 않았는가?

---

# 12. 작품 및 대사 최종 평가 순서

기존 단순 구조를 다음과 같이 확장한다.

> **실제 대사 정확성**
> → **문맥 적합성**
> → **공식 클립 확보 가능성**
> → **작품 인지도·최신성**

핵심:

> **좋은 대사 + 검증 가능한 공식 클립이 가장 우선이다.**

인기작이라도 공식 소스가 없거나 문맥이 부적절하면 우선순위를 낮춘다.

---

# 13. 다운로드 및 로컬 파일 관리

권장 구조:

```text
media/
├─ anime/
│  └─ <work_slug>/
│     └─ <youtube_video_id>/
│        ├─ source.mp4
│        ├─ subtitle.ja.srt
│        ├─ metadata.json
│        └─ notes.md
└─ drama/
   └─ <work_slug>/...
```

DB에는 절대경로보다 프로젝트 기준 상대경로 저장을 우선한다.

원본 파일과 실제 편집에 사용한 파생 클립은 분리한다.

```text
source.mp4
clips/
├─ clip_001.mp4
└─ clip_002.mp4
```

---

# 14. 저작권/사용 원칙

공식 YouTube 영상은 **출처가 명확한 소스**이지 자유 이용 소스가 아니다.

따라서:

- 영상 전체 또는 장시간 재사용을 기본값으로 삼지 않는다.
- 분석에 필요한 짧은 범위를 사용한다.
- 원본 오디오/영상 재생 직후 자체 해설·분석을 배치한다.
- 장면 자체가 콘텐츠의 주된 감상 가치를 대체하지 않게 한다.
- 필요한 경우 정지화면, 확대, 텍스트, 자체 그래픽 등으로 변환·해설 비중을 높인다.
- 권리자 정책/Content ID 결과를 실제 업로드 전 확인한다.

---

# 15. 관리 프로그램 UI 최소 기능

## 공식 채널 관리
- 채널 추가/수정/비활성화
- Anime / Drama 분류
- S/A/B 우선순위
- 마지막 동기화 시각

## 클립 라이브러리
- 최신순/작품/채널/유형 필터
- Shorts/Long-form 구분
- NEW/CANDIDATE/SELECTED 상태 필터
- 제목/설명/표현 검색
- YouTube 원본 열기
- 썸네일 미리보기

## 후보 검수
- 작품명/화수 수정
- 대사 후보 수정
- 독음/의미/문맥 메모
- 채택/보류/제외
- 콘텐츠 플랜으로 보내기

## 다운로드
- SELECTED 항목만 yt-dlp 실행
- 품질 선택 또는 공통 기본값
- 자막 동시 확보 옵션
- 다운로드 상태/오류 로그

---

# 16. 초기 구현 우선순위

## Phase 1
- 공식 채널 CRUD
- YouTube Data API 채널 동기화
- 영상 메타데이터 DB 저장
- 클립 리스트/필터
- 수동 채택/제외

## Phase 2
- 제목 규칙 기반 작품/화수/clip_type 자동 추출
- AI 대사/표현 후보 분석
- 콘텐츠 후보 연결

## Phase 3
- yt-dlp 선택 다운로드
- 자막 수집
- 로컬 미디어 경로 관리

## Phase 4
- 표현 우선 DB 검색
- 공식 클립 우선 자동 추천
- 콘텐츠 제작 프로젝트/대본과 연결

---

# 17. 외부 서비스 의존성 정책

필수 런타임 의존성으로 다음을 두지 않는다.

- Nadeshiko
- Apify
- vidIQ
- 기타 제3자 클립/대사 SaaS

이들은 필요하면 수동 조사/벤치마크 보조 자료로 사용할 수 있지만,
**니혼줍줍 관리 프로그램의 핵심 수집 파이프라인은 작동에 의존해서는 안 된다.**

핵심 파이프라인:

> **YouTube Data API + yt-dlp + 로컬 DB**

---

# 18. 최종 체크리스트

- [ ] 공식 채널인가?
- [ ] YouTube video_id를 저장했는가?
- [ ] 작품명/화수를 확인했는가?
- [ ] 실제 장면 유형인가?
- [ ] 대사/표현 후보가 검증됐는가?
- [ ] 다운로드 전에 사람이 채택했는가?
- [ ] 원본 URL을 항상 보존하는가?
- [ ] 로컬 파일과 원본 URL이 연결되는가?
- [ ] 긴 원본 장면 재사용을 기본값으로 하지 않는가?
- [ ] Content ID/저작권 검수 단계를 거치는가?

---

# 19. 최종 운영 공식

> **공식 YouTube 채널 등록**
> → **YouTube Data API 증분 수집**
> → **클립 유형 자동 분류**
> → **대사/표현 후보 분석**
> → **사람 검수**
> → **콘텐츠 후보 등록**
> → **채택된 항목만 yt-dlp로 확보**
> → **실제 문맥 최종 검증**
> → **대본/영상 제작**

---

# 20. 한 줄 결론

**니혼줍줍의 애니·일드 클립 소스는 외부 대사/클립 SaaS가 아니라, 공식 YouTube 채널을 YouTube Data API로 자체 수집하고 채택된 영상만 yt-dlp로 확보하는 자체 클립 라이브러리를 중심으로 운영한다.**


---

# 25. Thumbnail Studio 연계 — v1.1 추가

SELECTED 또는 REVIEWED 클립은 필요 시 썸네일 베이스 이미지 후보를 만들 수 있다.

## 프레임 추출 원칙
- 모든 수집 클립에서 자동 대량 추출하지 않는다.
- 콘텐츠 후보로 검토 중이거나 SELECTED 된 클립에서만 사용자가 지정한 시점 또는 소수의 후보 시점으로 추출한다.
- 프레임에는 원본 YouTube URL, video_id, 채널, 작품, 화수, timestamp를 유지한다.
- 추출된 프레임의 `rights_review_status`를 별도 관리한다.

## 권장 필드
```text
SourceFrame
- id
- source_clip_id
- timestamp_seconds
- local_path
- width
- height
- candidate_type       # thumbnail / reference / storyboard
- rights_review_status # unchecked / reviewed / rejected
- note
```

## 썸네일 편집기 전달
검토된 프레임은 `Thumbnail Studio`에서 `OFFICIAL_CLIP_FRAME` 베이스 이미지 타입으로 참조한다.

공식 채널의 영상이라는 사실은 저작권 자유 이용을 뜻하지 않는다. 프레임 사용 여부는 콘텐츠의 분석/비평 맥락과 권리 검토 상태를 별도로 확인한다.
