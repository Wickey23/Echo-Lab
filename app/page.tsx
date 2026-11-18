'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import DrumMachine from './components/DrumMachine';

type Track = { id: string; name: string; color: string; volume: number; pan: number; muted: boolean; solo: boolean };
type Clip = { id: string; trackId: string; start: number; name: string; peaks: number[] };
type Project = { name: string; bpm: number; bars: number; tracks: Track[]; clips: Clip[] };
type Session = { started: number; resume: number; nextAt: number; length: number };
const COLORS = ['#86e0bf', '#b8a0f9', '#ffa86d', '#70b8ee', '#f18eb6', '#f0d37e'];
const makeTrack = (i: number): Track => ({ id: crypto.randomUUID(), name: i === 0 ? 'Guitar 1' : 'Track ' + (i + 1), color: COLORS[i % COLORS.length], volume: 0.85, pan: 0, muted: false, solo: false });
const initialProject = (): Project => ({ name: 'Untitled session', bpm: 90, bars: 4, tracks: [makeTrack(0)], clips: [] });
const loopSeconds = (p: Project) => p.bars * 4 * 60 / p.bpm;
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const dbName = 'echolab-audio-v1';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('clips')) req.result.createObjectStore('clips', { keyPath: 'id' }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function dbWrite(id: string, blob: Blob) {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('clips', 'readwrite');
    tx.objectStore('clips').put({ id, blob });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
async function dbReadAll(): Promise<Array<{ id: string; blob: Blob }>> {
  const db = await openDB();
  const rows = await new Promise<Array<{ id: string; blob: Blob }>>((resolve, reject) => {
    const req = db.transaction('clips', 'readonly').objectStore('clips').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  db.close(); return rows;
}
async function dbDelete(id: string) {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('clips', 'readwrite');
    tx.objectStore('clips').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
function getPeaks(buffer: AudioBuffer): number[] {
  const data = buffer.getChannelData(0), count = 110, out = [];
  const block = Math.max(1, Math.floor(data.length / count));
  for (let i = 0; i < count; i++) {
    let max = 0;
    for (let j = i * block; j < Math.min(data.length, (i + 1) * block); j += 4) max = Math.max(max, Math.abs(data[j]));
    out.push(Math.max(0.04, max));
  }
  return out;
}
function Wave({ peaks, color }: { peaks: number[]; color: string }) {
  return <svg className="wave" preserveAspectRatio="none" viewBox="0 0 220 56" aria-hidden="true">{peaks.map((p, i) => <line key={i} x1={i * 2 + 1} x2={i * 2 + 1} y1={28 - p * 23} y2={28 + p * 23} stroke={color} strokeWidth="1.45" opacity=".88" />)}</svg>;
}
function wavBlob(audio: AudioBuffer): Blob {
  const channels = audio.numberOfChannels, length = audio.length, bytes = 44 + length * channels * 2;
  const ab = new ArrayBuffer(bytes), dv = new DataView(ab);
  const str = (at: number, s: string) => { for (let i = 0; i < s.length; i++) dv.setUint8(at + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); dv.setUint32(4, bytes - 8, true); str(8, 'WAVE'); str(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, channels, true);
  dv.setUint32(24, audio.sampleRate, true); dv.setUint32(28, audio.sampleRate * channels * 2, true);
  dv.setUint16(32, channels * 2, true); dv.setUint16(34, 16, true); str(36, 'data'); dv.setUint32(40, bytes - 44, true);
  const samples = Array.from({ length: channels }, (_, ch) => audio.getChannelData(ch));
  let idx = 44;
  for (let i = 0; i < length; i++) for (let c = 0; c < channels; c++) {
    const v = clamp(samples[c][i], -1, 1);
    dv.setInt16(idx, v < 0 ? v * 32768 : v * 32767, true); idx += 2;
  }
  return new Blob([ab], { type: 'audio/wav' });
}
const formatTime = (s: number) => { const v = Math.max(0, Math.floor(s)); return String(Math.floor(v / 60)).padStart(2, '0') + ':' + String(v % 60).padStart(2, '0'); };

export default function Studio() {
  const [project, setProject] = useState<Project | null>(null);
  const [screen, setScreen] = useState<'home' | 'studio'>('home');
  const [trackPicker, setTrackPicker] = useState(false);
  const [panel, setPanel] = useState<'none' | 'drums' | 'mixer' | 'loops' | 'input' | 'fx'>('none');
  const [selected, setSelected] = useState('');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [playing, setPlaying] = useState(false);
  const [recording, setRecording] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [status, setStatus] = useState('Ready to create');
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const buffers = useRef<Map<string, AudioBuffer>>(new Map());
  const projectRef = useRef<Project | null>(null);
  const selectedRef = useRef('');
  const session = useRef<Session | null>(null);
  const runningSources = useRef<AudioBufferSourceNode[]>([]);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const inputStream = useRef<MediaStream | null>(null);
  const recordStart = useRef(0);
  const recordingTrack = useRef('');
  const recordName = useRef('');
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileCount = project?.clips.length || 0;

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      let saved: Project;
      try {
        const raw = localStorage.getItem('echolab-project-v1');
        saved = raw ? JSON.parse(raw) as Project : initialProject();
        if (!Array.isArray(saved.tracks) || !Array.isArray(saved.clips) || !saved.tracks.length) saved = initialProject();
      } catch { saved = initialProject(); }
      if (cancelled) return;
      setProject(saved); projectRef.current = saved;
      setSelected(saved.tracks[0].id); selectedRef.current = saved.tracks[0].id;
      try {
        const rows = await dbReadAll();
        const ctx = new AudioContext(); ctxRef.current = ctx;
        for (const row of rows) {
          if (cancelled) break;
          try { buffers.current.set(row.id, await ctx.decodeAudioData(await row.blob.arrayBuffer())); } catch { /* bad recording: keep metadata until removed */ }
        }
      } catch { setStatus('Local audio storage unavailable. Try normal browser mode.'); }
    };
    void load();
    return () => { cancelled = true; if (tick.current) clearInterval(tick.current); inputStream.current?.getTracks().forEach(t => t.stop()); void ctxRef.current?.close(); };
  }, []);

  useEffect(() => { if (project) { projectRef.current = project; if (persistTimer.current) clearTimeout(persistTimer.current); persistTimer.current = setTimeout(() => { try { localStorage.setItem('echolab-project-v1', JSON.stringify(project)); } catch { setStatus('Storage is full. Export your project audio.'); } }, 250); } }, [project]);
  useEffect(() => { selectedRef.current = selected; }, [selected]);

  const update = (fn: (p: Project) => Project) => setProject(old => old ? fn(old) : old);
  const getContext = async (): Promise<AudioContext> => {
    if (!ctxRef.current || ctxRef.current.state === 'closed') ctxRef.current = new AudioContext();
    if (ctxRef.current.state === 'suspended') await ctxRef.current.resume();
    return ctxRef.current;
  };
  const stopTransport = useCallback(() => {
    if (tick.current) clearInterval(tick.current);
    tick.current = null;
    runningSources.current.forEach(s => { try { s.stop(); } catch { /* source already stopped */ } });
    runningSources.current = [];
    session.current = null;
    setPlaying(false); setPlayhead(0);
  }, []);

  const schedule = (ctx: AudioContext, when: number, from: number, length: number) => {
    const p = projectRef.current; if (!p) return;
    const soloActive = p.tracks.some(t => t.solo);
    for (const clip of p.clips) {
      const track = p.tracks.find(t => t.id === clip.trackId), buffer = buffers.current.get(clip.id);
      if (!track || !buffer || track.muted || (soloActive && !track.solo)) continue;
      const start = Math.max(from, clip.start), end = Math.min(length, clip.start + buffer.duration);
      if (end <= start) continue;
      const source = ctx.createBufferSource(), gain = ctx.createGain(), pan = ctx.createStereoPanner();
      source.buffer = buffer; gain.gain.value = track.volume; pan.pan.value = track.pan;
      source.connect(gain).connect(pan).connect(ctx.destination);
      source.start(Math.max(ctx.currentTime + .005, when + start - from), start - clip.start, end - start);
      runningSources.current.push(source);
      source.onended = () => { runningSources.current = runningSources.current.filter(x => x !== source); source.disconnect(); gain.disconnect(); pan.disconnect(); };
    }
  };

  const startTransport = async () => {
    if (playing) { stopTransport(); return; }
    try {
      const ctx = await getContext(), p = projectRef.current; if (!p) return;
      const length = loopSeconds(p), when = ctx.currentTime + .045;
      session.current = { started: when, resume: 0, nextAt: when + length, length };
      schedule(ctx, when, 0, length);
      setPlaying(true); setStatus('Loop playback');
      tick.current = setInterval(() => {
        const s = session.current, c = ctxRef.current; if (!s || !c) return;
        if (c.currentTime >= s.nextAt - .12) {
          schedule(c, s.nextAt, 0, s.length);
          s.nextAt += s.length;
        }
        setPlayhead(((c.currentTime - s.started) % s.length + s.length) % s.length);
      }, 40);
    } catch { setStatus('Audio playback could not start.'); }
  };

  const refreshDevices = async (askPermission = false) => {
    if (!navigator.mediaDevices?.enumerateDevices) { setStatus('Audio input requires HTTPS or localhost.'); return; }
    try {
      if (askPermission) { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach(t => t.stop()); }
      const list = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput');
      setDevices(list);
      if (list.length && !deviceId) setDeviceId(list[0].deviceId);
      setStatus(list.length ? list.length + ' audio input(s) available' : 'No audio input detected');
    } catch { setStatus('Microphone permission denied or device unavailable.'); }
  };

  const addAudio = async (blob: Blob, trackId: string, name: string, start: number) => {
    setBusy(true);
    try {
      const ctx = await getContext();
      const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
      const id = crypto.randomUUID();
      await dbWrite(id, blob);
      buffers.current.set(id, buffer);
      update(p => ({ ...p, clips: [...p.clips, { id, trackId, start: clamp(start, 0, Math.max(0, loopSeconds(p) - .05)), name, peaks: getPeaks(buffer) }] }));
      setStatus('Saved ' + name + ' locally');
    } catch { setStatus('Could not decode/save audio. Try WAV, MP3, or M4A.'); }
    setBusy(false);
  };

  const importFile = async (file: File) => {
    if (!projectRef.current) return;
    const p = projectRef.current, t = makeTrack(p.tracks.length);
    t.name = file.name.replace(/\.[^.]+$/, '').slice(0, 32);
    update(x => ({ ...x, tracks: [...x.tracks, t] }));
    setSelected(t.id);
    await addAudio(file, t.id, file.name, 0);
  };

  const stopRecording = () => { if (mediaRecorder.current?.state === 'recording') mediaRecorder.current.stop(); };

  const startRecording = async () => {
    if (recording) { stopRecording(); return; }
    if (!navigator.mediaDevices?.getUserMedia) { setStatus('Recording requires HTTPS / localhost.'); return; }
    try {
      const p = projectRef.current; if (!p) return;
      await getContext();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { ...(deviceId ? { deviceId: { ideal: deviceId } } : {}), echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      inputStream.current = stream;
      const chosen = p.tracks.find(t => t.id === selectedRef.current) || p.tracks[0];
      let target = chosen.id;
      if (p.clips.some(c => c.trackId === chosen.id)) {
        const layer = makeTrack(p.tracks.length);
        layer.name = 'Overdub ' + p.tracks.length;
        target = layer.id;
        update(x => ({ ...x, tracks: [...x.tracks, layer] }));
        setSelected(target);
      }
      recordingTrack.current = target;
      recordName.current = 'Take ' + new Date().toLocaleTimeString();
      const s = session.current, ctx = ctxRef.current;
      recordStart.current = s && ctx ? ((ctx.currentTime - s.started) % s.length + s.length) % s.length : 0;
      const chunks: BlobPart[] = [];
      const rec = new MediaRecorder(stream);
      mediaRecorder.current = rec;
      rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach(t => t.stop()); inputStream.current = null;
        setRecording(false);
        const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
        if (blob.size) void addAudio(blob, recordingTrack.current, recordName.current, recordStart.current);
      };
      rec.start();
      setRecording(true); setStatus('Recording audio — use headphones to prevent feedback');
    } catch { inputStream.current?.getTracks().forEach(t => t.stop()); setStatus('Recording failed. Check microphone permission and device selection.'); }
  };

  const exportWav = async () => {
    const p = projectRef.current; if (!p) return;
    setBusy(true); setStatus('Rendering mix…');
    try {
      const duration = loopSeconds(p), sampleRate = 44100;
      const offline = new OfflineAudioContext(2, Math.ceil(duration * sampleRate), sampleRate);
      const anySolo = p.tracks.some(t => t.solo);
      for (const clip of p.clips) {
        const track = p.tracks.find(t => t.id === clip.trackId), buffer = buffers.current.get(clip.id);
        if (!track || !buffer || track.muted || (anySolo && !track.solo) || clip.start >= duration) continue;
        const src = offline.createBufferSource(), gain = offline.createGain(), pan = offline.createStereoPanner();
        src.buffer = buffer; gain.gain.value = track.volume; pan.pan.value = track.pan;
        src.connect(gain).connect(pan).connect(offline.destination);
        src.start(clip.start, 0, Math.min(buffer.duration, duration - clip.start));
      }
      const wav = wavBlob(await offline.startRendering()), url = URL.createObjectURL(wav);
      const link = document.createElement('a'); link.href = url; link.download = (p.name || 'echolab-mix').replace(/[^a-z0-9-_ ]/gi, '_') + '.wav'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1500); setStatus('WAV mix exported');
    } catch { setStatus('Export failed. Try a shorter session.'); }
    setBusy(false);
  };

  const deleteClip = async (id: string) => {
    update(p => ({ ...p, clips: p.clips.filter(c => c.id !== id) }));
    buffers.current.delete(id); try { await dbDelete(id); } catch { /* non-critical */ }
  };
  const addTrackType = (type: string) => {
    if (type === 'Import audio') { setTrackPicker(false); fileInput.current?.click(); return; }
    if (type === 'Drum machine') { setPanel('drums'); setTrackPicker(false); setScreen('studio'); return; }
    const p = projectRef.current; if (!p) return;
    const t = makeTrack(p.tracks.length);
    t.name = ({'Voice / Audio':'Vocal','Guitar':'Guitar','Bass':'Bass','Looper':'Loop layer','Virtual instrument':'Instrument','Sampler':'Sample'} as Record<string,string>)[type] || 'Audio track';
    update(old => ({ ...old, tracks:[...old.tracks,t] }));
    setSelected(t.id);
    setTrackPicker(false);
    setScreen('studio');
    if (type === 'Looper') setPanel('loops');
    else if (type === 'Virtual instrument' || type === 'Sampler') {setPanel('fx');setStatus('MIDI instruments are planned; recording and importing audio work now.');}
    else setPanel('input');
  };
  const addDrumBeat = async (blob:Blob,name:string) => {
    const p = projectRef.current;if(!p)return;
    const t = makeTrack(p.tracks.length);t.name='Drums';
    update(x => ({...x,tracks:[...x.tracks,t]}));
    setSelected(t.id);
    await addAudio(blob,t.id,name,0);
    setPanel('none');
  };
  const resetProject = async () => {
    if (!window.confirm('Delete this local project and all recorded audio? This cannot be undone.')) return;
    stopTransport();
    const p = initialProject(); setProject(p); setSelected(p.tracks[0].id);
    buffers.current.clear();
    try { const db = await openDB(); const tx = db.transaction('clips', 'readwrite'); tx.objectStore('clips').clear(); db.close(); } catch { /* storage unavailable */ }
    setStatus('New session created'); setScreen('studio'); setTrackPicker(false); setPanel('none');
  };

  if (!project) return <main className="loading">Preparing EchoLab studio…</main>;
  const TRACK_TYPES = [
    {icon:'🎙',name:'Voice / Audio',sub:'Capture vocals and any audio',color:'#fa665f'},
    {icon:'♮',name:'Guitar',sub:'Record riffs with Spark GO',color:'#46c7c7'},
    {icon:'♫',name:'Bass',sub:'Lay down a low end',color:'#5094ef'},
    {icon:'◉',name:'Looper',sub:'Build layers in real time',color:'#f0bd5f'},
    {icon:'♬',name:'Virtual instrument',sub:'MIDI instruments — coming soon',color:'#62c99e'},
    {icon:'▦',name:'Sampler',sub:'Sample pads — coming soon',color:'#c28af8'},
    {icon:'▤',name:'Drum machine',sub:'Program a 16-step drum beat',color:'#f49c66'},
    {icon:'↥',name:'Import audio',sub:'Bring in MP3, WAV or M4A',color:'#a1aec1'}
  ];
  const openPicker = () => {setTrackPicker(true);setPanel('none');};
  const activeTrack = project.tracks.find(t=>t.id===selected) || project.tracks[0];
  const length = loopSeconds(project), barWidth = 100 / project.bars;
  return <div className="app-shell redesigned">
    <aside className="sidebar">
      <div className="brand"><div className="brand-symbol">≋</div><div><strong>echo<span>lab</span></strong><small>MAKE SOMETHING REAL</small></div></div>
      <div className="nav-group"><div className="nav-heading">WORKSPACE</div><button className={'nav-item nav-button '+(screen==='home'?'active':'')} onClick={()=>setScreen('home')}><span>⌂</span> Home</button><button className={'nav-item nav-button '+(screen==='studio'?'active':'')} onClick={()=>setScreen('studio')}><span>◉</span> Studio</button><button className="nav-item nav-button" onClick={openPicker}><span>⊞</span> Add a track</button><div className="nav-heading nav-heading-tools">TOOLS</div><button className="nav-item nav-button" onClick={()=>{setScreen('studio');setPanel('drums')}}><span>▤</span> Drum machine</button><button className="nav-item nav-button" onClick={()=>{setScreen('studio');setPanel('mixer')}}><span>☷</span> Mixer</button><button className="nav-item nav-button" onClick={()=>{setScreen('studio');setPanel('loops')}}><span>∞</span> Looper</button></div>
      <div className="sidebar-bottom"><div className="sidebar-divider" /><div className="feature-kicker">YOUR STUDIO, YOUR AUDIO</div><p>Recordings stay in this browser. Export your work to keep a backup.</p><div className="sidebar-version">ECHO LAB / EARLY ACCESS v0.1</div></div>
    </aside>
    <div className="main-area">
      <header className="topbar">
        <div className="top-left"><span className="breadcrumb">EchoLab <span>/</span> {screen==='home'?'Create':'Studio'}</span><input aria-label="Project name" className="project-name" value={project.name} maxLength={60} onChange={e => update(p => ({ ...p, name: e.target.value }))}/><span className="saved-label">● Local autosave</span></div>
        <div className="top-actions"><button className="btn btn-ghost" onClick={() => void resetProject()}>New session</button><button className="btn btn-ghost" onClick={openPicker}>＋ New track</button><button className="btn btn-primary" disabled={busy} onClick={() => void exportWav()}>↓ Export WAV</button></div>
      </header>
      {screen==='home' ? <main className="create-page">
        <div className="create-heading"><div><span className="eyebrow">WELCOME TO YOUR WORKSPACE</span><h1>What will you <em>create?</em></h1><p>Every great track starts with one sound.</p></div><button className="btn btn-primary create-start" onClick={()=>{setScreen('studio');openPicker()}}>＋ Create track</button></div>
        <div className="create-section"><div className="section-head"><h2>Your project</h2><span>Saved in this browser</span></div><button className="recent-session" onClick={()=>setScreen('studio')}><span className="recent-art">≋</span><span className="recent-copy"><strong>{project.name}</strong><small>{project.tracks.length} tracks · {project.clips.length} clips · {project.bpm} BPM</small></span><span className="recent-arrow">Open studio →</span></button></div>
        <div className="create-section"><div className="section-head"><h2>Start with a sound</h2><span>Choose a track type</span></div><div className="creation-grid">{TRACK_TYPES.map(t=><button key={t.name} className="creation-card" onClick={()=>addTrackType(t.name)}><span className="creation-icon" style={{background:t.color+'25',color:t.color}}>{t.icon}</span><strong>{t.name}</strong><small>{t.sub}</small><span className="creation-plus">＋</span></button>)}</div></div>
        <div className="create-section"><div className="section-head"><h2>Creative tools</h2></div><div className="tool-launchers"><button onClick={()=>{setScreen('studio');setPanel('drums')}}>▤ <span>Drum machine</span><small>Make beats</small></button><button onClick={()=>{setScreen('studio');setPanel('mixer')}}>☷ <span>Mixer</span><small>Shape your levels</small></button><button onClick={()=>{setScreen('studio');setPanel('loops')}}>∞ <span>Loop station</span><small>Layer your guitar</small></button><button onClick={()=>{setScreen('studio');setPanel('input')}}>♮ <span>Spark GO</span><small>Connect USB audio</small></button></div></div>
      </main> : <div className="content">
        <div className="headline"><div><div className="eyebrow">MULTITRACK STUDIO <span> / </span> YOUR SESSION</div><h1>Make something <i>real.</i></h1><p>Capture a riff. Layer a feeling. Build your sound.</p></div><div className="head-badge"><span className="pulse-dot" /> AUDIO ENGINE <strong>READY</strong></div></div>
        <section className="control-bar" aria-label="Transport controls">
          <div className="transport"><button className="round-btn square-btn" title="Return to start" onClick={stopTransport}>■</button><button className="round-btn play-btn" aria-label={playing ? 'Stop playback' : 'Start playback'} onClick={() => void startTransport()}>{playing ? '■' : '▶'}</button><button className={'record-btn ' + (recording ? 'is-recording' : '')} title={recording ? 'Stop recording' : 'Record / overdub'} onClick={() => void startRecording()}>{recording ? '■ STOP' : '● REC'}</button></div>
          <div className="transport-divider" />
          <div className="time-display">{formatTime(playhead)} <span>/ {formatTime(length)}</span></div>
          <div className="transport-divider" />
          <div className="tempo-control"><label> TEMPO <input type="number" aria-label="Tempo in BPM" value={project.bpm} min={40} max={240} onChange={e => { if (playing) stopTransport(); update(p => ({ ...p, bpm: clamp(Number(e.target.value) || 90, 40, 240) })); }} /> <small>BPM</small></label></div>
          <div className="transport-divider hide-mobile" />
          <div className="bars-control"><label>LOOP LENGTH <select aria-label="Loop length in bars" value={project.bars} onChange={e => { if (playing) stopTransport(); update(p => ({ ...p, bars: Number(e.target.value) })); }}>{[1,2,4,8,16].map(n => <option key={n} value={n}>{n} bars</option>)}</select></label></div>
          <span className="transport-spacer" /><div className="signature">4 / 4 <span>TIME</span></div>
        </section>
        <section className="studio-panel">
          <div className="panel-heading"><div><span className="panel-icon">▥</span><strong>Arrangement</strong><small>{project.tracks.length} tracks · {fileCount} clips</small></div><button className="btn btn-secondary" onClick={openPicker}>＋ Add track</button></div>
          <div className="arrangement">
            <div className="track-label top-label"><span>TRACKS</span></div><div className="ruler">{Array.from({ length: project.bars }, (_, i) => <div className="ruler-bar" key={i} style={{ width: barWidth + '%' }}><span>{String(i + 1).padStart(2, '0')}</span></div>)}</div>
            {project.tracks.map((track, index) => <div className="track-row" key={track.id}>
              <div className={'track-info ' + (selected === track.id ? 'track-selected' : '')} onClick={() => setSelected(track.id)}>
                <div className="track-title"><span className="track-color" style={{ background: track.color }} /><input aria-label={'Rename ' + track.name} value={track.name} onChange={e => update(p => ({ ...p, tracks: p.tracks.map(t => t.id === track.id ? { ...t, name: e.target.value } : t) }))}/></div>
                <div className="track-settings"><button className={track.muted ? 'toggle-on' : ''} title="Mute track" onClick={e => { e.stopPropagation(); update(p => ({ ...p, tracks: p.tracks.map(t => t.id === track.id ? { ...t, muted: !t.muted } : t) })); }}>M</button><button className={track.solo ? 'toggle-on' : ''} title="Solo track" onClick={e => { e.stopPropagation(); update(p => ({ ...p, tracks: p.tracks.map(t => t.id === track.id ? { ...t, solo: !t.solo } : t) })); }}>S</button><label title="Track volume">VOL <input type="range" min="0" max="1.5" step=".05" value={track.volume} onChange={e => update(p => ({ ...p, tracks: p.tracks.map(t => t.id === track.id ? { ...t, volume: Number(e.target.value) } : t) }))}/></label><button title="Remove empty track" disabled={project.tracks.length === 1 || project.clips.some(c => c.trackId === track.id)} onClick={e => { e.stopPropagation(); update(p => ({ ...p, tracks: p.tracks.filter(t => t.id !== track.id) })); if (selected === track.id) setSelected(project.tracks[0].id); }}>×</button></div>
              </div>
              <div className="lane" onClick={() => setSelected(track.id)} style={{ backgroundSize: barWidth + '% 100%' }}>
                {project.clips.filter(c => c.trackId === track.id).map(clip => { const buffer = buffers.current.get(clip.id), width = clamp((buffer?.duration || 0) / length * 100, 1, 100 - clip.start / length * 100); return <div className="clip" key={clip.id} style={{ left: clip.start / length * 100 + '%', width: width + '%', borderColor: track.color + '90', backgroundColor: track.color + '19' }} title={clip.name}><div className="clip-caption"><span>{clip.name}</span><button title="Delete clip" onClick={e => { e.stopPropagation(); void deleteClip(clip.id); }}>×</button></div><Wave peaks={clip.peaks} color={track.color}/><div className="clip-move"><button title="Move clip one beat left" onClick={e => { e.stopPropagation(); update(p => ({ ...p, clips: p.clips.map(c => c.id === clip.id ? { ...c, start: Math.max(0, c.start - 60 / p.bpm) } : c) })); }}>←</button><button title="Move clip one beat right" onClick={e => { e.stopPropagation(); update(p => ({ ...p, clips: p.clips.map(c => c.id === clip.id ? { ...c, start: Math.min(loopSeconds(p) - .05, c.start + 60 / p.bpm) } : c) })); }}>→</button></div></div>; })}
                {playing && <div className="playhead" style={{ left: playhead / length * 100 + '%' }} />}
                {!project.clips.some(c => c.trackId === track.id) && <span className="empty-lane">{index === 0 ? 'Press REC to capture your first sound' : 'Empty audio track'}</span>}
              </div>
            </div>)}
          </div>
          <div className="arrangement-footer"><span><span className="tiny-dot" /> {status}</span><span>1 bar = 4 beats · Loop repeats continuously</span></div>
        </section>
        <div className="studio-toolbar"><button onClick={()=>setPanel(panel==='mixer'?'none':'mixer')} className={panel==='mixer'?'selected':''}>☷ Mixer</button><button onClick={()=>setPanel(panel==='drums'?'none':'drums')} className={panel==='drums'?'selected':''}>▤ Drum machine</button><button onClick={()=>setPanel(panel==='loops'?'none':'loops')} className={panel==='loops'?'selected':''}>∞ Looper</button><button onClick={()=>setPanel(panel==='input'?'none':'input')} className={panel==='input'?'selected':''}>♮ Audio settings</button><button onClick={()=>setPanel(panel==='fx'?'none':'fx')} className={panel==='fx'?'selected':''}>✧ FX</button></div>
        {panel==='drums' && <div className="drawer-panel"><div className="drawer-title"><strong>Beat studio</strong><button onClick={()=>setPanel('none')}>✕ Close</button></div><DrumMachine bpm={project.bpm} bars={project.bars} onAdd={addDrumBeat}/></div>}
        {panel==='mixer' && <div className="drawer-panel"><div className="drawer-title"><strong>Track mixer</strong><button onClick={()=>setPanel('none')}>✕ Close</button></div><div className="mixer-list">{project.tracks.map(t=><div key={t.id} className="mixer-channel"><div className="mixer-marker" style={{background:t.color}}/><strong>{t.name}</strong><label>LEVEL <input type="range" min="0" max="1.5" step=".05" value={t.volume} onChange={e=>update(p=>({...p,tracks:p.tracks.map(x=>x.id===t.id?{...x,volume:Number(e.target.value)}:x)}))}/><span>{Math.round(t.volume*100)}%</span></label><label>PAN <input type="range" min="-1" max="1" step=".05" value={t.pan} onChange={e=>update(p=>({...p,tracks:p.tracks.map(x=>x.id===t.id?{...x,pan:Number(e.target.value)}:x)}))}/><span>{t.pan===0?'C':t.pan<0?'L':'R'}</span></label><button className={t.muted?'mixer-on':''} onClick={()=>update(p=>({...p,tracks:p.tracks.map(x=>x.id===t.id?{...x,muted:!x.muted}:x)}))}>M</button><button className={t.solo?'mixer-on':''} onClick={()=>update(p=>({...p,tracks:p.tracks.map(x=>x.id===t.id?{...x,solo:!x.solo}:x)}))}>S</button></div>)}</div></div>}
        {panel==='loops' && <div className="drawer-panel"><div className="drawer-title"><strong>Live loop station</strong><button onClick={()=>setPanel('none')}>✕ Close</button></div><div className="loop-workspace"><div className="loop-circle"><span>{project.bars}</span><small>BARS</small></div><div><h3>Build your layers</h3><p>Choose an audio track, hit Play, then Record. Each new overdub creates another layer.</p><div className="loop-actions"><button className="btn btn-secondary" onClick={()=>void startTransport()}>{playing?'■ Stop loop':'▶ Play loop'}</button><button className="btn btn-primary" onClick={()=>void startRecording()}>{recording?'■ Stop recording':'● Record layer'}</button></div><small>Browser audio latency is not yet compensated. Use headphones when overdubbing.</small></div></div></div>}
        {panel==='fx' && <div className="drawer-panel"><div className="drawer-title"><strong>Effects & instruments</strong><button onClick={()=>setPanel('none')}>✕ Close</button></div><div className="feature-placeholder"><span>✧</span><h3>Production effects are on the roadmap</h3><p>Per-track EQ, compression, delay, reverb, pitch tools, sampler and MIDI instruments will be added as functioning processors. These controls are not simulated as working effects.</p><button className="btn btn-secondary" onClick={()=>setPanel('mixer')}>Open working mixer</button></div></div>}
        {panel==='input' && <div className="drawer-panel"><div className="drawer-title"><strong>Audio device settings</strong><button onClick={()=>setPanel('none')}>✕ Close</button></div><p className="drawer-description">Choose your USB interface, including Spark GO when your computer and browser recognize it.</p></div>}
        <div className="bottom-grid">
          <section className="utility-card"><div className="utility-top"><div className="card-symbol">⌁</div><div><div className="card-eyebrow">INPUT & RECORDING</div><h2>Audio input</h2></div></div><p>Connect your Spark GO via USB-C, or use any audio interface or microphone exposed to your browser.</p><div className="device-select"><label htmlFor="input-device">INPUT DEVICE</label><select id="input-device" value={deviceId} onChange={e => setDeviceId(e.target.value)}><option value="">Default microphone / interface</option>{devices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Audio input ' + d.deviceId.slice(0, 5)}</option>)}</select></div><button className="btn btn-outline wide" onClick={() => void refreshDevices(true)}>◎ Detect / enable inputs</button><div className="card-note">USB interface recording works in supported desktop browsers. Select your Spark GO when it appears.</div></section>
          <section className="utility-card"><div className="utility-top"><div className="card-symbol purple">◌</div><div><div className="card-eyebrow">LIVE PERFORMANCE</div><h2>Loop station</h2></div></div><p>Set the tempo and loop length above. Hit play, record into a track, then overdub to stack up parts.</p><div className="loop-status"><span>LOOP REGION</span><strong>{project.bars} bars <em>·</em> {length.toFixed(1)}s</strong></div><div className="loop-status"><span>SELECTED TRACK</span><strong>{project.tracks.find(t => t.id === selected)?.name || 'Guitar 1'}</strong></div><div className="card-note warning">Early access: overdub alignment is approximate. Spark GO latency calibration is planned for the desktop engine.</div></section>
        </div>
        <footer className="app-footer"><span>ECHOLAB IS A LOCAL-FIRST STUDIO · YOUR AUDIO STAYS ON THIS DEVICE</span><span>Built for the moments that turn into music. ✦</span></footer>
      </div>}
    </div>
    <nav className="mobile-dock" aria-label="Main navigation"><button className={screen==='home'?'selected':''} onClick={()=>setScreen('home')}><span>⌂</span>Home</button><button className={screen==='studio'?'selected':''} onClick={()=>setScreen('studio')}><span>◉</span>Studio</button><button className="mobile-add" onClick={openPicker}>＋</button><button onClick={()=>{setScreen('studio');setPanel('drums')}}><span>▤</span>Beats</button><button onClick={()=>{setScreen('studio');setPanel('mixer')}}><span>☷</span>Mixer</button></nav>
    {trackPicker && <div className="picker-backdrop" onClick={()=>setTrackPicker(false)}><section className="picker-sheet" onClick={e=>e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Choose track type"><div className="sheet-handle"/><div className="sheet-header"><div><span className="mini-eyebrow">ECHO LAB</span><h2>New track</h2></div><button onClick={()=>setTrackPicker(false)} aria-label="Close track chooser">✕</button></div><div className="sheet-options">{TRACK_TYPES.map(t=><button key={t.name} onClick={()=>addTrackType(t.name)}><span className="sheet-icon" style={{background:t.color+'25',color:t.color}}>{t.icon}</span><span><strong>{t.name}</strong><small>{t.sub}</small></span><span className="sheet-arrow">→</span></button>)}</div></section></div>}
    <input ref={fileInput} type="file" className="visually-hidden" accept="audio/*,.wav,.mp3,.m4a,.ogg,.webm" onChange={e => { const f = e.target.files?.[0]; if (f) void importFile(f); e.currentTarget.value = ''; }} />
  </div>;
}
