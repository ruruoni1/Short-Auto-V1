import { Composition } from 'remotion';
import { ScenePreview } from './ScenePreview.js';
import { makeCaptionRenderFixture } from './fixture/caption-data.js';
import { msToFrame, prepareScenePreview } from './plan.js';
export function CaptionPreviewRoot() {
 return <>{[false,true].map(portrait=>{
  const props=makeCaptionRenderFixture(portrait),s=props.input.production.settings;
  const plan=prepareScenePreview(props.input,props.pack,props.captionDisplayPolicy);
  return <Composition key={String(portrait)} id={portrait?'CaptionLongPortrait':'CaptionLongLandscape'} component={ScenePreview} defaultProps={props} fps={s.fps} width={s.width} height={s.height} durationInFrames={msToFrame(plan.timeline.durationMs,s.fps)}/>;
 })}</>;
}
