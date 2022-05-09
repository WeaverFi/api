
// Importing WeaverFi SDK Types:
import type { Address, Hash } from 'weaverfi/dist/types';

/* ========================================================================================================================================================================= */

// Error Types:
export type ErrorResponseType = 'routeError' | 'missingAddress' | 'missingProject' | 'invalidAddress' | 'invalidProject' | 'missingAuth' | 'invalidAuth' | 'rateLimited' | 'internalError';

/* ========================================================================================================================================================================= */

// Covalent Interfaces:
export interface CovalentAPIResponse {
  data: CovalentTXsAPIResponse
  error: boolean
}
export interface CovalentTXsAPIResponse {
  address: Address
  updated_at: string
  next_update_at: string
  quote_currency: string
  chain_id: number
  items: CovalentTX[]
  pagination: {
    has_more: boolean
    page_number: number
    page_size: number
  }
}
export interface CovalentTX {
  block_signed_at: string
  block_height: number
  tx_hash: Hash
  tx_offset: number
  successful: boolean
  from_address: Address
  to_address: Address
  value: string
  value_quote: number
  gas_offered: number
  gas_spent: number
  gas_price: number
  fees_paid: string
  gas_quote: number
  gas_quote_rate: number
  log_events: CovalentLogEvent[]
}
export interface CovalentLogEvent {
  block_signed_at: string
  block_height: number
  tx_offset: number
  log_offset: number
  tx_hash: Hash
  raw_log_topics: Hash[]
  sender_contract_decimals: number
  sender_contract_ticker_symbol: string | null
  sender_address: Address
  raw_log_data: Hash
  decoded: CovalentDecodedData | null
}
export interface CovalentDecodedData {
  name: string
  signature: string
  params: CovalentDecodedParam[]
}
export interface CovalentDecodedParam {
  name: string
  type: string
  indexed: boolean
  decoded: boolean
  value: string
}