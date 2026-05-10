/**
 * Generic history record.
 * Projects extend this with domain-specific fields via the index signature.
 */
export interface HistoryRecord {
  id: number | string
  timestamp: string
  operator_name?: string
  operator_id?: string
  result?: boolean | null
  duration?: number
  [key: string]: any
}

export interface HistoryFilters {
  limit?: number
  offset?: number
  start_date?: string
  end_date?: string
  search?: string
  [key: string]: any
}

/**
 * Generic error log record.
 */
export interface ErrorRecord {
  id: number | string
  timestamp: string
  error_code?: string
  error_message: string
  severity?: 'low' | 'medium' | 'high' | 'critical' | null
  phase?: string
  details?: string
  [key: string]: any
}

export interface ErrorFilters {
  limit?: number
  offset?: number
  severity?: string
  phase?: string
  start_date?: string
  end_date?: string
}
