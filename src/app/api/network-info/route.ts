import { NextResponse } from 'next/server';
import { networkInterfaces } from 'os';

// GET /api/network-info — returns the server's local network IP
export async function GET() {
  const nets = networkInterfaces();
  let localIp = 'localhost';

  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      // Skip internal/loopback and non-IPv4
      if (!net.internal && net.family === 'IPv4') {
        localIp = net.address;
        break;
      }
    }
    if (localIp !== 'localhost') break;
  }

  return NextResponse.json({ ip: localIp });
}
