/**
 * Mock TCP Nano slave (127.0.0.1) for offline master/HTTP tests.
 */
import net from 'net'
import { NanoSimulator } from './firmware_simulator.mjs'

/**
 * @param {number} [port] 0 = OS-assigned
 * @param {NanoSimulator} [sim]
 */
export function startMockNano(port = 0, sim = new NanoSimulator()) {
  return new Promise((resolve, reject) => {
    const server = net.createServer(sock => {
      let buf = ''
      sock.on('data', chunk => {
        buf += chunk.toString('ascii')
        let nl
        while ((nl = buf.indexOf('\n')) !== -1) {
          const line = buf.slice(0, nl).replace(/\r$/, '')
          buf = buf.slice(nl + 1)
          const reply = sim.handle(line)
          if (reply != null) sock.write(`${reply}\n`)
        }
      })
    })
    server.on('error', reject)
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address()
      resolve({
        server,
        sim,
        host: '127.0.0.1',
        port: addr.port,
        close() {
          return new Promise(r => server.close(() => r()))
        },
      })
    })
  })
}
