# Motion System v1.0

## Preset

- FADE_UP
- SCALE_IN
- SLIDE_IN
- STAGGER
- SLOW_ZOOM
- PAN
- FREEZE_FOCUS
- CUT

## Transition

- CUT
- FADE
- PUSH
- MATCH

## Intensity

- subtle
- normal
- strong

기본값: normal

## 핵심 원칙

- Scene Type마다 기본 Motion이 있다.
- JSON에 Motion이 없어도 Scene이 완성되어야 한다.
- 랜덤 Motion 금지.
- 전체 Scene 전환의 70~80%는 CUT을 기본 가정.
- 이미지 Zoom/Pan은 미세하게.
- 강한 Motion은 HOOK/KEYWORD/CONCEPT 등 제한된 장면에서만 사용.
- Anime Clip → Freeze → Analysis를 대표 시그니처 패턴으로 사용 가능.

## 권장 시각 변화 빈도

Discovery Long-form:
약 3~7초마다 의미 있는 시각 변화.
Scene 전환뿐 아니라 Scene 내부 변화도 포함.
