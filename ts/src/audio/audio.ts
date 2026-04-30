// Simple audio utility, centralized. Expandable for pooling/mixing later.

export function playAudioFile(relativePath: string): void {
    const audioPath = `audio/${relativePath}`;
    console.log(`Attempting to play audio: ${audioPath}`);
    const audio = new Audio(audioPath);
    audio.play().catch(e => {
        console.error(`!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!`);
        console.error(`!!! ERROR PLAYING AUDIO FILE: ${relativePath} !!!`);
        console.error(`Path: ${audioPath}`);
        console.error(`Error Details:`, e);
        console.error(`!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!`);
    });
}

