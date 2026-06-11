#!/usr/bin/env node
/**
 * Standalone HTTP wrapper for pick-place TCP master (master_pick_place protocol).
 *
 *   node scripts/pick_place_api.js
 *
 * Env: PICK_PLACE_HOST, PICK_PLACE_PORT, PICK_PLACE_API_PORT, PICK_PLACE_CONFIG_PATH
 */
import { startPickPlaceApi } from './pick_place_client.js'

startPickPlaceApi(Number(process.env.PICK_PLACE_API_PORT || 3333))
