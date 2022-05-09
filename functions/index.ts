
// Required Packages:
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const express = require('express');
const cors = require('cors');
const swagger = require('swagger-ui-express');

// Imports:
import weaver from 'weaverfi';
import { sendError, getTXs, getFees, updateTokenPricesDB, fetchTokenPricesDB, fetchNativeTokenPricesDB, fetchChainTokenPricesDB, fetchTokenPriceDB } from './functions';
import type { Application, Request, Response, NextFunction } from 'express';
import type { URL, Address, TerraAddress, EVMChain } from 'weaverfi/dist/types';

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

// Local Test Settings:
const localTesting: boolean = false;
const localTestingPort: number = 3000;

// Price Fetcher Settings:
const priceFetcher: boolean = true;
const priceFetcherFrequencyInMinutes: number = 20;

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
  res.end(JSON.stringify(weaver.getAllChainInfo(), null, ' '));
});

// Project List Endpoint:
api.get('/projects', (req: Request, res: Response) => {
  res.end(JSON.stringify(weaver.getAllProjects(), null, ' '));
});

// Token List Endpoint:
api.get('/tokens', (req: Request, res: Response) => {
  res.end(JSON.stringify(weaver.getAllTokens(), null, ' '));
});

/* ========================================================================================================================================================================= */

// All Token Prices Endpoint:
api.get('/tokenPrices', async (req: Request, res: Response) => {
  try {
    if(!localTesting && priceFetcher) {
      res.status(200).end(JSON.stringify(await fetchTokenPricesDB(admin), null, ' '));
    } else {
      res.status(200).end(JSON.stringify(await weaver.getAllTokenPrices(), null, ' '));
    }
  } catch(err) {
    console.error(err);
    sendError('internalError', res);
  }
});

// Native Token Prices Endpoint:
api.get('/nativeTokenPrices', async (req: Request, res: Response) => {
  try {
    if(!localTesting && priceFetcher) {
      res.status(200).end(JSON.stringify(await fetchNativeTokenPricesDB(admin), null, ' '));
    } else {
      res.status(200).end(JSON.stringify(await weaver.getNativeTokenPrices(), null, ' '));
    }
  } catch(err) {
    console.error(err);
    sendError('internalError', res);
  }
});

/* ========================================================================================================================================================================= */

// Chain-Specific Endpoints:
weaver.getAllChains().forEach(chain => {

  // Chain Info Endpoint:
  api.get(`/${chain.toLowerCase()}/info`, (req: Request, res: Response) => {
    res.status(200).end(JSON.stringify(weaver[chain].getInfo(), null, ' '));
  });

  // Project List Endpoint:
  api.get(`/${chain.toLowerCase()}/projects`, (req: Request, res: Response) => {
    res.status(200).end(JSON.stringify(weaver[chain].getProjects(), null, ' '));
  });

  // Token List Endpoint:
  api.get(`/${chain.toLowerCase()}/tokens`, (req: Request, res: Response) => {
    res.status(200).end(JSON.stringify(weaver[chain].getTokens(), null, ' '));
  });

  // Token Prices Endpoint:
  api.get(`/${chain.toLowerCase()}/tokenPrices`, async (req: Request, res: Response) => {
    try {
      if(!localTesting && priceFetcher) {
        res.status(200).end(JSON.stringify(await fetchChainTokenPricesDB(admin, chain), null, ' '));
      } else {
        res.status(200).end(JSON.stringify(await weaver[chain].getTokenPrices(), null, ' '));
      }
    } catch(err) {
      console.error(err);
      sendError('internalError', res);
    }
  });

  // Token Price Endpoint:
  api.get(`/${chain.toLowerCase()}/tokenPrice`, async (req: Request, res: Response) => {
    let address = req.query.address as string | undefined;
    let decimals = req.query.decimals ? parseInt(req.query.decimals as string) : undefined;
    if(address) {
      try {
        let priceFound = false;
        if(!localTesting && priceFetcher) {
          let tokenPrice = await fetchTokenPriceDB(admin, chain, address);
          if(tokenPrice) {
            priceFound = true;
            res.status(200).end(JSON.stringify(tokenPrice, null, ' '));
          }
        }
        if(!priceFound) {
          if(chain === 'TERRA' && weaver[chain].isAddress(address as TerraAddress)) {
            res.status(200).end(JSON.stringify(await weaver[chain].getTokenPrice(address as TerraAddress, decimals), null, ' '));
          } else if(address.startsWith('0x')) {
            res.status(200).end(JSON.stringify(await weaver[chain].getTokenPrice(address as Address, decimals), null, ' '));
          } else {
            sendError('invalidAddress', res);
          }
        }
      } catch(err) {
        console.error(err);
        sendError('internalError', res);
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
        if(!localTesting && priceFetcher) { await fetchTokenPricesDB(admin); }
        if(chain === 'TERRA' && weaver.TERRA.isAddress(address as TerraAddress)) {
          res.status(200).end(JSON.stringify(await weaver[chain].getWalletBalance(address as TerraAddress), null, ' '));
        } else if(chain != 'TERRA' && weaver[chain].isAddress(address as Address)) {
          res.status(200).end(JSON.stringify(await weaver[chain].getWalletBalance(address as Address), null, ' '));
        } else {
          sendError('invalidAddress', res);
        }
      } catch(err) {
        console.error(err);
        sendError('internalError', res);
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
            if(!localTesting && priceFetcher) { await fetchTokenPricesDB(admin); }
            if(chain === 'TERRA' && weaver.TERRA.isAddress(address as TerraAddress)) {
              res.status(200).end(JSON.stringify(await weaver[chain].getProjectBalance(address as TerraAddress, project), null, ' '));
            } else if(chain != 'TERRA' && weaver[chain].isAddress(address as Address)) {
              res.status(200).end(JSON.stringify(await weaver[chain].getProjectBalance(address as Address, project), null, ' '));
            } else {
              sendError('invalidAddress', res);
            }
          } catch(err) {
            console.error(err);
            sendError('internalError', res);
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

  // Transaction History Endpoint:
  api.get(`/${chain.toLowerCase()}/txs`, async (req: Request, res: Response) => {
    let address = req.query.address as string | undefined;
    if(address) {
      try {
        if(chain === 'TERRA' && weaver.TERRA.isAddress(address as TerraAddress)) {
          sendError('routeError', res); // Terra TX History Not Supported Yet
        } else if(chain != 'TERRA' && weaver[chain].isAddress(address as Address)) {
          res.status(200).end(JSON.stringify(await getTXs(chain.toLowerCase() as EVMChain, address as Address), null, ' '));
        } else {
          sendError('invalidAddress', res);
        }
      } catch(err) {
        console.error(err);
        sendError('internalError', res);
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
        if(!localTesting && priceFetcher) { await fetchTokenPricesDB(admin); }
        if(chain === 'TERRA' && weaver.TERRA.isAddress(address as TerraAddress)) {
          sendError('routeError', res); // Terra TX History Not Supported Yet
        } else if(chain != 'TERRA' && weaver[chain].isAddress(address as Address)) {
          res.status(200).end(JSON.stringify(await getFees(chain.toLowerCase() as EVMChain, address as Address), null, ' '));
        } else {
          sendError('invalidAddress', res);
        }
      } catch(err) {
        console.error(err);
        sendError('internalError', res);
      }
    } else {
      sendError('missingAddress', res);
    }
  });
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
  
  // Exporting Firebase API Function:
  exports.api = functions.runWith({ memory: '1GB', timeoutSeconds: 120 }).https.onRequest(api);
  
  // Exporting Firebase Price Fetcher Scheduled Function:
  if(priceFetcher) {
    exports.priceFetcher = functions.runWith({ timeoutSeconds: 60 }).pubsub.schedule(`every ${priceFetcherFrequencyInMinutes} minutes`).onRun(async () => {
      let prices = await weaver.getAllTokenPrices();
      let timestamp = await updateTokenPricesDB(admin.firestore(), prices);
      console.info(`Fetched token prices at timestamp: ${timestamp}`);
      return null;
    });
  }
}