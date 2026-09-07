import { useMemo } from 'react';
import { AbsoluteFill, Sequence, Img, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { Audio, Video } from '@remotion/media';
import type { CSSProperties } from 'react';
import type { AssetSelection, ChannelPack, PlannedScene, TimelineInput } from '../index.js';
import { sampleTransition, selectTransition, selectThemeColor, selectThemeFont } from '../index.js';
import { frameInterval, frameToMs, msToFrame, prepareScenePreview, previousTransitionScene } from './plan.js';
import type { ScenePreviewPlan } from './plan.js';
import { editorStyle } from './scenes/shared.js';
import * as Scenes from './scenes/index.js';
const components = { HOOK: Scenes.Hook, KEYWORD: Scenes.Keyword, QUESTION: Scenes.Question, COMPARE: Scenes.Compare, EXPLAIN: Scenes.Explain, QUOTE_ANALYSIS: Scenes.QuoteAnalysis, RELATION: Scenes.Relation, CONCEPT: Scenes.Concept, RECAP: Scenes.Recap };
const mediaStyle: CSSProperties = { width: '100%', height: '100%', objectFit: 'contain' };
function Placeholder({ choice }: { choice: AssetSelection }) {
  return <div data-placeholder={choice.placeholderReason} style={{ border: '1px dashed #8b9aaa', padding: 14, fontSize: 16, color: '#b8c4d4', textAlign: 'center' }}>미디어 준비 중 · {choice.placeholderReason}</div>;
}
function SceneLayer({ plan, scene, time, portrait }: { plan: ScenePreviewPlan; scene: PlannedScene; time: number; portrait: boolean }) {
  const Component = components[scene.scene.type];
  const choice = plan.assets.scenes.find(s => s.id === scene.scene.id)!;
  return <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', flexDirection: 'column', justifyContent: 'center', gap: 18, padding: portrait ? '45px 30px 115px' : '28px 40px 82px' }}>
    <Component plan={scene} sourceTimeMs={time} theme={plan.theme} portrait={portrait} outputScale={plan.input.production.settings.width/(portrait ? 360 : 640)}/>
    <div style={{ ...editorStyle(scene.visual,plan.input.production.settings.width/(portrait ? 360 : 640)), maxWidth: '100%' }}>
      {choice.preview === 'placeholder' && <Placeholder choice={choice}/>}
      {choice.preview === 'asset' && <Img src={staticFile(choice.selectedAsset!.src!)} style={{ width: 180, height: 90, objectFit: 'contain' }}/>}
    </div>
  </div>;
}
function OperationMedia({ choice, trim, duration }: { choice: AssetSelection; trim: number; duration: number }) {
  if (choice.preview === 'placeholder') return <Placeholder choice={choice}/>;
  const asset = choice.selectedAsset;
  if (!asset) return null;
  if (asset.type === 'audio') return <Audio src={staticFile(asset.src!)} trimBefore={trim} durationInFrames={duration} volume={0.7}/>;
  if (['video','anime_clip','drama_clip'].includes(asset.type)) return <Video src={staticFile(asset.src!)} trimBefore={trim} durationInFrames={duration} style={{width:'100%',height:'100%'}} objectFit="contain" volume={0.7}/>;
  return <Img src={staticFile(asset.src!)} style={mediaStyle}/>;
}
export type ScenePreviewProps = { input: TimelineInput; pack: ChannelPack };
/** Test/preview consumer only. Does not call or bypass the final production approval gate. */
export function ScenePreview({ input, pack }: ScenePreviewProps) {
  const frame = useCurrentFrame(); const { fps, width, height } = useVideoConfig();
  const plan = useMemo(() => prepareScenePreview(input, pack), [input, pack]);
  if (fps !== input.production.settings.fps || width !== input.production.settings.width || height !== input.production.settings.height) throw new Error('Composition settings must match Production');
  const time = frameToMs(frame, fps), state = plan.runtime.getState(time);
  const portrait = height > width, logicalWidth = portrait ? 360 : 640, logicalHeight = portrait ? 640 : 360;
  const current = state.scenes[0];
  const previous = current ? previousTransitionScene(plan,current) : null;
  const elapsed = current && state.sourceTimeMs !== null ? state.sourceTimeMs-current.sourceStartMs : 250;
  const transition = current ? sampleTransition(selectTransition(current.scene.transition, plan.theme.theme), elapsed, 250) : null;
  const caption = current?.captionVisible ? (current.caption.lines ?? [state.caption!.text]).join('\n') : state.unassignedCaptionVisible ? state.caption!.text : null;
  const captionTransform = current?.caption ?? state.unassignedCaption;
  return <AbsoluteFill style={{ background: selectThemeColor(plan.theme,'background') ?? '#101c2c', color: selectThemeColor(plan.theme,'foreground') ?? '#fff', overflow: 'hidden' }}>
    <div style={{ position:'absolute', width: logicalWidth, height: logicalHeight, scale: width/logicalWidth, transformOrigin:'top left', wordBreak:'keep-all', overflowWrap:'break-word', fontFamily: selectThemeFont(plan.theme,'fontPrimaryKR') }}>
      {previous && elapsed < 250 && transition?.outgoing && <AbsoluteFill style={{ opacity: transition.outgoing.opacity, translate:`${transition.outgoing.translateX*100}% 0` }}><SceneLayer plan={plan} scene={previous} time={previous.sourceEndMs-1} portrait={portrait}/></AbsoluteFill>}
      {current && state.sourceTimeMs !== null && transition?.incoming && <AbsoluteFill style={{ opacity: transition.incoming.opacity, translate:`${transition.incoming.translateX*100}% 0` }}><SceneLayer plan={plan} scene={current} time={state.sourceTimeMs} portrait={portrait}/></AbsoluteFill>}
      {state.kind === 'pause' && <AbsoluteFill style={{ alignItems:'center', justifyContent:'center', fontSize:32 }}>잠깐 생각해 보세요</AbsoluteFill>}
      {state.ending && <AbsoluteFill style={{ padding:40, alignItems:'center', justifyContent:'center', textAlign:'center', fontSize:32, fontWeight:700 }}>{state.ending.message}</AbsoluteFill>}
      {plan.timeline.segments.map((segment,index) => {
        const range = frameInterval(segment.outputStartMs,segment.outputEndMs,fps);
        if (!range.durationInFrames) return null;
        if (segment.type === 'tts') return <Sequence key={index} {...range} layout="none"><Audio src={staticFile(input.production.audio.tts)} trimBefore={Math.floor(segment.sourceStartMs*fps/1000)} volume={input.production.audio.volume}/></Sequence>;
        if (!('insertId' in segment) || segment.type === 'pause') return null;
        const choice = plan.assets.inserts.find(s => s.id === segment.insertId)!;
        const original = input.production.inserts.find(s => s.id === segment.insertId)!;
        const trim = Object.hasOwn(input.overrides.inserts,original.id) ? input.overrides.inserts[original.id]!.trim : original.trim;
        return <Sequence key={index} {...range} layout="none"><div style={segment.type === 'overlay' ? { position:'absolute', zIndex:4, right:20, top:20, width:100, height:65, background:'#101c2c' } : { position:'absolute', inset:0, zIndex:2, padding:30, background:'#101c2c' }}><OperationMedia choice={choice} trim={Math.floor((trim?.startMs ?? 0)*fps/1000)} duration={range.durationInFrames}/></div></Sequence>;
      })}
      {caption && <div data-caption style={{ position:'absolute', zIndex:5, bottom:portrait ? 55 : 30, left:30, right:30, display:'flex', justifyContent:'center' }}><div style={{ whiteSpace:'pre-wrap', textAlign:'center', fontFamily:selectThemeFont(plan.theme,'fontCaption'), fontSize:portrait ? 19 : 20, lineHeight:1.5, padding:'7px 12px', borderRadius:5, background:'#080f1ce8', opacity:current?.scene.captionMode === 'subtle' ? 0.72 : 1, ...editorStyle(captionTransform,width/logicalWidth) }}>{caption}</div></div>}
    </div>
  </AbsoluteFill>;
}
