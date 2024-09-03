import TronWeb from 'tronweb';

const tronWeb = new TronWeb({
    fullHost: process.env.TRON_FULL_HOST || "https://api.trongrid.io",
    headers: { "TRON-PRO-API-KEY": process.env.API_KEY },
    privateKey: process.env.PRIVATE_KEY,
});