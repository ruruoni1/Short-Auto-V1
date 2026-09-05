import { nihonZupzupPack } from '../channel-packs/nihon-zupzup/index.js';
import type { ProjectBundle, Workspace } from '../src/index.js';

export function exampleWorkspace(): Workspace {
  const long: ProjectBundle = {
    production: {
      schemaVersion: '1.0',
      project: { id: 'NZ001', title: '표현과 관계', contentType: 'discovery_long', language: 'ko', channelPack: 'nihon_zupzup', contentProfile: 'anime_analysis', status: 'draft', revision: 0, origin: { sourceType: 'independent' } },
      audio: { tts: 'audio/tts.wav', volume: 1 }, captions: { source: 'audio/tts.srt', parsed: 'data/captions.json', show: true },
      settings: { fps: 30, width: 1920, height: 1080, theme: 'nihon-discovery-v1', captionStyle: 'default', transitionStyle: 'default' },
      assets: { clip01: { type: 'anime_clip', status: 'required', metadata: { title: '테스트용 가상 자료' } } },
      scenes: [{ id: 'scene_001', type: 'EXPLAIN', locked: false, confidence: 0.9, captionRange: { start: 1, end: 2 }, captionMode: 'normal', content: { mainText: '관계에 따라', subText: null, jpText: null, emphasis: [] }, visual: { strategy: 'text_only', assetId: null }, motion: null }],
      inserts: [{ id: 'insert_001', type: 'ANIME_CLIP', timingMode: 'insert', anchor: { type: 'caption_after', captionId: 1 }, assetId: 'clip01', durationMs: 1000 }],
      ending: { enabled: false, durationMs: 0, type: 'discovery_end', message: '' }
    },
    source: { durationMs: 4000, captions: [{ id: 1, startMs: 0, endMs: 2000, text: '표현은 관계에 따라 달라집니다.' }, { id: 2, startMs: 2000, endMs: 4000, text: '상황도 함께 살펴봅니다.' }] },
    overrides: { schemaVersion: '1.0', projectId: 'NZ001', revision: 0, global: {}, scenes: {}, inserts: {} }
  };
  const short = structuredClone(long);
  short.production.project = { ...short.production.project, id: 'NZ001_S1', contentType: 'discovery_short', contentProfile: 'anime_discovery_short', origin: { sourceType: 'derived', sourceLongProjectId: 'NZ001', derivativeIndex: 1, derivativeReason: '관계에 따른 의미 차이를 한 질문으로 재구성' } };
  short.production.settings.width = 1080; short.production.settings.height = 1920;
  short.overrides.projectId = 'NZ001_S1';
  return { packs: [structuredClone(nihonZupzupPack)], projects: [long, short], contents: [
    { id: 'content_long_001', title: '표현과 관계', contentType: 'discovery_long', contentProfile: 'anime_analysis', channelPack: 'nihon_zupzup', productionProjectId: 'NZ001', status: 'planned', relationship: { sourceType: 'independent' }, derivedShortIds: ['content_short_001'], relatedContentIds: [] },
    { id: 'content_short_001', title: '관계에 따른 표현', contentType: 'discovery_short', contentProfile: 'anime_discovery_short', channelPack: 'nihon_zupzup', productionProjectId: 'NZ001_S1', status: 'planned', relationship: { sourceType: 'derived', parentLongId: 'content_long_001' }, derivedShortIds: [], relatedContentIds: [] }
  ] };
}
