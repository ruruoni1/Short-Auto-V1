# Official Clip Library 검증 기록

이 문서는 구현·검증 기록이며 활성 요구사항 허용 목록에 추가하지 않는다.

## 확인할 사용자 동작

- 채널 추가·수정·비활성화, 공식 확인·분류·우선순위 저장과 재시작 복원.
- 공식/활성 채널만 동기화, 중복 수집 방지, 실패 때 성공 기준점 보존.
- 클립 검색·필터·원본 열기·썸네일, 검수 내용 수정·보류·채택·제외.
- 명시 검수 확인 전 채택 차단, 오래된 수정 충돌, 채택 전 다운로드 차단.
- 다운로드 품질/자막 선택, 실패 후 채택 유지·재시도, 성공 파일 상대경로 연결.
- 빈 라이브러리, 키 없는 상태, 연결 오류에서 입력 보존과 안내 확인.
- 좁은 화면에서 조작 가능, 키보드 포커스·레이블·오류 안내 확인.

## 기술 근거

- [YouTube uploads playlist](https://developers.google.com/youtube/v3/docs/playlistItems/list)
- [YouTube video metadata](https://developers.google.com/youtube/v3/docs/videos/list)
- [yt-dlp 공식 옵션](https://github.com/yt-dlp/yt-dlp)
- [Node SQLite](https://nodejs.org/api/sqlite.html)

## 실행 상태

2026-09-13 전체 358개 자동 테스트와 TypeScript 빌드 통과. 저장소·커넥터·HTTP 통합 테스트는 14개이며, 실제 SQLite 영속성·충돌·채택 조건·동기화 기준점·다운로드 실패 및 경로 검증을 포함한다.

격리된 브라우저 테스트에서 명시 확인 전 채택 차단, 검수 입력 저장, 채택 후 다운로드 노출, 다운로드 실패 후 재시도 활성화, 공식 채널 추가와 비활성화를 확인했다. 390×844 모바일 화면에서 메뉴 줄바꿈 수정과 필터 배치를 재검증했다. 실제 API 동기화·사용자 채택 미디어 다운로드는 아직 검증하지 않았다.



2026-09-14 Master 검증: Git index의 B 전용 스냅샷을 temp/phase-b-check에 추출하여 TypeScript 검사와 전체 359개 테스트 통과. 썸네일·Caption 미완성 파일은 이 스냅샷에서 제외했다. 동기화 요청 형식/Origin/Host 오류 시 작업 생성 차단 회귀 검증을 추가했다.
