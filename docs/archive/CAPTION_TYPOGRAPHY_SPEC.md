# Caption & Typography System v1.0

## 텍스트 계층

- CAPTION: TTS 전체 자막
- MAIN_TEXT: 장면 핵심 메시지
- JP_TEXT: 일본어 원문
- SOURCE_TEXT: 작품/화수/출처

## Caption Mode

- normal
- subtle
- hidden

## 기본 원칙

- Long-form Caption은 최대 2줄 기본
- 한국어/독음이 메인
- 일본어 원문은 보조
- Caption과 MAIN_TEXT는 같은 문장을 반복하지 않는다
- MAIN_TEXT는 보통 1~7어절
- 긴 SRT Cue는 필요 시 내부 표시 단위로 재분할
- 원본 SRT 자체는 수정하지 않는다

## Scene별 기본

HOOK: Caption 최소
KEYWORD: hidden/subtle
QUESTION: subtle 가능
COMPARE: subtle
EXPLAIN: normal
QUOTE_ANALYSIS: 상황에 따라
RELATION: normal
CONCEPT: subtle
RECAP: normal 또는 subtle

## 원작 Clip

TTS Caption은 표시하지 않는다.
필요 시 별도 CLIP_CAPTION을 사용한다.
SOURCE_TEXT로 작품명·화수 표시 가능.

## Font Role

- fontPrimaryKR
- fontPrimaryJP
- fontCaption
- fontNumber
