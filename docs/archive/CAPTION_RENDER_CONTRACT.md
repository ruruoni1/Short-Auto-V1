# Caption 표시 단위의 Preview 연결

## 범위

순수 `buildCaptionDisplay` 결과를 React/Remotion Preview에 연결한다. Core Caption, SourceTimeline, Timeline/Runtime 계약은 변경하지 않는다. 기존 13초 Scene Preview와 그 MP4는 보존하며 긴 자막 전용 fixture/출력명을 사용한다. 사용자 승인 Final Render 기능은 아니다.

## 명시 정책과 원문

`ScenePreviewProps.captionDisplayPolicy`와 `prepareScenePreview`의 선택 인자로 CaptionDisplayPolicy를 전달한다. 생략하면 기존 원본 cue/Override lines 표시 방식이 유지된다. 정책 숫자를 채널 기본값으로 자동 추가하지 않는다. 원본 grapheme 분할과 균등 Source 시간 배분은 기존 buildCaptionDisplay만 수행한다. Source 원문/시간/ID는 보존한다.

Source cue는 발화 원문이며 표시 unit은 그 cue의 일부다. 시점 조회는 Output 시간이 아닌 Runtime이 반환한 `sourceTimeMs`와 원본 caption ID를 기준으로 `[startMs,endMs)` 활성 unit을 선택한다. Insert/Pause에는 Caption이 없으며, TTS 재개 후 새 Source 시점의 unit을 선택한다. 원문 offset은 `origin: source` 결과에만 속한다.

Scene caption.lines가 명시된 경우 원문 분할보다 우선한다. 빈 배열은 표시를 비우는 명시 Override이며 원문 fallback을 하지 않는다. Override는 원문 offsets/부분 원문처럼 포장하지 않는다. 모든 출력은 React text children으로 전달하고 HTML/SRT 태그를 해석하지 않는다.

시간이 부족한 원문 분할은 CAPTION_DISPLAY_TOO_SHORT 오류로 남긴다. 표시 구간의 TTS→Output 투영에 프레임 표본이 하나도 없으면 렌더 단계에서 명시 진단한다. 내용 생략, 시간 확장, 분할 정책 완화, 원본 변경은 하지 않는다.

## 줄 수와 픽셀

정책을 사용한 표시 단위는 명시 줄 배열로 그린다. 줄 안에서 브라우저가 다시 wrap하지 않도록 하여 논리 maxLines를 유지한다. grapheme 제한이 픽셀 fit 보증은 아니다. 큰 글자/탭/emoji/폰트/Editor width 등에 따른 가로 overflow를 자동 축소하거나 자르지 않는다. 이번 fixture는 가로 24, 세로 12 grapheme/줄, 2줄/단위, 최소300ms를 **명시**하며 실제 추출 프레임으로 fit을 검수한다. 이 값은 제품 기본 정책이 아니다.

## 재현

```sh
npm ci
npm run render:assets
npm run caption:assets
npm run caption:preview
npm run caption:landscape
npm run caption:portrait
npm run caption:verify
```

`CaptionLongLandscape`와 `CaptionLongPortrait`는 1280×720 / 720×1280, 30fps, 585프레임(영상19.5초)이다. source18초 + 이미지Insert500ms + Pause500ms + ending500ms다. Sine 오디오는 로컬 합성 테스트음으로 음성이 아니다. 이미지 Insert는 이전에 직접 만든 synthetic/still.png를 읽기만 한다. 사용자 미디어/외부 API를 사용하지 않는다.

출력: `dist/render/caption-long-landscape.mp4`, `caption-long-portrait.mp4`. 기존 `scene-preview-*.mp4`는 출력 대상으로 사용하지 않는다. `caption:verify`는 전체 decode, probe, 모든 원문 표시 unit의 중간 프레임과 stop/Override/ending 표본을 추출한다. 증거는 `dist/render/caption-long/verification.json`, 방향별 probe/PNG, contact sheet다. 추출 자체와 사람의 시각 확인은 별도로 기록한다.

## 인수 기록

구현/테스트 에이전트의 실제 API 및 최종 실행 결과를 아래에 기록한다.
