import { mkdirSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const target = resolve('dist/render');
const frames = [21,57,75,93,114,153,183,192,204,213,249,285,321,338,357,381];
function command(name: string, args: string[], binary = false) {
  const r = spawnSync(name,args,{maxBuffer:64*1024*1024,...(!binary ? {encoding:'utf8' as const} : {})});
  if (r.error || r.status !== 0) throw r.error ?? new Error(`${name}: ${r.stderr}`);
  return r.stdout;
}
const report: unknown[] = [];
for (const orientation of ['landscape','portrait']) {
  const file=resolve(target,`scene-preview-${orientation}.mp4`), dir=resolve(target,orientation); mkdirSync(dir,{recursive:true});
  const metadata = JSON.parse(String(command('ffprobe',['-v','error','-show_streams','-show_format','-of','json',file])));
  const v=metadata.streams.find((s:{codec_type:string})=>s.codec_type==='video'),a=metadata.streams.find((s:{codec_type:string})=>s.codec_type==='audio');
  assert.equal(v.codec_name,'h264'); assert.equal(v.nb_frames,'390'); assert.equal(v.r_frame_rate,'30/1'); assert.equal(Number(v.duration),13); assert.ok(Number(metadata.format.duration) >= 13 && Number(metadata.format.duration) < 13.1);
  assert.equal(v.width,orientation==='landscape'?1280:720); assert.equal(v.height,orientation==='landscape'?720:1280); assert.equal(a.codec_name,'aac');
  command('ffmpeg',['-v','error','-i',file,'-f','null','-']);
  for (const frame of frames) command('ffmpeg',['-v','error','-y','-i',file,'-vf',`select=eq(n\\,${frame})`,'-frames:v','1','-update','1',resolve(dir,`frame-${frame}.png`)]);
  command('ffmpeg',['-v','error','-y','-i',file,'-vf',`select='${frames.map(n=>`eq(n,${n})`).join('+')}',scale=${orientation==='landscape'?'320:180':'180:320'},tile=4x4`,'-frames:v','1','-update','1',resolve(target,`${orientation}-contact.png`)]);
  // Decode final AAC, then test audible source tone, video sound, silent still/Pause, resumed source and silent ending.
  const pcm=command('ffmpeg',['-v','error','-i',file,'-vn','-ac','1','-ar','48000','-f','f32le','pipe:1'],true) as Buffer;
  const rms=(from:number,to:number) => { let energy=0,count=0; for(let i=Math.floor(from*48000);i<Math.floor(to*48000);i++){ const n=pcm.readFloatLE(i*4);energy+=n*n;count++; } return Math.sqrt(energy/count); };
  const audioRms={source:rms(0.3,0.5),video:rms(3.9,4.1),still:rms(6.3,6.5),pause:rms(6.8,6.9),resumed:rms(7.2,7.4),ending:rms(12.6,12.8)};
  assert.ok(audioRms.source>0.01);assert.ok(audioRms.video>0.001);assert.ok(audioRms.resumed>0.01);
  assert.ok(audioRms.still<0.0001);assert.ok(audioRms.pause<0.0001);assert.ok(audioRms.ending<0.0001);
  writeFileSync(resolve(dir,'probe.json'),JSON.stringify(metadata,null,2));
  report.push({file,bytes:statSync(file).size,sha256:createHash('sha256').update(readFileSync(file)).digest('hex'),width:v.width,height:v.height,frames:390,fps:30,videoDurationSeconds:13,containerDurationSeconds:Number(metadata.format.duration),video:v.codec_name,audio:a.codec_name,sampleRate:a.sample_rate,fullDecode:'PASS',audioRms,extractedFrames:frames});
}
writeFileSync(resolve(target,'verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
