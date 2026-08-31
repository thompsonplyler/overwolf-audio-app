import { AppWindow } from "../AppWindow";
import { kWindowNames } from "../consts";
import { SettingsManager, AUDIO_CUE_IDS, AUDIO_CUE_LABELS, AudioCueId, STORAGE_KEY } from "../config/settings";
import { setupVignetteSettingsPanel } from "../vignette/vignetteSettingsPanel";

// The desktop window is the window displayed while game is not running.
// It also owns the persisted audio-cue defaults (volume/mute) that the in-game overlay reads.
// Mutes set here are standing preferences and apply to every match. This is deliberately the
// ONLY place that edits those persisted values — the in-game overlay only ever applies its own
// session-only mute overrides on top, so muting something mid-match never changes what's saved here.
new AppWindow(kWindowNames.desktop);

const settings = SettingsManager.instance();

function bindMasterVolumeInput(input: HTMLInputElement | null): void {
  if (!input) {
    console.warn('[Desktop][Audio] desktopMasterVolumeInput not found in DOM.');
    return;
  }
  input.addEventListener('input', () => {
    const pct = Math.max(0, Math.min(100, Number(input.value)));
    settings.update({ volume: { masterVolume: pct / 100 } });
  });
}

function setButtonLabel(button: HTMLButtonElement | null, text: string): void {
  if (button) {
    button.textContent = text;
  }
}

function bindMasterMuteButton(button: HTMLButtonElement | null): void {
  if (!button) {
    console.warn('[Desktop][Audio] desktopMasterMuteBtn not found in DOM.');
    return;
  }
  button.addEventListener('click', () => {
    const next = !settings.getSettings().volume.masterMuted;
    settings.update({ volume: { masterMuted: next } });
    setButtonLabel(button, next ? 'Unmute all SFX' : 'Mute all SFX');
  });
}

/** Builds one label + volume-slider + mute-checkbox row for a cue, persisted (shared with in-game). */
function buildCueRow(cueId: AudioCueId): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'audio-settings__row';

  const volumeLabel = document.createElement('label');
  volumeLabel.className = 'audio-settings__field';
  const volumeInputId = `cueVolume_${cueId}`;
  volumeLabel.setAttribute('for', volumeInputId);

  const labelSpan = document.createElement('span');
  labelSpan.className = 'audio-settings__field-label';
  labelSpan.textContent = `${AUDIO_CUE_LABELS[cueId]} volume`;

  const volumeInput = document.createElement('input');
  volumeInput.type = 'range';
  volumeInput.id = volumeInputId;
  volumeInput.className = 'audio-settings__field-input audio-settings__field-input--range';
  volumeInput.min = '0';
  volumeInput.max = '100';
  volumeInput.step = '1';
  volumeInput.value = String(Math.round(settings.getSettings().volume.cues[cueId].volume * 100));
  volumeInput.addEventListener('input', () => {
    const pct = Math.max(0, Math.min(100, Number(volumeInput.value)));
    settings.update({ volume: { cues: { [cueId]: { volume: pct / 100 } } } });
  });

  volumeLabel.appendChild(labelSpan);
  volumeLabel.appendChild(volumeInput);

  const muteLabel = document.createElement('label');
  muteLabel.className = 'audio-settings__checkbox-field';
  const muteCheckboxId = `cueMute_${cueId}`;
  muteLabel.setAttribute('for', muteCheckboxId);

  const muteCheckbox = document.createElement('input');
  muteCheckbox.type = 'checkbox';
  muteCheckbox.id = muteCheckboxId;
  muteCheckbox.checked = settings.getSettings().volume.cues[cueId].muted;
  muteCheckbox.addEventListener('change', () => {
    settings.update({ volume: { cues: { [cueId]: { muted: muteCheckbox.checked } } } });
  });

  const muteText = document.createElement('span');
  muteText.textContent = 'Mute';

  muteLabel.appendChild(muteCheckbox);
  muteLabel.appendChild(muteText);

  row.appendChild(volumeLabel);
  row.appendChild(muteLabel);
  return row;
}

/** Refreshes every control's displayed value from the current persisted settings (e.g. after a cross-window sync). */
function refreshAudioSettingsUI(): void {
  const v = settings.getSettings().volume;

  const masterVolumeInput = document.getElementById('desktopMasterVolumeInput') as HTMLInputElement | null;
  if (masterVolumeInput) {
    masterVolumeInput.value = String(Math.round(v.masterVolume * 100));
  }
  setButtonLabel(
    document.getElementById('desktopMasterMuteBtn') as HTMLButtonElement | null,
    v.masterMuted ? 'Unmute all SFX' : 'Mute all SFX',
  );

  for (const cueId of AUDIO_CUE_IDS) {
    const volumeInput = document.getElementById(`cueVolume_${cueId}`) as HTMLInputElement | null;
    if (volumeInput) {
      volumeInput.value = String(Math.round(v.cues[cueId].volume * 100));
    }
    const muteCheckbox = document.getElementById(`cueMute_${cueId}`) as HTMLInputElement | null;
    if (muteCheckbox) {
      muteCheckbox.checked = v.cues[cueId].muted;
    }
  }
}

function setupAudioSettingsPanel(): void {
  const cueList = document.getElementById('cueSettingsList');
  if (!cueList) {
    console.warn('[Desktop][Audio] cueSettingsList not found in DOM.');
    return;
  }

  bindMasterVolumeInput(document.getElementById('desktopMasterVolumeInput') as HTMLInputElement | null);
  bindMasterMuteButton(document.getElementById('desktopMasterMuteBtn') as HTMLButtonElement | null);

  for (const cueId of AUDIO_CUE_IDS) {
    cueList.appendChild(buildCueRow(cueId));
  }

  // The in-game overlay still writes persisted volume levels (just not mutes); pick those up live
  // if both windows happen to be open at once.
  window.addEventListener('storage', (e) => {
    if (e.key === null || e.key === STORAGE_KEY) {
      refreshAudioSettingsUI();
    }
  });
}

setupAudioSettingsPanel();
setupVignetteSettingsPanel('desktopVignette');
