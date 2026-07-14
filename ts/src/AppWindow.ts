import { OWWindow } from "@overwolf/overwolf-api-ts";

// A base class for the app's foreground windows.
// Sets the modal and drag behaviors, which are shared accross the desktop and in-game windows.
export class AppWindow {
  protected currWindow: OWWindow;
  protected mainWindow: OWWindow;
  protected maximized: boolean = false;
  private _windowName: string;

  constructor(windowName) {
    this._windowName = windowName;
    this.mainWindow = new OWWindow('background');
    this.currWindow = new OWWindow(windowName);

    const closeButton = document.getElementById('closeButton');
    const maximizeButton = document.getElementById('maximizeButton');
    const minimizeButton = document.getElementById('minimizeButton');

    const header = document.getElementById('header');

    this.setDrag(header);

    closeButton.addEventListener('click', () => {
      this.mainWindow.close();
    });

    minimizeButton.addEventListener('click', () => {
      this.currWindow.minimize();
    });

    maximizeButton.addEventListener('click', () => {
      if (!this.maximized) {
        this.currWindow.maximize();
      } else {
        this.currWindow.restore();
      }

      this.maximized = !this.maximized;
    });
  }

  public async getWindowState() {
    return await this.currWindow.getWindowState();
  }

  private setDrag(elem: HTMLElement | null): void {
    if (!elem) {
      return;
    }
    elem.classList.add('draggable');
    elem.addEventListener('mousedown', (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, button, label, a, [data-no-drag]')) {
        return;
      }
      e.preventDefault();
      overwolf.windows.dragMove(this._windowName);
    });
  }
}
