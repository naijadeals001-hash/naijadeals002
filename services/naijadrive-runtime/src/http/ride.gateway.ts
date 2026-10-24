import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets'
import type { Server } from 'socket.io'

/** Realtime transport seam. GPS ingestion and room authorization are next slice, not faked here. */
@WebSocketGateway({ namespace: '/naijadrive', cors: false })
export class RideGateway {
  @WebSocketServer()
  server!: Server
}
