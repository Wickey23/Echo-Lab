# EchoLab v0.1 — acceptance checklist

## Automated checks
- [x] Next.js production compile (Vercel deployment)
- [x] TypeScript / page data generation (Vercel deployment)
- [ ] GitHub Actions quality workflow completes after push

## Browser checks — require a real Chrome/Edge browser
- [ ] Open studio without browser console errors
- [ ] Add, rename, mute and solo tracks
- [ ] Import WAV, MP3 and M4A; see waveforms
- [ ] Play loops at 60, 90 and 120 BPM; check 1/4/8 bars
- [ ] Shift clips by beats; stop/start transport
- [ ] Reload page: metadata and audio clips persist
- [ ] Record through default microphone, stop, replay
- [ ] Record a second overdub onto another track
- [ ] Export WAV and listen to the rendered mix
- [ ] Verify layout on desktop and mobile viewports
- [ ] Confirm microphone permission failure shows feedback
- [ ] Clear project and confirm tracks/audio disappear

## Spark GO-specific validation — Windows desktop
1. Connect guitar to Spark GO, then USB-C to Windows PC.
2. Install Positive Grid's official Windows driver if required.
3. Confirm the Spark GO appears as an audio input in Windows.
4. Open EchoLab in recent desktop Chrome/Edge over HTTPS.
5. Click **Detect / enable inputs**, grant permission and select Spark GO.
6. Record 10 seconds; stop; replay. Check clipping and dropout.
7. Record against a 90 BPM metronome reference and measure recorded offset.
8. Run 5-minute recording and export; look for drift.
9. Check headphones/direct-monitor routing to avoid feedback.

## Known limitations
- No device-measured round-trip latency calibration yet.
- Overdubs use MediaRecorder timing and are not sample-perfect.
- Loop-end audio tails are trimmed in playback/export. Long takes do not wrap to loop start.
- No metronome, count-in, input meters, non-destructive trim or effects yet.
- Project audio is saved only to this browser's IndexedDB and must be exported for backup.
- Cloud accounts, collaboration, native Spark preset controls, and AI tools are not implemented.

Do not mark hardware-specific tests passing without measuring on the actual device.
