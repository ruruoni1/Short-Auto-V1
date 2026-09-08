# YouTube Publishing Spec v1.0

## 목적

니혼줍줍 Studio에서 최종 영상의 YouTube 업로드까지 연결한다.

## 관리 항목

- video file
- title
- description
- tags
- hashtags
- thumbnail
- playlist
- visibility
- scheduled publish datetime
- upload status
- YouTube video ID
- upload error/log

## Visibility

사용자가 선택할 수 있도록 한다.

- public
- unlisted
- private

예약 공개 설정도 지원 대상으로 둔다.

## Upload Workflow

rendered
→ upload_ready
→ metadata review
→ upload action
→ uploaded
→ published

## 안전 원칙

- OAuth token/API credential은 저장소에 포함하지 않는다.
- 로컬 안전 저장 또는 OS credential storage 사용을 고려한다.
- 업로드 직전 사용자가 메타데이터를 검수 가능해야 한다.
- 실패한 업로드는 재시도 가능해야 한다.

## 초기 범위

v1:
- 영상 업로드
- 썸네일 업로드
- 제목/설명/태그
- 공개 상태
- 예약 설정
- playlist 연결
- 결과 video ID 저장

후속:
- Analytics 자동 수집
- 업로드 후 상태 동기화
