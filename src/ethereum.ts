import dotenv from "dotenv";
dotenv.config();

import { ethers } from "ethers";
import { Web3 } from "web3";
import { Pool } from '@uniswap/v3-sdk/'
import { TradeType, Token, CurrencyAmount, Percent } from '@uniswap/sdk-core'
import { AlphaRouter, SwapType } from '@uniswap/smart-order-router'
import { BigNumber } from '@ethersproject/bignumber';
import TelegramBot from "node-telegram-bot-api";
import axios from "axios";

const IUniswapV3Pool = require('@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json');
const IUniswapV3Factory = require('@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Factory.sol/IUniswapV3Factory.json');
const QuoterABI = require('@uniswap/v3-periphery/artifacts/contracts/lens/Quoter.sol/Quoter.json');
const ERC20_abi = require("../contract/ERC20.json").abi;

const rpc = process.env.MAINNET_RPC;
const pairAddress = process.env.PAIR_ADDRESS;
const chainId = Number(process.env.CHAIN_ID);
const provider = new ethers.providers.JsonRpcProvider(rpc, chainId);
const usdc_address = process.env.USDC;
const usdc_name = process.env.USDC_NAME;
const usdc_symbol = process.env.USDC_SYMBOL;
const usdc_decimals = Number(process.env.USDC_DECIMALS);
const token_address = process.env.TOKEN;
const token_name = process.env.TOKEN_NAME;
const token_symbol = process.env.TOKEN_SYMBOL;
const token_decimals = Number(process.env.TOKEN_DECIMALS);

const usdcToken = new Token(chainId, usdc_address!, usdc_decimals, usdc_symbol, usdc_name);
const tokenToken = new Token(chainId, token_address!, token_decimals, token_symbol, token_name);
const poolContract = new ethers.Contract(process.env.POOL_ADDRESS!, IUniswapV3Pool.abi, provider);
const quoterContract = new ethers.Contract(process.env.UNISWAP_QUOTER_ADDRESS!, QuoterABI.abi, provider);
const router = new AlphaRouter({ chainId: chainId, provider: provider });

const buy = async (privateKey: string, amount: number) => {
    try {
        const signer = new ethers.Wallet(privateKey, provider);
        const usdcContract = new ethers.Contract(usdc_address!, ERC20_abi, signer);
        const usdcBalance = await usdcContract.balanceOf(signer.address);

        const amountIn = ethers.utils.parseUnits(amount.toString(), usdc_decimals);
        const inAmount = CurrencyAmount.fromRawAmount(usdcToken, amountIn.toString());
        const route = await router.route(
            inAmount,
            tokenToken,
            TradeType.EXACT_INPUT,
            {
                type: SwapType.SWAP_ROUTER_02,
                recipient: signer.address,
                slippageTolerance: new Percent(5, 100),
                deadline: Math.floor(Date.now() / 1000 + 1800)
            },
            {
                maxSwapsPerPath: 1
            }
        );

        if (route == null || route.methodParameters === undefined)
            throw "No route loaded";

        const approveTxUnsigned = await usdcContract.populateTransaction.approve(process.env.V3_SWAP_ROUTER_ADDRESS, amountIn);
        approveTxUnsigned.chainId = chainId;
        approveTxUnsigned.gasLimit = await usdcContract.estimateGas.approve(process.env.V3_SWAP_ROUTER_ADDRESS, amountIn);
        approveTxUnsigned.gasPrice = await provider.getGasPrice();
        approveTxUnsigned.nonce = await provider.getTransactionCount(signer.address);
        const approveTxSigned = await signer.signTransaction(approveTxUnsigned);
        const submittedTx = await provider.sendTransaction(approveTxSigned);
        const approveReceipt = await submittedTx.wait();
        if (approveReceipt.status === 0)
            throw new Error("Approve transaction failed");

        console.log("Making a swap...");
        const value = BigNumber.from(route.methodParameters.value);
        const transaction = {
            data: route.methodParameters.calldata,
            to: process.env.V3_SWAP_ROUTER_ADDRESS,
            value: value,
            from: signer.address,
            gasPrice: route.gasPriceWei,
            gasLimit: BigNumber.from("800000")
        };

        var tx = await signer.sendTransaction(transaction);
        const receipt = await tx.wait();
        if (receipt.status === 0) {
            throw new Error("Sell Swap transaction failed");
        }
        console.log('Buy Swap completed successfully! ');
    } catch (error) {
        console.log('buy error = ', error);
    }
}

const sell = async (privateKey: string, amount: number) => {
    try {
        const signer = new ethers.Wallet(privateKey, provider);
        const tokenContract = new ethers.Contract(token_address!, ERC20_abi, signer);
        const tokenBalance = await tokenContract.balanceOf(signer.address);

        const amountIn = ethers.utils.parseUnits(amount.toString(), token_decimals);
        const inAmount = CurrencyAmount.fromRawAmount(tokenToken, amountIn.toString());
        const route = await router.route(
            inAmount,
            usdcToken,
            TradeType.EXACT_INPUT,
            {
                type: SwapType.SWAP_ROUTER_02,
                recipient: signer.address,
                slippageTolerance: new Percent(5, 100),
                deadline: Math.floor(Date.now() / 1000 + 1800)
            },
            {
                maxSwapsPerPath: 1
            }
        );

        if (route == null || route.methodParameters === undefined)
            throw "No route loaded";

        console.log("Approving amount to spend...");
        const approveTxUnsigned = await tokenContract.populateTransaction.approve(process.env.V3_SWAP_ROUTER_ADDRESS, amountIn);
        approveTxUnsigned.chainId = chainId;
        approveTxUnsigned.gasLimit = await tokenContract.estimateGas.approve(process.env.V3_SWAP_ROUTER_ADDRESS, amountIn);
        approveTxUnsigned.gasPrice = await provider.getGasPrice();
        approveTxUnsigned.nonce = await provider.getTransactionCount(signer.address);
        const approveTxSigned = await signer.signTransaction(approveTxUnsigned);
        const submittedTx = await provider.sendTransaction(approveTxSigned);
        const approveReceipt = await submittedTx.wait();
        if (approveReceipt.status === 0)
            throw new Error("Approve transaction failed");

        console.log("Making a swap...");
        const value = BigNumber.from(route.methodParameters.value);
        const transaction = {
            data: route.methodParameters.calldata,
            to: process.env.V3_SWAP_ROUTER_ADDRESS,
            value: value,
            from: signer.address,
            gasPrice: route.gasPriceWei,
            gasLimit: BigNumber.from("800000")
        };

        var tx = await signer.sendTransaction(transaction);
        const receipt = await tx.wait();
        if (receipt.status === 0) {
            throw new Error("Sell Swap transaction failed");
        }
        console.log('Sell Swap completed successfully! ');
    } catch (error) {
        console.log('Sell error = ', error);
    }
}

export const getTokenData = async (address: string) => {
    const tokenContract = new ethers.Contract(address!, ERC20_abi, provider);
    let promises = [];
    promises.push(tokenContract.name());
    promises.push(tokenContract.symbol());
    promises.push(tokenContract.decimals());
    const [name, symbol, decimals] = await Promise.all(promises);
    console.log('name = ', await tokenContract.name())
    console.log('symbol = ', await tokenContract.symbol())
    console.log('decimals = ', await tokenContract.decimals());
    return { name, symbol, decimals };
}

export const getPrice = async () => {

    const getPoolState = async function () {
        const [liquidity, slot] = await Promise.all([poolContract.liquidity(), poolContract.slot0()]);

        return {
            liquidity: liquidity,
            sqrtPriceX96: slot[0],
            tick: slot[1],
            observationIndex: slot[2],
            observationCardinality: slot[3],
            observationCardinalityNext: slot[4],
            feeProtocol: slot[5],
            unlocked: slot[6],
        }
    }

    const getPoolImmutables = async function () {
        const [factory, token0, token1, fee, tickSpacing, maxLiquidityPerTick] = await Promise.all([
            poolContract.factory(),
            poolContract.token0(),
            poolContract.token1(),
            poolContract.fee(),
            poolContract.tickSpacing(),
            poolContract.maxLiquidityPerTick(),
        ]);

        return {
            factory: factory,
            token0: token0,
            token1: token1,
            fee: fee,
            tickSpacing: tickSpacing,
            maxLiquidityPerTick: maxLiquidityPerTick,
        }
    }

    // loading immutable pool parameters and its current state (variable parameters)
    const [immutables, state] = await Promise.all([getPoolImmutables(), getPoolState()]);

    const pool = new Pool(
        usdcToken,
        tokenToken,
        immutables.fee,
        state.sqrtPriceX96.toString(),
        state.liquidity.toString(),
        state.tick
    );
    console.log("Token prices in pool:");
    console.log(`   1 ${pool.token0.symbol} = ${pool.token0Price.toSignificant()} ${pool.token1.symbol}`);
    console.log(`   1 ${pool.token1.symbol} = ${pool.token1Price.toSignificant()} ${pool.token0.symbol}`);
    return pool.token0Price.toSignificant();
}

export const swapABI_v2 =
{
    "anonymous": false,
    "inputs": [
        {
            "indexed": true,
            "internalType": "address",
            "name": "sender",
            "type": "address"
        },
        {
            "indexed": false,
            "internalType": "uint256",
            "name": "amount0In",
            "type": "uint256"
        },
        {
            "indexed": false,
            "internalType": "uint256",
            "name": "amount1In",
            "type": "uint256"
        },
        {
            "indexed": false,
            "internalType": "uint256",
            "name": "amount0Out",
            "type": "uint256"
        },
        {
            "indexed": false,
            "internalType": "uint256",
            "name": "amount1Out",
            "type": "uint256"
        },
        {
            "indexed": true,
            "internalType": "address",
            "name": "to",
            "type": "address"
        }
    ],
    "name": "Swap",
    "type": "event"
}

export const swapABI_v3 =
{
    "anonymous": false,
    "inputs": [
        {
            "indexed": true,
            "internalType": "address",
            "name": "sender",
            "type": "address"
        },
        {
            "indexed": true,
            "internalType": "address",
            "name": "recipient",
            "type": "address"
        },
        {
            "indexed": false,
            "internalType": "int256",
            "name": "amount0",
            "type": "int256"
        },
        {
            "indexed": false,
            "internalType": "int256",
            "name": "amount1",
            "type": "int256"
        },
        {
            "indexed": false,
            "internalType": "uint160",
            "name": "sqrtPriceX96",
            "type": "uint160"
        },
        {
            "indexed": false,
            "internalType": "uint128",
            "name": "liquidity",
            "type": "uint128"
        },
        {
            "indexed": false,
            "internalType": "int24",
            "name": "tick",
            "type": "int24"
        }
    ],
    "name": "Swap",
    "type": "event"
}

export const LOG_SWAP_V2_KECCACK = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822'
export const LOG_SWAP_V3_KECCACK = '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67'

export const swap_detect = async () => {
    const web3 = new Web3("wss://bsc-mainnet.core.chainstack.com/e0a24d81ae8019ec35e598e40a985bf3");
    var subscription = await web3.eth.subscribe('logs', {
        address: process.env.POOL_ADDRESS!,
        topics: []
    })

    subscription.on('data', async (data: any) => {
        console.log('New Swap Event Detected');
        console.log('Data:', data);
        parseLog(data);
    });


}

const getPrice_1 = () => {
    const sqrtPriceX96 = "396155930997547615878419245519308";
    const price = Math.pow((Number(sqrtPriceX96) / Math.pow(2, 96)), 2);
    console.log('price = ', price);
}

const parseLog = async (log: any) => {
    const web3 = new Web3("wss://bsc-mainnet.core.chainstack.com/e0a24d81ae8019ec35e598e40a985bf3");
    const logCode = log.topics[0]
    const sender = log.topics[1]?.toLowerCase()
    const receipt = log.topics[2]?.toLowerCase()
    const poolAddress = log.address

    if (!sender) {
        return
    }

    switch (logCode) {

        // case LOG_SWAP_V2_KECCACK: {

        //     const logData = web3.eth.abi.decodeLog(swapABI_v2.inputs, log.data, log.topics.slice(1));

        //     const tokenResult = await getTokensFromV2Pool(poolAddress)

        //     if (!tokenResult) {
        //         return
        //     }

        //     const { tokenA, tokenB } = tokenResult;
        // }
        //     break;

        case LOG_SWAP_V3_KECCACK: {
            const tokenResult = await getTokensFromV3Pool(poolAddress)
            const { token0, token1 } = tokenResult;
            console.log('tokens = ', tokenResult);
            if (!tokenResult) {
                return
            }
            const logData = web3.eth.abi.decodeLog(swapABI_v3.inputs, log.data, log.topics.slice(1));
            console.log('logData = ', logData);
            const amount0_lamports = logData.amount0;
            const amount1_lamports = logData.amount1;
            console.log('amount0 = ', amount0_lamports);
            console.log('amount1 = ', amount1_lamports);
            let promises = [];
            promises.push(getTokenData(token0));
            promises.push(getTokenData(token1));
            const [token0Data, token1Data] = await Promise.all(promises);
            let message;
            const amount0 = Number(amount0_lamports) / (10 ** token0Data.decimals);
            const amount1 = Number(amount1_lamports) / (10 ** token1Data.decimals);
            if (amount0 > 0) {
                message = `Sell: ${Math.abs(amount0).toFixed(4)} ${token0Data.symbol} / ${Math.abs(amount1).toFixed(4)} ${token1Data.symbol}`;
            } else {
                message = `Buy: ${Math.abs(amount0).toFixed(4)} ${token0Data.symbol} / ${Math.abs(amount1).toFixed(4)} ${token1Data.symbol}`;
            }
            console.log('message = ', message);
        }
            break;
    }
}

// export const getTokensFromV2Pool = async (poolAddress: string) => {
//     const poolContract = new ethers.Contract(poolAddress, IUniswapV2Pool.abi, provider);
//     const tokenA = await poolContract.token0();
//     const tokenB = await poolContract.token1();
//     return { tokenA, tokenB };
// }

export const getTokensFromV3Pool = async (poolAddress: string) => {
    const poolContract = new ethers.Contract(poolAddress, IUniswapV3Pool.abi, provider);
    const token0 = await poolContract.token0();
    const token1 = await poolContract.token1();
    return { token0, token1 };
}

// const start = () => {
//     sell("7933df45a93fe8dce8271715923964965ef116568fb17c030e771af8c4782472", 24);
// }

// start();

export const getEthPriceOnDate = async (date: string) => {
    const response = await axios.get(`https://api.coingecko.com/api/v3/coins/ethereum/history?date=${date}`);
    const ethPrice = response.data.market_data.current_price.usd;
    console.log(`ETH price on ${date} was $${ethPrice}`);
}
// getEthPriceOnDate('01-01-2022');