import type { TwicCardPayload } from './genetec.service.js';

export interface TwicCardResponse {
    success: boolean;
    log_id: number;
    card_known?: boolean;
    dms_access?: string;
    dms_denied_reason?: string;
    route?: string;
}

export class DmsService {
    private baseUrl: string;
    private apiKey: string;

    constructor(baseUrl: string, apiKey: string) {
        this.baseUrl = baseUrl.replace(/\/$/, ''); // Supprime le slash de fin s'il y a
        this.apiKey = apiKey;
    }

    public async sendTwicCard(payload: TwicCardPayload): Promise<TwicCardResponse | null> {
        if (!this.apiKey) {
            console.error("❌ La clé d'API DMS (TwicApiKey) est absente.");
            return null;
        }

        const url = `${this.baseUrl}/api/v1/gos/twic-card/`;

        try {
            console.log(`>>> REQUÊTE ENVOYÉE À DMS :\n${JSON.stringify(payload, null, 2)}`);

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-KEY': this.apiKey
                },
                body: JSON.stringify(payload)
            });

            const responseBody = await response.text();

            if (response.ok) {
                let result: TwicCardResponse | null = null;
                try {
                    result = JSON.parse(responseBody);
                } catch {
                    // Si la réponse n'est pas du JSON valide mais que c'est un succès
                }

                console.log(`<<< RÉPONSE DMS RÉUSSIE [${response.status}] :`, responseBody);
                return result;
            } else {
                console.error(`<<< ÉCHEC DMS [${response.status}] :`, responseBody);
                return null;
            }
        } catch (error) {
            console.error("❌ Erreur lors de la communication réseau avec l'API DMS :", error);
            return null;
        }
    }
}