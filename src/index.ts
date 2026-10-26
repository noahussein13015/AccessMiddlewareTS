import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import apiRouter from './routes/app.routes.js';
import { BadgeReaderService } from './services/reader.service.js';
import { GenetecService } from './services/genetec.service.js';
import { DmsService } from './services/dms.service.js';

const configPath = path.resolve(process.cwd(), 'appsettings.json');
if (!fs.existsSync(configPath)) {
    console.error("❌ Fichier appsettings.json introuvable.");
    process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
const portName = config.BadgeReader?.PortName || "COM3";
const baudRate = parseInt(config.BadgeReader?.BaudRate || "9600", 10);
const reverseBytes = config.BadgeReader?.ReverseBytes === true;
const serverPort = config.Server?.Port || 3000;
const gateId = config.App?.GateId || "PLE1";

const genetecConfig = config.Genetec || {};
const genetecService = new GenetecService(
    genetecConfig.BaseUrl,
    genetecConfig.Username,
    genetecConfig.ApplicationId,
    genetecConfig.Password,
    gateId
);

// Initialisation DMS
const dmsConfig = config.Dms || {};
const dmsService = new DmsService(
    dmsConfig.BaseUrl,
    dmsConfig.TwicApiKey
);

const app = express();
app.use(express.json());
app.use('/api', apiRouter);

const readerService = new BadgeReaderService(portName, baudRate, reverseBytes, async (cardId) => {
    console.log(`\n⚡ Badge détecté sur le port COM : ${cardId}`);
    console.log(`🔍 Interrogation de l'API Genetec en cours...`);

    try {
        const credential = await genetecService.getCredentialByCardId(cardId);

        if (!credential) {
            console.warn(`❌ Résultat : Badge ${cardId} INCONNU dans Genetec.`);
            return;
        }

        console.log(`✅ Badge TROUVÉ dans Genetec !`);
        console.log(`   - Porteur : ${credential.cardholder_name}`);
        console.log(`   - Accès   : ${credential.access}`);

        // Envoi automatique du payload vers l'API DMS
        console.log(`🚀 Transmission du payload vers DMS...`);
        const dmsResponse = await dmsService.sendTwicCard(credential);

        if (dmsResponse) {
            console.log(`✅ Réponse DMS reçue avec succès (LogId: ${dmsResponse.log_id}, Route: ${dmsResponse.route})`);
        } else {
            console.warn(`⚠️ L'envoi vers DMS a échoué ou n'a pas retourné de réponse valide.`);
        }

    } catch (error) {
        console.error(`❌ Erreur lors du traitement du badge ${cardId} :`, error);
    }
});

readerService.start();

app.listen(serverPort, () => {
    console.log(`🚀 Serveur Express démarré sur le port ${serverPort}`);
});