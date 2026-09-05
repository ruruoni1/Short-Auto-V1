# Desktop / GitHub / Auto Update Spec v1.0

## 목표

- Windows 11 우선
- 크로스플랫폼 호환 구조 유지
- GitHub 공개
- GitHub Releases 기반 자동 업데이트
- 향후 macOS/Linux 확장 가능

## Desktop

Electron 기반 데스크톱 앱.

주요 구성:
- React UI
- Remotion Player
- Local Workspace
- File system
- Render controller
- Update controller

## 경로 원칙

Windows 절대 경로 하드코딩 금지.
Node path + 프로젝트 상대 경로 사용.

## Workspace

앱 설치 폴더와 사용자 프로젝트 데이터 분리.

예:
Documents/NihonZupZupStudio/
- projects
- presets
- cache
- exports

앱 업데이트로 Workspace를 삭제/덮어쓰면 안 된다.

## GitHub 공개 저장소

필수 후보:
- README.md
- LICENSE
- CONTRIBUTING.md
- CHANGELOG.md
- SECURITY.md
- docs/

저장소 금지:
- API Key
- 토큰
- 비밀번호
- 저작권 있는 애니 원본
- 사용자 비공개 프로젝트/영상

## 자동 업데이트

GitHub Releases를 배포 채널로 사용.
앱 실행 시 업데이트 확인 가능.
권장 UX:
- 새 버전 알림
- 변경사항 표시
- 지금 업데이트
- 나중에
- 자동 다운로드 옵션

채널 확장:
- Stable
- Beta

## CI/CD

버전 태그
→ GitHub Actions
→ Windows build
→ Installer
→ GitHub Release
→ Update metadata
→ 기존 앱에서 감지

## 초기 배포 우선순위

1. Windows installer
2. Stable update
3. GitHub Actions
4. Beta channel
5. macOS/Linux 빌드
