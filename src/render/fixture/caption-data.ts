import type { CaptionDisplayPolicy } from '../../index.js';
import { makeRenderFixture } from './data.js';
export function makeCaptionRenderFixture(portrait = false) {
  const { input, pack } = makeRenderFixture(portrait);
  const texts = [
    '긴 자막도 원문은 그대로 보존합니다. 화면에는 읽을 수 있는 두 줄씩 차례대로 표시하고 장면의 핵심 메시지와 겹치지 않도록 아래에 배치합니다.',
    '日本語の長い字幕も元の文章を変えずに表示します。ひらがな、カタカナ、漢字を含む文章を二行ずつ順番に確認しましょう。',
    'Long English captions preserve every original character. Supercalifragilisticexpialidocious tests a long word without silently removing or rewriting text.',
    '함께 읽어요 👩🏽‍💻 가족 👨‍👩‍👧‍👦 깃발 🇰🇷 🇯🇵 미소 🙂 결합 é 문자를 보존해요. HTML처럼 보이는 <b>text</b> & 문장도 일반 글자입니다.',
    '이 원문은 표시 override로 대체됩니다. 화면의 문장은 원문 범위를 주장하지 않습니다.',
    '빈 배열 override는 이 원문을 화면에 다시 표시하지 않습니다.',
  ];
  input.production.project.title = 'Long caption display integration fixture';
  input.production.audio.tts = 'caption-long/tts.wav';
  input.source = { durationMs: 18000, captions: texts.map((text,i) => ({id: i*7+1,startMs:i*3000,endMs:(i+1)*3000,text})) };
  const base = input.production.scenes[0]!;
  input.production.scenes = ['원문 그대로','日本語の字幕','Read in two lines','문자 하나까지','직접 지정한 자막','빈 표시 유지'].map((mainText,i) => ({...structuredClone(base),id:`long${i}`,type:'EXPLAIN' as const,captionRange:{start:i*7+1,end:i*7+1},captionMode:'normal' as const,content:{mainText,jpText:null,subText:null,emphasis:[]},motion:{preset:'CUT' as const,intensity:'normal' as const},transition:'CUT' as const}));
  input.production.inserts = [
    {id:'long-still',type:'MEDIA',timingMode:'insert',assetId:'still',anchor:{type:'source_time',timeMs:6000},durationMs:500},
    {id:'long-pause',type:'PAUSE',timingMode:'pause',anchor:{type:'source_time',timeMs:6000},durationMs:500},
  ];
  input.production.ending={enabled:true,durationMs:500,type:'test-end',message:'표시 검증 끝'};
  input.overrides.scenes={long4:{caption:{lines:['직접 지정한 첫 줄','원문 범위와 별개예요']}},long5:{caption:{lines:[]}}};
  const captionDisplayPolicy: CaptionDisplayPolicy={maxGraphemesPerLine:portrait?12:24,maxLinesPerUnit:2,minUnitDurationMs:300};
  return {input,pack,captionDisplayPolicy};
}
