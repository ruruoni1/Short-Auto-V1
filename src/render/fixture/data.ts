import type { ChannelPack, Motion, Scene } from '../../index.js';
import type { TimelineInput } from '../../index.js';
export function makeRenderFixture(portrait = false): { input: TimelineInput; pack: ChannelPack } {
  const types: Scene['type'][] = ['HOOK','KEYWORD','QUESTION','COMPARE','EXPLAIN','QUOTE_ANALYSIS','RELATION','CONCEPT','RECAP'];
  const titles = ['말투가 달라지는 순간', '같은 말, 다른 거리', '누구에게 하는 말일까?', '표현을 나란히 보면', '관계를 먼저 살펴봐요', '한 단어에 집중하기', '사람 사이의 거리', '말에도 역할이 있어요', '상황과 관계를 함께'];
  const captions = ['말 한마디에도 관계가 담겨 있어요.', '같은 뜻이어도 느낌은 달라져요.', '상대가 누구인지 떠올려 보세요.', '두 표현의 차이를 살펴봐요.', '친밀함과 격식이 말투를 바꿔요.', '대사에서 핵심 표현을 골라 봐요.', '관계에 따라 선택이 달라져요.', '표현이 인물의 역할을 보여줘요.', '이제 말투 뒤의 관계를 찾아봐요.'];
  const presets: Motion['preset'][] = ['SCALE_IN','SCALE_IN','FADE_UP','STAGGER','SLOW_ZOOM','CUT','STAGGER','SCALE_IN','FADE_UP'];
  const pack: ChannelPack = { id: 'synthetic-preview', version: '1', profiles: [{ id: 'test', contentType: portrait ? 'learning_short' : 'training_long' }], themes: [{ id: 'temporary', fontPrimaryKR: 'Malgun Gothic, sans-serif', fontPrimaryJP: 'Yu Gothic, sans-serif', fontCaption: 'Malgun Gothic, sans-serif', fontNumber: 'sans-serif', colors: { background: '#101c2c', foreground: '#f4f1e8', accent: '#e7bc69', muted: '#b8c4d4' }, defaultTransition: 'CUT' }] };
  const input: TimelineInput = {
    production: { schemaVersion: '1.0', project: { id: 'synthetic-preview', title: 'Scene integration fixture', contentType: portrait ? 'learning_short' : 'training_long', language: 'ko', channelPack: pack.id, contentProfile: 'test', status: 'draft', revision: 0, origin: { sourceType: 'independent' } },
      audio: { tts: 'synthetic/tts.wav', volume: 0.7 }, captions: { source: 'synthetic/test.srt', parsed: 'synthetic/test.json', show: true },
      settings: { fps: 30, width: portrait ? 720 : 1280, height: portrait ? 1280 : 720, theme: 'temporary', captionStyle: 'preview', transitionStyle: 'preview' },
      assets: { moving: { type: 'video', status: 'ready', src: 'synthetic/moving.mp4', durationMs: 2000 }, still: { type: 'image', status: 'ready', src: 'synthetic/still.png' }, pending: { type: 'image', status: 'missing' } },
      scenes: types.map((type, i) => ({ id: `scene${i}`, type, locked: false, confidence: 1, captionRange: { start: i * 6 + 1, end: i * 6 + 3 }, captionMode: i === 1 ? 'hidden' : 'normal',
        content: { mainText: titles[i]!, jpText: i === 1 ? 'ことば' : null, subText: null, emphasis: i === 3 ? ['친근한 표현', '격식 있는 표현'] : i === 6 ? ['나', '상대'] : [], ...(i === 5 ? { sourceText: '직접 만든 합성 자료' } : {}) },
        visual: { strategy: i === 4 ? 'asset' : [3,6,7].includes(i) ? 'generated_graphic' : 'text_only', assetId: i === 4 ? 'pending' : null },
        motion: { preset: presets[i]!, intensity: 'subtle' }, transition: i === 2 ? 'FADE' : i === 8 ? 'PUSH' : 'CUT' })),
      inserts: [
        { id: 'movie', type: 'MEDIA', timingMode: 'insert', assetId: 'moving', anchor: { type: 'source_time', timeMs: 3600 }, durationMs: 800, trim: { startMs: 200, endMs: 1000 } },
        { id: 'picture', type: 'MEDIA', timingMode: 'insert', assetId: 'still', anchor: { type: 'source_time', timeMs: 5400 }, durationMs: 500 },
        { id: 'wait', type: 'PAUSE', timingMode: 'pause', anchor: { type: 'source_time', timeMs: 5400 }, durationMs: 300 },
        { id: 'overlay', type: 'MEDIA', timingMode: 'overlay', assetId: 'still', anchor: { type: 'source_time', timeMs: 3000 }, durationMs: 1000 },
      ], ending: { enabled: true, durationMs: 600, type: 'test-end', message: '말 속의 관계를 발견해 보세요' } },
    source: { durationMs: 10800, captions: captions.flatMap((text,i) => [{ id: i*6+1, startMs: i*1200, endMs: i*1200+600, text }, { id: i*6+3, startMs: i*1200+600, endMs: (i+1)*1200, text }]) },
    overrides: { schemaVersion: '1.0', projectId: 'synthetic-preview', revision: 0, global: { captionOffsetY: -3 }, scenes: { scene0: { mainText: { offsetY: -4, scale: 1.02 } }, scene4: { visual: { scale: 0.9, offsetX: 4 } } }, inserts: {} },
  };
  return { input, pack };
}
