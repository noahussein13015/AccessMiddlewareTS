import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import apiRouter from './routes/app.routes.js';
import { BadgeReaderService } from './services/reader.service.js';
import { GenetecService } from './services/genetec.service.js';
import { DmsService } from './services/dms.service.js';
import { logger } from './utils/logger.js';

const configPath = path.resolve(process.cwd(), 'appsettings.json');
if (!fs.existsSync(configPath)) {
    logger.error("❌ Fichier appsettings.json introuvable.");
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

const dmsConfig = config.Dms || {};
const dmsService = new DmsService(
    dmsConfig.BaseUrl,
    dmsConfig.TwicApiKey
);

const app = express();
app.use(express.json());

// Middleware de log des requêtes HTTP
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        if (!req.originalUrl.includes('/api/status')) {
            logger.info(`HTTP ${req.method} ${req.originalUrl} responded ${res.statusCode} in ${duration}ms`);
        }
    });
    next();
});

app.use('/api', apiRouter);

const readerService = new BadgeReaderService(portName, baudRate, reverseBytes, async (cardId) => {
    logger.info(`⚡ Badge détecté sur le port COM : ${cardId}`);
    logger.info(`🔍 Interrogation de l'API Genetec en cours...`);

    try {
        const credential = await genetecService.getCredentialByCardId(cardId);

        if (!credential) {
            logger.warn(`❌ Résultat : Badge ${cardId} INCONNU dans Genetec.`);
            return;
        }

        logger.info(`✅ Badge TROUVÉ dans Genetec ! Porteur : ${credential.cardholder_name} | Accès : ${credential.access}`);

        logger.info(`🚀 Transmission du payload vers DMS...`);
        const dmsResponse = await dmsService.sendTwicCard(credential);

        if (dmsResponse) {
            logger.info(`✅ Réponse DMS reçue avec succès (LogId: ${dmsResponse.log_id}, Route: ${dmsResponse.route})`);
        } else {
            logger.warn(`⚠️ L'envoi vers DMS a échoué ou n'a pas retourné de réponse valide.`);
        }

    } catch (error) {
        logger.error(`❌ Erreur lors du traitement du badge ${cardId} :`, { error });
    }
});

try {
    readerService.start();
} catch (error) {
    logger.error("❌ Erreur au démarrage du service de lecture de badge :", { error });
}

app.listen(serverPort, () => {
    logger.info(`🚀 Serveur Express démarré sur le port ${serverPort}`);
});