import dgram from 'dgram';
import { logger } from '../lib/logger.js';
class RadiusService {
    authSocket = null;
    acctSocket = null;
    async start() {
        // Auth Server (1812)
        this.authSocket = dgram.createSocket('udp4');
        this.authSocket.on('error', (err) => {
            logger.error({ err }, 'RADIUS Auth server error');
            this.authSocket?.close();
        });
        this.authSocket.on('message', (msg, rinfo) => {
            logger.info({
                sender: `${rinfo.address}:${rinfo.port}`,
                length: msg.length
            }, 'RADIUS Auth packet received');
            // TODO: Implement packet handling logic
        });
        const authPort = parseInt(process.env.RADIUS_PORT || '1812');
        this.authSocket.bind(authPort, () => {
            logger.info(`RADIUS Auth server listening on 0.0.0.0:${authPort}`);
        });
        // Acct Server (1813)
        this.acctSocket = dgram.createSocket('udp4');
        this.acctSocket.on('error', (err) => {
            logger.error({ err }, 'RADIUS Acct server error');
            this.acctSocket?.close();
        });
        this.acctSocket.on('message', (msg, rinfo) => {
            logger.info({
                sender: `${rinfo.address}:${rinfo.port}`,
                length: msg.length
            }, 'RADIUS Acct packet received');
            // TODO: Implement accounting logic
        });
        const acctPort = parseInt(process.env.RADIUS_ACCT_PORT || '1813');
        this.acctSocket.bind(acctPort, () => {
            logger.info(`RADIUS Acct server listening on 0.0.0.0:${acctPort}`);
        });
    }
    async stop() {
        if (this.authSocket) {
            this.authSocket.close();
            logger.info('RADIUS Auth server stopped');
        }
        if (this.acctSocket) {
            this.acctSocket.close();
            logger.info('RADIUS Acct server stopped');
        }
    }
}
export const radiusService = new RadiusService();
//# sourceMappingURL=radius.service.js.map