import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common'
import { Inject } from '@nestjs/common'
import { 
  MusicClientHello, 
  MusicCapability, 
  MusicSocketEvents,
  MUSIC_APP_ID,
  MUSIC_PROTOCOL_VERSION,
} from '@quiet/types'
import { Libp2pService, Libp2pState } from '../libp2p/libp2p.service'
import { CompatiblePeer, MUSIC_PUBSUB_TOPIC, DEFAULT_MUSIC_CONFIG } from './music.types'
import { SERVER_IO_PROVIDER } from '../const'
import { ServerIoProviderTypes } from '../types'
import { createLogger } from '../common/logger'
import { Libp2p } from '@libp2p/interface'
import { GossipSub } from '@chainsafe/libp2p-gossipsub'

/**
 * Handles discovery of compatible modified clients
 * Uses libp2p pubsub for peer discovery
 */
@Injectable()
export class CompatiblePeersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = createLogger(CompatiblePeersService.name)
  
  // Map of peerId -> CompatiblePeer
  private compatiblePeers: Map<string, CompatiblePeer> = new Map()
  
  // Our own peer info
  private ourPeerId: string = ''
  private ourCapabilities: MusicCapability[] = ['music_rooms', 'piped_audio', 'leader_election_v1']
  
  // Heartbeat interval
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null

  constructor(
    @Inject(SERVER_IO_PROVIDER) public readonly serverIoProvider: ServerIoProviderTypes,
    private readonly libp2pService: Libp2pService,
  ) {}

  async onModuleInit() {
    this.logger.info('Initializing CompatiblePeersService')
    
    // Wait for libp2p to be ready
    await this.waitForLibp2p()
    
    // Subscribe to discovery topic
    await this.subscribeToDiscoveryTopic()
    
    // Start broadcasting our presence
    this.startHeartbeat()
    
    this.logger.info('CompatiblePeersService initialized')
  }

  async onModuleDestroy() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
    
    // Unsubscribe from discovery topic
    try {
      await this.unsubscribeFromDiscoveryTopic()
    } catch (error) {
      this.logger.error('Error unsubscribing from discovery topic', error)
    }
  }

  private async waitForLibp2p(): Promise<void> {
    return new Promise((resolve) => {
      const checkReady = () => {
        if (this.libp2pService.state === Libp2pState.Started && this.libp2pService.libp2pInstance) {
          this.ourPeerId = this.libp2pService.libp2pInstance.peerId.toString()
          this.logger.info(`Libp2p ready, our peerId: ${this.ourPeerId}`)
          resolve()
        } else {
          setTimeout(checkReady, 500)
        }
      }
      checkReady()
    })
  }

  private getPubsub(): GossipSub | null {
    const libp2p = this.libp2pService.libp2pInstance
    if (!libp2p) return null
    return (libp2p.services as any)?.pubsub as GossipSub | null
  }

  private async subscribeToDiscoveryTopic(): Promise<void> {
    try {
      const pubsub = this.getPubsub()
      if (!pubsub) {
        this.logger.error('Pubsub not available')
        return
      }
      
      pubsub.subscribe(MUSIC_PUBSUB_TOPIC)
      
      // Listen for messages
      pubsub.addEventListener('message', (event: any) => {
        this.handleDiscoveryMessage(event.detail)
      })
      
      this.logger.info(`Subscribed to discovery topic: ${MUSIC_PUBSUB_TOPIC}`)
    } catch (error) {
      this.logger.error('Failed to subscribe to discovery topic', error)
    }
  }

  private async unsubscribeFromDiscoveryTopic(): Promise<void> {
    try {
      const pubsub = this.getPubsub()
      if (!pubsub) return
      
      pubsub.unsubscribe(MUSIC_PUBSUB_TOPIC)
    } catch (error) {
      this.logger.error('Failed to unsubscribe from discovery topic', error)
    }
  }

  private handleDiscoveryMessage(message: any): void {
    try {
      const data = JSON.parse(new TextDecoder().decode(message.data))
      
      if (!this.isValidHello(data)) {
        this.logger.debug('Received invalid hello message, ignoring')
        return
      }
      
      const hello = data as MusicClientHello
      
      // Don't process our own messages
      if (hello.peerId === this.ourPeerId) {
        return
      }
      
      // Check compatibility
      if (!this.isCompatible(hello)) {
        this.logger.debug(`Peer ${hello.peerId} is not compatible`)
        return
      }
      
      // Add or update peer
      const isNewPeer = !this.compatiblePeers.has(hello.peerId)
      
      this.compatiblePeers.set(hello.peerId, {
        peerId: hello.peerId,
        username: '', // Will be filled from identity
        capabilities: hello.capabilities,
        lastSeen: Date.now(),
      })
      
      this.logger.info(`Compatible peer ${hello.peerId} ${isNewPeer ? 'discovered' : 'updated'}`)
      
      // Notify frontend
      this.serverIoProvider.io.emit(MusicSocketEvents.COMPATIBLE_PEER_DISCOVERED, {
        peerId: hello.peerId,
        capabilities: hello.capabilities,
        lastSeen: Date.now(),
      })
      
    } catch (error) {
      this.logger.error('Error handling discovery message', error)
    }
  }

  private isValidHello(data: any): data is MusicClientHello {
    return (
      data &&
      typeof data.appId === 'string' &&
      typeof data.protocolVersion === 'number' &&
      Array.isArray(data.capabilities) &&
      typeof data.peerId === 'string' &&
      typeof data.timestamp === 'number' &&
      typeof data.signature === 'string'
    )
  }

  private isCompatible(hello: MusicClientHello): boolean {
    // Check app ID matches
    if (hello.appId !== MUSIC_APP_ID) {
      return false
    }
    
    // Check protocol version is compatible
    if (hello.protocolVersion > MUSIC_PROTOCOL_VERSION) {
      this.logger.warn(`Peer ${hello.peerId} has newer protocol version ${hello.protocolVersion}`)
      return false
    }
    
    // Check minimum required capabilities
    if (!hello.capabilities.includes('music_rooms')) {
      return false
    }
    
    return true
  }

  private startHeartbeat(): void {
    // Send initial hello
    this.broadcastHello()
    
    // Set up interval for regular heartbeats
    this.heartbeatInterval = setInterval(() => {
      this.broadcastHello()
      this.cleanupStalePeers()
    }, DEFAULT_MUSIC_CONFIG.heartbeatIntervalMs)
  }

  private async broadcastHello(): Promise<void> {
    const hello: MusicClientHello = {
      appId: MUSIC_APP_ID,
      protocolVersion: MUSIC_PROTOCOL_VERSION,
      capabilities: this.ourCapabilities,
      peerId: this.ourPeerId,
      timestamp: Date.now(),
      signature: '', // TODO: Sign with identity key
    }
    
    try {
      const pubsub = this.getPubsub()
      if (!pubsub) {
        this.logger.warn('Pubsub not available, cannot broadcast hello')
        return
      }
      
      const data = new TextEncoder().encode(JSON.stringify(hello))
      await pubsub.publish(MUSIC_PUBSUB_TOPIC, data)
      this.logger.debug('Broadcast hello message')
    } catch (error) {
      this.logger.error('Failed to broadcast hello', error)
    }
  }

  private cleanupStalePeers(): void {
    const now = Date.now()
    const staleThreshold = DEFAULT_MUSIC_CONFIG.heartbeatIntervalMs * 3
    
    for (const [peerId, peer] of this.compatiblePeers.entries()) {
      if (now - peer.lastSeen > staleThreshold) {
        this.logger.info(`Peer ${peerId} is stale, removing`)
        this.compatiblePeers.delete(peerId)
        
        // Notify frontend
        this.serverIoProvider.io.emit(MusicSocketEvents.COMPATIBLE_PEER_DISCONNECTED, {
          peerId,
        })
      }
    }
  }

  /**
   * Get all currently compatible peers
   */
  getCompatiblePeers(): CompatiblePeer[] {
    return Array.from(this.compatiblePeers.values())
  }

  /**
   * Check if a specific peer is compatible
   */
  isPeerCompatible(peerId: string): boolean {
    return this.compatiblePeers.has(peerId)
  }

  /**
   * Get a specific compatible peer
   */
  getPeer(peerId: string): CompatiblePeer | undefined {
    return this.compatiblePeers.get(peerId)
  }

  /**
   * Check if there are any compatible peers available
   */
  hasCompatiblePeers(): boolean {
    return this.compatiblePeers.size > 0
  }

  /**
   * Get count of compatible peers
   */
  getCompatiblePeerCount(): number {
    return this.compatiblePeers.size
  }
}
