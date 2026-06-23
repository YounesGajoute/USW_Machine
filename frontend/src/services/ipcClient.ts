/**
 * IPC Client stub.
 *
 * In an Electron environment this would delegate to window.electronAPI (preload bridge).
 * In a web / generic project these stubs can be replaced with real REST calls.
 *
 * Add your implementation for each method as needed by your backend.
 */

declare global {
  interface Window {
    electronAPI?: Record<string, (...args: any[]) => Promise<any>>
  }
}

function notImplemented(method: string): never {
  throw new Error(`ipcClient.${method}: not implemented – replace this stub with a real API call.`)
}

const ipcClient = {
  // ── System operations ────────────────────────────────────────────────────
  systemReset: async (options: any) => {
    if (window.electronAPI?.systemReset) return window.electronAPI.systemReset(options)
    notImplemented('systemReset')
  },

  createArchive: async () => {
    if (window.electronAPI?.createArchive) return window.electronAPI.createArchive()
    notImplemented('createArchive')
  },

  createAndExportArchiveToUSB: async (usbPath: string) => {
    if (window.electronAPI?.createAndExportArchiveToUSB) return window.electronAPI.createAndExportArchiveToUSB(usbPath)
    notImplemented('createAndExportArchiveToUSB')
  },

  systemUpdateFromUSB: async (usbPath: string, filePath: string, postAction: string) => {
    if (window.electronAPI?.systemUpdateFromUSB) return window.electronAPI.systemUpdateFromUSB(usbPath, filePath, postAction)
    notImplemented('systemUpdateFromUSB')
  },

  // ── Database ─────────────────────────────────────────────────────────────
  listDatabaseBackups: async (): Promise<{ success: boolean; backups: Array<{ name: string; path: string; size: number; modified: string }> }> => {
    if (window.electronAPI?.listDatabaseBackups) return window.electronAPI.listDatabaseBackups()
    return { success: true, backups: [] }
  },

  restoreDatabase: async (backupPath: string) => {
    if (window.electronAPI?.restoreDatabase) return window.electronAPI.restoreDatabase(backupPath)
    notImplemented('restoreDatabase')
  },

  // ── USB file system ───────────────────────────────────────────────────────
  getUSBStatus: async (): Promise<{ usb_connected: boolean; devices: any[] }> => {
    if (window.electronAPI?.getUSBStatus) return window.electronAPI.getUSBStatus()
    return { usb_connected: false, devices: [] }
  },

  listUSBFiles: async (directory: string, extension?: string) => {
    if (window.electronAPI?.listUSBFiles) return window.electronAPI.listUSBFiles(directory, extension)
    return { files: [] }
  },

  listLocalFiles: async (directory: string, extension?: string) => {
    if (window.electronAPI?.listLocalFiles) return window.electronAPI.listLocalFiles(directory, extension)
    return { files: [] }
  },

  readUSBFile: async (usbPath: string, filePath: string) => {
    if (window.electronAPI?.readUSBFile) return window.electronAPI.readUSBFile(usbPath, filePath)
    return { success: false, content: '', message: 'Not implemented' }
  },

  // ── Service control ───────────────────────────────────────────────────────
  listServices: async () => {
    if (window.electronAPI?.listServices) return window.electronAPI.listServices()
    return { success: true, services: [], rules: [] }
  },

  getServiceStatus: async (serviceName: string) => {
    if (window.electronAPI?.getServiceStatus) return window.electronAPI.getServiceStatus(serviceName)
    return { success: true, details: '' }
  },

  controlService: async (serviceName: string, action: string) => {
    if (window.electronAPI?.controlService) return window.electronAPI.controlService(serviceName, action)
    notImplemented('controlService')
  },

  installService: async (filePath: string) => {
    if (window.electronAPI?.installService) return window.electronAPI.installService(filePath)
    notImplemented('installService')
  },

  reloadSystemd: async () => {
    if (window.electronAPI?.reloadSystemd) return window.electronAPI.reloadSystemd()
    notImplemented('reloadSystemd')
  },

  installUdevRules: async (filePath: string) => {
    if (window.electronAPI?.installUdevRules) return window.electronAPI.installUdevRules(filePath)
    notImplemented('installUdevRules')
  },

  buildAndStart: async () => {
    if (window.electronAPI?.buildAndStart) return window.electronAPI.buildAndStart()
    notImplemented('buildAndStart')
  },

  // ── Shell scripts ─────────────────────────────────────────────────────────
  executeShellScript: async (scriptPath: string, args?: string[]) => {
    if (window.electronAPI?.executeShellScript) return window.electronAPI.executeShellScript(scriptPath, args)
    notImplemented('executeShellScript')
  },

  // ── Config files ──────────────────────────────────────────────────────────
  readConfigFile: async (fileName: string) => {
    if (window.electronAPI?.readConfigFile) return window.electronAPI.readConfigFile(fileName)
    return { success: false, content: '', message: 'Not implemented' }
  },

  writeConfigFile: async (filePath: string, content: string) => {
    if (window.electronAPI?.writeConfigFile) return window.electronAPI.writeConfigFile(filePath, content)
    notImplemented('writeConfigFile')
  },

  /** RTC / host time (Electron); browser returns current JS time. */
  getSystemTime: async (): Promise<{ status?: string; current_time?: string }> => {
    if (window.electronAPI?.getSystemTime) return window.electronAPI.getSystemTime()
    return { status: 'success', current_time: new Date().toISOString() }
  },

  setSystemTime: async (datetime: string): Promise<{ status?: string; message?: string }> => {
    if (window.electronAPI?.setSystemTime) return window.electronAPI.setSystemTime(datetime)
    return { status: 'success', message: 'Browser: host clock was not changed.' }
  },
}

export type IpcClient = typeof ipcClient
export default ipcClient
