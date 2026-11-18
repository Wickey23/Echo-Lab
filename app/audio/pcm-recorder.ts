// Local, uncompressed mono PCM recording via AudioWorklet.
// This is not an ASIO engine and does not compensate device round-trip latency.
const PROCESSOR = `
class EchoLabPcmCapture extends AudioWorkletProcessor {
 constructor(){
   super();this.frames=[];this.samples=0;this.stopped=false;
   this.port.onmessage = event => {
     if(event.data?.type==='stop'){
       this.flush();
       this.stopped=true;
       this.port.postMessage({type:'finished'});
     }
   };
 }
 flush(){
   if(!this.samples)return;
   const chunk=new Float32Array(this.samples);
   let offset=0;
   for(const part of this.frames){chunk.set(part,offset);offset+=part.length;}
   this.frames=[];this.samples=0;
   this.port.postMessage({type:'samples',buffer:chunk.buffer},[chunk.buffer]);
 }
 process(inputs,outputs){
   for(const output of outputs)for(const channel of output)channel.fill(0);
   const input=inputs[0]?.[0];
   if(!this.stopped && input && input.length){
     this.frames.push(new Float32Array(input));this.samples+=input.length;
     if(this.samples>=4096)this.flush();
   }
   return !this.stopped;
 }
}
registerProcessor('echolab-pcm-capture', EchoLabPcmCapture);
`;

function toWav(chunks:Float32Array[],sampleRate:number):Blob{
  const frames=chunks.reduce((total,part)=>total+part.length,0);
  const bytes=44+frames*2, ab=new ArrayBuffer(bytes),view=new DataView(ab);
  const put=(index:number,word:string)=>{for(let i=0;i<word.length;i++)view.setUint8(index+i,word.charCodeAt(i));};
  put(0,'RIFF');view.setUint32(4,bytes-8,true);put(8,'WAVE');put(12,'fmt ');
  view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);
  view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*2,true);
  view.setUint16(32,2,true);view.setUint16(34,16,true);put(36,'data');view.setUint32(40,bytes-44,true);
  let offset=44;
  for(const chunk of chunks)for(const value of chunk){
    const x=Math.min(1,Math.max(-1,value));
    view.setInt16(offset,x<0?Math.round(x*32768):Math.round(x*32767),true);
    offset+=2;
  }
  return new Blob([ab],{type:'audio/wav'});
}

export class PcmRecorder{
  private context:AudioContext|null=null;
  private source:MediaStreamAudioSourceNode|null=null;
  private worklet:AudioWorkletNode|null=null;
  private silent:GainNode|null=null;
  private chunks:Float32Array[]=[];
  private sampleRate=48000;
  private complete:(()=>void)|null=null;
  async start(stream:MediaStream){
    const context=new AudioContext({latencyHint:'interactive'});
    this.context=context;this.sampleRate=context.sampleRate;
    const module=new Blob([PROCESSOR],{type:'application/javascript'});
    const url=URL.createObjectURL(module);
    try {await context.audioWorklet.addModule(url);}
    finally {URL.revokeObjectURL(url);}
    const node=new AudioWorkletNode(context,'echolab-pcm-capture',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1]});
    this.worklet=node;
    node.port.onmessage=(event:MessageEvent<{type:string;buffer?:ArrayBuffer}>)=>{
      if(event.data.type==='samples'&&event.data.buffer)this.chunks.push(new Float32Array(event.data.buffer));
      if(event.data.type==='finished')this.complete?.();
    };
    this.source=context.createMediaStreamSource(stream);
    this.silent=context.createGain();this.silent.gain.value=0;
    this.source.connect(node);node.connect(this.silent).connect(context.destination);
    await context.resume();
  }
  async stop():Promise<Blob>{
    const context=this.context,node=this.worklet;
    if(!context||!node)throw new Error('PCM recorder has not started');
    const done=new Promise<void>((resolve,reject)=>{
      this.complete=resolve;
      const watchdog=setTimeout(()=>reject(new Error('Audio capture did not finish')),1500);
      this.complete=()=>{clearTimeout(watchdog);resolve();};
    });
    node.port.postMessage({type:'stop'});
    try {await done;}
    finally {
      this.source?.disconnect();node.disconnect();this.silent?.disconnect();
      node.port.close();await context.close();
      this.source=null;this.worklet=null;this.context=null;this.silent=null;
    }
    return toWav(this.chunks,this.sampleRate);
  }
  async abort(){
    this.source?.disconnect();this.worklet?.disconnect();this.silent?.disconnect();
    await this.context?.close();
    this.source=null;this.worklet=null;this.context=null;
  }
}
