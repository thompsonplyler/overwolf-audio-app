import { kWindowNames } from '../consts';
import WindowState = overwolf.windows.WindowStateEx;

document.addEventListener('DOMContentLoaded', () => {
    console.log('[TogglerButton] DOMContentLoaded - Toggler Button Window Loaded.');
    alert('Toggler Button Window Loaded!'); // Very obvious check

    const toggleButton = document.getElementById('toggleInGameBtn');
    const mainInGameWindowName = kWindowNames.inGame;

    if (toggleButton) {
        toggleButton.innerText = 'Toggle (Loaded)';
        toggleButton.addEventListener('click', async () => {
            try {
                console.log('[TogglerButton] Toggle button clicked');
                const mainInGameWindow = await new Promise<overwolf.windows.WindowResult | null>(
                    (resolve) => overwolf.windows.obtainDeclaredWindow(mainInGameWindowName, resolve)
                );

                if (!mainInGameWindow || !mainInGameWindow.window || !mainInGameWindow.window.id) {
                    console.error('[TogglerButton] Could not obtain main in-game window.', mainInGameWindow);
                    return;
                }

                const mainInGameWindowId = mainInGameWindow.window.id;

                const windowState = await new Promise<overwolf.windows.GetWindowStateResult | null>(
                    (resolve) => overwolf.windows.getWindowState(mainInGameWindowId, resolve)
                );

                if (!windowState || !windowState.window_state_ex) {
                    console.error('[TogglerButton] Could not get state of main in-game window.', windowState);
                    // As a fallback, try to restore it if we can't get its state
                    overwolf.windows.restore(mainInGameWindowId, (result: overwolf.windows.WindowIdResult | null) => {
                        if (!result || result.error) {
                            console.error('[TogglerButton] Fallback restore failed:', result ? result.error : 'Unknown error');
                        }
                    });
                    return;
                }

                console.log(`[TogglerButton] Main window current state: ${windowState.window_state_ex}`);

                if (windowState.window_state_ex === WindowState.NORMAL ||
                    windowState.window_state_ex === WindowState.MAXIMIZED) {
                    console.log('[TogglerButton] Main window is visible, minimizing it.');
                    overwolf.windows.minimize(mainInGameWindowId);
                } else { // Covers MINIMIZED, CLOSED, HIDDEN
                    console.log('[TogglerButton] Main window is not visible, restoring it.');
                    overwolf.windows.restore(mainInGameWindowId);
                }

            } catch (error) {
                console.error('[TogglerButton] Error in toggle logic:', error);
            }
        });
    } else {
        console.error('[TogglerButton] toggleInGameBtn not found!');
        alert('Toggler Button HTML element NOT FOUND!');
    }
});

console.log('[TogglerButton] toggler_button.ts script is executing.');
alert('toggler_button.ts script is executing.'); 