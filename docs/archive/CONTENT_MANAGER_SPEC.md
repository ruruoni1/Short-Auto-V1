# Content Manager Spec v1.0

## 목적

니혼줍줍의 콘텐츠 플랜과 실제 제작 상태를 한 곳에서 관리한다.

## 주요 화면

### Dashboard
- 이번 주 업로드 일정
- 제작 상태
- 준비 완료 분량
- 2주 선제 제작 경고
- 최근 업로드 성과
- 다음 작업

### Content Calendar
- 월/주 단위 일정
- Long / Shorts 구분
- 예정/완료/업로드 상태

### Content Backlog
- 아이디어
- 우선순위
- 시리즈
- 콘텐츠 축
- Long/Shorts 후보

### Content Detail
- 제목
- 콘텐츠 축
- contentType
- contentProfile
- 상태
- 제작일
- 공개일
- 관련 Long/Shorts
- Script/TTS/SRT/Assets
- Render
- YouTube metadata
- Analytics

## 초기 운영 규칙

- Long-form 우선 제작 가능
- Long-form에서 관련 Shorts 파생
- 독립 Shorts 별도 관리
- 2주치 선제 제작 상태 표시
- 4주 리뷰 데이터 지원
- 8주 콘텐츠 플랜 지원

## 상태 예

idea
planned
script_ready
media_ready
auto_generated
reviewing
approved
rendered
upload_ready
uploaded
published
archived

## Content Relationship

- parentLongId
- derivedShortIds[]
- relatedContentIds[]
- sourceType: independent | derived
