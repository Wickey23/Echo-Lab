'use client';
import { useEffect, useRef, useState } from 'react';

type AudioDevice = { deviceId: string; label: string };
type DesktopBridge = { isDesktop: boolean; platform: string; openOfficialHelp: (kind: 'driver'|'usb')=>Promise<void> };

export default function AudioSetup({ deviceId, setDeviceId, devices, refreshDevices }: {
  deviceId:string; setDeviceId:(id:string)=>void;
  devices:MediaDeviceInfo[]; refreshDevices:(permission:boolean)=>Promise<void>;
}) {
  const [desktop,setDesktop]=useState(false);
  const [step,setStep]=useState(0);
  const [test,setTest]=useState<'idle'|'testing'|'signal'|'silent'|'error'>('idle');
  const [level,setLevel]=useState(0);
  const [peak,setPeak]=useState(0);
  const [message,setMessage]=useState('');
  const stream=useRef<MediaStream|null>(null);
  const audio=useRef<AudioContext|null>(null);
  const frame=useRef<number>(0);
  const bridge=()=> (window as Window & {echoLabDesktop?:DesktopBridge}).echoLabDesktop;
  useEffect(()=>{setDesktop(Boolean(bridge()?.isDesktop));},[]);
  const stop=()=>{
    cancelAnimationFrame(frame.current);
    stream.current?.getTracks().forEach(t=>t.stop());
    stream.current=null;
    if(audio.current) void audio.current.close();
    audio.current=null;setTest('idle');setLevel(0);
  };
  useEffect(()=>()=>{cancelAnimationFrame(frame.current);stream.current?.getTracks().forEach(t=>t.stop());if(audio.current)void audio.current.close();},[]);
  async function listen() {
    stop(); setMessage('');
    if(!navigator.mediaDevices?.getUserMedia){setTest('error');setMessage('Microphone capture requires HTTPS or the desktop application.');return;}
    setTest('testing');
    try {
      const s=await navigator.mediaDevices.getUserMedia({audio:{
        ...(deviceId?{deviceId:{exact:deviceId}}:{}),
        echoCancellation:false,noiseSuppression:false,autoGainControl:false
      }});
      stream.current=s;
      const ctx=new AudioContext(), source=ctx.createMediaStreamSource(s), analyser=ctx.createAnalyser();
      audio.current=ctx;analyser.fftSize=2048;source.connect(analyser);
      const data=new Float32Array(analyser.fftSize);
      let maxPeak=0;
      const draw=()=>{
        analyser.getFloatTimeDomainData(data);
        let sum=0,peakSample=0;
        for(const value of data){sum+=value*value;peakSample=Math.max(peakSample,Math.abs(value));}
        const rms=Math.sqrt(sum/data.length);
        const visual=Math.min(100,Math.round(rms*300));
        setLevel(visual);maxPeak=Math.max(maxPeak,peakSample);setPeak(maxPeak);
        setTest(maxPeak>.008?'signal':'silent');
        frame.current=requestAnimationFrame(draw);
      };
      draw();
    }catch(err){
      setTest('error');
      setMessage(err instanceof Error?err.message:'Could not open audio input');
    }
  }
  const spark=devices.some(d=>/spark\s*go|positive\s*grid/i.test(d.label));
  const openHelp=(kind:'driver'|'usb')=>{
    if(bridge())void bridge()!.openOfficialHelp(kind).catch(()=>setMessage('Could not open the official instructions.'));
    else window.open(kind==='driver'?'https://help.positivegrid.com/hc/en-us/articles/15708382773901-Installing-Windows-Driver-for-Spark-GO':'https://help.positivegrid.com/hc/en-us/articles/13744445585933-USB-Audio-with-Spark-GO','_blank','noopener,noreferrer');
  };
  return <section className="audio-wizard">
    <div className="wizard-header"><div><span className="mini-eyebrow">{desktop?'ECHOLAB DESKTOP':'ECHOLAB WEB'} · AUDIO SETUP</span><h3>Spark GO connection check</h3><p>Check your input and verify a live guitar signal. No audio is uploaded.</p></div><span className="wizard-step">{step+1} / 3</span></div>
    <div className="wizard-progress">{[0,1,2].map(i=><button key={i} aria-label={'Setup step '+(i+1)} className={step===i?'current':step>i?'complete':''} onClick={()=>setStep(i)} />)}</div>
    {step===0&&<div className="wizard-content">
      <h4>1. Connect the hardware</h4>
      <p>Plug your guitar into Spark GO, connect Spark GO to your Windows computer with a data-capable USB-C cable and power on the amp.</p>
      <p>Windows may need Positive Grid's official driver. EchoLab does not bundle or install third-party drivers.</p>
      <div className="wizard-buttons"><button className="btn btn-secondary" onClick={()=>openHelp('driver')}>Open official driver setup ↗</button><button className="btn btn-secondary" onClick={()=>openHelp('usb')}>USB connection guide ↗</button></div>
    </div>}
    {step===1&&<div className="wizard-content">
      <h4>2. Select a recording input</h4>
      <div className="wizard-device"><select aria-label="Recording input" value={deviceId} onChange={e=>setDeviceId(e.target.value)}><option value="">System default input</option>{devices.map(d=><option key={d.deviceId} value={d.deviceId}>{d.label||'Unnamed audio input'}</option>)}</select><button className="btn btn-primary" onClick={()=>void refreshDevices(true)}>Scan devices</button></div>
      <p className={spark?'wizard-good':'wizard-note'}>{spark?'✓ Spark GO / Positive Grid input detected. Select it above.':'Spark GO not yet detected. Allow microphone access, install the official driver if needed, then scan again.'}</p>
    </div>}
    {step===2&&<div className="wizard-content">
      <h4>3. Verify a guitar signal</h4><p>Strum your guitar. The meter should respond. Avoid routing this input to speakers to prevent feedback.</p>
      <div className="wizard-meter"><span style={{width:level+'%'}}/></div>
      <div className="wizard-meter-label"><span>INPUT LEVEL</span><span>{peak>=.99?'CLIPPING — LOWER THE INPUT':test==='signal'?'SIGNAL DETECTED':test==='testing'||test==='silent'?'LISTENING…':'NO ACTIVE TEST'}</span></div>
      {message&&<p className="wizard-note">{message}</p>}
      <div className="wizard-buttons"><button className="btn btn-primary" onClick={()=>void listen()}>{test==='idle'?'Start input test':'Restart test'}</button><button className="btn btn-secondary" onClick={stop}>Stop test</button></div>
      <p className="wizard-note">A visible signal confirms capture input, not driver health, noise floor, or accurate overdub latency. A round-trip calibration test is still required.</p>
    </div>}
    <div className="wizard-bottom"><button className="btn btn-ghost" disabled={step===0} onClick={()=>{stop();setStep(x=>Math.max(0,x-1));}}>Back</button><button className="btn btn-primary" disabled={step===2} onClick={()=>{stop();setStep(x=>Math.min(2,x+1));}}>Next step →</button></div>
  </section>;
}
