import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {prepareScenePreview} from '../plan.js';
import {makeCaptionRenderFixture} from './caption-data.js';
const dir='dist/render/caption-long';mkdirSync(dir,{recursive:true});
function run(tool:string,args:string[]) {const r=spawnSync(tool,args,{encoding:'utf8',maxBuffer:32*1024*1024});if(r.error||r.status!==0)throw r.error??new Error(r.stderr);return r.stdout;}
const report=[];
for(const portrait of [false,true]) {
 const name=portrait?'portrait':'landscape',file=`dist/render/caption-long-${name}.mp4`,f=makeCaptionRenderFixture(portrait);
 const plan=prepareScenePreview(f.input,f.pack,f.captionDisplayPolicy),active=plan.captionDisplayUnits!;
 assert.ok(active.every(u=>u.lines.length<=f.captionDisplayPolicy.maxLinesPerUnit));
 const frames=[...active.map(u=>Math.ceil(((u.startMs+u.endMs)/2+(u.startMs>=6000?1000:0))*30/1000)),185,200,405,500,577].sort((a,b)=>a-b);
 const probe=JSON.parse(run('ffprobe',['-v','error','-show_streams','-show_format','-of','json',file]));
 const video=probe.streams.find((s:{codec_type:string})=>s.codec_type==='video');assert.equal(video.nb_frames,'585');assert.equal(video.duration,'19.500000');
 assert.equal(video.width,portrait?720:1280);assert.equal(video.height,portrait?1280:720);assert.equal(video.r_frame_rate,'30/1');
 run('ffmpeg',['-v','error','-i',file,'-f','null','-']);
 const out=`${dir}/${name}`;mkdirSync(out,{recursive:true});
 for(const frame of frames)run('ffmpeg',['-v','error','-y','-i',file,'-vf',`select=eq(n\\,${frame})`,'-frames:v','1','-update','1',`${out}/frame-${frame}.png`]);
 run('ffmpeg',['-v','error','-y','-i',file,'-vf',`select='${frames.map(n=>`eq(n,${n})`).join('+')}',scale=${portrait?'240:426':'426:240'},tile=4x${Math.ceil(frames.length/4)}`,'-frames:v','1','-update','1',`${dir}/${name}-contact.png`]);
 writeFileSync(`${out}/probe.json`,JSON.stringify(probe,null,2));
 report.push({file,bytes:statSync(file).size,sha256:createHash('sha256').update(readFileSync(file)).digest('hex'),frames:585,videoDuration:19.5,containerDuration:Number(probe.format.duration),fullDecode:'PASS',sampledFrames:frames,policy:f.captionDisplayPolicy,units:active.map(u=>({caption:u.sourceCaptionId,index:u.unitIndex,lines:u.lines.map(l=>l.text)}))});
}
writeFileSync(`${dir}/verification.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report.map(({units,...rest})=>rest),null,2));
