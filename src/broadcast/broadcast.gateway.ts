import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: 'notifications',
})
export class BroadcastGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  handleConnection(client: Socket) {
    const role = client.handshake.query.role as string;
    const userId = client.handshake.query.userId as string;

    // 1. JOIN PRIVATE USER ROOM (Crucial for sendTargeted)
    if (userId && userId !== 'undefined') {
      const privateRoom = `user-${userId}`;
      client.join(privateRoom);
      console.log(
        `[Remzik] Client ${client.id} joined private room: ${privateRoom}`,
      );
    }

    // 2. JOIN ROLE ROOM (Standard Broadcasts)
    if (role && role !== 'undefined') {
      // Standardize: 'INVESTORS' -> 'investor'
      const room = role.toLowerCase().trim().replace(/s$/, '');
      client.join(room);
      console.log(
        `[Remzik] Client ${client.id} (Role: ${role}) joined room: ${room}`,
      );
    } else {
      console.log(
        `[Remzik] Client ${client.id} connected without a valid role.`,
      );
    }
  }

  handleDisconnect(client: Socket) {
    console.log(`Client disconnected: ${client.id}`);
  }

  emitNewBroadcast(payload: any) {
    // Force every property the frontend list needs
    const enhancedPayload = {
      ...payload,
      id: payload.id,
      isBroadcast: true,
      createdAt: new Date().toISOString(),
    };

    if (payload.target === 'ALL') {
      this.server.emit('broadcast:general', enhancedPayload);
    } else {
      const room = payload.target.toLowerCase().trim().replace(/s$/, '');
      this.server.to(room).emit('broadcast:targeted', enhancedPayload);
      console.log(`[Remzik] Targeted broadcast sent to room: ${room}`);
    }
  }
}
