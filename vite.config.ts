import type { ServerResponse } from 'node:http'
import mqtt, { type MqttClient } from 'mqtt'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import tsconfigPaths from 'vite-tsconfig-paths'

function mqttBridgePlugin(): Plugin {
  let client: MqttClient | null = null
  let lastErrorLogMs = 0
  const subscribers = new Set<ServerResponse>()

  const sendEvent = (response: ServerResponse, payload: unknown) => {
    response.write(`data: ${JSON.stringify(payload)}\n\n`)
  }

  const broadcast = (payload: unknown) => {
    for (const response of subscribers) {
      sendEvent(response, payload)
    }
  }

  return {
    name: 'vestmicro-mqtt-bridge',
    configureServer(server) {
      const env = loadEnv(server.config.mode, process.cwd(), '')
      const brokerUrl = env.VITE_MQTT_TCP_BROKER || 'mqtt://broker.hivemq.com:1883'
      const topicFilter = env.VITE_MQTT_TOPIC_FILTER || `${env.VITE_MQTT_TOPIC_PREFIX || 'vestmicro/v1/devices'}/+/events`

      client = mqtt.connect(brokerUrl, {
        clientId: `vite_bridge_${Math.random().toString(16).slice(2, 10)}`,
        clean: true,
        connectTimeout: 4000,
        keepalive: 30,
        protocolVersion: 4,
        reconnectPeriod: 1000,
      })

      client.on('connect', () => {
        console.log(`[mqtt-bridge] connected: ${brokerUrl}`)
        broadcast({ type: 'status', connected: true, brokerUrl })
        client?.subscribe(topicFilter, { qos: 0 }, (err) => {
          if (err) {
            console.warn(`[mqtt-bridge] subscribe failed for ${topicFilter}:`, err)
          } else {
            console.log(`[mqtt-bridge] subscribed: ${topicFilter}`)
          }
        })
      })

      client.on('message', (topic, payload) => {
        broadcast({ type: 'message', topic, payload: payload.toString() })
      })

      client.on('close', () => {
        broadcast({ type: 'status', connected: false, brokerUrl })
      })

      client.on('offline', () => {
        broadcast({ type: 'status', connected: false, brokerUrl })
      })

      client.on('error', (err) => {
        const now = Date.now()
        if (now - lastErrorLogMs > 15000) {
          lastErrorLogMs = now
          console.warn('[mqtt-bridge] error:', err)
        }
        broadcast({ type: 'status', connected: false, brokerUrl })
      })

      server.middlewares.use('/api/mqtt-events', (request, response) => {
        response.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        })
        response.write('\n')
        subscribers.add(response)
        sendEvent(response, { type: 'status', connected: Boolean(client?.connected), brokerUrl })

        request.on('close', () => {
          subscribers.delete(response)
        })
      })

      server.httpServer?.once('close', () => {
        client?.end(true)
        client = null
        subscribers.clear()
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), tsconfigPaths(), mqttBridgePlugin()],
  base: '/GPSCrashDetectorDashboard/', // ← must match your GitHub repo name
})
