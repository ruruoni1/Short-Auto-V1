# Timeline Engine v1.0

## 1. 두 시간축

### Source Timeline
TTS/SRT 원본 시간.

### Output Timeline
Insert와 Pause가 반영된 최종 영상 시간.

공식:
Output Time = Source Time + 이전 Insert/Pause 총 Duration

`overlay`는 위 Duration 합산에서 제외한다. `source_time`을 사용하는 정지 Insert/Pause도 Caption 중간에 배치하지 않는다. 사용자 타이밍 수정은 원본 Source가 아닌 Override/Output에 적용한다.

## 2. 기본 원칙

- 원본 SRT 시간은 수정하지 않는다.
- TTS 파일은 물리적으로 여러 조각으로 자르지 않는다.
- 내부 시간은 millisecond.
- Remotion 렌더 직전에 frame 변환.
- Pause Insert는 Caption 경계에서만 허용하는 것을 기본으로 한다.

## 3. Timing Mode

- overlay: TTS 계속
- insert: TTS 정지 + 외부 미디어
- pause: TTS 정지 + 정적 연출/여백

## 4. resolved-timeline.json

production.json + captions.json + asset duration
→ Timeline Resolver
→ resolved-timeline.json

예:
```json
{
  "durationMs": 328400,
  "segments": [
    {
      "type": "tts",
      "sourceStartMs": 0,
      "sourceEndMs": 32200,
      "outputStartMs": 0,
      "outputEndMs": 32200
    },
    {
      "type": "insert",
      "insertId": "anime_001",
      "outputStartMs": 32200,
      "outputEndMs": 35400
    }
  ]
}
```

## 5. Validator

ERROR:
- 없는 Caption ID
- 없는 Asset
- Caption 중간 Insert
- 음수 Duration
- 잘못된 Anchor

WARNING:
- Scene 범위 중첩
- 미할당 TTS 구간
- 과도한 Insert
