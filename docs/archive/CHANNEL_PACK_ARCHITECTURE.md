# Channel Pack Architecture v1.0

## 목표

v1은 니혼줍줍 전용이지만
향후 다른 채널/주제로 파생 가능한 구조를 유지한다.

## 구조 예

channel-packs/
  nihon-zupzup/
    pack.json
    content-profiles/
    themes/
    publishing-rules/
    schedule-rules/
    analytics-rules/
    strategy-rules/

## Generic Core가 담당

- Timeline
- Caption parsing
- Asset Registry
- Scene runtime
- Motion runtime
- Review Editor
- Render
- Project storage
- Publishing interface
- Analytics interface

## Channel Pack이 담당

- 콘텐츠 종류
- Scene 추천 규칙
- 채널별 디자인
- 업로드 기본값
- 일정 규칙
- 파생 Shorts 규칙
- 콘텐츠 전략 규칙

## 금지

- Core 내부에 `nihon_zupzup` 전용 조건문 남발
- 특정 일본어 표현이나 시리즈명을 Core에 직접 삽입
