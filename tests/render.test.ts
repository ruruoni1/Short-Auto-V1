import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { prepareScenePreview, frameToMs, msToFrame, frameInterval, previousTransitionScene, SceneRenderError } from '../src/render/plan.js';
import { makeRenderFixture } from '../src/render/fixture/data.js';
import { samplePlannedSceneMotion } from '../src/index.js';
import * as Scenes from '../src/render/scenes/index.js';

for (const fps of [24,30,60,29.97]) test(`frame half-open quantization at ${fps} fps`, () => {
  for (const ms of [0,1,33,34,99,100,101,333,1200,12999]) {
    const first = msToFrame(ms,fps);
    assert.ok(frameToMs(first,fps) >= ms);
    if (first > 0) assert.ok(frameToMs(first-1,fps) < ms);
  }
  const a = frameInterval(101,333,fps), b = frameInterval(333,901,fps);
  assert.equal(a.from+a.durationInFrames,b.from);
});
test('frame conversion rejects malformed values and reversed ranges', () => {
  for (const n of [NaN,Infinity,-1,0.5]) { assert.throws(() => frameToMs(n,30)); assert.throws(() => msToFrame(n,30)); }
  assert.throws(() => frameInterval(2,1,30)); assert.throws(() => msToFrame(1,0));
  assert.equal(frameInterval(1,2,30).durationInFrames,0);
});
for (const portrait of [false,true]) test(`fixture compiles all 9 types at ${portrait ? '9:16' : '16:9'} and remains draft`, () => {
  const f = makeRenderFixture(portrait), before = structuredClone(f), p = prepareScenePreview(f.input,f.pack);
  assert.equal(p.runtime.scenes.length,9); assert.equal(p.timeline.durationMs,13000);
  assert.equal(msToFrame(p.timeline.durationMs,30),390);
  assert.equal(p.assets.scenes.find(s => s.id === 'scene4')!.preview,'placeholder');
  assert.equal(p.assets.scenes.find(s => s.id === 'scene3')!.preview,'generated_graphic');
  assert.equal(f.input.production.project.status,'draft'); assert.deepEqual(f,before);
});
test('actual fixture Insert caption stop, Overlay concurrency, Pause and Source-motion continuation', () => {
  const f=makeRenderFixture(),p=prepareScenePreview(f.input,f.pack);
  assert.equal(p.runtime.getState(3599).caption!.id,15);
  assert.equal(p.runtime.getState(3600).kind,'insert'); assert.equal(p.runtime.getState(3600).caption,null);
  assert.equal(p.runtime.getState(3600).overlays.length,1);
  assert.equal(p.runtime.getState(4400).caption!.id,19);
  assert.equal(p.runtime.getState(6200).kind,'insert'); assert.equal(p.runtime.getState(6700).kind,'pause');
  const s=p.runtime.getState(7000); assert.equal(s.sourceTimeMs,5400); assert.equal(s.scenes[0]!.scene.id,'scene4');
  const motion=samplePlannedSceneMotion(s.scenes[0]!,s.sourceTimeMs!);
  assert.equal(motion.progress,0.5); // Output stop did not advance SLOW_ZOOM.
  assert.equal(p.runtime.getState(12400).kind,'ending'); assert.equal(p.runtime.getState(13000).kind,'outside');
});
for (const mode of ['FREEZE_FOCUS','MATCH']) test(`unsupported ${mode} blocks preview/render before frames`, () => {
  const f=makeRenderFixture();
  if (mode === 'MATCH') f.input.production.scenes[0]!.transition='MATCH';
  else f.input.production.scenes[0]!.motion={ preset:'FREEZE_FOCUS', intensity:'normal' };
  assert.throws(() => prepareScenePreview(f.input,f.pack), e => e instanceof SceneRenderError && e.diagnostics.some(d => d.code.includes(mode)));
});
test('minimal renderer explicitly rejects overlap, aspect mismatch, and Scene video', () => {
  const f=makeRenderFixture(); f.input.production.scenes[1]!.captionRange={...f.input.production.scenes[0]!.captionRange};
  assert.throws(() => prepareScenePreview(f.input,f.pack), /RENDER_SCENE_OVERLAP_UNSUPPORTED/);
  const a=makeRenderFixture(); a.input.production.settings.height=800;
  assert.throws(() => prepareScenePreview(a.input,a.pack), /RENDER_ASPECT_RATIO/);
  const b=makeRenderFixture(); b.input.production.scenes[0]!.visual={strategy:'asset',assetId:'moving'};
  assert.throws(() => prepareScenePreview(b.input,b.pack), /RENDER_SCENE_VIDEO_UNSUPPORTED/);
});
test('transition adjacency excludes stop boundaries but supports contiguous sources', () => {
  const f=makeRenderFixture(),p=prepareScenePreview(f.input,f.pack);
  assert.equal(previousTransitionScene(p,p.runtime.scenes[2]!)!.scene.id,'scene1');
  assert.equal(previousTransitionScene(p,p.runtime.scenes[3]!),null);
});
const components = [Scenes.Hook,Scenes.Keyword,Scenes.Question,Scenes.Compare,Scenes.Explain,Scenes.QuoteAnalysis,Scenes.Relation,Scenes.Concept,Scenes.Recap];
components.forEach((component,index) => test(`real React markup ${component.name} renders nullable text, static transforms and stagger context`, () => {
  const f=makeRenderFixture(),p=prepareScenePreview(f.input,f.pack),scene=p.runtime.scenes[index]!;
  const html=renderToStaticMarkup(createElement(component,{ plan:scene,sourceTimeMs:scene.sourceStartMs+700,theme:p.theme,portrait:true }));
  assert.ok(html.includes(`data-scene-type="${scene.scene.type}"`)); assert.ok(!html.includes('undefined')); assert.ok(!html.includes('NaN'));
  scene.scene.content={mainText:null,subText:null,jpText:null,emphasis:[]};
  assert.doesNotThrow(() => renderToStaticMarkup(createElement(component,{plan:scene,sourceTimeMs:scene.sourceStartMs,theme:p.theme,portrait:false})));
}));

test('editor transform uses output pixels outside the source-time animation wrapper', async () => {
  const { editorStyle } = await import('../src/render/scenes/shared.js');
  assert.deepEqual(editorStyle({ offsetX: 10, offsetY: -20, scale: 1.2, fontSize: 60, width: 300 },2), {translate:'5px -10px',scale:1.2,fontSize:30,width:150});
});
