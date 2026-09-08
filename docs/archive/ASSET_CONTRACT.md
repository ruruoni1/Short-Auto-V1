# Asset resolver 계약 — 최초 기능

`src/asset.ts`는 Registry 데이터 검증과 Scene/Insert의 순수 선택 계획을 제공한다. 파일 읽기, 생성, 다운로드, decoder, Placeholder 이미지 제작 및 렌더는 수행하지 않는다. Core Schema, Scene Runtime, Timeline, 저장 revision은 변경하지 않는다.

## 공개 API

```ts
import { validateAssetRegistry, resolveAssets } from '@short-auto/core';
const registryResult = validateAssetRegistry(production.assets);
const result = resolveAssets({ production, overrides }, {
  generatedGraphicSceneIds: ['scene_001'],
});
if (result.valid) {
  const { scenes, inserts, previewAvailable, finalAssetReadiness } = result.plan;
}
```

- `validateAssetRegistry(unknown): ValidationResult`: 기존 AssetRegistrySchema의 키/필드/status/src/metadata/generation 구조를 검사한다. ready는 상대 src 필수, required/missing/rejected는 유효한 데이터 상태다. 검증 성공은 실제 파일 증거가 아니다.
- `resolveAssets(input: unknown, policy?: AssetResolutionPolicy): ResolveAssetsResult`: input은 `{production, overrides}`다. Source, Pack, approval은 받지 않는다. 두 입력은 기존 Schema로 검사하며 알 수 없는 필드를 거부한다. 정책은 선택적 `generatedGraphicSceneIds: string[]`이며 기본값은 빈 목록이다. 존재하지 않는 Scene ID와 잘못된 정책 필드는 오류다.
- 성공은 `{valid: true, plan, diagnostics}`, 오류는 `{valid: false, plan: null, diagnostics}`다. 구조/참조 오류에서 부분 계획은 반환하지 않는다. Preview용 미해결 상태는 성공 결과의 `finalAssetReadiness`에 오류를 기록한다.
- 공개 타입: `AssetResolutionPolicy`, `AssetReferenceState`, `AssetRequest`, `AssetSelection`, `AssetResolutionPlan`, `ResolveAssetsResult`.

## 전략 및 우선순위

| 명시 strategy | Preview 선택 |
| --- | --- |
| none | 항상 none. Asset이나 생성 요청으로 바꾸지 않음 |
| text_only | 항상 text_only. 내용이 비어도 다른 전략으로 바꾸지 않음 |
| asset | 유효 지정 Asset이 ready이면 asset, 그 외 등록 상태는 placeholder |
| generated_graphic | 정책에 Scene ID가 있으면 graphic 계획, 없으면 graphic_unavailable placeholder |
| auto | ready 지정 시각 Asset → 선언된 graphic 지원 → 표시 텍스트 → 생성/수집 요청을 동반한 placeholder |

우선순위는 **auto의 fallback**에 적용한다. 명시 전략을 덮어쓰지 않는다. Registry에서 무관한 Asset을 임의 검색/선택하거나 Scene type으로 지원 기능을 추측하지 않는다. graphic 정책은 renderer 능력에 대한 호출자 선언이며 구현/생성/렌더 성공 증거가 아니다. graphic 계획은 최종 Asset 준비 완료로 승격하지 않는다. 명시 graphic이 미지원이면 다른 전략이나 외부 생성 요청으로 대체하지 않고 지원 부족을 반환한다.

auto의 표시 텍스트는 mainText/subText/jpText/sourceText 중 trim 후 한 글자 이상인 값이다. emphasis만 존재하거나 공백뿐인 텍스트는 후보가 아니다. 원문 자체를 trim하거나 수정하지 않는다. ready audio는 Scene 시각 후보가 아니므로 auto에서 `audio_not_visual` fallback을 반환한다. 명시 asset에 audio가 유효 연결되면 status에 관계없이 ASSET_TYPE 오류다.

## 상태, 참조, Override

- `effectiveAssetId`는 own-property Scene visual override.assetId > 원본 assetId다. 원본 strategy를 유지하고 `visualOverride`에 transform을 보존한다. 다른 Scene Override의 표시 합성은 Scene Runtime 책임이다.
- `referenceState`와 `referencedAsset`은 유효 연결의 원래 상태 및 metadata/generation 전체 snapshot이다. 실제 선택에 사용되지 않은 rejected 자료도 출처 확인을 위해 보존한다. `selectedAsset`은 ready 자료를 asset Preview로 선택한 경우에만 채운다.
- auto의 `fallbackReason`은 required/missing/rejected/no_candidate/audio_not_visual이다. 명시 전략에는 null이다. placeholder의 원인은 `placeholderReason`으로 별도 반환한다. required는 제작 요구, missing은 등록 자료 누락, rejected는 사용 거부 상태로 구분하며 src가 있어도 재사용하지 않는다.
- 미등록 ID는 ASSET_REF 오류이며 missing으로 바꾸지 않는다. 명시 none/text_only, 사용하지 않는 원본 참조, Override가 대체한 원본 참조도 존재해야 한다. Override의 잘못된 참조 역시 오류다. 중복 Scene/Insert ID, 다른 프로젝트 Override, 없는 Scene/Insert Override는 오류다.
- Registry와 Override dictionary는 own enumerable string entry만 입력으로 취급한다. 상속된 키는 배제한다. constructor/toString/hasOwnProperty도 명시 own 등록일 때만 유효하다. 기존 Zod record가 상속 키를 순회할 수 있어 Schema 검사 전에 해당 dictionary를 own-entry 복사한다. 입력은 JSON 저장 모델이며 accessor/Proxy 객체의 실행 안전성을 제공하는 API는 아니다.

## Insert와 요청

ANIME_CLIP은 anime_clip, DRAMA_CLIP은 drama_clip만 허용한다. MEDIA는 Core와 동일하게 audio를 포함한 모든 등록 Asset type을 허용한다. PAUSE는 Asset을 선택하지 않는다. PAUSE에 남아 있는 assetId도 참조와 보수적 최종 준비 검사는 유지한다. 유효 trim은 Override > 원본이며 trim.endMs 또는 durationMs가 등록 durationMs를 넘으면 ASSET_DURATION 오류다. 이는 선언값 비교이며 실제 미디어 길이 확인이 아니다. 시간축/anchor/Caption 검증은 Timeline 계층 책임이다.

미디어 Insert의 required/missing/rejected는 상태별 placeholder와 요청을 반환하며 텍스트/graphic으로 대체하지 않는다. 생성 설명이 등록되어 있으면 `request.kind=generate`, 없으면 collect다. request는 원래 assetId, reason, generation을 보존하고 항상 `fulfilled=false`다. rejected 요청은 거부 자료의 재사용이 아니라 대체 자료 확보 필요를 나타낸다. 요청 반환은 외부 작업 실행/예약/등록이 아니며 자동으로 Registry 항목을 추가하지 않는다. auto에서 graphic/text fallback이 가능하면 후순위 외부 요청을 만들지 않는다.

## Preview와 최종 준비 경계

`previewAvailable=true`는 모든 유효 항목에 선택/placeholder 계획이 있다는 뜻이다. 화면이나 픽셀의 생성 성공을 의미하지 않는다. `fileVerification` 및 `renderVerification`은 항상 `not_performed`이며 성공 결과에도 ASSET_FILES_UNVERIFIED 경고가 있다.

`finalAssetReadiness`는 **Asset 데이터 조건만** 검사한다. Core의 보수적 기준을 유지하여 전략과 무관하게 effective Scene 참조와 Insert 참조가 ready여야 하며, 사용되지 않은 Registry required도 차단한다. 사용되지 않은 missing/rejected는 차단하지 않는다. Override로 대체된 원본의 missing/rejected도 참조가 존재하면 차단하지 않는다. Placeholder, 미지원 graphic, 생성 증거 없는 graphic 계획은 추가 차단한다. ready의 존재만으로 파일 검증 완료를 주장하지 않는다.

이 결과가 true여도 최종 렌더를 허가하는 것이 아니다. 기존 `checkFinalRenderReadiness`의 Workspace/Profile/승인/revision 검사와 Timeline/Scene 검증, 파일 존재/해독 가능성/권리 검토 및 실제 렌더 QA가 별도로 필요하다. Core/Scene Runtime을 자동 호출하거나 기존 결과를 바꾸지 않으므로 renderer 통합 시 이 선택 계획을 명시 소비해야 한다.

## 불변성과 검증

입력과 Registry를 변경하지 않으며 결과 Asset/metadata/generation/visual override는 분리된 snapshot이다. 결과를 수정해도 원본과 다음 호출 결과에 영향을 주지 않는다. 배열 순서는 원본 Scene/Insert 순서다. 재호출은 결정적이며 네트워크·파일·시간·난수 의존성이 없다.

`tests/asset.test.ts`는 전략/status 조합, auto 단계별 fallback, 공백 텍스트, generation 요청, 명시 전략 보존, own-property, 유효 Override, Insert type/trim, 오류의 원자적 반환 및 frozen 입력/metadata 보존을 검증한다.

검증 명령: `npx tsx --test tests/asset.test.ts`, `npm run typecheck`, `npm test`, `npm run build`, 빌드 후 `@short-auto/core` 공개 ESM import/호출.
