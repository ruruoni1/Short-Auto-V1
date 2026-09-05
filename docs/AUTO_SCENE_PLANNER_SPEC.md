# Auto Scene Planner v1.0

## 입력

- 제작용 대본
- TTS SRT
- Asset Registry

## 처리 Pass

1. Alignment
2. Segmentation
3. Classification
4. Direction

## Scene 판정

우선순위:
HOOK
→ CONCEPT
→ COMPARE
→ RELATION
→ QUOTE_ANALYSIS
→ KEYWORD
→ QUESTION
→ RECAP
→ EXPLAIN

단:
- HOOK은 초반에서만 활성
- RECAP은 후반에서 가중치 증가
- 애매하면 EXPLAIN

## Main Text

- TTS 전체 문장 복사 금지
- 1~7어절 권장
- 접속사/군더더기 제거
- 핵심 명사/반전/질문 중심
- 필요 없으면 null

## Visual Strategy 기본

KEYWORD: text_only
QUESTION: text_only
COMPARE: generated_graphic
RELATION: generated_graphic
CONCEPT: text_only
QUOTE_ANALYSIS: generated_graphic 또는 이전 Frame
EXPLAIN: auto
RECAP: generated_graphic

## Confidence

각 Scene은 confidence를 기록한다.
낮은 confidence는 Review 대상.

## 금지

- 대본 내용 변경
- 없는 일본어 정보 추가
- 없는 작품/대사/Asset 생성
- 모든 Scene에 Main Text 생성
- 모든 Scene에 이미지 생성
- 랜덤 Motion 지정
- SRT 원본 시간 변경

## Human Override

- locked=true Scene은 Planner 재실행 시 유지
- Scene별 재생성 가능 구조 권장
