class Clicker {
    private letsGoButton: HTMLButtonElement;
    private isClicked: boolean = false;

    constructor() {
        console.log('Clicker script starting...');
        this.letsGoButton = document.getElementById('lets-go-button') as HTMLButtonElement;

        if (!this.letsGoButton) {
            console.error('Could not find lets-go-button element!');
            return;
        }

        console.log('Lets go button found, initializing...');
        this.init();
    }

    private init(): void {
        this.letsGoButton.addEventListener('click', () => {
            console.log('Lets Go button clicked!');

            if (!this.isClicked) {
                this.letsGoButton.classList.add('clicked');
                this.letsGoButton.textContent = 'Activated!';
                this.isClicked = true;
                console.log('Button activated - changed to green');
            } else {
                // Allow re-clicking to toggle back
                this.letsGoButton.classList.remove('clicked');
                this.letsGoButton.textContent = 'Let\'s Go!';
                this.isClicked = false;
                console.log('Button reset - changed back to red');
            }
        });

        console.log('Click event listener added to button');
    }
}

new Clicker(); 