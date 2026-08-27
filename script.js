(() => {
    const MIDI_C4 = 60;
    const MIDI_B5 = 83;
    const NUM_WHITE_KEYS = 14;
    const WHITE_KEY_MIDI = [60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79, 81, 83];
    const BLACK_KEY_MIDI = [61, 63, 66, 68, 70, 73, 75, 78, 80, 82];
    const BLACK_KEY_POS = [0, 1, 3, 4, 5, 7, 8, 10, 11, 12];
    const KEY_MAP = {
        'KeyA': 60, 'KeyW': 61, 'KeyS': 62, 'KeyE': 63, 'KeyD': 64, 'KeyF': 65,
        'KeyT': 66, 'KeyG': 67, 'KeyY': 68, 'KeyH': 69, 'KeyU': 70, 'KeyJ': 71,
        'KeyK': 72, 'KeyO': 73, 'KeyL': 74, 'KeyP': 75, 'Semicolon': 76, 'Quote': 77,
        'BracketRight': 78, 'Backslash': 79
    };
    const NOTE_COLOR = '#4dd0e1';
    const LOOP_COLOR = 'rgba(102,187,106,0.18)';
    const PLAYHEAD_COLOR = '#ff7043';
    const WAVEFORM_COLOR = 'rgba(79,195,247,0.55)';
    const MIN_NOTE_DURATION = 0.08;
    const LOOKAHEAD_MS = 120;
    const SCHEDULE_INTERVAL_MS = 25;

    // Piano synthesis parameters
    const HARMONICS = [
        { multiplier: 1, gain: 1.0, decay: 1.5 },
        { multiplier: 2, gain: 0.5, decay: 1.2 },
        { multiplier: 3, gain: 0.25, decay: 1.0 },
        { multiplier: 4, gain: 0.15, decay: 0.8 },
        { multiplier: 5, gain: 0.08, decay: 0.6 }
    ];

    let audioCtx = null;
    let audioBuffer = null;
    let audioSourceNode = null;
    let isPlaying = false;
    let isPaused = false;
    let isRecording = false;
    let loopEnabled = false;
    let loopStartTime = 0;
    let loopEndTime = 0;
    let playbackMode = 'both';
    let playbackStartCtxTime = 0;
    let playbackStartBufferPos = 0;
    let currentBufferPos = 0;
    let recordedNotes = [];
    let activeNotes = new Map();
    let scheduledNoteIds = new Set();
    let nextNoteId = 0;
    let waveformPeaks = null;
    let canvasEl = null;
    let canvasCtx = null;
    let canvasWidth = 0;
    let canvasHeight = 0;
    let dpr = 1;
    let animationFrameId = null;
    let schedulerIntervalId = null;
    let draggedKey = null;
    let isDraggingTimeline = false;

    const playBtn = document.getElementById('playBtn');
    const stopBtn = document.getElementById('stopBtn');
    const recordBtn = document.getElementById('recordBtn');
    const loopBtn = document.getElementById('loopBtn');
    const setLoopStartBtn = document.getElementById('setLoopStartBtn');
    const setLoopEndBtn = document.getElementById('setLoopEndBtn');
    const clearSectionBtn = document.getElementById('clearSectionBtn');
    const uploadBtn = document.getElementById('uploadBtn');
    const fileInput = document.getElementById('fileInput');
    const fileNameEl = document.getElementById('fileName');
    const timeDisplay = document.getElementById('timeDisplay');
    const statusText = document.getElementById('statusText');
    const noteCountEl = document.getElementById('noteCount');
    const loopInfoEl = document.getElementById('loopInfo');
    const recordIndicator = document.getElementById('recordIndicator');
    const pianoKeyboard = document.getElementById('pianoKeyboard');
    const timelineCanvas = document.getElementById('timelineCanvas');
    const dropOverlay = document.getElementById('dropOverlay');
    const modeButtons = document.querySelectorAll('.btn-mode');

    canvasEl = timelineCanvas;
    canvasCtx = canvasEl.getContext('2d');

    function initAudioContext() {
        if (!audioCtx) {
            audioCtx = new(window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        return audioCtx;
    }

    function midiToFrequency(midi) {
        return 440 * Math.pow(2, (midi - 69) / 12);
    }

    function formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        const tenths = Math.floor((seconds % 1) * 10);
        return `${mins}:${secs.toString().padStart(2, '0')}.${tenths}`;
    }

    function getAudioDuration() {
        return audioBuffer ? audioBuffer.duration : 0;
    }

    function getEffectiveEndTime() {
        if (loopEnabled && loopEndTime > loopStartTime && loopEndTime <= getAudioDuration()) {
            return loopEndTime;
        }
        return getAudioDuration();
    }

    function getEffectiveStartTime() {
        if (loopEnabled && loopStartTime < loopEndTime && loopStartTime >= 0) {
            return loopStartTime;
        }
        return 0;
    }

    function updateTimeDisplay() {
        const duration = getAudioDuration();
        if (duration > 0) {
            timeDisplay.textContent = `${formatTime(currentBufferPos)} / ${formatTime(duration)}`;
        } else {
            timeDisplay.textContent = '0:00.0 / 0:00.0';
        }
    }

    function updateStatusUI() {
        noteCountEl.textContent = `Notes: ${recordedNotes.length}`;
        if (loopEnabled && loopEndTime > loopStartTime) {
            loopInfoEl.textContent = `Loop: ${formatTime(loopStartTime)} - ${formatTime(loopEndTime)}`;
        } else {
            loopInfoEl.textContent = 'Loop: Off';
        }
        recordIndicator.classList.toggle('hidden', !isRecording);
    }

    function buildPianoKeyboard() {
        pianoKeyboard.innerHTML = '';
        const containerWidth = pianoKeyboard.clientWidth || 700;
        const keyHeight = pianoKeyboard.clientHeight || 150;
        const whiteKeyWidth = containerWidth / NUM_WHITE_KEYS;
        const blackKeyWidth = whiteKeyWidth * 0.62;
        const blackKeyHeight = keyHeight * 0.58;

        WHITE_KEY_MIDI.forEach((midi, idx) => {
            const key = document.createElement('div');
            key.className = 'white-key';
            key.dataset.midi = midi;
            key.style.left = (idx * whiteKeyWidth) + 'px';
            key.style.width = (whiteKeyWidth - 1) + 'px';
            key.style.height = '100%';
            const label = document.createElement('span');
            label.className = 'key-label';
            label.textContent = getNoteName(midi);
            key.appendChild(label);
            key.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                key.setPointerCapture(e.pointerId);
                handleKeyPress(midi, e.pointerId);
                draggedKey = { midi, pointerId: e.pointerId };
            });
            key.addEventListener('pointerup', (e) => {
                handleKeyRelease(midi, e.pointerId);
                if (draggedKey && draggedKey.pointerId === e.pointerId) draggedKey = null;
            });
            key.addEventListener('pointercancel', (e) => {
                handleKeyRelease(midi, e.pointerId);
                if (draggedKey && draggedKey.pointerId === e.pointerId) draggedKey = null;
            });
            key.addEventListener('pointerenter', (e) => {
                if (e.buttons & 1) {
                    if (draggedKey && draggedKey.midi !== midi) {
                        handleKeyRelease(draggedKey.midi, draggedKey.pointerId);
                    }
                    handleKeyPress(midi, e.pointerId);
                    draggedKey = { midi, pointerId: e.pointerId };
                }
            });
            pianoKeyboard.appendChild(key);
        });

        BLACK_KEY_MIDI.forEach((midi, idx) => {
            const key = document.createElement('div');
            key.className = 'black-key';
            key.dataset.midi = midi;
            const whiteIdx = BLACK_KEY_POS[idx];
            const leftPos = (whiteIdx + 1) * whiteKeyWidth - blackKeyWidth / 2;
            key.style.left = leftPos + 'px';
            key.style.width = blackKeyWidth + 'px';
            key.style.height = blackKeyHeight + 'px';
            const label = document.createElement('span');
            label.className = 'key-label';
            label.textContent = getNoteName(midi);
            key.appendChild(label);
            key.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                key.setPointerCapture(e.pointerId);
                handleKeyPress(midi, e.pointerId);
                draggedKey = { midi, pointerId: e.pointerId };
            });
            key.addEventListener('pointerup', (e) => {
                handleKeyRelease(midi, e.pointerId);
                if (draggedKey && draggedKey.pointerId === e.pointerId) draggedKey = null;
            });
            key.addEventListener('pointercancel', (e) => {
                handleKeyRelease(midi, e.pointerId);
                if (draggedKey && draggedKey.pointerId === e.pointerId) draggedKey = null;
            });
            key.addEventListener('pointerenter', (e) => {
                if (e.buttons & 1) {
                    if (draggedKey && draggedKey.midi !== midi) {
                        handleKeyRelease(draggedKey.midi, draggedKey.pointerId);
                    }
                    handleKeyPress(midi, e.pointerId);
                    draggedKey = { midi, pointerId: e.pointerId };
                }
            });
            pianoKeyboard.appendChild(key);
        });
    }

    function getNoteName(midi) {
        const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        const octave = Math.floor(midi / 12) - 1;
        return names[midi % 12] + octave;
    }

    function highlightKey(midi, pressed) {
        const keys = pianoKeyboard.querySelectorAll(`[data-midi="${midi}"]`);
        keys.forEach(key => {
            if (pressed) {
                key.classList.add('pressed');
            } else {
                key.classList.remove('pressed');
            }
        });
    }

    // Create a piano-like sound using additive synthesis
    function createPianoVoice(freq, startTime, masterGain, duration) {
        const oscillators = [];
        const individualGains = [];

        HARMONICS.forEach((harmonic, index) => {
            const osc = audioCtx.createOscillator();
            const oscGain = audioCtx.createGain();

            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq * harmonic.multiplier, startTime);

            // Set initial gain for this harmonic
            oscGain.gain.setValueAtTime(0, startTime);
            // Attack (fast)
            oscGain.gain.linearRampToValueAtTime(harmonic.gain, startTime + 0.005);
            // Decay (exponential) - for realtime, we'll control master gain instead
            if (duration !== undefined) {
                // For scheduled notes, set the decay envelope directly
                oscGain.gain.setTargetAtTime(0, startTime + 0.005, harmonic.decay / 3);
            }

            osc.connect(oscGain);
            oscGain.connect(masterGain);

            osc.start(startTime);
            if (duration !== undefined) {
                osc.stop(startTime + duration + 0.1);
            }

            oscillators.push(osc);
            individualGains.push(oscGain);
        });

        return { oscillators, individualGains };
    }

    function handleKeyPress(midi, sourceId) {
        if (!audioCtx) return;
        const now = audioCtx.currentTime;
        const freq = midiToFrequency(midi);

        // Master gain for this note
        const masterGain = audioCtx.createGain();
        masterGain.gain.setValueAtTime(0, now);
        masterGain.gain.linearRampToValueAtTime(0.5, now + 0.008);
        // Natural piano decay while held
        masterGain.gain.setTargetAtTime(0.25, now + 0.008, 0.5);
        masterGain.connect(audioCtx.destination);

        const { oscillators, individualGains } = createPianoVoice(freq, now, masterGain);

        const noteId = nextNoteId++;
        const noteData = {
            oscillators,
            individualGains,
            masterGain,
            midi,
            startCtxTime: now,
            startBufferTime: currentBufferPos,
            sourceId
        };
        activeNotes.set(sourceId + '-' + midi, noteData);
        highlightKey(midi, true);

        if (isRecording && isPlaying) {
            const startTime = currentBufferPos;
            replaceOverlappingNotes(startTime, Math.max(MIN_NOTE_DURATION, 0.12));
            recordedNotes.push({
                startTime,
                duration: MIN_NOTE_DURATION,
                midi,
                frequency: freq,
                noteId
            });
            updateStatusUI();
        }
    }

    function handleKeyRelease(midi, sourceId) {
        const key = sourceId + '-' + midi;
        const noteData = activeNotes.get(key);
        if (!noteData) return;
        const now = audioCtx.currentTime;
        const heldDuration = now - noteData.startCtxTime;
        const actualDuration = Math.max(heldDuration, MIN_NOTE_DURATION);

        // Quick release
        noteData.masterGain.gain.cancelScheduledValues(now);
        noteData.masterGain.gain.setValueAtTime(noteData.masterGain.gain.value, now);
        noteData.masterGain.gain.linearRampToValueAtTime(0, now + 0.05);

        // Stop oscillators after release
        noteData.oscillators.forEach(osc => {
            try { osc.stop(now + 0.06); } catch (e) {}
        });

        activeNotes.delete(key);
        highlightKey(midi, false);

        if (isRecording && isPlaying) {
            const matchingNote = recordedNotes.find(n => n.noteId === noteData.noteId && Math.abs(n.startTime - noteData.startBufferTime) < 0.001);
            if (matchingNote) {
                matchingNote.duration = actualDuration;
            }
        }
    }

    function replaceOverlappingNotes(startTime, duration) {
        const endTime = startTime + duration;
        recordedNotes = recordedNotes.filter(note => {
            const noteEnd = note.startTime + note.duration;
            return !(note.startTime < endTime && noteEnd > startTime);
        });
    }

    function buildWaveformPeaks() {
        if (!audioBuffer) {
            waveformPeaks = null;
            return;
        }
        const data = audioBuffer.getChannelData(0);
        const samplesPerPixel = Math.max(1, Math.floor(data.length / 800));
        const peaks = [];
        for (let i = 0; i < data.length; i += samplesPerPixel) {
            let maxVal = 0;
            for (let j = i; j < Math.min(i + samplesPerPixel, data.length); j++) {
                const absVal = Math.abs(data[j]);
                if (absVal > maxVal) maxVal = absVal;
            }
            peaks.push(maxVal);
        }
        waveformPeaks = peaks;
    }

    function resizeCanvas() {
        const rect = canvasEl.getBoundingClientRect();
        dpr = window.devicePixelRatio || 1;
        canvasWidth = rect.width;
        canvasHeight = rect.height;
        canvasEl.width = canvasWidth * dpr;
        canvasEl.height = canvasHeight * dpr;
        canvasCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawTimeline();
    }

    function drawTimeline() {
        if (!canvasCtx || canvasWidth <= 0 || canvasHeight <= 0) return;
        const ctx = canvasCtx;
        const w = canvasWidth;
        const h = canvasHeight;
        const duration = getAudioDuration();
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = '#0d0d1a';
        ctx.fillRect(0, 0, w, h);

        if (duration <= 0) {
            ctx.fillStyle = '#555';
            ctx.font = '14px "Segoe UI", sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('Load audio to see timeline', w / 2, h / 2);
            return;
        }

        const effectiveStart = getEffectiveStartTime();
        const effectiveEnd = getEffectiveEndTime();
        const displayStart = effectiveStart;
        const displayEnd = effectiveEnd;
        const displayDuration = displayEnd - displayStart;
        if (displayDuration <= 0) return;

        const timeToX = (t) => ((t - displayStart) / displayDuration) * w;
        const midiToY = (midi) => {
            const normalized = (midi - MIDI_C4) / (MIDI_B5 - MIDI_C4);
            return h - normalized * (h * 0.85) - h * 0.075;
        };

        for (let i = 0; i <= 10; i++) {
            const t = displayStart + (i / 10) * displayDuration;
            const x = timeToX(t);
            ctx.strokeStyle = 'rgba(255,255,255,0.06)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
            ctx.stroke();
        }
        for (let i = 0; i <= 6; i++) {
            const y = (i / 6) * h;
            ctx.strokeStyle = 'rgba(255,255,255,0.04)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
        }

        if (waveformPeaks && waveformPeaks.length > 0) {
            const peakCount = waveformPeaks.length;
            const samplesPerX = peakCount / w;
            ctx.fillStyle = WAVEFORM_COLOR;
            for (let x = 0; x < w; x++) {
                const peakIdx = Math.floor(x * samplesPerX);
                const peakVal = waveformPeaks[peakIdx] || 0;
                const barHeight = peakVal * h * 0.7;
                ctx.fillRect(x, h / 2 - barHeight / 2, 1, Math.max(1, barHeight));
            }
        }

        if (loopEnabled && loopEndTime > loopStartTime && loopStartTime >= 0 && loopEndTime <= duration) {
            const loopX1 = timeToX(loopStartTime);
            const loopX2 = timeToX(loopEndTime);
            ctx.fillStyle = LOOP_COLOR;
            ctx.fillRect(loopX1, 0, loopX2 - loopX1, h);
            ctx.strokeStyle = 'rgba(102,187,106,0.7)';
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 4]);
            ctx.beginPath();
            ctx.moveTo(loopX1, 0);
            ctx.lineTo(loopX1, h);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(loopX2, 0);
            ctx.lineTo(loopX2, h);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        recordedNotes.forEach(note => {
            const nx = timeToX(note.startTime);
            const nw = Math.max(2, timeToX(note.startTime + note.duration) - nx);
            const ny = midiToY(note.midi);
            const nh = Math.max(4, (h / (MIDI_B5 - MIDI_C4)) * 0.75);
            ctx.fillStyle = NOTE_COLOR;
            ctx.globalAlpha = 0.85;
            ctx.fillRect(nx, ny - nh / 2, nw, nh);
            ctx.globalAlpha = 1;
            ctx.strokeStyle = 'rgba(0,0,0,0.3)';
            ctx.lineWidth = 0.5;
            ctx.strokeRect(nx, ny - nh / 2, nw, nh);
        });

        const playheadX = timeToX(currentBufferPos);
        ctx.strokeStyle = PLAYHEAD_COLOR;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(playheadX, 0);
        ctx.lineTo(playheadX, h);
        ctx.stroke();
        ctx.fillStyle = PLAYHEAD_COLOR;
        ctx.beginPath();
        ctx.moveTo(playheadX - 5, 0);
        ctx.lineTo(playheadX + 5, 0);
        ctx.lineTo(playheadX, 8);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = '#888';
        ctx.font = '10px "Segoe UI", sans-serif';
        ctx.textAlign = 'left';
        for (let i = 0; i <= 8; i++) {
            const t = displayStart + (i / 8) * displayDuration;
            const x = timeToX(t);
            ctx.fillText(formatTime(t), x + 3, h - 5);
        }
    }

    function updatePlayhead() {
        if (isPlaying && audioCtx) {
            const ctxTime = audioCtx.currentTime;
            const elapsed = ctxTime - playbackStartCtxTime;
            currentBufferPos = playbackStartBufferPos + elapsed;
            const effectiveEnd = getEffectiveEndTime();
            const effectiveStart = getEffectiveStartTime();
            if (loopEnabled && effectiveEnd > effectiveStart && currentBufferPos >= effectiveEnd) {
                const loopLength = effectiveEnd - effectiveStart;
                currentBufferPos = effectiveStart + (currentBufferPos - effectiveEnd) % loopLength;
                playbackStartCtxTime = ctxTime - (currentBufferPos - playbackStartBufferPos);
            }
            if (!loopEnabled && currentBufferPos >= getAudioDuration()) {
                stopPlayback();
                currentBufferPos = 0;
            }
            if (loopEnabled && loopEndTime > loopStartTime && currentBufferPos >= loopEndTime) {
                const loopLen = loopEndTime - loopStartTime;
                currentBufferPos = loopStartTime + ((currentBufferPos - loopStartTime) % loopLen);
                playbackStartCtxTime = ctxTime - (currentBufferPos - playbackStartBufferPos);
            }
            updateTimeDisplay();
        }
    }

    function startPlayback() {
        if (!audioBuffer && playbackMode !== 'notes') {
            statusText.textContent = 'Load audio first';
            return;
        }
        if (isPlaying) return;
        initAudioContext();
        isPlaying = true;
        isPaused = false;
        const startPos = (loopEnabled && loopStartTime < loopEndTime && currentBufferPos < loopStartTime) ? loopStartTime : currentBufferPos;
        currentBufferPos = startPos;
        playbackStartBufferPos = startPos;
        playbackStartCtxTime = audioCtx.currentTime;
        if (audioBuffer && playbackMode !== 'notes') {
            audioSourceNode = audioCtx.createBufferSource();
            audioSourceNode.buffer = audioBuffer;
            audioSourceNode.connect(audioCtx.destination);
            audioSourceNode.start(0, startPos);
        }
        startScheduler();
        startAnimationLoop();
        playBtn.textContent = '⏸ Pause';
        playBtn.classList.add('playing');
        statusText.textContent = isRecording ? 'Recording...' : 'Playing...';
    }

    function pausePlayback() {
        if (!isPlaying) return;
        if (audioSourceNode) {
            try { audioSourceNode.stop(0); } catch (e) {}
            audioSourceNode = null;
        }
        stopAllActiveNotes();
        isPlaying = false;
        isPaused = true;
        stopScheduler();
        stopAnimationLoop();
        playBtn.textContent = '▶ Play';
        playBtn.classList.remove('playing');
        statusText.textContent = 'Paused';
    }

    function stopPlayback() {
        if (audioSourceNode) {
            try { audioSourceNode.stop(0); } catch (e) {}
            audioSourceNode = null;
        }
        stopAllActiveNotes();
        isPlaying = false;
        isPaused = false;
        stopScheduler();
        stopAnimationLoop();
        currentBufferPos = 0;
        playbackStartBufferPos = 0;
        playBtn.textContent = '▶ Play';
        playBtn.classList.remove('playing');
        updateTimeDisplay();
        drawTimeline();
        statusText.textContent = 'Stopped';
    }

    function stopAllActiveNotes() {
        const now = audioCtx ? audioCtx.currentTime : 0;
        activeNotes.forEach((noteData) => {
            try {
                noteData.masterGain.gain.cancelScheduledValues(now);
                noteData.masterGain.gain.setValueAtTime(0, now);
                noteData.oscillators.forEach(osc => {
                    try { osc.stop(now + 0.03); } catch (e) {}
                });
            } catch (e) {}
            highlightKey(noteData.midi, false);
        });
        activeNotes.clear();
    }

    function startScheduler() {
        if (schedulerIntervalId) clearInterval(schedulerIntervalId);
        schedulerIntervalId = setInterval(scheduleAhead, SCHEDULE_INTERVAL_MS);
    }

    function stopScheduler() {
        if (schedulerIntervalId) {
            clearInterval(schedulerIntervalId);
            schedulerIntervalId = null;
        }
    }

    function scheduleAhead() {
        if (!isPlaying || !audioCtx) return;
        const ctxTime = audioCtx.currentTime;
        const scheduleHorizon = ctxTime + LOOKAHEAD_MS / 1000;
        const effectiveStart = getEffectiveStartTime();
        const effectiveEnd = getEffectiveEndTime();

        const notesToPlay = recordedNotes.filter(note => {
            const noteCtxTime = playbackStartCtxTime + (note.startTime - playbackStartBufferPos);
            return noteCtxTime >= ctxTime - 0.05 && noteCtxTime <= scheduleHorizon && note.startTime >= effectiveStart - 0.01 && note.startTime < effectiveEnd;
        });

        if (playbackMode === 'notes' || playbackMode === 'both') {
            notesToPlay.forEach(note => {
                const noteCtxTime = playbackStartCtxTime + (note.startTime - playbackStartBufferPos);
                if (noteCtxTime < ctxTime) return;
                const uniqueId = note.noteId + '-' + Math.round(noteCtxTime * 1000);
                if (scheduledNoteIds.has(uniqueId)) return;
                scheduledNoteIds.add(uniqueId);
                schedulePianoNote(note, noteCtxTime);
            });
        }

        // Cleanup old scheduled IDs
        scheduledNoteIds.forEach(key => {
            const parts = key.split('-');
            const timeMs = parseInt(parts[parts.length - 1]);
            if (timeMs < ctxTime * 1000 - 200) scheduledNoteIds.delete(key);
        });
    }

    function schedulePianoNote(note, startCtxTime) {
        const freq = note.frequency;
        const duration = Math.max(note.duration, 0.1);
        const masterGain = audioCtx.createGain();
        masterGain.gain.setValueAtTime(0, startCtxTime);
        masterGain.gain.linearRampToValueAtTime(0.5, startCtxTime + 0.005);
        masterGain.gain.setTargetAtTime(0, startCtxTime + 0.005, 0.3);
        masterGain.gain.linearRampToValueAtTime(0, startCtxTime + duration);
        masterGain.connect(audioCtx.destination);

        HARMONICS.forEach((harmonic) => {
            const osc = audioCtx.createOscillator();
            const oscGain = audioCtx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq * harmonic.multiplier, startCtxTime);
            oscGain.gain.setValueAtTime(0, startCtxTime);
            oscGain.gain.linearRampToValueAtTime(harmonic.gain, startCtxTime + 0.005);
            oscGain.gain.setTargetAtTime(0, startCtxTime + 0.005, harmonic.decay / 3);
            osc.connect(oscGain);
            oscGain.connect(masterGain);
            osc.start(startCtxTime);
            osc.stop(startCtxTime + duration + 0.1);
        });
    }

    function startAnimationLoop() {
        if (animationFrameId) return;
        const loop = () => {
            updatePlayhead();
            drawTimeline();
            updateTimeDisplay();
            animationFrameId = requestAnimationFrame(loop);
        };
        animationFrameId = requestAnimationFrame(loop);
    }

    function stopAnimationLoop() {
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }
    }

    function togglePlay() {
        if (isPlaying) {
            pausePlayback();
        } else {
            startPlayback();
        }
    }

    function toggleRecording() {
        isRecording = !isRecording;
        if (isRecording) {
            recordBtn.classList.add('armed');
            recordBtn.textContent = '● Recording';
            if (!isPlaying) {
                startPlayback();
            }
            statusText.textContent = 'Recording...';
        } else {
            recordBtn.classList.remove('armed');
            recordBtn.textContent = '● Record';
            if (isPlaying) {
                statusText.textContent = 'Playing...';
            } else {
                statusText.textContent = 'Ready';
            }
        }
        updateStatusUI();
    }

    function toggleLoop() {
        loopEnabled = !loopEnabled;
        if (loopEnabled) {
            if (loopEndTime <= loopStartTime) {
                loopStartTime = 0;
                loopEndTime = getAudioDuration();
            }
            loopBtn.classList.add('active');
        } else {
            loopBtn.classList.remove('active');
        }
        updateStatusUI();
        drawTimeline();
    }

    function setLoopStart() {
        loopStartTime = Math.max(0, Math.min(currentBufferPos, getAudioDuration() - 0.1));
        if (loopEndTime <= loopStartTime) {
            loopEndTime = Math.min(getAudioDuration(), loopStartTime + 2);
        }
        updateStatusUI();
        drawTimeline();
    }

    function setLoopEnd() {
        loopEndTime = Math.min(getAudioDuration(), Math.max(currentBufferPos, loopStartTime + 0.1));
        updateStatusUI();
        drawTimeline();
    }

    function clearLoopSection() {
        if (loopEndTime > loopStartTime) {
            recordedNotes = recordedNotes.filter(note => {
                const noteEnd = note.startTime + note.duration;
                return note.startTime >= loopEndTime || noteEnd <= loopStartTime;
            });
            updateStatusUI();
            drawTimeline();
        }
    }

    function setPlaybackMode(mode) {
        playbackMode = mode;
        modeButtons.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === mode);
        });
        if (isPlaying) {
            const currentPos = currentBufferPos;
            pausePlayback();
            currentBufferPos = currentPos;
            startPlayback();
        }
    }

    async function loadAudioFile(file) {
        try {
            initAudioContext();
            const arrayBuffer = await file.arrayBuffer();
            const decoded = await audioCtx.decodeAudioData(arrayBuffer);
            if (audioSourceNode) {
                try { audioSourceNode.stop(0); } catch (e) {}
                audioSourceNode = null;
            }
            stopAllActiveNotes();
            isPlaying = false;
            isPaused = false;
            isRecording = false;
            recordBtn.classList.remove('armed');
            recordBtn.textContent = '● Record';
            currentBufferPos = 0;
            playbackStartBufferPos = 0;
            recordedNotes = [];
            activeNotes.clear();
            scheduledNoteIds.clear();
            audioBuffer = decoded;
            loopStartTime = 0;
            loopEndTime = audioBuffer.duration;
            buildWaveformPeaks();
            updateStatusUI();
            drawTimeline();
            updateTimeDisplay();
            fileNameEl.textContent = file.name;
            statusText.textContent = 'Audio loaded. Press play and start mapping!';
            playBtn.textContent = '▶ Play';
            playBtn.classList.remove('playing');
            stopScheduler();
            stopAnimationLoop();
        } catch (err) {
            console.error('Failed to load audio:', err);
            statusText.textContent = 'Error loading audio file';
        }
    }

    function seekTo(position) {
        if (!audioBuffer && playbackMode === 'notes' && recordedNotes.length === 0) return;
        if (position < 0) position = 0;
        if (audioBuffer && position > audioBuffer.duration) position = audioBuffer.duration;
        if (!audioBuffer && position < 0) position = 0;
        currentBufferPos = position;
        if (isPlaying) {
            if (audioSourceNode) {
                try { audioSourceNode.stop(0); } catch (e) {}
                audioSourceNode = null;
            }
            playbackStartBufferPos = position;
            playbackStartCtxTime = audioCtx.currentTime;
            if (audioBuffer && playbackMode !== 'notes') {
                audioSourceNode = audioCtx.createBufferSource();
                audioSourceNode.buffer = audioBuffer;
                audioSourceNode.connect(audioCtx.destination);
                audioSourceNode.start(0, position);
            }
            scheduledNoteIds.clear();
        }
        updateTimeDisplay();
        drawTimeline();
    }

    function handleTimelineClick(e) {
        const rect = canvasEl.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const w = rect.width;
        const duration = getAudioDuration();
        if (duration <= 0) return;
        const effectiveStart = getEffectiveStartTime();
        const effectiveEnd = getEffectiveEndTime();
        const displayDuration = effectiveEnd - effectiveStart;
        if (displayDuration <= 0) return;
        const ratio = x / w;
        const position = effectiveStart + ratio * displayDuration;
        seekTo(position);
    }

    function setupEventListeners() {
        playBtn.addEventListener('click', togglePlay);
        stopBtn.addEventListener('click', () => {
            if (isPlaying || isPaused) {
                stopPlayback();
            }
        });
        recordBtn.addEventListener('click', toggleRecording);
        loopBtn.addEventListener('click', toggleLoop);
        setLoopStartBtn.addEventListener('click', setLoopStart);
        setLoopEndBtn.addEventListener('click', setLoopEnd);
        clearSectionBtn.addEventListener('click', clearLoopSection);
        uploadBtn.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                loadAudioFile(e.target.files[0]);
            }
        });
        modeButtons.forEach(btn => {
            btn.addEventListener('click', () => setPlaybackMode(btn.dataset.mode));
        });
        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            if (e.repeat) {
                if (KEY_MAP[e.code]) {
                    e.preventDefault();
                    return;
                }
                return;
            }
            if (e.code === 'Space') {
                e.preventDefault();
                togglePlay();
                return;
            }
            if (e.code === 'KeyR') {
                e.preventDefault();
                toggleRecording();
                return;
            }
            if (e.code === 'KeyL') {
                e.preventDefault();
                toggleLoop();
                return;
            }
            if (e.code === 'KeyI') {
                e.preventDefault();
                setLoopStart();
                return;
            }
            if (e.code === 'KeyO') {
                e.preventDefault();
                setLoopEnd();
                return;
            }
            if (e.code === 'KeyC') {
                e.preventDefault();
                clearLoopSection();
                return;
            }
            if (KEY_MAP[e.code]) {
                e.preventDefault();
                if (!activeNotes.has('keyboard-' + KEY_MAP[e.code])) {
                    handleKeyPress(KEY_MAP[e.code], 'keyboard');
                }
            }
        });
        document.addEventListener('keyup', (e) => {
            if (KEY_MAP[e.code]) {
                e.preventDefault();
                handleKeyRelease(KEY_MAP[e.code], 'keyboard');
            }
        });
        timelineCanvas.addEventListener('pointerdown', (e) => {
            isDraggingTimeline = true;
            timelineCanvas.setPointerCapture(e.pointerId);
            handleTimelineClick(e);
        });
        timelineCanvas.addEventListener('pointermove', (e) => {
            if (isDraggingTimeline) {
                handleTimelineClick(e);
            }
        });
        timelineCanvas.addEventListener('pointerup', () => {
            isDraggingTimeline = false;
        });
        timelineCanvas.addEventListener('pointercancel', () => {
            isDraggingTimeline = false;
        });
        window.addEventListener('resize', () => {
            resizeCanvas();
            buildPianoKeyboard();
        });
        const dropZone = document.body;
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropOverlay.classList.remove('hidden');
        });
        dropZone.addEventListener('dragleave', (e) => {
            if (e.relatedTarget === null) {
                dropOverlay.classList.add('hidden');
            }
        });
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropOverlay.classList.add('hidden');
            if (e.dataTransfer.files.length > 0) {
                loadAudioFile(e.dataTransfer.files[0]);
            }
        });
    }

    function init() {
        buildPianoKeyboard();
        resizeCanvas();
        setupEventListeners();
        updateTimeDisplay();
        updateStatusUI();
        statusText.textContent = 'Load an audio file to begin';
    }

    init();
})();
