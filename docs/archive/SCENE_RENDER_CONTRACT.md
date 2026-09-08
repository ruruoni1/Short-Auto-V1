# Scene React/Remotion Preview 계약 — 최초 렌더 연결

## 범위와 진입점

`src/render/`는 기존 순수 Core를 소비하는 별도 React/Remotion Preview 모듈이다. `@short-auto/core`의 export graph에는 React/Remotion import를 추가하지 않았다. 선택 진입점 `@short-auto/core/render`는 `ScenePreview`, `prepareScenePreview`, `SceneRenderError`, frame 변환 함수, 9개 최소 Scene 컴포넌트와 관련 타입을 export한다. `register.tsx`의 Studio 등록은 별도이며 공개 모듈 import만으로 registerRoot를 실행하지 않는다.

`prepareScenePreview(input, pack)`은 resolveTimeline → createThemedSceneRuntime/resolveTheme → resolveAssets를 실제 호출한다. 유효한 Timeline/Theme/Asset 선택 계획만 반환하고 오류는 diagnostics를 가진 SceneRenderError로 throw한다. Asset의 미해결 status는 Preview placeholder로 유지하며 finalAssetReadiness를 승격하지 않는다. Pack, Source, Production/Overrides 원본을 수정하지 않는다.

이 API는 Preview/test 전용이다. 승인 생성, status 변경, checkFinalRenderReadiness 우회, 실제 사용자 Final Render 명령을 제공하지 않는다. 테스트 fixture의 draft 상태와 missing Asset은 의도적인 Preview 검증 데이터다. 사용자 최종 제작에는 기존 승인/revision/Workspace 준비 판정 및 실제 Asset 검증을 포함한 별도 경로가 필요하다.

## 실행과 합성 자료

프로젝트 루트에서 Node.js 22+, npm, PATH의 FFmpeg/FFprobe가 필요하다.

```sh
npm ci
npm run render:assets
npm run preview
npm run render:fixture
npm run render:portrait
npm run render:verify
```

- Studio는 콘솔에 출력된 실제 URL을 연다. 기본 예: `http://localhost:3000/ScenePreviewLandscape`, 세로형은 `/ScenePreviewPortrait`다. 다른 서버가 포트를 사용하면 출력된 URL이 기준이다.
- Composition: ScenePreviewLandscape(1280×720), ScenePreviewPortrait(720×1280), 30fps, 390프레임, 영상 13초.
- `remotion.config.ts`의 webpack extensionAlias가 NodeNext `.js` import를 `.ts/.tsx/.js`로 해석한다. Core import 이름/ESM 정책을 변경하지 않는다.
- React/React DOM 19.2.0, Remotion/CLI/media 4.0.521을 lockfile에 고정한다. 최초 렌더 시 Remotion이 공식 Chrome Headless Shell을 받을 수 있다. 자산 생성/렌더 자체는 외부 API를 호출하지 않는다.
- `src/render/fixture/data.ts`는 9종 Scene, 각 Scene의 sparse ID cue 2개, 비디오 Insert, 이미지 Insert, Pause, 동시 Overlay, missing Asset, ending을 생성한다. QUOTE_ANALYSIS는 FREEZE_FOCUS 대신 지원 CUT을 **fixture 원본에 명시**한다.
- `generate.ts`는 FFmpeg 색면/도형/색상 변화로 만든 로컬 MP4/PNG와 sine WAV를 `remotion/public/synthetic/`에 생성한다. TTS 파일은 음성 합성이 아니라 재생/정지/trim 검증용 신호다. 외부 작품, 사용자 미디어, API 키, 다운로드 자산이 없다. PROVENANCE.txt에 기록한다.
- generator는 이미 있는 파일을 덮어쓰지 않는다. fixture 생성 로직 수정 후 재생성이 필요하면 해당 합성 파일만 수동으로 처리한다. 기존 사용자 프로젝트는 건드리지 않는다.
- 생성 public 파일은 `remotion/.gitignore`, 렌더/검증 산출물은 기존 dist ignore 아래에 둔다. 소스와 생성 스크립트로 재현한다.

## 시간과 frame 정책

모든 Scene/Caption 조회는 `floor(frame * 1000 / fps)` 정수 ms로 기존 Runtime.getState에 전달한다. Source 시간/원본 cue는 바꾸지 않는다. Output `[a,b)` 구간의 프레임은 `[ceil(a*fps/1000), ceil(b*fps/1000))`이다. 같은 경계의 Sequence는 빈틈/중복 없이 이어진다. 프레임에 포착되지 않는 1프레임 미만 구간은 빈 Sequence로 생략될 수 있다. 길이는 전체 Timeline duration의 ceil로 구한다. 음수/소수 frame, 안전 범위 밖 값, 비정상 fps/역전 구간은 오류다. 24/30/60/29.97fps 산술을 테스트했으며 실제 MP4 QA는 30fps다.

TTS는 각 Timeline tts 구간별 Audio+Sequence로 배치한다. 미디어 trimBefore는 `floor(sourceStartMs * fps / 1000)` 프레임이다. Insert trim도 Override > 원본의 start를 같은 규칙으로 변환한다. 임의 ms 경계에는 구간 시작 양자화와 미디어 trim 양자화로 최대 약 2프레임의 Source 샘플 차이가 생길 수 있다. 샘플 단위 오디오 절단/정밀 resampling은 후속이다. fixture 경계/trim은 모두 30fps 그리드에 일치한다.

정지 Insert/Pause에는 TTS Audio Sequence가 없고 Runtime Caption/Scene도 없다. 재개 후 Motion은 Output elapsed가 아닌 `samplePlannedSceneMotion(plan, state.sourceTimeMs)`를 사용한다. Scene 안 cue 경계에 둔 Pause 뒤에도 SLOW_ZOOM이 처음부터 재시작하거나 정지 시간만큼 진행하지 않는다. Source 무음에서는 Runtime 정책대로 Scene 범위 안 Motion이 진행한다.

영상 트랙은 390/30=13초이며 AAC 패딩으로 MP4 format duration은 13.056초일 수 있다. 검증기는 비디오 프레임/트랙 길이와 컨테이너 길이를 구분한다. 이를 사용자 콘텐츠의 TTS 길이 측정으로 해석하지 않는다.

## 화면, Caption, Asset

논리 배치는 가로 640×360, 세로 360×640을 출력 크기로 균등 확대한다. Main 영역에는 하단 Caption 공간을 남긴다. 한글은 keep-all 줄바꿈, JP_TEXT는 별도 fontPrimaryJP, Caption은 fontCaption을 사용한다. 임시 Theme font/color를 실제 선택하고, 없는 named color에는 Preview용 중립값을 사용한다. 폰트 파일을 배포하거나 최종 브랜드 디자인을 확정하지 않는다. Windows 설치 폰트에 따라 다른 OS에서 glyph/metrics가 달라질 수 있다.

9개 파일의 최소 컴포넌트는 공통 SceneContent를 사용한다. HOOK의 강조선, KEYWORD의 큰 핵심어/JP_TEXT, QUESTION 질문 기호, COMPARE emphasis 목록, EXPLAIN 설명, QUOTE_ANALYSIS 인용 기호/출처, RELATION 원형 관계 항목, CONCEPT SVG, RECAP 체크 표시로 구분한다. 의미 자동 생성이나 외부 그래픽 생성은 하지 않는다. COMPARE/RELATION/CONCEPT만 실제 내장 도형/목록 능력을 resolveAssets에 선언한다.

Caption은 Runtime captionVisible/unassignedCaptionVisible을 따른다. hidden 및 captions.show=false는 표시하지 않고 subtle은 불투명도 0.72다. 원본 Caption은 변하지 않으며 표시 lines가 있으면 배열 전체를 줄바꿈으로 연결한다. 텍스트 null/undefined는 출력하지 않는다. 짧은 fixture는 최대 2줄에 맞지만 임의 장문을 자동으로 2줄 단위 분할/축소하는 엔진은 없다. 큰 텍스트/Editor 값의 overflow 자동 검수도 후속이다.

Editor offsetX/Y, fontSize, width는 **출력 픽셀**이다. 논리 화면 확대율로 나누어 적용하고 scale은 배율 그대로 유지한다. mainText는 핵심어, visual은 선택 Asset/placeholder, caption은 Caption에 적용한다. 정적 transform을 자식, Motion transform을 바깥 부모로 분리한다. Transition은 전체 Scene 시각 레이어의 바깥에 적용하되 Caption에는 적용하지 않는다. Editor 값을 덮어쓰거나 원본을 수정하지 않는다.

Asset 선택의 none/text_only/generated_graphic/placeholder/asset 상태를 소비한다. Scene 정지 이미지는 Img, 비디오/오디오 Insert는 @remotion/media Video/Audio, 이미지 Insert/Overlay는 Img로 실제 출력한다. 미해결 자료는 status를 표시하는 Preview placeholder다. 비디오는 contain, overlay는 상단 우측 작은 패널이며 stop Insert 위에도 보이도록 z-index를 분리한다. Pause는 중립 안내, ending은 설정 message만 표시한다. 별도 CLIP_CAPTION은 만들지 않는다.

## Motion/Transition 지원 경계

7종 지원 Motion은 기존 Theme/Motion 수식을 사용한다. STAGGER에는 실제 표시 항목 index/count를 전달하며 빈 목록은 sampling하지 않는다. FREEZE_FOCUS는 MOTION_FREEZE_FOCUS_UNSUPPORTED로 **렌더 전 차단**하고 CUT으로 몰래 대체하지 않는다. MATCH도 TRANSITION_MATCH_UNSUPPORTED로 차단한다.

CUT/FADE/PUSH는 Scene 첫 250 Source ms에 sampleTransition의 양쪽 값을 적용한다. 직전 Source Scene이 정확히 맞닿고 Output 사이 stop이 없을 때만 이전 Scene의 마지막 Source 시각 시각요소를 outgoing으로 잠시 보여준다. Caption은 현재 Runtime 값만 표시한다. Source gap/stop 뒤에는 outgoing 없이 현재 Scene만 진입한다. 전환이 Timeline 길이를 줄이거나 늘리지 않는다. 짧은 Scene의 전환 완료 이전 절단은 그대로 유지한다.

이번 최소 renderer는 동시 Scene 레이아웃을 지원하지 않아 RENDER_SCENE_OVERLAP_UNSUPPORTED로 차단한다. 순수 Runtime의 복수 Scene 반환 계약은 그대로다. Scene 내 비디오 seek/hold는 RENDER_SCENE_VIDEO_UNSUPPORTED이며 비디오는 Insert/Overlay에서만 지원한다. 16:9/9:16 외 비율은 RENDER_ASPECT_RATIO 오류다. Scene outputTiming은 기존 Timeline 오류다. 일반 사용자 Final Render, 자유 Scene layout, 프레임 정밀 audio trim, 장문 Caption 분할, media-aware FREEZE_FOCUS/MATCH, 외부 폰트 로딩, Editor UI는 후속이다.

## 검증과 증거

```sh
npx tsx --test tests/render.test.ts
npm run typecheck
npm test
npm run build
npm run render:fixture
npm run render:portrait
npm run render:verify
```

`tests/render.test.ts`는 9종 실제 React markup, null 텍스트, 정적 transform, frame 경계, 지원 거절, Source Motion 재개, 두 비율을 검증한다. 렌더 성공은 이 단위 테스트와 별도로 확인한다.

verify 스크립트는 두 MP4의 h264/AAC, 크기, 390프레임/30fps, 영상 13초, 전체 decode를 검사하고 최종 AAC를 PCM으로 내려 TTS 테스트음/Insert 소리/정지와 재개의 RMS를 확인한다. `dist/render/verification.json`, orientation별 `probe.json`, PNG 대표 프레임 및 4×4 contact sheet를 만든다. SHA256/bytes와 정확한 길이는 verification.json이 기준이다. 대표 프레임 추출만으로 사람이 시각 확인했다고 기록하지 않는다.

이번 실행의 최종 결과/시각 점검은 아래 인수 기록에 남긴다.

### 2026-09-06 실행 인수 기록

- `npx tsx --test tests/render.test.ts`: 최초 21개 통과, 출력 픽셀 transform 회귀 1개 추가 후 전체 실행에 포함.
- 최종 `npm run typecheck`, `npm test` **300/300 (기존 278 + Render 22)**, `npm run build` 통과.
- 빌드 후 두 공개 ESM 진입점 import/prepareScenePreview 호출 통과. Node resolve hook으로 React/Remotion import를 강제로 거절한 상태에서도 `@short-auto/core` import 통과를 확인했다.
- 두 CLI 렌더 모두 exit 0. 최종 로그는 `dist/render/landscape-render.log`, `portrait-render.log`. objectFit 경고를 prop 사용으로 수정한 최종 로그에 해당 경고/오류가 없다.
- 가로: 1280×720, h264, 390 frames, 30/1 fps, 영상 13.000s, format 13.056s, AAC 48000Hz, **1,069,624 bytes**. SHA256 `7d9b9ae23df12dc11dc9cfa35348f323eaa83544a121d5431fd19ad7057c5204`.
- 세로: 720×1280, 같은 codec/frame/fps/길이, **986,454 bytes**. SHA256 `5220f268c570e33ad9849774089c9441322c1c012263bf8171830003b3d869be`.
- `npm run render:verify`: 두 파일 전체 decode PASS. 디코딩한 AAC의 source RMS 약 0.04896, video Insert 0.02619, resume 0.04897, still/Pause/ending의 내부 표본 구간 RMS는 0. 이는 합성 신호의 정지/재개 검사이며 실제 음성 품질/방송 loudness 검수는 아니다.
- 각 파일의 frame 21/57/75/93/114/153/183/192/204/213/249/285/321/338/357/381을 PNG로 추출하고 두 contact sheet를 직접 시각 확인했다. 9종 Scene, 한글/일본어, hidden Caption, 영상+Overlay 병렬, 이미지 Insert, Pause, 재개 Caption, missing placeholder, ending이 확인됐다. 75/338은 FADE/PUSH 도중 의도된 두 레이어 상태다. 최종 세로 한글 줄바꿈은 단어 단위이며 대표 정지 프레임에서 Caption/핵심어 충돌은 보이지 않는다. 장문/임의 Editor transform의 일반적 fit 보증은 아니다.
- Studio의 두 Composition 등록/페이지 로딩을 인앱 브라우저에서 확인했다. Preview 서버는 `npm run preview`로 재실행 가능하다.

이 기록은 합성 fixture에 대한 최소 렌더 연결 인수 자료이며, 실제 사용자 승인 콘텐츠의 Final Render, 전체 Scene 시스템/브랜드 디자인 완료를 의미하지 않는다.
