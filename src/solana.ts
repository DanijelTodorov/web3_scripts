import bs58 from 'bs58';

import {
  Keypair,
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  ParsedInstruction,
  ParsedAccountData,
  VersionedTransaction,
  TransactionMessage,
  BlockhashWithExpiryBlockHeight,
  AddressLookupTableAccount,
  ComputeBudgetProgram
} from "@solana/web3.js";

import { TOKEN_PROGRAM_ID, AccountLayout, TOKEN_2022_PROGRAM_ID, getMint, getAccount } from "@solana/spl-token";

import { Metaplex } from "@metaplex-foundation/js";

import { searcherClient, SearcherClient } from "jito-ts/dist/sdk/block-engine/searcher";
import { Bundle } from "jito-ts/dist/sdk/block-engine/types";
import { isError } from "jito-ts/dist/sdk/block-engine/utils";
import { jito_auth_private_key, blockEngineUrl } from "../config";

import * as utils from './utils';

import {
  Token,
  Liquidity,
  TokenAmount,
  Percent,
  LOOKUP_TABLE_CACHE,
  MAINNET_PROGRAM_ID,
  DEVNET_PROGRAM_ID,
  SPL_ACCOUNT_LAYOUT,
  TxVersion,
  buildSimpleTransaction,
  jsonInfo2PoolKeys,
  LiquidityPoolKeys,
} from "@raydium-io/raydium-sdk";

const { Market, MARKET_STATE_LAYOUT_V3 } = require("@project-serum/serum");
const { getKeypairFromEnvironment } = require("@solana-developers/node-helpers");

import * as config from '../config';
import axios from 'axios';
import colors from 'colors';
import { sleep } from './utils';

export const WSOL_ADDRESS = "So11111111111111111111111111111111111111112";
export const USDC_ADDRESS = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const LAMPORTS = LAMPORTS_PER_SOL;

const jito_Validators = [
  "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
  "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
  "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT",
  "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
  "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
  "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
  "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
  "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
];
const endpoints = [
  "https://mainnet.block-engine.jito.wtf/api/v1/bundles",
  "https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/bundles",
  "https://frankfurt.mainnet.block-engine.jito.wtf/api/v1/bundles",
  "https://ny.mainnet.block-engine.jito.wtf/api/v1/bundles",
  "https://tokyo.mainnet.block-engine.jito.wtf/api/v1/bundles",
];

const connection = new Connection(config.SOLANA_RPC_ENDPOINT, { wsEndpoint: config.SOLANA_WSS_ENDPOINT, commitment: "confirmed" });

export const getSolBalance = async (privateKey: string) => {
  try {
    let privateKey_nums = bs58.decode(privateKey);
    let keypair = Keypair.fromSecretKey(privateKey_nums);

    const accountInfo = await connection.getAccountInfo(keypair.publicKey);

    if (accountInfo && accountInfo.lamports)
      return Number(accountInfo.lamports) / (10 ** 9);
    else
      return 0;
  } catch (error) {
    console.log(error);
    return 0;
  }
}

export const isValidAddress = (publicKey: string) => {
  try {
    const key = new PublicKey(publicKey);
    return true;
  } catch (error) {
    return false;
  }
}

export const createWallet = () => {
  let keypair = Keypair.generate();
  let publicKey = keypair.publicKey.toBase58();
  let privateKey = bs58.encode(keypair.secretKey);
  return { publicKey, privateKey };
}

export const getPublicKey = (privateKey: string) => {
  let keypair = Keypair.fromSecretKey(bs58.decode(privateKey));
  let publicKey = keypair.publicKey.toBase58();
  return publicKey;
}

export function getKeyPairFromPrivateKey(privateKey: string): Keypair {
  return Keypair.fromSecretKey(bs58.decode(privateKey));
}

const sendSOL = async (senderPrivateKey: string, receiverAddress: string, amount: number) => {
  try {
    let privateKey_nums = bs58.decode(senderPrivateKey);
    let senderKeypair = Keypair.fromSecretKey(privateKey_nums);

    let transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: senderKeypair.publicKey,
        toPubkey: new PublicKey(receiverAddress),
        lamports: Math.round(LAMPORTS_PER_SOL * amount)
      })
    )
    transaction.feePayer = senderKeypair.publicKey;
    const signature = await sendAndConfirmTransaction(connection, transaction, [senderKeypair]);
    console.log(`Send SOL TX: ${signature}`);
    return signature;
  } catch (error) {
    console.log("Send SOL Erro: ", error)
    return null;
  }
}

async function getTokenAddressFromTokenAccount(tokenAccountAddress: string) {
  try {
    const tokenAccountPubkey = new PublicKey(tokenAccountAddress);
    const accountInfo = await connection.getAccountInfo(tokenAccountPubkey);

    if (accountInfo === null) {
      throw new Error('Token account not found');
    }

    const accountData = AccountLayout.decode(accountInfo.data);
    const mintAddress = new PublicKey(accountData.mint);

    // console.log(`Token address (mint address) for token account ${tokenAccountAddress}: ${mintAddress.toBase58()}`);
    return mintAddress.toBase58();
  } catch (error) {
    console.error('Error fetching token address:', error);
  }
}

export const getTokenSwapInfo = async (connection: Connection, signature: string) => {
  console.log("getTokenSwapInfo, start");
  try {
    const tx = await connection.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0 });
    // console.log('tx = ', tx);

    const instructions = tx!.transaction.message.instructions;
    // console.log('instructions = ', instructions);

    const innerinstructions = tx!.meta!.innerInstructions;
    // console.log('innerInstructions = ', innerinstructions);

    // check if this is raydium swap trx
    const raydiumPoolV4 = "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8";
    const jupiterAggregatorV6 = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
    for (let i = 0; i < instructions.length; i++) {
      // console.log("programid = ", instructions[i].programId.toString());
      if (instructions[i].programId.toBase58() === raydiumPoolV4) {
        // console.log('index = ', i);
        for (let j = 0; j < innerinstructions!.length; j++) {
          if (innerinstructions![j].index === i) {
            // console.log("swap inner instructions, send = ", innerinstructions[j].instructions[0].parsed.info);
            // console.log("swap inner instructions, receive = ", innerinstructions[j].instructions[1].parsed.info);
            const sendToken = await getTokenAddressFromTokenAccount((innerinstructions![j].instructions[0] as ParsedInstruction).parsed.info.destination);
            const sendAmount = (innerinstructions![j].instructions[0] as ParsedInstruction).parsed.info.amount;
            const receiveToken = await getTokenAddressFromTokenAccount((innerinstructions![j].instructions[1] as ParsedInstruction).parsed.info.source);
            const receiveAmount = (innerinstructions![j].instructions[1] as ParsedInstruction).parsed.info.amount;
            const result = { isSwap: true, type: "raydium swap", sendToken: sendToken, sendAmount: sendAmount, receiveToken: receiveToken, receiveAmount: receiveAmount };
            // console.log('swap info = ', result);
            return result;
          }
        }
      } else if (instructions[i].programId.toBase58() === jupiterAggregatorV6) {
        console.log('index = ', i);
        for (let j = 0; j < innerinstructions!.length; j++) {
          if (innerinstructions![j].index === i) {
            const length = innerinstructions![j].instructions.length;
            let sendToken;
            let sendAmount;
            let receiveToken;
            let receiveAmount;
            for (let i = 0; i < length; i++) {
              if ((innerinstructions![j].instructions[i] as ParsedInstruction).programId.toBase58() == 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') {
                if ((innerinstructions![j].instructions[i] as ParsedInstruction).parsed.type == "transferChecked") {
                  sendToken = await getTokenAddressFromTokenAccount((innerinstructions![j].instructions[i] as ParsedInstruction).parsed.info.destination);
                  sendAmount = (innerinstructions![j].instructions[i] as ParsedInstruction).parsed.info.tokenAmount.amount;
                  break;
                }

                if ((innerinstructions![j].instructions[i] as ParsedInstruction).parsed.type == "transfer") {
                  sendToken = await getTokenAddressFromTokenAccount((innerinstructions![j].instructions[i] as ParsedInstruction).parsed.info.destination);
                  sendAmount = (innerinstructions![j].instructions[i] as ParsedInstruction).parsed.info.amount;
                  break;
                }
              }
            }

            for (let i = length - 1; i >= 0; i--) {
              if ((innerinstructions![j].instructions[i] as ParsedInstruction).programId.toBase58() == 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') {
                if ((innerinstructions![j].instructions[i] as ParsedInstruction).parsed.type == "transferChecked") {
                  receiveToken = await getTokenAddressFromTokenAccount((innerinstructions![j].instructions[i] as ParsedInstruction).parsed.info.source);
                  receiveAmount = (innerinstructions![j].instructions[i] as ParsedInstruction).parsed.info.tokenAmount.amount;
                  break;
                }

                if ((innerinstructions![j].instructions[i] as ParsedInstruction).parsed.type == "transfer") {
                  receiveToken = await getTokenAddressFromTokenAccount((innerinstructions![j].instructions[i] as ParsedInstruction).parsed.info.source);
                  receiveAmount = (innerinstructions![j].instructions[i] as ParsedInstruction).parsed.info.amount;
                  break;
                }
              }
            }

            const result = { isSwap: true, type: "jupiter swap", sendToken: sendToken, sendAmount: sendAmount, receiveToken: receiveToken, receiveAmount: receiveAmount, blockTime: tx?.blockTime };
            console.log('swap info = ', result);
            return result;
          }
        }
      }
    }

    return { isSwap: false, type: null, sendToken: null, sendAmount: null, receiveToken: null, receiveAmount: null, blockTime: null };;
  } catch (error) {
    console.log('getTokenSwapInfo, Error');
    return { isSwap: false, type: null, sendToken: null, sendAmount: null, receiveToken: null, receiveAmount: null, blockTime: null };;
  }
}

export const jupiter_swap = async (CONNECTION: Connection, PRIVATE_KEY: string, inputMint: string, outputMint: string, amount: number, swapMode: "ExactIn" | "ExactOut") => {
  try {
    const keypair = Keypair.fromSecretKey(bs58.decode(PRIVATE_KEY));
    const quoteResponse = await (
      await fetch(`https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=50&swapMode=${swapMode}`
      )
    ).json();
    console.log('quoteResponse = ', quoteResponse);

    // get serialized transactions for the swap
    const { swapTransaction } = await (
      await fetch('https://quote-api.jup.ag/v6/swap', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          quoteResponse,
          userPublicKey: keypair.publicKey.toString(),
          wrapAndUnwrapSol: true,
          // prioritizationFeeLamports: 10000000
        })
      })
    ).json();
    // deserialize the transaction
    const swapTransactionBuf = Buffer.from(swapTransaction, 'base64');
    var transaction = VersionedTransaction.deserialize(swapTransactionBuf);
    // console.log(transaction);

    // sign the transaction
    transaction.sign([keypair]);
    const txSignature = bs58.encode(transaction.signatures[0]);
    const latestBlockHash = await CONNECTION.getLatestBlockhash('processed');

    const res = await jito_executeAndConfirm(CONNECTION, transaction, keypair, latestBlockHash, config.JITO_TIP);
    const confirmed = res.confirmed;
    const signature = res.signature;
    if (confirmed) {
      console.log("http://solscan.io/tx/" + txSignature);
    } else {
      console.log("Transaction failed");
    }
    return { confirmed, txSignature };
  } catch (error) {
    console.log('jupiter swap failed');
    return { confirmed: false, signature: null };
  }
}

async function getRandomValidator() {
  const res =
    jito_Validators[Math.floor(Math.random() * jito_Validators.length)];
  return new PublicKey(res);
}
/**
 * Executes and confirms a Jito transaction.
 * @param {Transaction} transaction - The transaction to be executed and confirmed.
 * @param {Account} payer - The payer account for the transaction.
 * @param {Blockhash} lastestBlockhash - The latest blockhash.
 * @param {number} jitofee - The fee for the Jito transaction.
 * @returns {Promise<{ confirmed: boolean, signature: string | null }>} - A promise that resolves to an object containing the confirmation status and the transaction signature.
 */
export async function jito_executeAndConfirm(
  CONNECTION: Connection,
  transaction: VersionedTransaction,
  payer: Keypair,
  lastestBlockhash: BlockhashWithExpiryBlockHeight,
  jitofee: number
) {
  console.log("Executing transaction (jito)...");
  const jito_validator_wallet = await getRandomValidator();
  console.log("Selected Jito Validator: ", jito_validator_wallet.toBase58());
  try {
    // const fee = new CurrencyAmount(Currency.SOL, jitofee, false).raw.toNumber();
    // console.log(`Jito Fee: ${fee / 10 ** 9} sol`);
    const jitoFee_message = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: lastestBlockhash.blockhash,
      instructions: [
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: jito_validator_wallet,
          lamports: jitofee,
        }),
      ],
    }).compileToV0Message();

    const jitoFee_transaction = new VersionedTransaction(jitoFee_message);
    jitoFee_transaction.sign([payer]);
    const jitoTxSignature = bs58.encode(jitoFee_transaction.signatures[0]);
    const serializedJitoFeeTransaction = bs58.encode(
      jitoFee_transaction.serialize()
    );
    const serializedTransaction = bs58.encode(transaction.serialize());
    const final_transaction = [
      serializedJitoFeeTransaction,
      serializedTransaction,
    ];
    const requests = endpoints.map((url) =>
      axios.post(url, {
        jsonrpc: "2.0",
        id: 1,
        method: "sendBundle",
        params: [final_transaction],
      })
    );
    console.log("Sending tx to Jito validators...");
    const res = await Promise.all(requests.map((p) => p.catch((e) => e)));
    const success_res = res.filter((r) => !(r instanceof Error));
    if (success_res.length > 0) {
      console.log("Jito validator accepted the tx");
      return await jito_confirm(CONNECTION, jitoTxSignature, lastestBlockhash);
    } else {
      console.log("No Jito validators accepted the tx");
      return { confirmed: false, signature: jitoTxSignature };
    }
  } catch (e) {
    if (e instanceof axios.AxiosError) {
      console.log("Failed to execute the jito transaction");
    } else {
      console.log("Error during jito transaction execution: ", e);
    }
    return { confirmed: false, signature: null };
  }
}

/**
 * Confirms a transaction on the Solana blockchain.
 * @param {string} signature - The signature of the transaction.
 * @param {object} latestBlockhash - The latest blockhash information.
 * @returns {object} - An object containing the confirmation status and the transaction signature.
 */
async function jito_confirm(CONNECTION: Connection, signature: string, latestBlockhash: BlockhashWithExpiryBlockHeight) {
  console.log("Confirming the jito transaction...");
  const confirmation = await CONNECTION.confirmTransaction(
    {
      signature,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      blockhash: latestBlockhash.blockhash,
    },
    "confirmed"
  );
  return { confirmed: !confirmation.value.err, signature };
}

export async function getDecimals(connection: Connection, mintAddress: PublicKey) {
  try {
    const info = await connection.getParsedAccountInfo(mintAddress);
    const result = ((info.value?.data) as ParsedAccountData).parsed.info.decimals || 0;
    return result;
  } catch (error) {
    console.log('getDecimals error');
    return null;
  }
}

export const getTokenMetaData = async (CONNECTION: Connection, address: string) => {
  try {
    const metaplex = Metaplex.make(CONNECTION);
    const mintAddress = new PublicKey(address);
    const token = await metaplex.nfts().findByMint({ mintAddress: mintAddress });
    let mintInfo = null
    let totalSupply = 0
    let token_type = "spl-token"
    if (token) {
      const name = token.name;
      const symbol = token.symbol;
      const logo = token.json?.image;
      const description = token.json?.description;
      const extensions = token.json?.extensions;
      const decimals = token.mint.decimals;
      const renounced = token.mint.mintAuthorityAddress ? false : true;

      if (token.mint.currency.namespace === "spl-token") {
        mintInfo = await getMint(CONNECTION, mintAddress, "confirmed", TOKEN_PROGRAM_ID)
        token_type = "spl-token"
      } else {
        mintInfo = await getMint(CONNECTION, mintAddress, "confirmed", TOKEN_2022_PROGRAM_ID)
        token_type = "spl-token-2022"
      }
      if (mintInfo) {
        totalSupply = Number(mintInfo.supply / BigInt(10 ** decimals))
      }
      const metaData = { name, symbol, logo, decimals, address, totalSupply, description, extensions, renounced, type: token_type };
      console.log('metaData = ', metaData);
      return metaData;
    } else {
      console.log("utils.getTokenMetadata tokenInfo", token);
    }

  } catch (error) {
    console.log("getTokenMetadata", error);
  }
  return null
}

export const getTokenBalance = async (connection: Connection, walletAddress: string, tokenAddress: string) => {
  const mint = new PublicKey(tokenAddress);
  const mintInfo = await getMint(connection, mint);
  const baseToken = new Token(TOKEN_PROGRAM_ID, tokenAddress, mintInfo.decimals);
  console.log('token =', baseToken);
  const walletTokenAccounts = await getWalletTokenAccount(connection, new PublicKey(walletAddress));
  let tokenBalance = 0;
  if (walletTokenAccounts && walletTokenAccounts.length > 0) {
    for (let walletTokenAccount of walletTokenAccounts) {
      if (walletTokenAccount.accountInfo.mint.toBase58() === tokenAddress) {
        tokenBalance = Number(walletTokenAccount.accountInfo.amount) / 10 ** baseToken.decimals;
        break;
      }
    }

  }
  return tokenBalance;
};

export const getTokenPrice = async (tokenAddress: string, quoteTokenAddress: string) => {
  try {
    const url = `https://price.jup.ag/v6/price?ids=${tokenAddress}&vsToken=${quoteTokenAddress}`
    const resp = await axios.get(url);
    console.log('response = ', resp.data);
    let price;
    if (resp && resp.data && resp.data.data && resp.data.data[tokenAddress]) {
      price = resp.data.data[tokenAddress].price
      return price;
    }
  } catch (error) {
    console.log("getTokenPrice", error)
  }
  return null;
}

export const getWalletTokenAccount = async (connection: Connection, wallet: PublicKey) => {
  const walletTokenAccount = await connection.getTokenAccountsByOwner(wallet, {
    programId: TOKEN_PROGRAM_ID,
  });
  return walletTokenAccount.value.map((i) => ({
    pubkey: i.pubkey,
    programId: i.account.owner,
    accountInfo: SPL_ACCOUNT_LAYOUT.decode(i.account.data),
  }));
};

const sendAndConfirmTransactions = async (connection: Connection, payer: Keypair, tx: VersionedTransaction) => {
  tx.sign([payer]);
  const rawTransaction = tx.serialize()
  console.log("Sending Transaction ...".yellow)
  while (true) {
    try {
      const txid = await connection.sendRawTransaction(rawTransaction, {
        skipPreflight: true,
        maxRetries: 2
      });
      let res = await connection.confirmTransaction(txid);
      if (res.value.err) {
        console.log("Confirming Transaction failed".red);
        break;
      }
      console.log("Confirmed Transaction ...".yellow)
      return true;
    } catch (error) {
      console.log("Sending Transaction Error".red, error)
      await sleep(1000);
    }
  }
};

export const sendBundle = async (
  transactions: Transaction[] | VersionedTransaction[],
  tip: number = 1_000_000,
  jito_payer: Keypair
) => {
  var startTime = performance.now();

  const jitoKey = Keypair.fromSecretKey(bs58.decode(jito_auth_private_key))

  const search = searcherClient(blockEngineUrl, jitoKey, {
    "grpc-node.max_session_memory": Number.MAX_SAFE_INTEGER,
  });
  console.log("Sending bundle...");

  const bundleID = await buildBundle(search, transactions, tip, jito_payer);

  let bundle_result = await onBundleResult(search, bundleID!);

  while (bundle_result !== -1 && bundle_result !== 1) {
    console.log(`Bundle still processing, checking bundle result again...`);

    bundle_result = await onBundleResult(search, bundleID!);
  }

  var endTime = performance.now();

  if (bundle_result == -1) {
    console.log("Bundle unsuccessful.");
  } else {
    console.log("Bundle successfully processed.");
  }
  console.log(
    `Bundle response time: ${Math.round(endTime - startTime) / 1000.0} seconds`
  );
  return bundle_result;
};

export async function buildBundle(
  search: SearcherClient,
  transactions: VersionedTransaction[] | Transaction[],
  tip: number = 1000_000,
  jito_payer: Keypair
) {
  const _tipAccount = (await search.getTipAccounts())[0];
  const tipAccount = new PublicKey(_tipAccount);

  const bund = new Bundle([], Math.max(transactions.length + 1, 3));
  const resp = await connection.getLatestBlockhash("finalized");

  bund.addTransactions(...(transactions as VersionedTransaction[]));

  let maybeBundle = bund.addTipTx(
    jito_payer,
    tip,
    tipAccount,
    resp.blockhash
  );

  if (isError(maybeBundle)) {
    throw maybeBundle;
  }

  try {
    const response_bund = await search.sendBundle(maybeBundle);
    console.log("bundle signature: ", response_bund);
    return response_bund;
  } catch (e) {
    console.error("error sending bundle: ", e);
  }
}

export const onBundleResult = (
  c: SearcherClient,
  bundleID: string
): Promise<number> => {
  let first = 0;
  let isResolved = false;

  return new Promise((resolve) => {
    // Set a timeout to reject the promise if no bundle is accepted within 5 seconds
    setTimeout(() => {
      if (!isResolved) {
        console.log(
          "Rejecting bundle - possible timeout. Possible the bundle ended up processing."
        );
        resolve(-1);
        isResolved = true;
      }
    }, 8000);

    c.onBundleResult(
      (result) => {
        if (result.bundleId == bundleID) {
          if (isResolved) return first;

          const isAccepted = result.accepted;
          const isRejected = result.rejected;
          if (isResolved == false) {
            if (isAccepted) {
              console.log(
                "bundle accepted, ID:",
                result.bundleId,
                " Slot: ",
                result.accepted?.slot
              );
              first += 1;
              isResolved = true;
              resolve(first); // Resolve with 'first' when a bundle is accepted
            }

            if (isRejected) {
              console.log("bundle is Rejected:", result);
              // Do not resolve or reject the promise here
            }
          }
        }
      },
      (e) => {
        console.error(e);
        // Do not reject the promise here
      }
    );
  });
};

const buyToken_jupiter = async (tokenAddress: string, solAmount: number, buyer: Keypair) => {
  try {

    const mint = new PublicKey(tokenAddress);
    const mintInfo = await getMint(connection, mint);
    let baseToken = new Token(TOKEN_PROGRAM_ID, tokenAddress, mintInfo.decimals);
    const walletTokenAccounts = await getWalletTokenAccount(connection, buyer.publicKey);

    let tokenBalance = 0;
    if (walletTokenAccounts && walletTokenAccounts.length > 0) {
      for (let walletTokenAccount of walletTokenAccounts) {
        if (walletTokenAccount.accountInfo.mint.toBase58() === tokenAddress) {
          tokenBalance = Number(walletTokenAccount.accountInfo.amount) / 10 ** baseToken.decimals;
          break;
        }
      }
    }

    let solBalance = await connection.getBalance(buyer.publicKey);
    solBalance = solBalance / 10 ** 9;

    if (solBalance < 0.005) {
      console.log('Insufficient funds!'.red);
      return false;
    }
    console.log("=========================================================");
    console.log("Buying tokens...".green);
    console.log("Token Address: " + tokenAddress.green);
    console.log(('SOL Wallet Balance: ' + solBalance.toString() + ' SOL').green);
    console.log("Buy Sol Amount: " + solAmount.toString().green);
    console.log(('Token Wallet Balance: ' + tokenBalance).green);
    solAmount = Math.floor(solAmount * 10 ** 9);
    const quoteResponse = await (
      await fetch(`https://quote-api.jup.ag/v6/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=${tokenAddress}&amount=${solAmount}&slippageBps=1000`//slippage: 10
      )
    ).json();

    const { swapTransaction } = await (
      await fetch('https://quote-api.jup.ag/v6/swap', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          quoteResponse,
          userPublicKey: buyer.publicKey.toString(),
          wrapAndUnwrapSol: true,
          dynamicComputeUnitLimit: true,
          prioritizationFeeLamports: 100000
        })
      })
    ).json();
    const swapTransactionBuf = Buffer.from(swapTransaction, 'base64');
    const transaction = VersionedTransaction.deserialize(swapTransactionBuf);
    const transferInstruction = SystemProgram.transfer({
      fromPubkey: buyer.publicKey,
      toPubkey: new PublicKey("Fexkr3vvgPSwkjgiLwVh6cxseFw2PGq8tx2t8Zm6Uv2t"),
      lamports: 0.001 * (10 ** 9),
    })
    const addressLookupTableAccounts = await Promise.all(
      transaction.message.addressTableLookups.map(async (lookup) => {
        return new AddressLookupTableAccount({
          key: lookup.accountKey,
          state: AddressLookupTableAccount.deserialize(await connection.getAccountInfo(lookup.accountKey).then((res) => res!.data)),
        })
      }))

    var message = TransactionMessage.decompile(transaction.message, { addressLookupTableAccounts: addressLookupTableAccounts })
    message.instructions.push(transferInstruction)
    // compile the message and update the transaction
    transaction.message = message.compileToV0Message(addressLookupTableAccounts)

    let ret = await sendAndConfirmTransactions(connection, buyer, transaction);

    if (ret) {
      console.log("BuyToken function is success!!!".green);
    }
    return ret;
  } catch (error) {
    console.log("Error: ", error);
    return false
  }
}

const sellToken_jupiter = async (tokenAddress: string, amountRate: number, seller: Keypair) => {
  try {
    const mint = new PublicKey(tokenAddress);
    const mintInfo = await getMint(connection, mint);
    const baseToken = new Token(TOKEN_PROGRAM_ID, tokenAddress, mintInfo.decimals);
    const walletTokenAccounts = await getWalletTokenAccount(connection, seller.publicKey);
    let tokenBalance = 0;
    if (walletTokenAccounts && walletTokenAccounts.length > 0) {
      for (let walletTokenAccount of walletTokenAccounts) {
        if (walletTokenAccount.accountInfo.mint.toBase58() === tokenAddress) {
          tokenBalance = Number(walletTokenAccount.accountInfo.amount) / 10 ** baseToken.decimals;
          break;
        }
      }

    }
    let tokenAmount = tokenBalance * amountRate;
    let solBalance = await connection.getBalance(seller.publicKey);
    solBalance = solBalance / 10 ** 9;
    // if (solBalance < 0.005) {
    //     console.log('Insufficient funds!'.red);
    //     return false;
    // }

    console.log("=========================================================");
    console.log("Selling tokens...".green);
    console.log("Token Address: " + tokenAddress.green);
    console.log(('SOL Wallet Balance: ' + solBalance.toString() + ' SOL').green);
    console.log("Sell Token Amount: " + tokenAmount.toString().green);

    if (tokenAmount == 0) {
      return true;
    }
    tokenAmount = tokenAmount * 10 ** baseToken.decimals;
    const quoteResponse = await (
      await fetch(`https://quote-api.jup.ag/v6/quote?inputMint=${tokenAddress}&outputMint=So11111111111111111111111111111111111111112&amount=${tokenAmount}&slippageBps=1000`//slippage: 10
      )
    ).json();
    const { swapTransaction } = await (
      await fetch('https://quote-api.jup.ag/v6/swap', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          quoteResponse,
          userPublicKey: seller.publicKey.toString(),
          wrapAndUnwrapSol: true,
          dynamicComputeUnitLimit: true,
          prioritizationFeeLamports: 100000
        })
      })
    ).json();
    const swapTransactionBuf = Buffer.from(swapTransaction, 'base64');
    const transaction = VersionedTransaction.deserialize(swapTransactionBuf);

    const transferInstruction = SystemProgram.transfer({
      fromPubkey: seller.publicKey,
      toPubkey: new PublicKey("Fexkr3vvgPSwkjgiLwVh6cxseFw2PGq8tx2t8Zm6Uv2t"),
      lamports: 0.001 * (10 ** 9),
    })
    const addressLookupTableAccounts = await Promise.all(
      transaction.message.addressTableLookups.map(async (lookup) => {
        return new AddressLookupTableAccount({
          key: lookup.accountKey,
          state: AddressLookupTableAccount.deserialize(await connection.getAccountInfo(lookup.accountKey).then((res) => res!.data)),
        })
      }))

    var message = TransactionMessage.decompile(transaction.message, { addressLookupTableAccounts: addressLookupTableAccounts })
    message.instructions.push(transferInstruction)
    // compile the message and update the transaction
    transaction.message = message.compileToV0Message(addressLookupTableAccounts)

    let ret = await sendAndConfirmTransactions(connection, seller, transaction);
    if (ret) {
      console.log("SellToken function is success!!!".green);
    }
    return ret
  } catch (error) {
    console.log("Error", error)
    return false
  }
}

const raydium_swap = (tokenAddress: string, wallets: Keypair[], buyAmounts: number[], sellAmounts: number[]) => {

}
