# Scene Types v1.0

## HOOK
초반 5~10초 관심 유도.
기본 Visual: text_only 또는 asset.
기본 Motion: SCALE_IN / CUT.

## KEYWORD
한 표현 집중.
예: 키사마 / 貴様.
한국어 독음 우선.
CaptionMode: hidden 또는 subtle.
기본 Motion: SCALE_IN.

## QUESTION
질문 하나만 남긴다.
기본 Visual: text_only.
기본 Motion: FADE_UP.

## COMPARE
2~3개 표현 비교.
예: 오레 / 보쿠 / 와타시.
기본 Visual: generated_graphic.
기본 Motion: STAGGER.

## EXPLAIN
일반 설명. 가장 일반적인 기본 Scene.
애매하면 EXPLAIN을 선택한다.
기본 Motion: FADE_UP + 필요 시 SLOW_ZOOM.

## QUOTE_ANALYSIS
원작 대사 직후 핵심 단어 분석.
전체 대사보다 분석 대상 표현 중심.
기본 Motion: FREEZE_FOCUS.

## RELATION
관계에 따라 표현 의미/뉘앙스가 달라지는 설명.
기본 Visual: generated_graphic.
기본 Motion: STAGGER.

## CONCEPT
새 개념 공개.
예: 야쿠와리고 / 役割語.
남발 금지.
기본 Motion: SCALE_IN + FADE.

## RECAP
초반 질문과 핵심 표현 회수.
기본 Motion: FADE_UP 또는 STAGGER.

## 일반 규칙
- Scene은 문장 수가 아니라 의미 변화로 나눈다.
- 모든 Scene에 MAIN_TEXT를 만들지 않는다.
- 최대한 text_only / generated_graphic을 우선한다.
