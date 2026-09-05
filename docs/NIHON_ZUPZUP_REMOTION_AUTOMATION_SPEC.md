# 니혼줍줍 Studio 개발 통합 명세 v1.1

작성일: 2026-09-04  
대상: Codex 멀티쓰레드 개발  
상태: 구현 착수 기준본

## 1. 제품 정의

초기 제품명(가칭): **니혼줍줍 Studio**

v1의 목표는 단순 영상 자동 생성기가 아니라,
니혼줍줍의 실제 운영 계획을 프로그램 안에서 관리하는 전용 도구를 만드는 것이다.

전체 흐름:

콘텐츠 플랜
→ 콘텐츠 기획
→ 대본/TTS/SRT/Asset 준비
→ 자동 영상 제작
→ Review Editor 검수
→ 최종 렌더
→ Long-form 파생 Shorts 생성
→ YouTube 업로드
→ 성과 데이터 관리
→ 다음 콘텐츠 플랜

## 2. 장기 구조

v1은 니혼줍줍 전용으로 구현한다.
하지만 Core는 특정 채널에 종속되지 않도록 설계한다.

구조:

Generic Video Automation Core
+ Channel Pack
+ Content Profile

초기 Channel Pack:
`nihon_zupzup`

향후 다른 주제/채널의 Pack을 추가할 수 있어야 한다.

## 3. 기술 스택

- Node.js
- TypeScript
- React
- Remotion
- Electron
- JSON 기반 프로젝트 데이터
- GitHub Actions
- GitHub Releases
- 자동 업데이트

Windows 11 우선 개발.
macOS/Linux 호환 구조 유지.

## 4. 니혼줍줍 지원 콘텐츠 체계

### 운영 축
- 애니 줍줍
- 일드 줍줍
- 실전 줍줍
- 영어 줍줍
- 사투리 줍줍
- 한본어/트렌드 줍줍

### 제작 포맷
- discovery_long
- training_long
- discovery_short
- learning_short

### Content Profile 예
- anime_analysis
- drama_analysis
- practical_explainer
- wasei_eigo
- dialect
- trend
- shadowing_training
- repetition_training
- phrase_learning_short
- anime_discovery_short

## 5. 콘텐츠 운영

Content Manager가 다음을 관리한다.

- 8주 콘텐츠 플랜
- 주간 편성
- 제작 상태
- 업로드 예정일
- Long/Shorts 연결 관계
- 독립 Shorts / 파생 Shorts 구분
- 2주치 선제 제작 상태
- 4주 리뷰
- 8주 전략 조정

## 6. 영상 제작 Pipeline

제작 대본
+ TTS
+ SRT
+ Assets
→ Auto Scene Planner
→ production.json
→ Caption / Timeline / Asset / Motion
→ Remotion Live Preview
→ Review Editor
→ overrides.json
→ 승인
→ Final Render

## 7. Long-form → Shorts

Long-form 완성 프로젝트에서
Shorts 후보를 자동 탐색하여 별도 Short 프로젝트를 만든다.

단순 Crop 재사용이 아니라:
- 독립 가능한 핵심 구간 탐색
- Hook 재구성
- 9:16 Scene 재배치
- Shorts Content Profile 적용
- Review
- Final Render

운영 계획 기본값:
Long-form 1편에서 관련 Shorts 2편 파생 가능 구조.

## 8. YouTube Publishing

프로그램 내부에서 다음을 관리한다.

- 영상 선택
- 제목
- 설명
- 태그/해시태그
- 썸네일
- 재생목록
- 공개 상태
- 예약 업로드
- 업로드 상태
- YouTube video ID
- 업로드 결과 기록

실제 API 인증 정보는 코드/저장소에 포함하지 않는다.

## 9. Analytics / Strategy

향후 YouTube 성과 데이터를 콘텐츠 레코드와 연결한다.

예:
- views
- likes
- comments
- averageViewDuration
- averageViewPercentage
- subscribers gained/lost
- 필요 시 추가 성과 지표

목표:
성과 → 4주 리뷰 → 다음 콘텐츠 후보/전략으로 연결.

## 10. Scene System

일반 Scene Type:
- HOOK
- KEYWORD
- QUESTION
- COMPARE
- EXPLAIN
- QUOTE_ANALYSIS
- RELATION
- CONCEPT
- RECAP

Content Profile에 따라 허용/권장 Scene 조합을 달리한다.

ANIME_CLIP / DRAMA_CLIP / PAUSE는 Insert.

## 11. Timeline

Source Timeline(TTS/SRT)은 불변.
Output Timeline은 Insert/Pause를 반영한다.

시간 저장 단위: millisecond.
Remotion 렌더 시 frame 변환.

## 12. Review Editor

자동 생성 직후 최종 렌더하지 않는다.

지원:
- Caption 위치/크기/줄바꿈
- Main Text 위치/크기
- Visual 위치/Scale
- Asset 교체
- Caption Mode
- Motion 조정
- Scene/Insert 타이밍 미세 수정
- Undo/Redo
- Reset
- Auto Save

사용자 수정은 overrides.json에 저장.

## 13. 프로젝트 상태

예:
- idea
- planned
- script_ready
- media_ready
- auto_generated
- reviewing
- approved
- rendered
- upload_ready
- uploaded
- published
- archived

## 14. Codex 쓰레드

- 00_Master
- 01_Core
- 02_Caption
- 03_Timeline
- 04_Scene
- 05_Asset
- 06_Theme_Motion
- 07_AutoPlanner
- 08_ReviewEditor
- 09_Content_Manager
- 10_YouTube
- 11_Desktop_Release
- 12_Integration

사용자는 기본적으로 00_Master와만 대화한다.

## 15. Master 책임

1. 모든 변경 요청 접수
2. 영향 범위 분석
3. 담당 쓰레드 선정
4. 작업 지시
5. 완료 확인
6. 회귀 테스트
7. 문서 갱신
8. CURRENT_STATUS 관리
9. DECISIONS / CHANGELOG 관리
10. 사용자에게 통합 결과 보고

## 16. 개발 우선순위

Phase 1: Core Video Engine
- Core
- Caption
- Timeline
- Scene
- Asset
- Theme/Motion

Phase 2: Planning + Production
- AutoPlanner
- ReviewEditor
- Content Manager
- Long→Shorts

Phase 3: Publishing
- YouTube
- Desktop/Release

Phase 4: Integration
- 실제 니혼줍줍 콘텐츠로 E2E 테스트

## 17. 첫 E2E 테스트

Long-form:
“애니 일본어를 현실에서 쓰면 왜 이상하게 들릴까?”

이 Long-form을 생성/검수/렌더한 뒤
파생 Shorts 2편까지 만들어
업로드 준비 상태까지 연결하는 것을 첫 통합 목표로 한다.
