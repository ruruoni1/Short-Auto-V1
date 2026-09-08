# 니혼줍줍 VOICEVOX 로컬 TTS 연동 지침 v1.0 FINAL

작성일: 2026-09-09  
프로젝트 루트: `D:\coding\Short-auto`  
적용 대상: Short-auto TTS 생성/미리듣기/보이스 설정 모듈

---

# 1. 목적

사용자 PC에 설치된 VOICEVOX를 직접 이용해 니혼줍줍 Long-form/Shorts 내레이션 WAV를 만든다. 외부 TTS SaaS를 기본 의존성으로 사용하지 않는다.

핵심 UX는 다음과 같다.

> VOICEVOX 연결 → 현재 사용 가능한 목소리 목록 가져오기 → 사용자가 선택 → 미리듣기 → 기본 보이스로 저장 → TTS 생성

---

# 2. 엔진 연결

기본 endpoint:

```text
http://127.0.0.1:50021
```

앱 시작 시 또는 TTS 화면 진입 시 엔진 상태를 확인한다. endpoint는 설정에서 변경 가능해야 하지만 기본값은 localhost다.

엔진이 응답하지 않으면:
- 앱 전체를 실패시키지 않는다.
- `VOICEVOX 연결 안 됨` 상태를 보여준다.
- `다시 연결` 버튼을 제공한다.
- 사용자가 VOICEVOX/Engine을 실행한 후 재시도할 수 있게 한다.

---

# 3. 화자/목소리 목록 조회

화자와 스타일을 코드에 하드코딩하지 않는다.

VOICEVOX Engine의 `/speakers` 응답을 이용한다. 각 화자 안의 `styles`를 펼쳐 하나의 선택 가능한 목소리 항목으로 표시한다.

UI 예:

```text
[화자]              [스타일]         [선택]
캐릭터 A             노멀              ○
캐릭터 A             즐거움            ○
캐릭터 B             노멀              ○
...
```

내부적으로는 최소 다음 값을 보관한다.

```json
{
  "speaker_uuid": "...",
  "speaker_name": "...",
  "style_id": 0,
  "style_name": "..."
}
```

합성 API의 `speaker` 파라미터에는 선택한 style `id`를 사용한다.

목록에는 `새로고침` 기능을 둔다. VOICEVOX 업데이트/추가 보이스 설치 후에도 코드 변경 없이 반영되어야 한다.

---

# 4. 최초 선택 플로우

처음에는 특정 캐릭터를 자동 확정하지 않는다.

1. `/speakers` 목록 로드
2. 사용자에게 화자/스타일 목록 표시
3. 항목 선택
4. 짧은 고정 샘플 문장으로 미리듣기 생성
5. 사용자가 최종 선택
6. `기본 니혼줍줍 보이스`로 저장

추천 미리듣기 문장은 실제 TTS 규칙을 검증할 수 있도록 한국어 + 일본어 독음이 섞인 짧은 문장을 사용한다.

예:

```text
애니에서 자주 듣는 오마에. 현실에서는 어떻게 들릴까요?
```

---

# 5. 합성 플로우

공식 Engine API 흐름을 따른다.

```text
TTS text
   ↓
POST /audio_query?text=...&speaker={style_id}
   ↓
AudioQuery JSON
   ↓
사용자/프로필 파라미터 적용
   ↓
POST /synthesis?speaker={style_id}
   ↓
WAV
```

기본적으로 조정 가능한 값:
- `speedScale`
- `pitchScale`
- `intonationScale`
- `volumeScale`
- `prePhonemeLength`
- `postPhonemeLength`

초기값은 Engine이 생성한 AudioQuery 값을 존중하고, 사용자가 변경한 값만 덮어쓴다.

---

# 6. 보이스 프로필

사용자가 선택한 결과는 이름 있는 프로필로 저장한다.

예:

```json
{
  "profile_name": "니혼줍줍 기본",
  "engine": "voicevox",
  "endpoint": "http://127.0.0.1:50021",
  "speaker_uuid": "...",
  "speaker_name": "...",
  "style_id": 0,
  "style_name": "...",
  "speedScale": 1.0,
  "pitchScale": 0.0,
  "intonationScale": 1.0,
  "volumeScale": 1.0
}
```

중요:
- 표시 이름보다 `speaker_uuid + style_id`를 식별 기준으로 우선한다.
- 저장된 style이 더 이상 존재하지 않으면 자동으로 다른 목소리를 선택하지 말고 재선택을 요구한다.

---

# 7. 생성 파일 관리

권장 경로:

```text
D:\coding\Short-auto\output\tts\{content_id}\
```

파일 예:

```text
001_hook.wav
002_explain.wav
003_compare.wav
tts_manifest.json
```

`tts_manifest.json`에는 문장, 보이스 프로필, style ID, 생성 시각, 파라미터, 출력 파일명을 기록해 재현 가능하게 한다.

---

# 8. 문장 단위 생성

하나의 긴 WAV 하나만 생성하지 말고 제작/씬 단위로 나누는 것을 기본으로 한다.

장점:
- 재생성 범위 최소화
- 영상 타이밍 조정 용이
- 특정 문장만 속도/억양 수정 가능
- Vrew/편집기 삽입 편리

TTS 문장 분리 기준은 `nihon_zupzup_tts_script_rules_v1.1_FINAL_2026-09-09.md`를 따른다.

---

# 9. UI MVP

TTS 화면 최소 구성:

```text
[VOICEVOX 상태: 연결됨] [다시 연결]

화자: [드롭다운]  스타일: [드롭다운] [목록 새로고침]
[미리듣기]

속도      [slider] [1.00]
피치      [slider] [0.00]
억양      [slider] [1.00]
볼륨      [slider] [1.00]

[기본 보이스로 저장]

TTS 대본
┌──────────────────────────────┐
│ ...                          │
└──────────────────────────────┘

[선택 문장 생성] [전체 생성]
```

---

# 10. 예외 처리

필수 처리:
- Engine 미실행/연결 실패
- `/speakers` 빈 응답
- 저장된 style ID가 사라짐
- `/audio_query` 오류
- `/synthesis` 오류
- 출력 폴더 쓰기 실패
- 동일 파일명 충돌

오류가 나도 사용자가 작성한 대본과 선택 설정은 보존한다.

---

# 11. 금지 사항

- 화자/스타일 ID 하드코딩
- 첫 번째 `/speakers` 항목을 자동 기본값으로 확정
- 외부 VOICEVOX 서버를 기본으로 호출
- 엔진 연결 실패 때문에 앱 전체 종료
- 긴 대본을 무조건 하나의 WAV로만 생성
- 원작 애니/일드 실제 대사를 자체 TTS로 그대로 재연하는 것을 기본 방식으로 사용

---

# 12. 구현 완료 조건

다음을 실제 사용자 PC에서 검증해야 한다.

1. 로컬 VOICEVOX 실행 상태 감지
2. 현재 설치된 화자/스타일 목록 표시
3. 사용자가 목소리 선택
4. 미리듣기 생성
5. 기본 보이스 저장/앱 재실행 후 복원
6. TTS 대본 한 문장 WAV 생성
7. 여러 문장 일괄 생성
8. 파라미터 변경 후 재생성
9. manifest 기록
10. VOICEVOX 종료 상태에서 정상적인 오류 안내

---

# 한 줄 원칙

**Short-auto는 로컬 VOICEVOX의 현재 화자/스타일 목록을 동적으로 읽고, 사용자가 선택한 보이스 프로필로 장면 단위 TTS를 생성하며, 특정 목소리나 style ID를 코드에 고정하지 않는다.**
