/**
 * Production good/NG counters — state lives in ProductionCountsProvider
 * (app-scoped + localStorage) so login/logout and menu navigation do not reset
 * session totals. Only the manual Reset control clears SESSION.
 */
export { useProductionCountsContext as useProductionCounts } from '@/contexts/ProductionCountsContext'
