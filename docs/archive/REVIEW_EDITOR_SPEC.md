# Review Editor / Override Layer v1.0

## 목표

자동 생성 결과를 최종 렌더 전에 사용자가 직접 검수하고 간단히 수정한다.

## 전체 흐름

Auto Generate
→ Remotion Live Preview
→ Review Editor
→ overrides.json
→ approved
→ Final Render

## 수정 가능 항목

- Caption 위치
- Caption 크기
- Caption 폭
- 줄바꿈
- Caption Mode
- MAIN_TEXT 위치/크기
- Visual 위치/Scale
- Asset 교체
- Scene Type
- 일부 Motion
- Scene 타이밍 미세 조정
- Insert Trim

## Override 분리

production.json = 자동화 결과
overrides.json = 사용자 수정

예:
```json
{
  "global": {
    "captionOffsetY": -30
  },
  "scene_014": {
    "caption": {
      "offsetY": -55
    },
    "visual": {
      "scale": 1.12
    }
  }
}
```

## 필수 UI

- Remotion Player
- Scene 목록 또는 단순 Timeline
- Scene Inspector
- Caption Inspector
- Asset Selector
- Approval 버튼

## 필수 UX

- Drag reposition
- Scale 조정
- Auto Save
- Undo
- Redo
- Reset Element
- Reset Scene
- Reset All Overrides

## 상태

- auto_generated
- reviewing
- approved
- rendered

Final Render는 approved 프로젝트를 기본 대상으로 한다.
