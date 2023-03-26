
// Importing WeaverFi SDK Types:
import type { Address } from 'weaverfi';

/* ========================================================================================================================================================================= */

// Error Types:
export type ErrorResponseType = 'routeError' | 'missingAddress' | 'missingProject' | 'invalidAddress' | 'invalidProject' | 'missingAuth' | 'invalidAuth' | 'teapot' | 'rateLimited' | 'rateLimitedRampingUp' | 'internalError';

/* ========================================================================================================================================================================= */

// Database Interfaces:
export interface AggregatedTokenPriceData {
  symbol: string | null
  address: Address
  prices: {
    price: number
    timestamp: number
  }[]
}

/* ========================================================================================================================================================================= */

// Database Key Doc Interface:
export interface KeyDoc {
  lastTimestamp: any
  queries: number
  usage: {
    queries: number
    timestamp: any
  }[]
}

// Database IP Doc Interface:
export interface IpDoc {
  lastTimestamp: any
  queries: number
}