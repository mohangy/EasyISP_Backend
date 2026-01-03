
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const nas = await prisma.nAS.findFirst({
        where: { vpnIp: '10.10.0.2' },
    });
    console.log('Router Name:', nas?.name);
    console.log('Public Key:', nas?.vpnPublicKey);
}

main()
    .catch(e => console.error(e))
    .finally(async () => {
        await prisma.$disconnect();
    });
