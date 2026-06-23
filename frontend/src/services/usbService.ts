/**
 * USB Service stub.
 *
 * In an Electron environment this monitors USB device events via IPC.
 * In a generic web project, replace initialize/checkStatus with REST calls
 * to your backend's USB-detection endpoint.
 */

export interface USBDevice {
  path: string
  label: string
  filesystem?: string
  writable: boolean
  available: boolean
}

export interface USBStatus {
  usb_connected: boolean
  devices: USBDevice[]
}

type StatusCallback = (status: USBStatus) => void

let _monitorInterval: ReturnType<typeof setInterval> | null = null
const _listeners = new Set<StatusCallback>()
let _initialized = false

export const usbService = {
  initialize() {
    if (_initialized) return
    _initialized = true
    // Optionally: trigger initial status check via REST or Electron IPC.
  },

  startMonitoring(intervalMs = 30_000) {
    if (_monitorInterval) return
    _monitorInterval = setInterval(() => {
      usbService.checkStatus().catch(console.error)
    }, intervalMs)
  },

  stopMonitoring() {
    if (_monitorInterval) {
      clearInterval(_monitorInterval)
      _monitorInterval = null
    }
  },

  onStatusChange(callback: StatusCallback): () => void {
    _listeners.add(callback)
    return () => { _listeners.delete(callback) }
  },

  async checkStatus(): Promise<USBStatus> {
    // TODO: replace with real call, e.g. from ipcClient.getUSBStatus()
    // import ipcClient from './ipcClient'
    // const status = await ipcClient.getUSBStatus()
    const status: USBStatus = { usb_connected: false, devices: [] }
    _listeners.forEach(fn => fn(status))
    return status
  },

  notifyStatus(status: USBStatus) {
    _listeners.forEach(fn => fn(status))
  },
}
