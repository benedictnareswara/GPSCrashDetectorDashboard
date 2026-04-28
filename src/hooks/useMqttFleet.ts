import { useEffect, useState } from 'react';
import mqtt, { MqttClient } from 'mqtt';

// Define the shape of incoming data
interface DevicePacket {
  deviceId: string;
  event: string;
  timestamp: number;
  [key: string]: any; // For other dynamic metadata
}

interface FleetState {
  [deviceId: string]: {
    status: 'crash' | 'online';
    lastSeen: number;
    data: DevicePacket;
  };
}

const BROKER_URL = 'wss://broker.hivemq.com:8884/mqtt';
const TOPIC_FILTER = 'vestmicro/v1/devices/+/events';

export const useMqttFleet = () => {
  const [fleet, setFleet] = useState<FleetState>({});
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    // Initialize the MQTT client
    const client: MqttClient = mqtt.connect(BROKER_URL, {
      clientId: `web_client_${Math.random().toString(16).slice(2, 10)}`,
      clean: true,
      connectTimeout: 4000,
      reconnectPeriod: 1000,
    });

    client.on('connect', () => {
      console.log('Connected to HiveMQ');
      setIsConnected(true);
      client.subscribe(TOPIC_FILTER);
    });

    client.on('message', (topic, payload) => {
      try {
        const message: DevicePacket = JSON.parse(payload.toString());
        
        // Logical Mapping: 
        // CRASH_CONFIRMED -> crash | anything else -> online
        const deviceStatus = message.event === 'CRASH_CONFIRMED' ? 'crash' : 'online';

        setFleet((prev) => ({
          ...prev,
          [message.deviceId]: {
            status: deviceStatus,
            lastSeen: Date.now(),
            data: message,
          },
        }));
      } catch (err) {
        console.error('Failed to parse MQTT message:', err);
      }
    });

    client.on('error', (err) => {
      console.error('MQTT Connection Error:', err);
    });

    // Cleanup: Disconnect on unmount
    return () => {
      if (client.connected) {
        client.end();
        console.log('MQTT Disconnected');
      }
    };
  }, []);

  return { fleet, isConnected };
};
