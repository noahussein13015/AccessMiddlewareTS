import winston from 'winston';
import 'winston-daily-rotate-file';
import path from 'path';

// Définition du format personnalisé (proche de Serilog)
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
    let logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    if (Object.keys(meta).length > 0) {
      logMessage += ` ${JSON.stringify(meta)}`;
    }
    if (stack) {
      logMessage += `\n${stack}`;
    }
    return logMessage;
  })
);

// Configuration de la rotation journalière des fichiers (similaire à RollingInterval.Day)
const fileTransport = new winston.transports.DailyRotateFile({
  filename: path.join('logs', 'access-middleware-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  zippedArchive: false,
  maxSize: '20m',
  maxFiles: '14d', // Conserve les logs pendant 14 jours
  level: 'info',
});

export const logger = winston.createLogger({
  level: 'info',
  format: logFormat,
  transports: [
    // Sortie Console avec couleurs pour le dev
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        logFormat
      ),
    }),
    // Sortie Fichier journalier
    fileTransport,
  ],
});


export const ignoreStatusRequests = winston.format((info) => {
  const message = String(info.message || '');
  if (message.includes('/api/status')) {
    return false; // Ignore le log
  }
  return info;
});