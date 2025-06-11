class Clicker {
    private letsGoButton: HTMLButtonElement;
    private isClicked: boolean = false;

    constructor() {
        this.letsGoButton = document.getElementById('lets-go-button') as HTMLButtonElement;
        this.init();
    }

    private init(): void {
        this.letsGoButton.addEventListener('click', () => {
            if (!this.isClicked) {
                this.letsGoButton.classList.add('clicked');
                this.isClicked = true;
            }
        });
    }
}

new Clicker(); 