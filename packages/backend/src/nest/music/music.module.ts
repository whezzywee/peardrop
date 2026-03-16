import { Module, OnModuleInit } from '@nestjs/common'
import { MusicRoomsService } from './music-rooms.service'
import { CompatiblePeersService } from './compatible-peers.service'
import { AudioSourceService } from './audio-source.service'
import { MusicGateway } from './music.gateway'
import { Libp2pModule } from '../libp2p/libp2p.module'
import { SocketModule } from '../socket/socket.module'

@Module({
  imports: [Libp2pModule, SocketModule],
  providers: [
    MusicRoomsService,
    CompatiblePeersService,
    AudioSourceService,
    MusicGateway,
  ],
  exports: [
    MusicRoomsService,
    CompatiblePeersService,
    AudioSourceService,
  ],
})
export class MusicModule implements OnModuleInit {
  constructor(
    private readonly musicRoomsService: MusicRoomsService,
    private readonly compatiblePeersService: CompatiblePeersService,
    private readonly musicGateway: MusicGateway,
  ) {}

  async onModuleInit() {
    // Services initialize themselves via OnModuleInit
  }
}
