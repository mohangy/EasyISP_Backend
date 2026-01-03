
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const nas = await prisma.nAS.findFirst({
        orderBy: { createdAt: 'desc' },
    });
    console.log('Router Name:', nas?.name);
    console.log('IP Address:', nas?.ipAddress);
    console.log('VPN IP:', nas?.vpnIp);
    console.log('VPN Public Key:', nas?.vpnPublicKey);
}

main()
    .catch(e => console.error(e))
    .finally(async () => {
        await prisma.$disconnect();
    });
