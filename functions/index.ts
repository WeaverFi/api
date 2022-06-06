
// Required Packages:
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const express = require('express');
const cors = require('cors');
const swagger = require('swagger-ui-express');

// Imports:
import weaver from 'weaverfi';
import { sendResponse, sendError, getTXs, getFees, fetchTokenPricesDB, fetchNativeTokenPricesDB, fetchChainTokenPricesDB, fetchTokenPriceDB, fetchTokenPriceHistoryDB } from './functions';

// Type Imports:
import type { Application, Request, Response, NextFunction } from 'express';
import type { URL, Address, Chain } from 'weaverfi/dist/types';

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
const repository: URL = 'https://github.com/CookieTrack-io/weaverfi-api';
const rootResponse = `<title>WeaverFi API</title><p>Click <a href="${repository}">here</a> to see the API's repository, or <a href="/docs">here</a> to see its OpenAPI documentation.</p>`;

// Settings:
const localTesting: boolean = false; // Set this to `true` to test the API locally instead of deploying it.
const localTestingPort: number = 3000; // This is the port used to locally host the API during testing.
const dbPrices: boolean = true; // Set this to `true` to fetch token prices from Firebase (production-only).

/* ========================================================================================================================================================================= */

// Default Endpoint:
api.get('/', (req: Request, res: Response) => {
  res.status(200).end(rootResponse);
});

// Swagger Documentation Endpoint:
api.use('/docs', swagger.serve, swagger.setup(swaggerDocs));

// Logging Middleware:
api.use((req: Request, res: Response, next: NextFunction) => {
  if(req.originalUrl != '/service-worker.js') {
    console.info(`Loading: ${req.originalUrl}`);
  }
  next();
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
  api.get(`/${chain.toLowerCase()}/info`, (req: Request, res: Response) => {
    sendResponse(req, res, weaver[chain].getInfo());
  });

  // Project List Endpoint:
  api.get(`/${chain.toLowerCase()}/projects`, (req: Request, res: Response) => {
    sendResponse(req, res, weaver[chain].getProjects());
  });

  // Token List Endpoint:
  api.get(`/${chain.toLowerCase()}/tokens`, (req: Request, res: Response) => {
    sendResponse(req, res, weaver[chain].getTokens());
  });

  // Token Prices Endpoint:
  api.get(`/${chain.toLowerCase()}/tokenPrices`, async (req: Request, res: Response) => {
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
  api.get(`/${chain.toLowerCase()}/tokenPrice`, async (req: Request, res: Response) => {
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
  api.get(`/${chain.toLowerCase()}/wallet`, async (req: Request, res: Response) => {
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
  api.get(`/${chain.toLowerCase()}/project`, async (req: Request, res: Response) => {
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
  api.get(`/${chain.toLowerCase()}/nfts`, async (req: Request, res: Response) => {
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
  api.get(`/${chain.toLowerCase()}/txs`, async (req: Request, res: Response) => {
    let address = req.query.address as string | undefined;
    let page = req.query.page as string | undefined;
    if(address) {
      try {
        if(weaver[chain].isAddress(address as Address)) {
          if(page !== undefined) {
            sendResponse(req, res, await getTXs(chain.toLowerCase() as Chain, address as Address, parseInt(page)));
          } else {
            sendResponse(req, res, await getTXs(chain.toLowerCase() as Chain, address as Address));
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
  api.get(`/${chain.toLowerCase()}/fees`, async (req: Request, res: Response) => {
    let address = req.query.address as string | undefined;
    if(address) {
      try {
        if(!localTesting && dbPrices) { await fetchTokenPricesDB(admin); }
        if(weaver[chain].isAddress(address as Address)) {
          sendResponse(req, res, await getFees(chain.toLowerCase() as Chain, address as Address));
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
    api.get(`/${chain.toLowerCase()}/tokenPriceHistory`, async (req: Request, res: Response) => {
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

// Teapot:
api.get(`/teapot`, async (req: Request, res: Response) => {
  sendError('teapot', res);
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
  exports.api = functions.runWith({ memory: '1GB', timeoutSeconds: 180, minInstances: 1 }).https.onRequest(api);
}