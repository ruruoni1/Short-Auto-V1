# 니혼줍줍 썸네일 생성·텍스트 오버레이 에디터 구현 지침 v1.0 FINAL

작성일: 2026-09-09  
적용 대상: 니혼줍줍 관리 프로그램의 썸네일 생성/편집 모듈  
상태: Codex 구현 기준본

---

# 1. 목적

기존의 `AI가 이미지와 문구를 한 번에 렌더링`하는 방식을 폐기한다.

새 구조:

> **Base Image + Editable Text Layers + Final Render**

Canva/미리캔버스처럼 이미지 위에 텍스트를 별도 객체로 배치·편집하고, 결과만 합성 출력한다.

---

# 2. 핵심 원칙

1. AI 이미지 생성은 기본적으로 **무텍스트**다.
2. 텍스트는 항상 별도 레이어다.
3. 텍스트, 위치, 스타일은 프로젝트 저장 후 다시 수정할 수 있어야 한다.
4. 채널별 템플릿과 공용 에디터 엔진을 분리한다.
5. 니혼줍줍 전용으로 시작하지만 데이터 구조는 추후 범용 채널을 지원해야 한다.
6. 폰트는 라이선스가 명확한 허용 목록(registry)에서 기본 선택한다.

---

# 3. 캔버스

초기 프리셋:
- YouTube Long-form: 1280 × 720 (16:9)
- YouTube Shorts thumbnail/project: 1080 × 1920 (9:16)

기능:
- 줌 인/아웃
- Fit to screen
- 그리드/스냅
- 안전영역 표시 ON/OFF
- Undo/Redo
- 객체 선택/다중 선택(후순위 가능)

---

# 4. 베이스 이미지

소스 유형:
- AI_GENERATED
- OFFICIAL_CLIP_FRAME
- USER_IMAGE
- RECREATED_IMAGE

AI 생성 시 기본 Negative/Constraint:
- no text
- no letters
- no typography
- no logo
- no watermark
- leave intentional negative space for later text overlay

이미지 조정:
- crop
- scale
- position
- optional blur/dim
- brightness/contrast 정도의 최소 조정

---

# 5. 애니·일드 이미지 연계

`OFFICIAL_CLIP_FRAME`은 공식 클립 라이브러리의 SELECTED/DOWNLOADED 항목과 연결할 수 있다.

필수 참조:
- source_clip_id
- youtube_video_id
- source_channel_id
- frame_timestamp
- work_title
- episode
- source_url
- rights_review_status

사용자가 클립에서 원하는 프레임을 선택해 베이스 이미지 후보로 등록할 수 있게 한다.

자동으로 모든 클립에서 프레임을 대량 추출하지 않는다. 후보/선택된 클립에 대해 수행한다.

---

# 6. 텍스트 레이어 모델

권장 스키마:

```json
{
  "id": "text_001",
  "type": "text",
  "text": "만숀이 아파트라고?",
  "x": 96,
  "y": 120,
  "width": 560,
  "height": 220,
  "rotation": 0,
  "font_family": "Pretendard",
  "font_weight": 800,
  "font_size": 88,
  "color": "#FFFFFF",
  "align": "left",
  "letter_spacing": 0,
  "line_height": 1.05,
  "stroke_color": "#111111",
  "stroke_width": 4,
  "shadow": {"enabled": true, "x": 2, "y": 3, "blur": 6, "opacity": 0.35},
  "locked": false,
  "visible": true
}
```

초기 기능:
- Add/Delete text
- 직접 입력
- 드래그 이동
- 핸들 리사이즈
- 폰트/굵기/크기
- 텍스트 색상
- 좌/중/우 정렬
- 외곽선
- 그림자
- 자간/행간
- 레이어 순서
- Lock/Hide

후순위:
- 곡선 텍스트
- 워프
- 고급 블렌딩
- 복잡한 효과

---

# 7. 템플릿

초기 니혼줍줍 템플릿:
- Discovery Long
- Training Long
- Shorts Discovery
- Shorts Learning

템플릿 저장 대상:
- 캔버스 규격
- 텍스트 박스 기본 위치
- 텍스트 스타일 토큰
- 안전영역
- 베이스 이미지 권장 영역
- 이미지/텍스트의 좌우 배치 규칙

템플릿은 실제 문구를 강제하지 않는다.

---

# 8. 폰트 레지스트리

`fonts_registry.json` 등의 형태로 관리한다.

예:

```json
{
  "family": "Pretendard",
  "version": "pinned-version",
  "languages": ["ko", "ja", "latin"],
  "license_id": "OFL-1.1",
  "source_url": "official-source",
  "license_text_path": "licenses/Pretendard-OFL.txt",
  "bundled": true
}
```

초기 후보:
- Pretendard
- Noto Sans KR
- Noto Sans JP
- Noto Serif KR
- Noto Serif JP
- IBM Plex Sans KR
- IBM Plex Sans JP

규칙:
- 번들 전에 공식 라이선스를 다시 확인하고 버전을 고정한다.
- 라이선스 전문/고지를 앱 배포본과 저장소에 포함한다.
- 라이선스 미확인 폰트는 기본 제공하지 않는다.
- 폰트 파일을 사용자 결과물과 별도 다운로드 파일로 노출하지 않는다.

---

# 9. 프로젝트 파일

권장 스키마 상위 구조:

```json
{
  "schema_version": 1,
  "project_id": "...",
  "channel_profile": "nihon_zupzup",
  "template_id": "discovery_long_v1",
  "canvas": {"width":1280,"height":720},
  "base_image": {...},
  "layers": [...],
  "source_refs": [...],
  "created_at": "...",
  "updated_at": "..."
}
```

저장 파일:

```text
thumbnail_project/
├─ project.json
├─ assets/
│  └─ base_image.png
└─ exports/
   └─ final_thumbnail.jpg
```

---

# 10. 렌더링

최종 출력:
- PNG
- JPG

렌더링 결과는 화면 미리보기와 최대한 동일해야 한다.

필수 테스트:
- 한글
- 일본어
- 혼합 문자열
- 줄바꿈
- 외곽선
- 그림자
- 폰트 fallback
- Windows 환경

---

# 11. A/B 변형

프로젝트를 복제하여:
- 문구만 변경
- 베이스 이미지만 변경
- 레이아웃만 변경

가능해야 한다.

A/B variant는 원본 프로젝트 ID를 참조한다.

---

# 12. MVP 구현 우선순위

## Phase 1
- 캔버스
- 이미지 1개
- 텍스트 레이어 여러 개
- 드래그/리사이즈
- 폰트/크기/색/외곽선
- 저장/불러오기
- PNG/JPG export
- 4개 니혼줍줍 템플릿

## Phase 2
- 공식 클립 프레임 선택 연계
- 그림자/자간/행간/스냅
- A/B variant
- 안전영역

## Phase 3
- 범용 채널 프로필
- 사용자 템플릿
- 추가 이미지/도형 레이어
- 고급 타이포 기능

---

# 13. 금지/비목표

- AI에게 썸네일 문구까지 이미지로 그리게 하는 것을 기본 플로우로 만들지 않는다.
- 폰트 라이선스를 확인하지 않고 앱에 번들하지 않는다.
- 애니 공식 클립 프레임을 `권리 문제 없음`으로 자동 판정하지 않는다.
- 미리캔버스/Canva 전체 기능을 처음부터 복제하려 하지 않는다. MVP는 썸네일 제작에 필요한 핵심 편집 기능에 집중한다.

---

# 14. 한 줄 결론

**니혼줍줍 썸네일 모듈은 AI가 무텍스트 베이스 이미지를 만들고, 사용자가 별도 텍스트 레이어를 Canva처럼 편집하며, 공식 애니·일드 클립의 검토된 프레임도 베이스 이미지로 연결할 수 있는 재편집 가능한 레이어 기반 시스템으로 구현한다.**
