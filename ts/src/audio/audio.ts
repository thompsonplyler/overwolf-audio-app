// Simple audio utility, centralized. Expandable for pooling/mixing later.

/** @param volume 0..1. Playback is skipped entirely at 0 (muted). */
export function playAudioFile(relativePath: string, volume: number = 1): void {
    if (volume <= 0) {
        console.log(`Skipping audio (muted/volume=0): ${relativePath}`);
        return;
    }
    const audioPath = `audio/${relativePath}`;
    console.log(`Attempting to play audio: ${audioPath} (volume=${volume.toFixed(2)})`);
    const audio = new Audio(audioPath);
    audio.volume = Math.max(0, Math.min(1, volume));
    audio.play().catch(e => {
        console.error(`!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!`);
        console.error(`!!! ERROR PLAYING AUDIO FILE: ${relativePath} !!!`);
        console.error(`Path: ${audioPath}`);
        console.error(`Error Details:`, e);
        console.error(`!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!`);
    });
}

