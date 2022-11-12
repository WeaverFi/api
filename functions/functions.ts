
// Imports:
import { KeyManager } from '3pi';
import axios from 'axios';
import weaver from 'weaverfi';
import keys from './keys.json';

// Type Imports:
import type { KeyInfo } from '3pi/dist/types';
import type { Request, Response } from 'express';
import type { Address, Chain, Hash, TokenPriceData } from 'weaverfi/dist/types';
import type { ErrorResponseType, AggregatedTokenPriceData, TransferTX, ApprovalTX, SimpleTX, TXToken, KeyDoc, IpDoc, CovalentAPIResponse, CovalentTX } from './types';

// Initializations:
const defaultAddress: Address = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const dbPricesCollectionName = 'prices';
const dbRateLimitsCollectionName = 'rateLimits';
const dbIpRateLimitsCollectionName = 'ipRateLimits';
const storageBucketName = 'weaverfi-price-history';
const keyExpiryReCheckWindowInMs: number = 1_800_000;

// Valid API Routes:
const validRoutes: string[] = ['chains', 'projects', 'tokens', 'tokenPrices', 'nativeTokenPrices'];
const chains: Record<Chain, null> = { eth: null, bsc: null, poly: null, ftm: null, avax: null, cronos: null, op: null, arb: null };
const validChainRoutes: string[] = ['info', 'projects', 'tokens', 'gas', 'tokenPrices', 'tokenPrice', 'wallet', 'project', 'nfts', 'txs', 'fees', 'tokenPriceHistory'];

/* ========================================================================================================================================================================= */

// Function to validate route:
export const isValidRoute = (route: string) => {
  const parts = route.split('/').slice(1);
  const isValidSimpleEndpoint = validRoutes.includes(parts[0]);
  if(isValidSimpleEndpoint) {
    return true;
  }
  const isValidChainEndpoint = Object.keys(chains).includes(parts[0]) && validChainRoutes.includes(parts[1]);
  if(isValidChainEndpoint) {
    return true;
  }
  return false;
}

/* ========================================================================================================================================================================= */

// Function to send API responses:
export const sendResponse = (req: Request, res: Response, data: any) => {
  try {
    res.status(200).end(JSON.stringify(data, null, ' '));
  } catch(err) {
    sendError('internalError', res, err);
  }
}

// Function to send API error responses:
export const sendError = (responseType: ErrorResponseType, res: Response, err?: any) => {
  if(err) {
    console.error(err);
  }
  res.status(errorResponses[responseType].status).end(errorResponses[responseType].message);
}

/* ========================================================================================================================================================================= */

// Function to log endpoint usage:
export const logUsage = (req: Request) => {
  let queryVars = '';
  Object.keys(req.query).forEach(name => {
    if(name !== 'key') {
      queryVars += `, ${name}: ${req.query[name]?.toString()}`;
    }
  });
  console.info(`Loading: ${req.path}${queryVars.length > 0 ? ` (${queryVars.slice(2)})` : ''}`);
}

/* ========================================================================================================================================================================= */

// Function to get a wallet's transaction history:
export const getTXs = async (chain: Chain, wallet: Address, page?: number) => {
  let txs: (TransferTX | ApprovalTX)[] = [];
  if(page !== undefined) {
    txs = (await queryCovalentPageTXs(chain, wallet, 100, page)).txs;
  } else {
    txs = await queryCovalentTXs(chain, wallet);
  }
  return txs.sort((a, b) => b.time - a.time);
}

// Function to get a wallet's simple transaction history:
export const getSimpleTXs = async (chain: Chain, wallet: Address) => {
  let txs = await queryCovalentSimpleTXs(chain, wallet);
  return txs.sort((a, b) => b.time - a.time);
}

/* ========================================================================================================================================================================= */

// Function to get a wallet's gas fee expenditure:
export const getFees = async (chain: Chain, wallet: Address) => {
  let fees = { amount: 0, txs: 0, price: 0 };
  let txs = await queryCovalentSimpleTXs(chain, wallet);
  txs.forEach(tx => {
    if(tx.direction === 'out') {
      fees.amount += tx.fee;
      fees.txs += 1;
    }
  });
  fees.price = await weaver[chain].getTokenPrice(defaultAddress);
  return fees;
}

/* ========================================================================================================================================================================= */

// Function to fetch key doc from database:
export const fetchKeyDocDB = async (admin: any, keyHash: Hash) => {
  const rateLimitsRef = admin.firestore().collection(dbRateLimitsCollectionName);
  const keyDocRef = rateLimitsRef.doc(keyHash);
  const keyDoc = await keyDocRef.get();
  if(keyDoc.exists) {
    return keyDoc.data() as KeyDoc;
  } else {
    return undefined;
  }
}

// Function to set a key doc's value on database:
export const setKeyDocDB = async (admin: any, keyHash: Hash, data: KeyDoc) => {
  const rateLimitsRef = admin.firestore().collection(dbRateLimitsCollectionName);
  const keyDocRef = rateLimitsRef.doc(keyHash);
  await keyDocRef.set(data);
}

// Function to update a key doc on database:
export const updateKeyDocDB = async (admin: any, keyHash: Hash, data: Partial<KeyDoc>) => {
  const rateLimitsRef = admin.firestore().collection(dbRateLimitsCollectionName);
  const keyDocRef = rateLimitsRef.doc(keyHash);
  await keyDocRef.update(data);
}

/* ========================================================================================================================================================================= */

// Function to fetch native token prices from database:
export const fetchNativeTokenPricesDB = async (admin: any) => {
  let priceData = await fetchTokenPricesDB(admin);
  Object.keys(priceData).forEach(stringChain => {
    let chain = stringChain as Chain;
    let nativeTokenPriceData = priceData[chain].filter(token => token.address.startsWith(defaultAddress));
    priceData[chain] = nativeTokenPriceData;
  });
  return priceData;
}

// Function to fetch a chain's token prices from database:
export const fetchChainTokenPricesDB = async (admin: any, chain: Chain) => {
  let priceData = await fetchTokenPricesDB(admin);
  return priceData[chain];
}

// Function to fetch one token's price from database:
export const fetchTokenPriceDB = async (admin: any, chain: Chain, address: string) => {
  let priceData = await fetchTokenPricesDB(admin);
  let tokenPriceData = priceData[chain].find(token => token.address === address.toLowerCase());
  if(tokenPriceData) {
    return tokenPriceData.price;
  } else {
    return null;
  }
}

// Function to fetch token prices from database:
export const fetchTokenPricesDB = async (admin: any) => {
  const pricesRef = admin.firestore().collection(dbPricesCollectionName);
  let pricesSnapshot = await pricesRef.orderBy('timestamp', 'desc').limit(1).get();
  if(!pricesSnapshot.empty) {
    let latestPrices: { timestamp: number, priceData: Record<Chain, TokenPriceData[]> } = pricesSnapshot.docs[0].data();
    Object.keys(latestPrices.priceData).forEach(stringChain => {
      let chain = stringChain as Chain;
      latestPrices.priceData[chain].forEach(tokenPriceData => {
        weaver[chain].updateTokenPrice(tokenPriceData);
      });
    });
  } else {
    console.error('No token price data found on database.');
  }
  return weaver.checkPrices() as Record<Chain, TokenPriceData[]>;
}

// Function to fetch a token's price history from database:
export const fetchTokenPriceHistoryDB = async (admin: any, chain: Chain, address: string) => {
  const priceHistoryBucket = admin.storage().bucket(storageBucketName);
  const storageFileName = `${chain}/${address.toLowerCase()}.json`;
  let rawFile = await priceHistoryBucket.file(storageFileName).download();
  let file: AggregatedTokenPriceData = JSON.parse(rawFile.toString());
  return file.prices;
}

/* ========================================================================================================================================================================= */

// Function to get 3PI key information:
export const getKeyInfo = async (apiKey: string, contractAddresses: Partial<Record<Chain, Address>>, admin: any, timestampInMs: number, options?: { useDB?: boolean }) => {
  const keyIsBase58 = /^[A-HJ-NP-Za-km-z1-9]*$/.test(apiKey);
  if(keyIsBase58) {
    let keyChain: Chain | undefined = undefined;
    for(const stringChain of Object.keys(contractAddresses)) {
      if(keyChain === undefined) {
        if(apiKey.slice(0, 2) === stringChain.slice(0, 2)) {
          keyChain = stringChain as Chain;
        }
      }
    }
    if(keyChain !== undefined) {
      const keyManager = initKeyManager(keyChain, contractAddresses);
      if(keyManager) {
        const keyHash = keyManager.getPublicHash(apiKey);
        const keyInfoDB = options?.useDB ? await fetchKeyInfoDocDB(admin, keyHash, keyChain) : undefined;
        if(keyInfoDB) {
          if((keyInfoDB.expiryTime * 1000) > timestampInMs) {
            return { ...keyInfoDB, valid: true, hash: keyHash };
          } else if((timestampInMs - (keyInfoDB.expiryTime * 1000)) < keyExpiryReCheckWindowInMs) {
            const validKeyInfoOnChain = await fetchKeyInfoOnChain(keyManager, keyHash);
            if(validKeyInfoOnChain) {
              options?.useDB && await setKeyInfoDocDB(admin, keyHash, keyChain, validKeyInfoOnChain);
              return { ...validKeyInfoOnChain, valid: true, hash: keyHash };
            }
          }
        } else {
          const validKeyInfoOnChain = await fetchKeyInfoOnChain(keyManager, keyHash);
          if(validKeyInfoOnChain) {
            options?.useDB && await setKeyInfoDocDB(admin, keyHash, keyChain, validKeyInfoOnChain);
            return { ...validKeyInfoOnChain, valid: true, hash: keyHash };
          }
        }
      }
    }
  }
  const invalidKey: { valid: false } = { valid: false };
  return invalidKey;
}

/* ========================================================================================================================================================================= */

// Function to check if free key user is IP rate limited:
export const isUserRateLimited = async (admin: any, hashedIP: Hash, rateLimit: number, rateLimitTimespanInMs: number) => {
  const ipDoc = await fetchIpDocDB(admin, hashedIP);
  if(ipDoc) {
    if(ipDoc.lastTimestamp.toMillis() < (Date.now() - rateLimitTimespanInMs)) {
      await updateIpDocDB(admin, hashedIP, { lastTimestamp: admin.firestore.FieldValue.serverTimestamp(), queries: 1 });
    } else if(ipDoc.queries >= rateLimit) {
      return true;
    } else {
      await updateIpDocDB(admin, hashedIP, { queries: admin.firestore.FieldValue.increment(1) });
    }
  } else {
    await setIpDocDB(admin, hashedIP, { lastTimestamp: admin.firestore.FieldValue.serverTimestamp(), queries: 1 });
  }
  return false;
}

/* ========================================================================================================================================================================= */

// Function to fetch IP doc from database:
const fetchIpDocDB = async (admin: any, hashedIP: Hash) => {
  const ipRateLimitsRef = admin.firestore().collection(dbIpRateLimitsCollectionName);
  const ipDocRef = ipRateLimitsRef.doc(hashedIP);
  const ipDoc = await ipDocRef.get();
  if(ipDoc.exists) {
    return ipDoc.data() as IpDoc;
  } else {
    return undefined;
  }
}

// Function to set an IP doc's value on database:
const setIpDocDB = async (admin: any, hashedIP: Hash, data: IpDoc) => {
  const ipRateLimitsRef = admin.firestore().collection(dbIpRateLimitsCollectionName);
  const ipDocRef = ipRateLimitsRef.doc(hashedIP);
  await ipDocRef.set(data);
}

// Function to update an IP doc on database:
const updateIpDocDB = async (admin: any, hashedIP: Hash, data: Partial<KeyDoc>) => {
  const ipRateLimitsRef = admin.firestore().collection(dbIpRateLimitsCollectionName);
  const ipDocRef = ipRateLimitsRef.doc(hashedIP);
  await ipDocRef.update(data);
}

/* ========================================================================================================================================================================= */

// Function to fetch key info from chain:
const fetchKeyInfoOnChain = async (keyManager: KeyManager, keyHash: Hash) => {
  try {
    const isValidKey = await keyManager.isKeyActive(keyHash);
    if(isValidKey) {
      const keyInfo = await keyManager.getKeyInfo(keyHash);
      return keyInfo;
    }
  } catch {}
  return undefined;
}

// Function to fetch key info doc from database:
const fetchKeyInfoDocDB = async (admin: any, keyHash: Hash, keyChain: Chain) => {
  const keysRef = admin.firestore().collection(`${keyChain}Keys`);
  const keyInfoDocRef = keysRef.doc(keyHash);
  const keyInfoDoc = await keyInfoDocRef.get();
  if(keyInfoDoc.exists) {
    return keyInfoDoc.data() as KeyInfo;
  } else {
    return undefined;
  }
}

// Function to set key info doc's value on database:
const setKeyInfoDocDB = async (admin: any, keyHash: Hash, keyChain: Chain, data: KeyInfo) => {
  const keysRef = admin.firestore().collection(`${keyChain}Keys`);
  const keyInfoDocRef = keysRef.doc(keyHash);
  await keyInfoDocRef.set(data);
}

/* ========================================================================================================================================================================= */

// Function to initialize key manager for a given chain:
const initKeyManager = (chain: Chain, contractAddresses: Partial<Record<Chain, Address>>) => {
  const contractAddress = contractAddresses[chain];
  if(contractAddress) {
    const rpcs = weaver[chain].getInfo().rpcs;
    const keyManager = new KeyManager(contractAddress, rpcs);
    return keyManager;
  } else {
    console.error(`No contract address set for ${chain} chain.`);
    return undefined;
  }
}

/* ========================================================================================================================================================================= */

// Function to query all wallet transactions from Covalent:
const queryCovalentTXs = async (chain: Chain, wallet: Address) => {

  // Initializations:
  let txs: (TransferTX | ApprovalTX)[] = [];
  let hasNextPage = false;
  let page = 0;

  // Fetching Covalent API Data:
  do {
    let covalentResponse = await queryCovalentPageTXs(chain, wallet, 1000, page++);
    txs.push(...covalentResponse.txs);
    hasNextPage = covalentResponse.hasNextPage;
  } while(hasNextPage);
  return txs;
}

// Function to query one page of wallet transactions from Covalent:
const queryCovalentPageTXs = async (chain: Chain, wallet: Address, pageSize: number, page: number) => {

  // Initializations:
  let txs: (TransferTX | ApprovalTX)[] = [];
  let nullEventNativeSwapTXs: Hash[] = [];
  let hasNextPage = false;
  let response: CovalentAPIResponse | undefined = undefined;
  let errors = 0;

  // Fetching Covalent API Data:
  while(!response && errors < 3) {
    try {
      response = (await axios.get(`https://api.covalenthq.com/v1/${fetchChainID(chain)}/address/${wallet}/transactions_v2/?page-size=${pageSize}&page-number=${page}&key=${keys.ckey}`)).data;
      if(response && !response.error) {
        hasNextPage = response.data.pagination.has_more;
        response.data.items.forEach(tx => {
          if(tx.successful) {

            // Setting Basic Info:
            let nativeToken = fetchNativeToken(chain);
            let nativeTokenLogo = weaver[chain].getTokenLogo(nativeToken);
            let wrappedNativeTokenAddress = fetchWrappedNativeTokenAddress(chain);
            let hash = tx.tx_hash;
            let block = tx.block_height;
            let time = (new Date(tx.block_signed_at)).getTime() / 1000;
            let fee = calcFee(chain, tx);
            wallet = wallet.toLowerCase() as Address;

            // Native Transfer TXs:
            if(parseInt(tx.value) > 0) {
              if((tx.from_address === wallet || tx.to_address === wallet)) {
                let from: Address = tx.from_address;
                let to: Address = tx.to_address;
                let token: TXToken = { address: defaultAddress, symbol: nativeToken, logo: nativeTokenLogo }
                let value = parseInt(tx.value) / (10 ** 18);
                txs.push({ wallet, chain, type: 'transfer', hash, block, time, direction: tx.to_address === wallet ? 'in' : 'out', from, to, token, value, fee, nativeToken });
  
                // Wrapping TXs:
                if(tx.to_address.toLowerCase() === wrappedNativeTokenAddress) {
                  let from: Address = tx.to_address;
                  let to: Address = tx.from_address;
                  let symbol = 'W' + nativeToken;
                  let token: TXToken = { address: wrappedNativeTokenAddress, symbol, logo: weaver[chain].getTokenLogo(symbol) }
                  txs.push({ wallet, chain, type: 'transfer', hash, block, time, direction: 'in', from, to, token, value, fee, nativeToken });
                }
              }

            // Approval TXs:
            } else if(tx.log_events.length < 3) {
              tx.log_events.forEach(event => {
                if(event.decoded != null && event.sender_contract_ticker_symbol != null) {
                  if(event.decoded.name === 'Approval') {
                    if(event.decoded.params[0].name === 'owner' && event.decoded.params[0].value === wallet) {
                      let symbol = event.sender_contract_ticker_symbol;
                      let token: TXToken = { address: event.sender_address, symbol, logo: weaver[chain].getTokenLogo(symbol) };
                      let value = parseInt(event.decoded.params[2].value) / (10 ** event.sender_contract_decimals);
                      txs.push({ wallet, chain, type: value > 0 ? 'approve' : 'revoke', hash, block, time, direction: 'out', token, fee, nativeToken, value});
                    }
                  }
                }
              });
            }

            // Other TXs:
            tx.log_events.forEach(event => {
              if(event.decoded != null) {

                // Token Transfers:
                if(event.decoded.name === 'Transfer') {
                  if(!isBlacklisted(chain, event.sender_address) && event.sender_contract_ticker_symbol != null && event.decoded.params[2].name === 'value' && parseInt(event.decoded.params[2].value) > 0) {
                    let symbol = event.sender_contract_ticker_symbol;
                    let token: TXToken = { address: event.sender_address, symbol, logo: weaver[chain].getTokenLogo(symbol) }
                    let value = parseInt(event.decoded.params[2].value) / (10 ** event.sender_contract_decimals);

                    // Outbound:
                    if(event.decoded.params[0].name === 'from' && event.decoded.params[0].value === wallet && event.decoded.params[2].decoded) {
                      let from: Address = wallet;
                      let to: Address = event.decoded.params[1].value as Address;
                      txs.push({ wallet, chain, type: 'transfer', hash, block, time, direction: 'out', from, to, token, value, fee, nativeToken });

                    // Inbound:
                    } else if(event.decoded.params[1].name === 'to' && event.decoded.params[1].value === wallet && event.decoded.params[2].decoded) {
                      let from: Address = event.decoded.params[0].value as Address;
                      let to: Address = wallet;
                      txs.push({ wallet, chain, type: 'transfer', hash, block, time, direction: 'in', from, to, token, value, fee, nativeToken });
                    }
                  }

                // Native Router Swaps:
                } else if(event.decoded.name === 'Withdrawal' && event.decoded.params[0].value === tx.to_address) {
                  let from: Address = tx.to_address;
                  let to: Address = tx.from_address;
                  let token: TXToken = { address: defaultAddress, symbol: nativeToken, logo: nativeTokenLogo }
                  let nullEvent = tx.log_events.find(event => event.decoded === null);
                  if(nullEvent) {
                    if(!nullEventNativeSwapTXs.includes(nullEvent.tx_hash)) {
                      nullEventNativeSwapTXs.push(nullEvent.tx_hash);
                      
                      // ParaSwap TXs:
                      if(nullEvent.raw_log_topics[0] === '0x680ad12fcfabafe9b1f08214caef968eb651cf010bee4a2824adfaec965903e8' && nullEvent.raw_log_topics[3].endsWith('eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee')) {
                        let value = ((parseInt(nullEvent.raw_log_data.slice(194, 258), 16) + parseInt(nullEvent.raw_log_data.slice(258, 322), 16)) / 2) / (10 ** 18);
                        txs.push({ wallet, chain, type: 'transfer', hash, block, time, direction: 'in', from, to, token, value, fee, nativeToken });
                      }
                    }
                  } else {
                    let value = parseInt(event.decoded.params[1].value) / (10 ** 18);
                    txs.push({ wallet, chain, type: 'transfer', hash, block, time, direction: 'in', from, to, token, value, fee, nativeToken });
                  }
                }
              }
            });
          }
        });
      } else {
        hasNextPage = false;
      }
    } catch(err: any) {
      if(++errors > 2) {
        console.error(`Covalent API Error: ${err.response.status}`);
      }
      hasNextPage = false;
    }
  }
  return { txs, hasNextPage };
}

// Function to query all wallet transactions with no logs from Covalent:
const queryCovalentSimpleTXs = async (chain: Chain, wallet: Address) => {

  // Initializations:
  let txs: SimpleTX[] = [];
  let hasNextPage = false;
  let page = 0;

  // Fetching Covalent API Data:
  do {
    let response: CovalentAPIResponse | undefined = undefined;
    let errors = 0;
    while(!response && errors < 3) {
      try {
        response = (await axios.get(`https://api.covalenthq.com/v1/${fetchChainID(chain)}/address/${wallet}/transactions_v2/?no-logs=true&page-size=1000&page-number=${page++}&key=${keys.ckey}`)).data;
        if(response && !response.error) {
          hasNextPage = response.data.pagination.has_more;
          response.data.items.forEach(tx => {
            wallet = wallet.toLowerCase() as Address;
            let hash = tx.tx_hash;
            let block = tx.block_height;
            let time = (new Date(tx.block_signed_at)).getTime() / 1000;
            let fee = calcFee(chain, tx);
            txs.push({ wallet, chain, hash, block, time, direction: tx.from_address === wallet ? 'out' : 'in', fee });
          });
        } else {
          hasNextPage = false;
        }
      } catch(err: any) {
        if(++errors > 2) {
          console.error(`Covalent API Error: ${err.response.status}`);
        }
        hasNextPage = false;
      }
    }
  } while(hasNextPage);
  return txs;
}

/* ========================================================================================================================================================================= */

// Function to calculate transaction fees from Covalent data:
const calcFee = (chain: Chain, tx: CovalentTX) => {
  let fees = (tx.gas_spent * tx.gas_price) / (10 ** 18);
  if(chain === 'op') {
    let estimatedRollupGas = 5000;
    let estimatedGasPrice = 35000000000;
    let layer1Fees = (estimatedRollupGas * estimatedGasPrice) / (10 ** 18);
    return fees + layer1Fees;
  } else {
    return fees;
  }
}

/* ========================================================================================================================================================================= */

// Function to fetch chain ID:
const fetchChainID = (chain: Chain) => {
  return weaver[chain].getInfo().id;
}

/* ========================================================================================================================================================================= */

// Function to fetch a chain's native token symbol:
const fetchNativeToken = (chain: Chain) => {
  return weaver[chain].getInfo().token;
}

/* ========================================================================================================================================================================= */

// Function to fetch a chain's wrapped native token address:
const fetchWrappedNativeTokenAddress = (chain: Chain) => {
  return weaver[chain].getInfo().wrappedToken;
}

/* ========================================================================================================================================================================= */

// Function to check if a given token is blacklisted:
const isBlacklisted = (chain: Chain, token: Address) => {
  if(blacklist[chain].includes(token.toLowerCase() as Address)) {
    return true;
  } else {
    return false;
  }
}

/* ========================================================================================================================================================================= */

// API Error Responses:
const errorResponses: Record<ErrorResponseType, { status: number, message: string }> = {
  routeError: {
    status: 400,
    message: `Invalid route.`
  },
  missingAddress: {
    status: 400,
    message: `No address provided.`
  },
  missingProject: {
    status: 400,
    message: `No project name provided.`
  },
  invalidAddress: {
    status: 400,
    message: `Invalid address provided.`
  },
  invalidProject: {
    status: 400,
    message: `Invalid project name provided.`
  },
  missingAuth: {
    status: 401,
    message: `No API key provided.`
  },
  invalidAuth: {
    status: 401,
    message: `Invalid API key provided.`
  },
  teapot: {
    status: 418,
    message: `             ;,'\n     _o_    ;:;'\n ,-.'---\`.__ ;\n((j\`=====',-'\n \`-\\     /\n    \`-=-'`
  },
  rateLimited: {
    status: 429,
    message: `Too many requests.`
  },
  internalError: {
    status: 500,
    message: `Internal API error.`
  }
}

/* ========================================================================================================================================================================= */

// Token Blacklist (lowercase):
const blacklist: Record<Chain, Address[]> = {
  eth: [
    '0x616fe98349783f1975361d5eb827ef31f90b47b6',
    '0x82dfdb2ec1aa6003ed4acba663403d7c2127ff67',
    '0xd4de05944572d142fbf70f3f010891a35ac15188',
    '0x31a240648e2baf4f9f17225987f6f53fceb1699a',
    '0xe530441f4f73bdb6dc2fa5af7c3fc5fd551ec838',
    '0x7b2f9706cd8473b4f5b7758b0171a9933fc6c4d6',
    '0x1e28439d814486c9d989e55b1993c2f1447957cc',
    '0x34278f6f40079eae344cbac61a764bcf85afc949',
    '0xaf47ebbd460f21c2b3262726572ca8812d7143b0',
    '0xbddab785b306bcd9fb056da189615cc8ece1d823',
    '0xc12d1c73ee7dc3615ba4e37e4abfdbddfa38907e',
    '0x26004d228fc8a32c5bd1a106108c8647a455b04a',
    '0xf84ea569eaaebd634cac7944058f1b17386aa56e',
    '0x4e0b2a80e158f8d28a2007866ab80b7f63be6076',
    '0xbf5fb1563ef58ba41325454ca61cc3d62bd40744',
    '0xf01f7a348681776c1fc9a066c6973882b693cdc6',
    '0xef13cec8ffaf97bc9351b8d422f5bda14c058c14',
    '0xa6d1537b3699905ac18a10718b282661425fd662',
    '0xc9da518db3abdb90a82c4d1838b7cf9b0c945e7e'
  ],
  bsc: [
    '0xb0557906c617f0048a700758606f64b33d0c41a6',
    '0x68d1569d1a6968f194b4d93f8d0b416c123a599f',
    '0x119e2ad8f0c85c6f61afdf0df69693028cdc10be',
    '0x57dbae4b73455bc0d3e892ae57779160961f0f03',
    '0x1882c296ebfa916a0ad194cfa0094c5e0086ba03',
    '0xb8a9704d48c3e3817cc17bc6d350b00d7caaecf6',
    '0xbc6675de91e3da8eac51293ecb87c359019621cf',
    '0xc33fc11b55465045b3f1684bde4c0aa5c5f40124',
    '0x15351604e617d9f645b53ee211d9c95ba88297df',
    '0xab57aef3601cad382aa499a6ae2018a69aad9cf0',
    '0x569b2cf0b745ef7fad04e8ae226251814b3395f9',
    '0xb16600c510b0f323dee2cb212924d90e58864421',
    '0x7269163f2b060fb90101f58cf724737a2759f0bb',
    '0x5ec2a778717cf1a5018c6ae3a7a2957582a92007',
    '0xd22202d23fe7de9e3dbe11a2a88f42f4cb9507cf',
    '0xb926beb62d7a680406e06327c87307c1ffc4ab09',
    '0x44fa4fd9211293a72fcbba8d58fe6cf0bd4df525',
    '0xf301c8435d4dfa51641f71b0615add794b52c8e9',
    '0x1ddbd3d8e6102b81f820175d1be188efd77c3ed8',
    '0xb131a09026a05ab068401babb132d8be8c0ec07e',
    '0x0df62d2cd80591798721ddc93001afe868c367ff',
    '0x33a7e2e54317f8b5cc1ffe1c57b6198b68e3c7c9',
    '0x202ea1329665a7ed6082cc8ee30baed6fe23d81a',
    '0x179960442ece8de9f390011b7f7c9b56c74e4d0a',
    '0xd5e3bf9045cfb1e6ded4b35d1b9c34be16d6eec3',
    '0x442b656f5a5c3dd09790951810c5a15ea5295b51',
    '0x58c10c8e2b80fdb5613778125ddd1c93f8cc8983',
    '0x4827405d992d4d42f9ff4bb9d13ec9b616a75278',
    '0x0198be93b7cae38da7e2fd966946412cc36447bf',
    '0x5e48c354a5da2b0a8c203518d0fc7b9c58cc9329',
    '0x0d05a204e27e4815f1f5afdb9d82aa221aa0bdfa',
    '0x04645027122c9f152011f128c7085449b27cb6d7',
    '0x5190b01965b6e3d786706fd4a999978626c19880',
    '0x491b25000d386cd31307580171a510d32d7e64ee',
    '0xef27b9cb67aa93ec3494a60f1ea9380e86175b26',
    '0x893c25c46bfaa9b66cd557837d32af3fe264a07b',
    '0x556798dd55db12562a6950ea8339a273539b0495',
    '0x2ba6204c23fbd5698ed90abc911de263e5f41266',
    '0x74ddd251aa2037be101bf53f655716b1734828cd',
    '0x0b7dc561777842d55163e0f48886295aad1359b9',
    '0x50fa1d465b2a4a13d64e9fa428ccc98ec873ae64',
    '0x58b5c4697dc70f3d889225260944cdd9c270c132',
    '0x949e0a0672299e6fcd6bec3bd1735d6647b20618',
    '0x2248ba304d2045cdc144866ce37d1435a30b29f3',
    '0xbf7183b8c8e5bb2d10f63678abb5d52df72712b2',
    '0x1c749d5f5630cf365673bf6c0b6b0570c48da112',
    '0x7b4a50a9010c79be94baf3e7ae49f2602557855c',
    '0xdfb8603d947ab42fb76eb3bb14d9dde4334130d2',
    '0x24c7ee6a2b22e72886d88f309d2ac89619c443b6'
  ],
  poly: [
    '0xe4fb1bb8423417a460286b0ed44b64e104c5fae5',
    '0x442407e94a771d60c0adcd4b8217131b65b73199',
    '0x1cc384b6f900a947eb3bbfc47417afeee7599e24',
    '0xcb45304bba17aed9a0c5e0c97127c3cfaf771b93',
    '0x81067076dcb7d3168ccf7036117b9d72051205e2',
    '0x02677c45fa858b9ffec24fc791bf72cdf4a8a8df',
    '0xcbf4ab00b6aa19b4d5d29c7c3508b393a1c01fe3',
    '0x6142f62e7996faec5c5bb9d10669d60299d69dfe',
    '0xa39b14f57087aa5f16b941e5ec182b84a5432aa7',
    '0xa85f8a198d59f0fda82333be9aeeb50f24dd59ff',
    '0x2744861accb5bd435017c1cfee789b6ebab42082',
    '0xd7f1d4f5a1b44d827a7c3cc5dd46a80fade55558',
    '0x22e51bae3f545255e115090202a23c7ede0b00b9',
    '0x0b91b07beb67333225a5ba0259d55aee10e3a578',
    '0xfae400bf04f88e47d899cfe7e7c16bf8c8ae919b',
    '0xdc8fa3fab8421ff44cc6ca7f966673ff6c0b3b58',
    '0xf31cdb090d1d4b86a7af42b62dc5144be8e42906',
    '0x531f83800425a0c4c6964e41d843798e5822b829',
    '0x514b4916a152190424757da1005ea8be613f552b',
    '0x0f1f17e4260515d9bfe805cff323374eb771eae6',
    '0x439a06e69f1302f3f94f265d32ca4511e882b5cd',
    '0x9e2d266d6c90f6c0d80a88159b15958f7135b8af',
    '0xbd43eb85eacc3b5571d3805538f64cc27c21cfc0',
    '0xceb28732d284306c9c44682a8aa788d36d81ad96',
    '0x92face859e48c5d70510bf9bbc60a4b4c4fc8b98',
    '0x52f3b30922d252151d72746dd325390a4e3fa1fb',
    '0x5229cadb824fd5117f00e3614c138b62f2bd3156',
    '0xe0ddf6de9a86f8ad46c40e7714b7960514491ff4',
    '0x695be1c915e3f13315cb226900c168789554f5eb'
  ],
  ftm: [
    '0x95ce7b991cfc7e3ad8466ac20746b9bed7713b0a',
    '0x8e4a2fa6e651df75f7f4e9e9ac81f8f9347a4add',
    '0xe52a9eb2505a072324984c818c0f49c19c8b6abb',
    '0xe4517100ae62cbeefc363e59d0f8df5754dc7e40'
  ],
  avax: [
    '0xd17584633bc8d190e5a14502976dad9640456d6d',
    '0x4a0050cc4a951d8bf0b58129301b9fc7657b0198'
  ],
  cronos: [],
  op: [],
  arb: []
}