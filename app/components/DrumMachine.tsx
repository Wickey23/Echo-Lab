'use client';

import { useEffect, useRef, useState } from 'react';

const voices = ['Kick', 'Snare', 'Closed hat', 'Open hat'];
const colors = ['#91e4c5', '#f7a09a', '#a6a5fa', '#f5c879'];
const pattern = () => [
  Array.from({length:16},(_,i)=>i%4===0),
  Array.from({length:16},(_,i)=>i===4||i===12),
  Array.from({length:16},(_,i)=>i%2===0),
  Array.from({length:16},()=>false)
];

function noise(ctx: BaseAudioContext, duration: number) {
  const buf = ctx.createBuffer(1, Math.floor(duration*ctx.sampleRate),ctx.sampleRate);
  const a = buf.getChannelData(0);
  for(let i=0;i<a.length;i++) a[i]=Math.random()*2-1;
  return buf;
}
function hit(ctx: BaseAudioContext, output: AudioNode, voice: number, time: number, velocity=0.75) {
  const gain=ctx.createGain();gain.connect(output);
  if(voice===0){
    const osc=ctx.createOscillator();osc.type='sine';
    osc.frequency.setValueAtTime(155,time);
    osc.frequency.exponentialRampToValueAtTime(43,time+.16);
    gain.gain.setValueAtTime(velocity,time);
    gain.gain.exponentialRampToValueAtTime(.001,time+.38);
    osc.connect(gain);osc.start(time);osc.stop(time+.4);
  }else{
    const source=ctx.createBufferSource();
    const dur=voice===1?.22:voice===2?.09:.36;
    source.buffer=noise(ctx,dur);
    const filter=ctx.createBiquadFilter(); filter.type=voice===1?'bandpass':'highpass';
    filter.frequency.value=voice===1?1800:7500;
    gain.gain.setValueAtTime(velocity*(voice===1?.7:.42),time);
    gain.gain.exponentialRampToValueAtTime(.001,time+dur);
    source.connect(filter).connect(gain);source.start(time);source.stop(time+dur);
    if(voice===1){
      const osc=ctx.createOscillator(), tone=ctx.createGain();
      osc.type='triangle';osc.frequency.value=178;
      tone.gain.setValueAtTime(.3*velocity,time);
      tone.gain.exponentialRampToValueAtTime(.001,time+.12);
      osc.connect(tone).connect(output);osc.start(time);osc.stop(time+.13);
    }
  }
}
function wav(audio:AudioBuffer):Blob{
 const channels=2, length=audio.length, bytes=44+length*channels*2, ab=new ArrayBuffer(bytes), v=new DataView(ab);
 const put=(p:number,s:string)=>{for(let i=0;i<s.length;i++)v.setUint8(p+i,s.charCodeAt(i));};
 put(0,'RIFF');v.setUint32(4,bytes-8,true);put(8,'WAVE');put(12,'fmt ');v.setUint32(16,16,true);
 v.setUint16(20,1,true);v.setUint16(22,channels,true);v.setUint32(24,audio.sampleRate,true);
 v.setUint32(28,audio.sampleRate*channels*2,true);v.setUint16(32,channels*2,true);v.setUint16(34,16,true);
 put(36,'data');v.setUint32(40,bytes-44,true);
 let offset=44;
 const l=audio.getChannelData(0),r=audio.getChannelData(1);
 for(let i=0;i<length;i++)for(const sample of [l[i],r[i]]){
   const val=Math.max(-1,Math.min(1,sample));
   v.setInt16(offset,val<0?val*32768:val*32767,true);offset+=2;
 }
 return new Blob([ab],{type:'audio/wav'});
}
export default function DrumMachine({bpm,bars,onAdd}:{bpm:number;bars:number;onAdd:(blob:Blob,name:string)=>Promise<void>}) {
 const [steps,setSteps]=useState<boolean[][]>(pattern);
 const [playing,setPlaying]=useState(false);
 const [position,setPosition]=useState(0);
 const [saving,setSaving]=useState(false);
 const [kit,setKit]=useState('Indie kit');
 const ctxRef=useRef<AudioContext|null>(null);
 const timer=useRef<ReturnType<typeof setInterval>|null>(null);
 const progress=useRef(0);
 const startTime=useRef(0);
 const stepsRef=useRef(steps);
 useEffect(()=>{stepsRef.current=steps;},[steps]);
 useEffect(()=>()=>{if(timer.current)clearInterval(timer.current);void ctxRef.current?.close();},[]);
 const stop=()=>{
   if(timer.current)clearInterval(timer.current);
   timer.current=null;setPlaying(false);setPosition(0);
   void ctxRef.current?.close();ctxRef.current=null;
 };
 const play=async()=>{
   if(playing){stop();return;}
   const ctx=new AudioContext();ctxRef.current=ctx;await ctx.resume();
   startTime.current=ctx.currentTime+.04;progress.current=0;
   setPlaying(true);
   const stepDuration=60/bpm/4;
   timer.current=setInterval(()=>{
     const c=ctxRef.current;if(!c)return;
     while(startTime.current+progress.current*stepDuration<c.currentTime+.11){
       const i=progress.current%16,t=startTime.current+progress.current*stepDuration;
       stepsRef.current.forEach((row,voice)=>{if(row[i])hit(c,c.destination,voice,Math.max(t,c.currentTime+.001));});
       progress.current++;
     }
     setPosition(Math.floor((c.currentTime-startTime.current)/stepDuration)%16);
   },25);
 };
 const add=async()=>{
   stop();setSaving(true);
   try{
     const length=bars*4*60/bpm,ctx=new OfflineAudioContext(2,Math.ceil(length*44100),44100);
     const stepDuration=60/bpm/4;
     for(let s=0;s<bars*16;s++){
       const i=s%16;
       steps.forEach((row,voice)=>{if(row[i])hit(ctx,ctx.destination,voice,s*stepDuration);});
     }
     const audio=await ctx.startRendering();
     await onAdd(wav(audio),'Drum beat — '+kit);
   }finally{setSaving(false);}
 };
 return <div className="drum-workspace">
   <div className="drum-head"><div><span className="mini-eyebrow">RHYTHM BUILDER</span><h3>Drum Machine</h3><p>Program a beat. Preview it. Add a real audio clip to your project.</p></div>
   <select aria-label="Drum kit" value={kit} onChange={e=>setKit(e.target.value)}><option>Indie kit</option><option>Dream kit</option><option>Lo-fi kit</option></select></div>
   <div className="step-grid">
     <div className="step-numbers"><span></span>{Array.from({length:16},(_,i)=><span key={i}>{i%4===0?Math.floor(i/4)+1:''}</span>)}</div>
     {voices.map((voice,row)=><div className="step-row" key={voice}><span className="voice-title" style={{color:colors[row]}}>{voice}</span>{steps[row].map((on,i)=><button key={i} type="button" className={['step-pad',on?'active':'',playing&&position===i?'now':'',i%4===0?'measure':''].join(' ')} style={{'--pad-color':colors[row]} as React.CSSProperties} aria-label={voice+' step '+(i+1)} aria-pressed={on} onClick={()=>setSteps(all=>all.map((r,j)=>j===row?r.map((v,k)=>k===i?!v:v):r))}></button>)}</div>)}
   </div>
   <div className="drum-actions"><button className="btn btn-secondary" onClick={()=>setSteps(pattern())}>Reset pattern</button><button className="btn btn-secondary" onClick={()=>void play()}>{playing?'■ Stop preview':'▶ Preview beat'}</button><button className="btn btn-primary" disabled={saving} onClick={()=>void add()}>{saving?'Rendering…':'＋ Add beat to timeline'}</button></div>
   <p className="fine-print">Synthesized drum sounds are generated locally; no sample libraries or external audio services are required.</p>
 </div>;
}
