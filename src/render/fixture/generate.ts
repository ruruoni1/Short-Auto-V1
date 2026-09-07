import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
// Own synthetic signals/shapes only. Existing assets are preserved; delete manually to regenerate.
const target = resolve('remotion/public/synthetic'); mkdirSync(target, { recursive: true });
function generate(name: string, args: string[]) {
  const file = resolve(target, name); if (existsSync(file)) return;
  const result = spawnSync('ffmpeg', ['-hide_banner','-loglevel','error',...args,file], { stdio: 'inherit' });
  if (result.error || result.status !== 0) throw result.error ?? new Error(`ffmpeg failed for ${name}`);
}
generate('tts.wav', ['-f','lavfi','-i','aevalsrc=0.07*sin(2*PI*(330+110*floor(t/1.2))*t):s=48000:d=10.8','-c:a','pcm_s16le']);
generate('moving.mp4', ['-f','lavfi','-i','color=c=0x243a50:s=640x360:r=30:d=2','-f','lavfi','-i','sine=frequency=660:sample_rate=48000:duration=2','-vf',"drawbox=x=100:y=70:w=440:h=220:color=0xe7bc69:t=5,drawgrid=w=80:h=60:t=1:c=0x536779,hue=h=30*t",'-af','volume=0.3','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest']);
generate('still.png', ['-f','lavfi','-i','color=c=0x243a50:s=640x360','-vf','drawbox=x=180:y=50:w=280:h=260:color=0xe7bc69:t=fill,drawbox=x=210:y=80:w=220:h=200:color=0x101c2c:t=fill','-frames:v','1','-update','1']);
writeFileSync(resolve(target,'PROVENANCE.txt'),'Synthetic fixture assets generated locally by src/render/fixture/generate.ts using FFmpeg color, geometry and sine signals. No third-party media. tts.wav is a test tone, not speech.\n');
console.log(target);
