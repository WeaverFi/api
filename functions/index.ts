
// Required Packages:
const cors = require('cors');
const express = require('express');
const admin = require('firebase-admin');
const requestIp = require('request-ip');
const swagger = require('swagger-ui-express');
const functions = require('firebase-functions');

// Imports:
import { ethers } from 'ethers';
import weaver from 'weaverfi';
import * as fn from './functions';

// Type Imports:
import type { Chain, Address, Hash } from 'weaverfi/dist/types';
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

// General Settings:
const localTesting: boolean = false; // Set this to `true` to test the API locally instead of deploying it.
const localTestingPort: number = 3000; // This is the port used to locally host the API during testing.
const dbPrices: boolean = true; // Set this to `true` to fetch token prices from Firebase (production only).
const dbKeyCache: boolean = true; // Set this to `true` to fetch cached key info from Firebase (production only).
const rateLimited: boolean = true; // Set this to `true` to rate limit all endpoints with a few exceptions.
const minInstances = 0; // Set this to the number of function instances you want to keep warm (decreases spin-up time but increases cost).
const maxInstances = 100; // Set this to the maximum number of function instances you would like to have (stops excessive scaling during peak usage).

// 3PI Key Management Settings:
const contractAddresses: Partial<Record<Chain, Address>> = {
  op: '0xF50D1cAF40E1dE56198F262ACA4A3745De0A88dC',
  poly: '0xF50D1cAF40E1dE56198F262ACA4A3745De0A88dC'
}
const rateLimitTimespanInMs: number = 86400000;
const newKeyCooldown: boolean = true;
const freeTierID: number = 0;
const apiTiers: Record<number, { rateLimit: number }> = {
  0: { rateLimit: 100 },
  1: { rateLimit: 1000 },
  2: { rateLimit: 3000 },
  3: { rateLimit: 8000 }
}

/* ========================================================================================================================================================================= */

// Swagger Documentation Endpoint:
api.use('/docs', swagger.serve, swagger.setup(swaggerDocs));

// Teapot:
api.get(`/teapot`, async (req: Request, res: Response) => {
  fn.sendError('teapot', res);
});

// Logging Middleware:
api.use(async (req: Request, res: Response, next: NextFunction) => {
  if(fn.isValidRoute(req.path)) {
    if(rateLimited && (process.env.WHITELIST === undefined || req.headers.origin === undefined || (req.headers.origin && !process.env.WHITELIST.split(' ').includes(req.headers.origin)))) {
      const apiKey = req.query.key;
      if(apiKey) {
        if(typeof apiKey === 'string') {
          const timestampInMs = Date.now();
          const keyInfo = await fn.getKeyInfo(apiKey, contractAddresses, admin, timestampInMs, { useDB: dbKeyCache });
          if(keyInfo.valid) {
            const coolingDown = newKeyCooldown ? timestampInMs < ((keyInfo.startTime * 1000) + rateLimitTimespanInMs) : false;
            const rateLimit = coolingDown ? apiTiers[keyInfo.tierId].rateLimit * ((timestampInMs - (keyInfo.startTime * 1000)) / rateLimitTimespanInMs) : apiTiers[keyInfo.tierId].rateLimit;
            if(!localTesting) {

              // Getting client's IP & hashing it if using free tier:
              let clientIp = requestIp.getClientIp(req);
              const hashedIP = keyInfo.tierId === freeTierID ? ethers.utils.keccak256(Buffer.from(typeof clientIp !== 'string' ? 'no-ip' : clientIp)) as Hash : undefined;

              // Determining if client is rate-limited:
              const ipRateLimitReached = hashedIP ? await fn.isUserRateLimited(admin, hashedIP, rateLimit, rateLimitTimespanInMs) : false;
              if(!ipRateLimitReached) {
                const keyDoc = await fn.fetchKeyDocDB(admin, keyInfo.hash);
                if(keyDoc) {
                  if(keyDoc.lastTimestamp.toMillis() < (timestampInMs - rateLimitTimespanInMs)) {
                    const usageHistory = { timestamp: keyDoc.lastTimestamp, queries: keyDoc.queries };
                    await fn.updateKeyDocDB(admin, keyInfo.hash, { usage: admin.firestore.FieldValue.arrayUnion(usageHistory), lastTimestamp: admin.firestore.FieldValue.serverTimestamp(), queries: 1 });
                    fn.logUsage(req);
                    next();
                  } else if(keyDoc.queries >= rateLimit) {
                    fn.sendError('rateLimited', res);
                  } else {
                    await fn.updateKeyDocDB(admin, keyInfo.hash, { queries: admin.firestore.FieldValue.increment(1) });
                    fn.logUsage(req);
                    next();
                  }
                } else {
                  await fn.setKeyDocDB(admin, keyInfo.hash, { lastTimestamp: admin.firestore.FieldValue.serverTimestamp(), queries: 1, usage: [] });
                  fn.logUsage(req);
                  next();
                }
              } else {
                fn.sendError('rateLimited', res);
              }

            }
          } else {
            fn.sendError('invalidAuth', res);
          }
        } else {
          fn.sendError('invalidAuth', res);
        }
      } else {
        fn.sendError('missingAuth', res);
      }
    } else {
      fn.logUsage(req);
      next();
    }
  } else {
    next();
  }
});

/* ========================================================================================================================================================================= */

// Chain List Endpoint:
api.get('/chains', (req: Request, res: Response) => {
  fn.sendResponse(req, res, weaver.getAllChainInfo());
});

// Project List Endpoint:
api.get('/projects', (req: Request, res: Response) => {
  fn.sendResponse(req, res, weaver.getAllProjects());
});

// Token List Endpoint:
api.get('/tokens', (req: Request, res: Response) => {
  fn.sendResponse(req, res, weaver.getAllTokens());
});

/* ========================================================================================================================================================================= */

// All Token Prices Endpoint:
api.get('/tokenPrices', async (req: Request, res: Response) => {
  try {
    if(!localTesting && dbPrices) {
      fn.sendResponse(req, res, await fn.fetchTokenPricesDB(admin));
    } else {
      fn.sendResponse(req, res, await weaver.getAllTokenPrices());
    }
  } catch(err) {
    fn.sendError('internalError', res, err);
  }
});

// Native Token Prices Endpoint:
api.get('/nativeTokenPrices', async (req: Request, res: Response) => {
  try {
    if(!localTesting && dbPrices) {
      fn.sendResponse(req, res, await fn.fetchNativeTokenPricesDB(admin));
    } else {
      fn.sendResponse(req, res, await weaver.getNativeTokenPrices());
    }
  } catch(err) {
    fn.sendError('internalError', res, err);
  }
});

/* ========================================================================================================================================================================= */

// Chain-Specific Endpoints:
weaver.getAllChains().forEach(chain => {

  // Chain Info Endpoint:
  api.get(`/${chain}/info`, (req: Request, res: Response) => {
    fn.sendResponse(req, res, weaver[chain].getInfo());
  });

  // Project List Endpoint:
  api.get(`/${chain}/projects`, (req: Request, res: Response) => {
    fn.sendResponse(req, res, weaver[chain].getProjects());
  });

  // Token List Endpoint:
  api.get(`/${chain}/tokens`, (req: Request, res: Response) => {
    fn.sendResponse(req, res, weaver[chain].getTokens());
  });

  // Gas Estimates Endpoint:
  api.get(`/${chain}/gas`, async (req: Request, res: Response) => {
    fn.sendResponse(req, res, await weaver[chain].getGasEstimates());
  });

  // Token Prices Endpoint:
  api.get(`/${chain}/tokenPrices`, async (req: Request, res: Response) => {
    try {
      if(!localTesting && dbPrices) {
        fn.sendResponse(req, res, await fn.fetchChainTokenPricesDB(admin, chain));
      } else {
        fn.sendResponse(req, res, await weaver[chain].getTokenPrices());
      }
    } catch(err) {
      fn.sendError('internalError', res, err);
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
          let tokenPrice = await fn.fetchTokenPriceDB(admin, chain, address);
          if(tokenPrice) { tokenInfo.price = tokenPrice; }
        }
        if(tokenInfo.price === 0) {
          if(weaver[chain].isAddress(address as Address)) {
            tokenInfo.price = await weaver[chain].getTokenPrice(address as Address, decimals);
          } else {
            fn.sendError('invalidAddress', res);
          }
        }
        fn.sendResponse(req, res, tokenInfo);
      } catch(err) {
        fn.sendError('internalError', res, err);
      }
    } else {
      fn.sendError('missingAddress', res);
    }
  });

  // Wallet Balance Endpoint:
  api.get(`/${chain}/wallet`, async (req: Request, res: Response) => {
    let address = req.query.address as string | undefined;
    if(address) {
      try {
        if(!localTesting && dbPrices) { await fn.fetchTokenPricesDB(admin); }
        if(weaver[chain].isAddress(address as Address)) {
          fn.sendResponse(req, res, await weaver[chain].getWalletBalance(address as Address));
        } else {
          fn.sendError('invalidAddress', res);
        }
      } catch(err) {
        fn.sendError('internalError', res, err);
      }
    } else {
      fn.sendError('missingAddress', res);
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
            if(!localTesting && dbPrices) { await fn.fetchTokenPricesDB(admin); }
            if(weaver[chain].isAddress(address as Address)) {
              fn.sendResponse(req, res, await weaver[chain].getProjectBalance(address as Address, project));
            } else {
              fn.sendError('invalidAddress', res);
            }
          } catch(err) {
            fn.sendError('internalError', res, err);
          }
        } else {
          fn.sendError('missingAddress', res);
        }
      } else {
        fn.sendError('invalidProject', res);
      }
    } else {
      fn.sendError('missingProject', res);
    }
  });

  // NFT Balance Endpoint:
  api.get(`/${chain}/nfts`, async (req: Request, res: Response) => {
    let address = req.query.address as string | undefined;
    if(address) {
      try {
        if(weaver[chain].isAddress(address as Address)) {
          fn.sendResponse(req, res, await weaver[chain].getNFTBalance(address as Address));
        } else {
          fn.sendError('invalidAddress', res);
        }
      } catch(err) {
        fn.sendError('internalError', res, err);
      }
    } else {
      fn.sendError('missingAddress', res);
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
            fn.sendResponse(req, res, await fn.getSimpleTXs(chain, address as Address));
          } else {
            if(page !== undefined) {
              fn.sendResponse(req, res, await fn.getTXs(chain, address as Address, parseInt(page)));
            } else {
              fn.sendResponse(req, res, await fn.getTXs(chain, address as Address));
            }
          }
        } else {
          fn.sendError('invalidAddress', res);
        }
      } catch(err) {
        fn.sendError('internalError', res, err);
      }
    } else {
      fn.sendError('missingAddress', res);
    }
  });

  // Transaction Fees Endpoint:
  api.get(`/${chain}/fees`, async (req: Request, res: Response) => {
    let address = req.query.address as string | undefined;
    if(address) {
      try {
        if(!localTesting && dbPrices) { await fn.fetchTokenPricesDB(admin); }
        if(weaver[chain].isAddress(address as Address)) {
          fn.sendResponse(req, res, await fn.getFees(chain, address as Address));
        } else {
          fn.sendError('invalidAddress', res);
        }
      } catch(err) {
        fn.sendError('internalError', res, err);
      }
    } else {
      fn.sendError('missingAddress', res);
    }
  });

  // Token Price History Endpoint:
  if(!localTesting && dbPrices) {
    api.get(`/${chain}/tokenPriceHistory`, async (req: Request, res: Response) => {
      let address = req.query.address as string | undefined;
      if(address) {
        try {
          let priceHistory = await fn.fetchTokenPriceHistoryDB(admin, chain, address);
          fn.sendResponse(req, res, { chain, address, priceHistory });
        } catch(err) {
          fn.sendError('internalError', res, err);
        }
      } else {
        fn.sendError('missingAddress', res);
      }
    });
  }
});

/* ========================================================================================================================================================================= */

// 404 Response:
api.all('*', async (req: Request, res: Response) => {
  fn.sendError('routeError', res);
});

/* ========================================================================================================================================================================= */

// Local Development:
if(localTesting) {
  api.listen(localTestingPort, () => { console.info(`API Up on http://127.0.0.1:${localTestingPort}`); });

// Production Deployment:
} else {
  exports.api = functions.runWith({ memory: '1GB', timeoutSeconds: 180, minInstances: minInstances, maxInstances: maxInstances }).https.onRequest(api);
}