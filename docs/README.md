# NIHON ZUPZUP — Codex Docs Pack for Short-auto (2026-09-09)

## 고정 프로젝트 경로

- 프로젝트 루트: `D:\\coding\\Short-auto`
- 활성 문서: `D:\\coding\\Short-auto\\docs`
- 구버전 보관: `D:\\coding\\Short-auto\\docs\\archive`

Codex는 `docs` 루트의 최신 기준 문서만 활성 규칙으로 취급한다. 구버전/중복 MD는 `docs\archive`로 이동하고 자동 문서 로더·프롬프트 인덱스에서 제외한다.

가장 먼저 읽을 파일:
`NIHON_ZUPZUP_CODEX_MIGRATION_v3_2026-09-09.md`

## 현재 핵심 구현 기준

1. 공식 YouTube 클립: YouTube Data API + 로컬 DB + SELECTED 이후 yt-dlp
2. 썸네일: 무텍스트 베이스 이미지 + 편집 가능한 텍스트 레이어
3. 애니 콘텐츠: 특정 작품/캐릭터가 훅이면 공식 클립 프레임을 우선 썸네일 후보로 사용
4. TTS: 로컬 설치된 VOICEVOX Engine 사용
5. VOICEVOX 화자/스타일은 하드코딩하지 않고 실행 시 `/speakers`에서 조회
6. 사용자가 화자/스타일을 선택하면 style ID와 합성 설정을 프로젝트 설정에 저장

## 포함 파일

- `NIHON_ZUPZUP_CODEX_MIGRATION_v3_2026-09-09.md`
- `nihon_zupzup_channel_plan_v1.4_2026-09-09.md`
- `nihon_zupzup_channel_settings_and_operation_v1.3_FINAL_2026-09-09.md`
- `nihon_zupzup_official_youtube_clip_source_rules_v1.1_FINAL_2026-09-09.md`
- `nihon_zupzup_anime_drama_quote_research_rules_v2.1_FINAL_2026-09-09.md`
- `nihon_zupzup_anime_speech_series_rules_v1.2_FINAL_2026-09-09.md`
- `nihon_zupzup_longform_thumbnail_rules_v1.4_FINAL_2026-09-09.md`
- `nihon_zupzup_shorts_thumbnail_rules_v1.1_FINAL_2026-09-09.md`
- `nihon_zupzup_thumbnail_editor_and_generation_rules_v1.0_FINAL_2026-09-09.md`
- `nihon_zupzup_tts_script_rules_v1.1_FINAL_2026-09-09.md`
- `nihon_zupzup_voicevox_integration_rules_v1.0_FINAL_2026-09-09.md`
- `vidiq_2026_youtube_thumbnail_research.md`

## 보안/제외

- API 키·토큰·쿠키·개인 인증 파일은 `docs`에 넣지 않는다.
- Nadeshiko API 키 파일은 코드 저장소/문서 팩에서 제외한다.
- VOICEVOX 연결은 기본 `127.0.0.1` 로컬 엔진만 사용하며 외부 공개 포트를 전제로 하지 않는다.

## 기존 썸네일 샘플 해석

기존 PNG 샘플은 시각/구도 참고 자료다. 이미지 안에 텍스트가 있더라도 새 구현에서 AI가 그 텍스트를 렌더링하라는 의미가 아니다. 문구는 Thumbnail Studio의 텍스트 레이어로 재구성한다.
