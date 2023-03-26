
// Imports:
import { KeyManager } from '3pi';
import weaver from 'weaverfi';

// Type Imports:
import type { KeyInfo } from '3pi';
import type { Request, Response } from 'express';
import type { Address, Chain, Hash, TokenPriceData } from 'weaverfi';
import type { ErrorResponseType, AggregatedTokenPriceData, KeyDoc, IpDoc } from './types';

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
  rateLimitedRampingUp: {
    status: 429,
    message: `Too many requests. (your API key's rate limit is still ramping up)`
  },
  internalError: {
    status: 500,
    message: `Internal API error.`
  }
}