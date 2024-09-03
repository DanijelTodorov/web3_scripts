import { toNano } from '@ton/core';
import { mnemonicToPrivateKey, KeyPair } from "@ton/crypto";
import { Address, TonClient, TonClient4, WalletContractV4, WalletContractV3R2 } from "@ton/ton";
import { Factory, MAINNET_FACTORY_ADDR, Asset, PoolType, ReadinessStatus, JettonRoot, JettonWallet, VaultJetton } from '@dedust/sdk';
import dotenv from 'dotenv';
import { getJettonBalance, getTonClient, waitConfirmTrx } from './ton_utils';
import { sleep } from '@ton-community/assets-sdk/dist/utils';
dotenv.config();
require("buffer");

export const dedustBuy = async (client: TonClient | TonClient4, buyer: KeyPair, jetton_address: string, amount: number) => {
    try {
        const TON = Asset.native();
        const JETTON = Asset.jetton(Address.parse(jetton_address));

        const factory = client.open(Factory.createFromAddress(MAINNET_FACTORY_ADDR));
        const tonVaultContract = client.open(await factory.getNativeVault());
        const pool = client.open(await factory.getPool(PoolType.VOLATILE, [TON, JETTON]));

        let wallet = WalletContractV4.create({ workchain: 0, publicKey: buyer.publicKey });
        const walletContract = client.open(wallet);
        const balance = await walletContract.getBalance();
        console.log('buyer wallet balance:', balance);

        if (balance < toNano(amount + 1)) {
            console.log('balance is not enough, so can not buy jetton');
            return false;
        }

        // Check if pool exists:
        if ((await pool.getReadinessStatus()) !== ReadinessStatus.READY) {
            console.log('Pool not found, so can not buy jetton');
            throw new Error('Pool (TON, SCALE) does not exist.');
        }

        console.log('pool address = ', pool.address);
        // Check if vault exits:
        if ((await tonVaultContract.getReadinessStatus()) !== ReadinessStatus.READY) {
            throw new Error('Vault (TON) does not exist.');
        }

        const amountIn = toNano(amount);
        const { amountOut: expectedAmountOut } = await pool.getEstimatedSwapOut({
            assetIn: Asset.native(),
            amountIn,
        });
        console.log('expected jetton Amount = ', expectedAmountOut);

        let sender = walletContract.sender(buyer.secretKey);
        await tonVaultContract.sendSwap(sender, {
            poolAddress: pool.address,
            amount: amountIn,
            gasAmount: toNano("0.25"),
        });

        await waitConfirmTrx(buyer, "buy trx on DeDust");
        sleep(5000); // confirm time
        return true;
    } catch (error) {
        console.log("dedustBuy function error = ");
        return false;
    }
}

export const dedustSell = async (client: TonClient | TonClient4, seller: KeyPair, jetton_address: string, amountRate: number) => {
    try {
        // get Factory contract
        const factory = client.open(Factory.createFromAddress(MAINNET_FACTORY_ADDR));

        let wallet = WalletContractV4.create({ workchain: 0, publicKey: seller.publicKey });
        const walletContract = client.open(wallet);

        // get trx sender
        const TON = Asset.native();
        const JETTON = Asset.jetton(Address.parse(jetton_address));

        // get pool contract
        const pool = client.open(await factory.getPool(PoolType.VOLATILE, [TON, JETTON]));
        const poolAddress = pool.address;
        console.log('Pool address = ', poolAddress);

        const jettonVault = client.open(await factory.getJettonVault(Address.parse(jetton_address)));
        const jettonRoot = client.open(JettonRoot.createFromAddress(Address.parse(jetton_address)));
        const jettonWallet = client.open(await jettonRoot.getWallet(wallet.address));

        const jetton_balance = await getJettonBalance(client, seller, jetton_address);
        const sellAmount = jetton_balance * BigInt(amountRate) / BigInt(100);

        const sender = walletContract.sender(seller.secretKey);
        await jettonWallet.sendTransfer(sender, toNano("0.3"), {
            amount: sellAmount,
            destination: jettonVault.address,
            responseAddress: wallet.address, // return gas to user
            forwardAmount: toNano("0.25"),
            forwardPayload: VaultJetton.createSwapPayload({ poolAddress }),
        });
        await waitConfirmTrx(seller, "sell trx on Dedust");
        return true;
    } catch (error) {
        console.log('dedustSell function error: ', error);
        return false;
    }
}

export const createPool = async (client: TonClient4 | TonClient, signer: KeyPair, jetton_address: string) => {

    const factory = client.open(Factory.createFromAddress(MAINNET_FACTORY_ADDR));

    const TON = Asset.native();
    const JETTON = Asset.jetton(Address.parse(jetton_address));

    const walletContract = client.open(WalletContractV4.create({ workchain: 0, publicKey: signer.publicKey }));
    const balance = await walletContract.getBalance();
    console.log('wallet balance:', balance);

    if (balance < toNano(1)) {
        console.log('balance is not enough');
        return false;
    }

    let sender = walletContract.sender(signer.secretKey);
    try {
        // Create a vault
        await factory.sendCreateVault(sender, {
            asset: JETTON,
        });
        await waitConfirmTrx(signer, "create vault trx");

        // Create a volatile pool
        const pool = client.open(
            await factory.getPool(PoolType.VOLATILE, [TON, JETTON]),
        );
        console.log('Pool Address =', pool.address);
        const poolReadiness = await pool.getReadinessStatus();
        console.log('Pool Readiness = ', poolReadiness);

        if (poolReadiness === ReadinessStatus.NOT_DEPLOYED) {
            console.log('==== pool contract not deployed ====');
            console.log('==== create volatile pool ====');
            await factory.sendCreateVolatilePool(sender, {
                assets: [TON, JETTON],
            });
            await waitConfirmTrx(signer, "create volatile pool trx");
        }
        return true;
    } catch (error) {
        console.log("createPool function error");
        return false;
    }
}

export const addLiquidity = async (client: TonClient | TonClient4, signer: KeyPair, jetton_address: string, tonAmount: number, jettonAmount: number) => {

    try {
        const factory = client.open(Factory.createFromAddress(MAINNET_FACTORY_ADDR));
        const TON = Asset.native();
        const JETTON = Asset.jetton(Address.parse(jetton_address));
        const assets: [Asset, Asset] = [TON, JETTON];
        const ton_Amount = toNano(tonAmount);
        const jetton_Amount = toNano(jettonAmount);
        const targetBalances: [bigint, bigint] = [ton_Amount, jetton_Amount];

        const walletContract = client.open(WalletContractV4.create({ workchain: 0, publicKey: signer.publicKey }));
        const balance = await walletContract.getBalance();
        console.log('wallet balance:', balance);

        if (balance < ton_Amount + toNano(1)) {
            console.log('insufficient TON balance, so can not add liquidity');
            return false;
        }

        // get tonVault contract
        const tonVault = client.open(await factory.getNativeVault());

        let sender = walletContract.sender(signer.secretKey);
        // deposite ton to ton vault
        await tonVault.sendDepositLiquidity(sender, {
            poolType: PoolType.VOLATILE,
            assets,
            targetBalances,
            amount: ton_Amount,
        });
        await waitConfirmTrx(signer, "deposite ton trx");

        // get jettonVault contract
        const jettonVault = client.open(await factory.getJettonVault(Address.parse(jetton_address)));

        // get jettonWallet contract
        const jettonRoot = client.open(JettonRoot.createFromAddress(Address.parse(jetton_address)));
        const jettonWallet = client.open(await jettonRoot.getWallet(walletContract.address));
        const jettonBalance = await jettonWallet.getBalance();
        console.log('wallet jetton Balance = ', jettonBalance);

        if (jettonBalance < jettonAmount){
            console.log('invalid jetton amount, check correct amount');
            return false;
        }

        // deposite jetton to jetton vault
        await jettonWallet.sendTransfer(sender, toNano('0.5'), {
            amount: jetton_Amount,
            destination: jettonVault.address,
            responseAddress: walletContract.address,
            forwardAmount: toNano('0.4'),
            forwardPayload: VaultJetton.createDepositLiquidityPayload({
                poolType: PoolType.VOLATILE,
                assets,
                targetBalances,
            }),
        });
        await waitConfirmTrx(signer, "deposite jetton trx");
        return true;
    } catch (error) {
        console.log("add liquidity function error");
        return false;
    }

}

export const widthdrawLiquidity = async (client: TonClient | TonClient4, signer: KeyPair, jetton_address: string) => {
    const TON = Asset.native();
    const JETTON = Asset.jetton(Address.parse(jetton_address));
    const factory = client.open(Factory.createFromAddress(MAINNET_FACTORY_ADDR));
    const pool = client.open(await factory.getPool(PoolType.VOLATILE, [TON, JETTON]));
    const walletContract = client.open(WalletContractV4.create({ workchain: 0, publicKey: signer.publicKey }));
    const lpWallet = client.open(await pool.getWallet(walletContract.address));
    const lpBalance = await lpWallet.getBalance()
    console.log('lpWallet balance = ', lpBalance);
    let sender = walletContract.sender(signer.secretKey);
    await lpWallet.sendBurn(sender, toNano('0.5'), {
        amount: lpBalance,
    });
    await waitConfirmTrx(signer, "withdrow LP trx");
}