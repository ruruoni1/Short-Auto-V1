# Content Profiles Spec v1.0

## 목적

영상 엔진과 니혼줍줍 콘텐츠 문법을 분리한다.

`channelPack + contentType + contentProfile` 조합으로
같은 Core Engine에서 서로 다른 콘텐츠를 제작한다.

## channelPack

초기:
`nihon_zupzup`

## contentType

- discovery_long
- training_long
- discovery_short
- learning_short

## 초기 contentProfile

### Discovery Long
- anime_analysis
- drama_analysis
- practical_explainer
- wasei_eigo
- dialect
- trend

### Training Long
- shadowing_training
- repetition_training
- practical_dialogue_training

### Discovery Shorts
- anime_discovery_short
- drama_discovery_short
- dialect_discovery_short
- trend_discovery_short
- wasei_discovery_short

### Learning Shorts
- phrase_learning_short
- vocabulary_learning_short
- pronunciation_learning_short

## Profile 정의 항목

각 Profile은 다음을 가질 수 있다.

- allowedSceneTypes
- preferredSceneSequence
- captionPolicy
- typographyPreset
- motionPreset
- visualPolicy
- insertPolicy
- durationTarget
- hookPolicy
- endingPolicy
- derivativePolicy

## 핵심 원칙

니혼줍줍 전용 규칙을 Core Component에 직접 하드코딩하지 않는다.
