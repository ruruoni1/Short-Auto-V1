import { Composition } from 'remotion';
import { ScenePreview } from './ScenePreview.js';
import { makeRenderFixture } from './fixture/data.js';
import { msToFrame, prepareScenePreview } from './plan.js';
export function PreviewRoot() {
  return <>{[false,true].map(portrait => {
    const props = makeRenderFixture(portrait), { settings } = props.input.production;
    const plan = prepareScenePreview(props.input,props.pack);
    return <Composition key={String(portrait)} id={portrait ? 'ScenePreviewPortrait' : 'ScenePreviewLandscape'} component={ScenePreview} defaultProps={props} fps={settings.fps} width={settings.width} height={settings.height} durationInFrames={msToFrame(plan.timeline.durationMs,settings.fps)}/>;
  })}</>;
}
