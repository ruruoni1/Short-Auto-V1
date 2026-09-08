# Asset System v1.0

## Asset Types

- anime_clip
- drama_clip
- image
- illustration
- video
- screenshot
- graphic
- audio

## Status

- ready
- required
- missing
- rejected

## Role

- primary
- background
- reference
- overlay
- decorative

## Visual Strategy

- none
- asset
- generated_graphic
- text_only
- auto

## 기본 구조

```json
{
  "anime01": {
    "type": "anime_clip",
    "status": "ready",
    "src": "assets/anime/clip01.mp4",
    "metadata": {
      "title": "작품명",
      "episode": "3화",
      "expression": "키사마"
    }
  }
}
```

## AI 생성 Asset

```json
{
  "ill01": {
    "type": "illustration",
    "status": "required",
    "generation": {
      "description": "친구 두 명이 자연스럽게 대화하는 일본 일상 상황",
      "aspectRatio": "16:9"
    }
  }
}
```

## Resolver 우선순위

1. 기존 지정 Asset
2. generated_graphic
3. text_only
4. 새 Asset 생성/수집

## Placeholder

Asset이 없어도 Preview는 가능해야 한다.
Missing/Required Asset은 Placeholder로 표시한다.

## 폴더

projects/NZ001/assets/
- anime
- drama
- images
- illustrations
- video
- screenshots
- graphics
- audio
