
// Required Packages:
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const express = require('express');
const cors = require('cors');
// const swagger = require('swagger-ui-express');

// Imports:
import weaver from 'weaverfi'; // <TODO> Find a way to also import types.
import type { Request, Response, Application } from 'express';
import type { URL, Address, TerraAddress } from 'weaverfi/dist/types';

// Fetching Required JSON Files:
// const swaggerDocs: JSON = require('../static/swagger.json'); // <TODO>

// Fetching Firebase Logger Compatibility Patch:
require("firebase-functions/lib/logger/compat");

// Initializing Firebase App:
admin.initializeApp();

// Initializing Express Server:
const api: Application = express();
api.use(cors());

// Initializations:
const repository: URL = 'https://github.com/CookieTrack-io/weaverfi-api';
// const discord: string = 'https://discord.com/invite/DzADcq7y75';
const rootResponse: string = `<title>WeaverFi API</title><p>Click <a href="${repository}">here</a> to see the API's repository, or <a href="/docs">here</a> to see its OpenAPI documentation.</p>`;
const routeErrorResponse: string = `Invalid route.`;
const internalErrorResponse: string = `Internal API error.`;
const missingAddressErrorResponse: string = `No address provided.`;
const invalidAddressErrorResponse: string = `Invalid address provided.`;
const missingProjectErrorResponse: string = `No project name provided.`;
const invalidProjectErrorResponse: string = `Invalid project name provided.`;
// const filter: RegExp = /[^a-zA-Z0-9]/;

// Settings:
const localTesting: boolean = false;
const localTestingPort: number = 3000;

/* ========================================================================================================================================================================= */

// Default Endpoint:
api.get('/', (req: Request, res: Response) => {
  res.send(rootResponse);
});

// Swagger Documentation Endpoint:
// api.use('/docs', swagger.serve, swagger.setup(swaggerDocs));

/* ========================================================================================================================================================================= */

// Chain List Endpoint:
api.get('/chains', (req: Request, res: Response) => {
  res.end(JSON.stringify(weaver.getAllChains().map(chain => chain.toLowerCase()), null, ' '));
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
    res.end(JSON.stringify(await weaver.getAllTokenPrices(), null, ' '));
  } catch(err) {
    console.error(err);
    res.send(internalErrorResponse);
  }
});

// Native Token Prices Endpoint:
api.get('/nativeTokenPrices', async (req: Request, res: Response) => {
  try {
    res.end(JSON.stringify(await weaver.getNativeTokenPrices(), null, ' '));
  } catch(err) {
    console.error(err);
    res.send(internalErrorResponse);
  }
});

/* ========================================================================================================================================================================= */

// Chain-Specific Endpoints:
weaver.getAllChains().forEach(chain => {

  // Project List Endpoint:
  api.get(`/${chain.toLowerCase()}/projects`, (req: Request, res: Response) => {
    res.end(JSON.stringify(weaver[chain].getProjects(), null, ' '));
  });

  // Token List Endpoint:
  api.get(`/${chain.toLowerCase()}/tokens`, (req: Request, res: Response) => {
    res.end(JSON.stringify(weaver[chain].getTokens(), null, ' '));
  });

  // Token Prices Endpoint:
  api.get(`/${chain.toLowerCase()}/tokenPrices`, async (req: Request, res: Response) => {
    try {
      res.end(JSON.stringify(await weaver[chain].getTokenPrices(), null, ' '));
    } catch(err) {
      console.error(err);
      res.send(internalErrorResponse);
    }
  });

  // Token Price Endpoint:
  api.get(`/${chain.toLowerCase()}/tokenPrice`, async (req: Request, res: Response) => {
    let address = req.query.address as string | undefined;
    let decimals = req.query.decimals ? parseInt(req.query.decimals as string) : undefined;
    if(address) {
      try {
        if(chain === 'TERRA' && weaver[chain].isAddress(address as TerraAddress)) {
          res.end(JSON.stringify(await weaver[chain].getTokenPrice(address as TerraAddress, decimals), null, ' '));
        } else if(address.startsWith('0x')) {
          res.end(JSON.stringify(await weaver[chain].getTokenPrice(address as Address, decimals), null, ' '));
        } else {
          res.send(invalidAddressErrorResponse);
        }
      } catch(err) {
        console.error(err);
        res.send(internalErrorResponse);
      }
    } else {
      res.send(missingAddressErrorResponse);
    }
  });

  // Wallet Balance Endpoint:
  api.get(`/${chain.toLowerCase()}/wallet`, async (req: Request, res: Response) => {
    let address = req.query.address as string | undefined;
    if(address) {
      try {
        if(chain === 'TERRA' && weaver.TERRA.isAddress(address as TerraAddress)) {
          res.end(JSON.stringify(await weaver[chain].getWalletBalance(address as TerraAddress), null, ' '));
        } else if(chain != 'TERRA' && weaver[chain].isAddress(address as Address)) {
          res.end(JSON.stringify(await weaver[chain].getWalletBalance(address as Address), null, ' '));
        } else {
          res.send(invalidAddressErrorResponse);
        }
      } catch(err) {
        console.error(err);
        res.send(internalErrorResponse);
      }
    } else {
      res.send(missingAddressErrorResponse);
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
            if(chain === 'TERRA' && weaver.TERRA.isAddress(address as TerraAddress)) {
              res.end(JSON.stringify(await weaver[chain].getProjectBalance(address as TerraAddress, project), null, ' '));
            } else if(chain != 'TERRA' && weaver[chain].isAddress(address as Address)) {
              res.end(JSON.stringify(await weaver[chain].getProjectBalance(address as Address, project), null, ' '));
            } else {
              res.send(invalidAddressErrorResponse);
            }
          } catch(err) {
            console.error(err);
            res.send(internalErrorResponse);
          }
        } else {
          res.send(missingAddressErrorResponse);
        }
      } else {
        res.send(invalidProjectErrorResponse);
      }
    } else {
      res.send(missingProjectErrorResponse);
    }
  });

  // Transaction History Endpoint:
  // <TODO>

  // Transaction Fees Endpoint:
  // <TODO>
});

/* ========================================================================================================================================================================= */

// 404 Response:
api.all('*', async (req: Request, res: Response) => {
  res.send(routeErrorResponse);
});

/* ========================================================================================================================================================================= */

// Local Testing:
if(localTesting) {
  api.listen(localTestingPort, () => { console.info(`API Up on http://127.0.0.1:${localTestingPort}`); });

// Exporting Firebase API Function:
} else {
  exports.api = functions.runWith({ memory: '1GB', timeoutSeconds: 120 }).https.onRequest(api);
}