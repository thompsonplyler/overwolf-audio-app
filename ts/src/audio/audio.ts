// Simple audio utility, centralized. Expandable for pooling/mixing later.

// Tracks the in-flight Audio element per channel so a cue whose trigger condition
// resolves mid-playback can be stopped via stopAudioChannel (see in_game.ts callers).
const activeAudioByChannel = new Map<string, HTMLAudioElement>();

/**
 * @param volume 0..1. Playback is skipped entirely at 0 (muted).
 * @param channel Optional key used to stop this sound early via stopAudioChannel.
 */
export function playAudioFile(relativePath: string, volume: number = 1, channel?: string): void {
    if (volume <= 0) {
        console.log(`Skipping audio (muted/volume=0): ${relativePath}`);
        return;
    }
    const audioPath = `audio/${relativePath}`;
    console.log(`Attempting to play audio: ${audioPath} (volume=${volume.toFixed(2)})`);
    const audio = new Audio(audioPath);
    audio.volume = Math.max(0, Math.min(1, volume));
    if (channel) {
        audio.addEventListener('ended', () => {
            if (activeAudioByChannel.get(channel) === audio) {
                activeAudioByChannel.delete(channel);
            }
        });
        activeAudioByChannel.set(channel, audio);
    }
    audio.play().catch(e => {
        console.error(`!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!`);
        console.error(`!!! ERROR PLAYING AUDIO FILE: ${relativePath} !!!`);
        console.error(`Path: ${audioPath}`);
        console.error(`Error Details:`, e);
        console.error(`!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!`);
    });
}

/** Stops whatever is currently playing on `channel`, if anything. No-op otherwise. */
export function stopAudioChannel(channel: string): void {
    const audio = activeAudioByChannel.get(channel);
    if (!audio) {
        return;
    }
    audio.pause();
    activeAudioByChannel.delete(channel);
}

/**
 * Plays an absolute URL (e.g. the backend's cached enemy-spike mp3) and calls onDone exactly
 * once when it ends, errors, or is skipped (volume 0) -- so a queue never stalls.
 */
export function playAudioUrl(url: string, volume: number, channel: string, onDone: () => void): void {
    let finished = false;
    const done = () => {
        if (finished) return;
        finished = true;
        if (activeAudioByChannel.get(channel) === audio) {
            activeAudioByChannel.delete(channel);
        }
        onDone();
    };
    if (volume <= 0) {
        console.log(`Skipping audio (muted/volume=0): ${url}`);
        onDone();
        return;
    }
    const audio = new Audio(url);
    audio.volume = Math.max(0, Math.min(1, volume));
    audio.addEventListener('ended', done);
    audio.addEventListener('error', () => {
        console.error(`[audio] failed to play ${url}`);
        done();
    });
    activeAudioByChannel.set(channel, audio);
    audio.play().catch(e => {
        console.error(`[audio] play() rejected for ${url}:`, e);
        done();
    });
}
