
// Imports:
import type { Response } from 'express';
import type { ErrorResponseType } from './types';

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

// Function to send API error responses:
export const sendError = (responseType: ErrorResponseType, res: Response) => {
  res.status(errorResponses[responseType].status).end(errorResponses[responseType].message);
}