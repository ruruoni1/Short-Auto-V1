import {mkdirSync,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const dir='remotion/public/caption-long';mkdirSync(dir,{recursive:true});
if(!existsSync(`${dir}/tts.wav`)) {
 const result=spawnSync('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=18','-af','volume=0.3','-c:a','pcm_s16le',`${dir}/tts.wav`],{stdio:'inherit'});
 if(result.error||result.status!==0)throw result.error??new Error('Synthetic audio generation failed');
}
