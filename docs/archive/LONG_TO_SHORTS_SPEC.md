# Long-form → Shorts Derivation Spec v1.0

## 목적

니혼줍줍 운영 계획의
Long-form → 관련 Shorts 파생 전략을 자동화한다.

## 입력

- Long-form production.json
- resolved-timeline.json
- script
- captions
- assets
- completed review overrides

## 처리

1. Candidate Detection
2. Candidate Scoring
3. Shorts Type 선택
4. Hook Rebuild
5. Content Reframe
6. 9:16 Layout Adaptation
7. Asset Reuse / Replacement
8. Shorts Project 생성
9. Review
10. Render

## Candidate 기준

- 한 표현으로 독립 가능
- 질문/반전이 명확
- 15~35초 안에 이해 가능
- Long-form 핵심을 전부 소모하지 않음
- 관련 Long-form으로 유입할 여지 있음

## 기본 목표

Long-form 1편당:
- 파생 Shorts 2편 후보 생성
- 필요 시 후보 3~5개 제안 후 상위 2개 선택

## 금지

완성 Long-form 영상을 단순 9:16 Crop만 해서 끝내지 않는다.

## 관계 데이터

Short project는 반드시:
- sourceLongProjectId
- derivativeIndex
- derivativeReason
를 보관한다.
