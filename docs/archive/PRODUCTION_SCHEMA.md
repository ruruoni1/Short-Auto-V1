# production.json Schema v1.0

> 2026-09-05 Master 보충: 이 문서는 구조 예시다. 제작 status와 ContentRecord 운영 status는 별도다. project에 `channelPack`, `contentProfile` 참조를 포함한다. 구체적인 런타임 검증 계약은 최초 Core 구현에서 제공한다. 명세 해석은 `DECISIONS.md`의 2026-09-05 결정을 함께 따른다.

## 최상위 구조

```json
{
  "schemaVersion": "1.0",
  "project": {},
  "audio": {},
  "captions": {},
  "settings": {},
  "assets": {},
  "scenes": [],
  "inserts": [],
  "ending": {}
}
```

## project

```json
{
  "id": "NZ001",
  "title": "애니 일본어를 현실에서 쓰면 왜 이상할까?",
  "series": "애니 말투 줍줍",
  "contentType": "discovery_long",
  "language": "ko",
  "status": "draft"
}
```

status:
- draft
- auto_generated
- reviewing
- approved
- rendered

## audio

```json
{
  "tts": "audio/tts.wav",
  "volume": 1.0
}
```

## captions

```json
{
  "source": "audio/tts.srt",
  "parsed": "data/captions.json",
  "show": true
}
```

## settings

```json
{
  "fps": 30,
  "width": 1920,
  "height": 1080,
  "theme": "nihon-discovery-v1",
  "captionStyle": "default",
  "transitionStyle": "default"
}
```

## scenes

```json
{
  "id": "scene_001",
  "type": "EXPLAIN",
  "locked": false,
  "confidence": 0.94,
  "captionRange": {
    "start": 12,
    "end": 14
  },
  "captionMode": "normal",
  "content": {
    "mainText": "뜻보다 관계",
    "subText": null,
    "jpText": null,
    "emphasis": ["관계"]
  },
  "visual": {
    "strategy": "generated_graphic",
    "assetId": null
  },
  "motion": null
}
```

## inserts

```json
{
  "id": "insert_001",
  "type": "ANIME_CLIP",
  "anchor": {
    "type": "caption_after",
    "captionId": 8
  },
  "assetId": "anime01"
}
```

anchor type:
- caption_before
- caption_after
- source_time

## ending

```json
{
  "enabled": true,
  "durationMs": 15000,
  "type": "discovery_end",
  "message": "다음 일본어도 하나 더 줍고 가세요."
}
```
