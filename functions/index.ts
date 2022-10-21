
// Required Packages:
const cors = require('cors');
const express = require('express');
const admin = require('firebase-admin');
const swagger = require('swagger-ui-express');
const functions = require('firebase-functions');

// Imports:
import weaver from 'weaverfi';
import { KeyManager } from '3pi';
import { sendResponse, sendError, logUsage, getTXs, getSimpleTXs, getFees, fetchKeyDocDB, setKeyDocDB, updateKeyDocDB, fetchTokenPricesDB, fetchNativeTokenPricesDB, fetchChainTokenPricesDB, fetchTokenPriceDB, fetchTokenPriceHistoryDB } from './functions';

// Type Imports:
import type { URL, Address } from 'weaverfi/dist/types';
import type { Application, Request, Response, NextFunction } from 'express';

// Fetching Swagger Docs Setup JSON File:
const swaggerDocs: JSON = require('../static/swagger.json');

// Fetching Firebase Logger Compatibility Patch:
require("firebase-functions/lib/logger/compat");

// Initializing Firebase App:
admin.initializeApp();

// Initializing Express Server:
const api: Application = express();
api.use(cors());
api.use(express.static('functions/static'));

// Initializations:
const repository: URL = 'https://github.com/WeaverFi/api';
const rootResponse = `<title>WeaverFi API</title><p>Click <a href="${repository}">here</a> to see the API's repository, or <a href="/docs">here</a> to see its OpenAPI documentation.</p>`;

// General Settings:
const localTesting: boolean = false; // Set this to `true` to test the API locally instead of deploying it.
const localTestingPort: number = 3000; // This is the port used to locally host the API during testing.
const dbPrices: boolean = true; // Set this to `true` to fetch token prices from Firebase (production only).
const rateLimited: boolean = true; // Set this to `true` to rate limit all endpoints with a few exceptions.
const minInstances = 0; // Set this to the number of function instances you want to keep warm (decreases spin-up time but increases cost).
const maxInstances = 100; // Set this to the maximum number of function instances you would like to have (stops excessive scaling during peak usage).

// 3PI Key Management Settings:
const opKeyContractAddress: Address = '0x'; // <TODO> enter actual OP deployment address
const rateLimitTimespanInMs: number = 86400000;
const newKeyCooldown: boolean = true;
const apiTiers: Record<number, { rateLimit: number }> = {
  0: { rateLimit: 500 },
  1: { rateLimit: 1500 },
  2: { rateLimit: 4000 }
}

/* ========================================================================================================================================================================= */

// Default Endpoint:
api.get('/', (req: Request, res: Response) => {
  res.status(200).end(rootResponse);
});

// Swagger Documentation Endpoint:
api.use('/docs', swagger.serve, swagger.setup(swaggerDocs));

// Teapot:
api.get(`/teapot`, async (req: Request, res: Response) => {
  sendError('teapot', res);
});

// Logging Middleware:
api.use(async (req: Request, res: Response, next: NextFunction) => {
  if(req.path !== '/service-worker.js') {
    if(rateLimited && (process.env.WHITELIST === undefined || (req.headers.origin && !process.env.WHITELIST.split(' ').includes(req.headers.origin)))) {
      const apiKey = req.query.key;
      if(apiKey) {
        if(typeof apiKey === 'string') {
          const keyManager = new KeyManager(opKeyContractAddress, weaver.op.getInfo().rpcs);
          const keyHash = keyManager.getPublicHash(apiKey);
          const isValidKey = await keyManager.isKeyActive(keyHash);
          if(isValidKey) {
            const keyInfo = await keyManager.getKeyInfo(keyHash);
            const coolingDown = newKeyCooldown ? Date.now() < ((keyInfo.startTime * 1000) + rateLimitTimespanInMs) : false;
            const rateLimit = coolingDown ? apiTiers[keyInfo.tierId].rateLimit * ((Date.now() - (keyInfo.startTime * 1000)) / rateLimitTimespanInMs) : apiTiers[keyInfo.tierId].rateLimit;
            if(!localTesting) {
              const keyDoc = await fetchKeyDocDB(admin, keyHash);
              if(keyDoc) {
                if(keyDoc.lastTimestamp.toMillis() < (Date.now() - rateLimitTimespanInMs)) {
                  const usageHistory = { timestamp: keyDoc.lastTimestamp, queries: keyDoc.queries };
                  await updateKeyDocDB(admin, keyHash, { usage: admin.firestore.FieldValue.arrayUnion(usageHistory), lastTimestamp: admin.firestore.FieldValue.serverTimestamp(), queries: 1 });
                  logUsage(req);
                  next();
                } else if(keyDoc.queries >= rateLimit) {
                  sendError('rateLimited', res);
                } else {
                  await updateKeyDocDB(admin, keyHash, { queries: admin.firestore.FieldValue.increment(1) });
                  logUsage(req);
                  next();
                }
              } else {
                await setKeyDocDB(admin, keyHash, { lastTimestamp: admin.firestore.FieldValue.serverTimestamp(), queries: 1, usage: [] });
                logUsage(req);
                next();
              }
            }
          } else {
            sendError('invalidAuth', res);
          }
        } else {
          sendError('invalidAuth', res);
        }
      } else {
        sendError('missingAuth', res);
      }
    } else {
      logUsage(req);
      next();
    }
  } else {
    next();
  }
});

/* ========================================================================================================================================================================= */

// Chain List Endpoint:
api.get('/chains', (req: Request, res: Response) => {
  sendResponse(req, res, weaver.getAllChainInfo());
});

// Project List Endpoint:
api.get('/projects', (req: Request, res: Response) => {
  sendResponse(req, res, weaver.getAllProjects());
});

// Token List Endpoint:
api.get('/tokens', (req: Request, res: Response) => {
  sendResponse(req, res, weaver.getAllTokens());
});

/* ========================================================================================================================================================================= */

// All Token Prices Endpoint:
api.get('/tokenPrices', async (req: Request, res: Response) => {
  try {
    if(!localTesting && dbPrices) {
      sendResponse(req, res, await fetchTokenPricesDB(admin));
    } else {
      sendResponse(req, res, await weaver.getAllTokenPrices());
    }
  } catch(err) {
    sendError('internalError', res, err);
  }
});

// Native Token Prices Endpoint:
api.get('/nativeTokenPrices', async (req: Request, res: Response) => {
  try {
    if(!localTesting && dbPrices) {
      sendResponse(req, res, await fetchNativeTokenPricesDB(admin));
    } else {
      sendResponse(req, res, await weaver.getNativeTokenPrices());
    }
  } catch(err) {
    sendError('internalError', res, err);
  }
});

/* ========================================================================================================================================================================= */

// Chain-Specific Endpoints:
weaver.getAllChains().forEach(chain => {

  // Chain Info Endpoint:
  api.get(`/${chain}/info`, (req: Request, res: Response) => {
    sendResponse(req, res, weaver[chain].getInfo());
  });

  // Project List Endpoint:
  api.get(`/${chain}/projects`, (req: Request, res: Response) => {
    sendResponse(req, res, weaver[chain].getProjects());
  });

  // Token List Endpoint:
  api.get(`/${chain}/tokens`, (req: Request, res: Response) => {
    sendResponse(req, res, weaver[chain].getTokens());
  });

  // Gas Estimates Endpoint:
  api.get(`/${chain}/gas`, async (req: Request, res: Response) => {
    sendResponse(req, res, await weaver[chain].getGasEstimates());
  });

  // Token Prices Endpoint:
  api.get(`/${chain}/tokenPrices`, async (req: Request, res: Response) => {
    try {
      if(!localTesting && dbPrices) {
        sendResponse(req, res, await fetchChainTokenPricesDB(admin, chain));
      } else {
        sendResponse(req, res, await weaver[chain].getTokenPrices());
      }
    } catch(err) {
      sendError('internalError', res, err);
    }
  });

  // Token Price Endpoint:
  api.get(`/${chain}/tokenPrice`, async (req: Request, res: Response) => {
    let address = req.query.address as string | undefined;
    let decimals = req.query.decimals ? parseInt(req.query.decimals as string) : undefined;
    let tokenInfo = { chain, address, decimals, price: 0 };
    if(address) {
      try {
        if(!localTesting && dbPrices) {
          let tokenPrice = await fetchTokenPriceDB(admin, chain, address);
          if(tokenPrice) { tokenInfo.price = tokenPrice; }
        }
        if(tokenInfo.price === 0) {
          if(weaver[chain].isAddress(address as Address)) {
            tokenInfo.price = await weaver[chain].getTokenPrice(address as Address, decimals);
          } else {
            sendError('invalidAddress', res);
          }
        }
        sendResponse(req, res, tokenInfo);
      } catch(err) {
        sendError('internalError', res, err);
      }
    } else {
      sendError('missingAddress', res);
    }
  });

  // Wallet Balance Endpoint:
  api.get(`/${chain}/wallet`, async (req: Request, res: Response) => {
    let address = req.query.address as string | undefined;
    if(address) {
      try {
        if(!localTesting && dbPrices) { await fetchTokenPricesDB(admin); }
        if(weaver[chain].isAddress(address as Address)) {
          sendResponse(req, res, await weaver[chain].getWalletBalance(address as Address));
        } else {
          sendError('invalidAddress', res);
        }
      } catch(err) {
        sendError('internalError', res, err);
      }
    } else {
      sendError('missingAddress', res);
    }
  });

  // Project Balance Endpoint:
  api.get(`/${chain}/project`, async (req: Request, res: Response) => {
    let project = req.query.name as string | undefined;
    let address = req.query.address as string | undefined;
    if(project) {
      if(weaver[chain].getProjects().includes(project)) {
        if(address) {
          try {
            if(!localTesting && dbPrices) { await fetchTokenPricesDB(admin); }
            if(weaver[chain].isAddress(address as Address)) {
              sendResponse(req, res, await weaver[chain].getProjectBalance(address as Address, project));
            } else {
              sendError('invalidAddress', res);
            }
          } catch(err) {
            sendError('internalError', res, err);
          }
        } else {
          sendError('missingAddress', res);
        }
      } else {
        sendError('invalidProject', res);
      }
    } else {
      sendError('missingProject', res);
    }
  });

  // NFT Balance Endpoint:
  api.get(`/${chain}/nfts`, async (req: Request, res: Response) => {
    let address = req.query.address as string | undefined;
    if(address) {
      try {
        if(weaver[chain].isAddress(address as Address)) {
          sendResponse(req, res, await weaver[chain].getNFTBalance(address as Address));
        } else {
          sendError('invalidAddress', res);
        }
      } catch(err) {
        sendError('internalError', res, err);
      }
    } else {
      sendError('missingAddress', res);
    }
  });

  // Transaction History Endpoint:
  api.get(`/${chain}/txs`, async (req: Request, res: Response) => {
    let address = req.query.address as string | undefined;
    let page = req.query.page as string | undefined;
    let simple = req.query.simple as string | undefined;
    if(address) {
      try {
        if(weaver[chain].isAddress(address as Address)) {
          if(simple === 'true') {
            sendResponse(req, res, await getSimpleTXs(chain, address as Address));
          } else {
            if(page !== undefined) {
              sendResponse(req, res, await getTXs(chain, address as Address, parseInt(page)));
            } else {
              sendResponse(req, res, await getTXs(chain, address as Address));
            }
          }
        } else {
          sendError('invalidAddress', res);
        }
      } catch(err) {
        sendError('internalError', res, err);
      }
    } else {
      sendError('missingAddress', res);
    }
  });

  // Transaction Fees Endpoint:
  api.get(`/${chain}/fees`, async (req: Request, res: Response) => {
    let address = req.query.address as string | undefined;
    if(address) {
      try {
        if(!localTesting && dbPrices) { await fetchTokenPricesDB(admin); }
        if(weaver[chain].isAddress(address as Address)) {
          sendResponse(req, res, await getFees(chain, address as Address));
        } else {
          sendError('invalidAddress', res);
        }
      } catch(err) {
        sendError('internalError', res, err);
      }
    } else {
      sendError('missingAddress', res);
    }
  });

  // Token Price History Endpoint:
  if(!localTesting && dbPrices) {
    api.get(`/${chain}/tokenPriceHistory`, async (req: Request, res: Response) => {
      let address = req.query.address as string | undefined;
      if(address) {
        try {
          let priceHistory = await fetchTokenPriceHistoryDB(admin, chain, address);
          sendResponse(req, res, { chain, address, priceHistory });
        } catch(err) {
          sendError('internalError', res, err);
        }
      } else {
        sendError('missingAddress', res);
      }
    });
  }
});

/* ========================================================================================================================================================================= */

// 404 Response:
api.all('*', async (req: Request, res: Response) => {
  sendError('routeError', res);
});

/* ========================================================================================================================================================================= */

// Local Development:
if(localTesting) {
  api.listen(localTestingPort, () => { console.info(`API Up on http://127.0.0.1:${localTestingPort}`); });

// Production Deployment:
} else {
  exports.api = functions.runWith({ memory: '1GB', timeoutSeconds: 180, minInstances: minInstances, maxInstances: maxInstances }).https.onRequest(api);
}