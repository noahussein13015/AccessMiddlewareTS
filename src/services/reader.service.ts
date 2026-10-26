import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';

export class BadgeReaderService {
    private portName: string;
    private baudRate: number;
    private reverseBytesEnabled: boolean;
    private serialPort: SerialPort | null = null;
    private parser: ReadlineParser | null = null;
    private isRunning: boolean = false;

    constructor(portName: string, baudRate: number, reverseBytes: boolean, onCardScanned: (cardId: string) => void) {
        this.portName = portName;
        this.baudRate = baudRate;
        this.reverseBytesEnabled = reverseBytes;

        this.onCardScanned = onCardScanned;
    }

    private onCardScanned: (cardId: string) => void;

    public start() {
        this.isRunning = true;
        this.monitorConnection();
    }

    private monitorConnection() {
        if (!this.isRunning) return;

        if (!this.serialPort || !this.serialPort.isOpen) {
            this.tryOpenPort();
        }

        setTimeout(() => this.monitorConnection(), 3000);
    }

    private tryOpenPort() {
        try {
            this.serialPort = new SerialPort({
                path: this.portName,
                baudRate: this.baudRate,
            });

            this.parser = this.serialPort.pipe(new ReadlineParser({ delimiter: '\r\n' }));

            this.serialPort.on('open', () => {
                console.log(`✅ Lecteur de badge connecté sur ${this.portName} à ${this.baudRate} bauds`);
            });

            this.parser.on('data', (data: string) => {
                let cardId = data.trim();
                if (!cardId) return;

                if (this.reverseBytesEnabled) {
                    cardId = this.reverseBytes(cardId);
                }
                this.onCardScanned(cardId);
            });

            this.serialPort.on('error', (err) => {
                console.error(`❌ Erreur sur le port série ${this.portName}:`, err.message);
                this.closePort();
            });

        } catch (ex) {
            this.closePort();
        }
    }

    private closePort() {
        if (this.serialPort) {
            try {
                if (this.serialPort.isOpen) {
                    this.serialPort.close();
                }
                this.serialPort.destroy();
            } catch {}
            finally {
                this.serialPort = null;
                this.parser = null;
            }
        }
    }

    private reverseBytes(decimalCardId: string): string {
        const num = parseInt(decimalCardId, 10);
        if (isNaN(num)) return decimalCardId;

        const b1 = (num >> 24) & 0xFF;
        const b2 = (num >> 16) & 0xFF;
        const b3 = (num >> 8) & 0xFF;
        const b4 = num & 0xFF;

        const reversedNum = (b4 << 24) | (b3 << 16) | (b2 << 8) | b1;
        return (reversedNum >>> 0).toString();
    }

    public stop() {
        this.isRunning = false;
        this.closePort();
    }
}