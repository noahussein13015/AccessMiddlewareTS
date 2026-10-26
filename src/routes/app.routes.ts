import { Router } from 'express';

const router = Router();

router.get('/status', (req, res) => {
    res.json({
        status: 'online',
        timestamp: new Date().toISOString(),
        message: 'Le middleware est en marche.'
    });
});

export default router;