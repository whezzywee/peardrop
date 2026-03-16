import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common'
import { Inject } from '@nestjs/common'
import { v4 as uuidv4 } from 'uuid'
import {
  MusicRoom,
  MusicRoomSession,
  MusicTrack,
  MusicRoomParticipant,
  MusicSocketActions,
  MusicSocketEvents,
  MusicPlaybackState,
  CreateMusicRoomPayload,
  CreateMusicRoomResponse,
  JoinMusicRoomPayload,
  JoinMusicRoomResponse,
  LeaveMusicRoomPayload,
  SetPlaybackStatePayload,
  AddToQueuePayload,
  AddToQueueResponse,
  RemoveFromQueuePayload,
  SkipTrackPayload,
  PlaybackEvent,
  LeaderHeartbeat,
  MUSIC_APP_ID,
  MUSIC_PROTOCOL_VERSION,
} from '@quiet/types'
import { Libp2pService, Libp2pState } from '../libp2p/libp2p.service'
import { CompatiblePeersService } from './compatible-peers.service'
import { AudioSourceService } from './audio-source.service'
import { 
  MusicRoomState, 
  MUSIC_ROOM_EVENTS_TOPIC_PREFIX, 
  DEFAULT_MUSIC_CONFIG,
} from './music.types'
import { SERVER_IO_PROVIDER } from '../const'
import { ServerIoProviderTypes } from '../types'
import { createLogger } from '../common/logger'
import { GossipSub } from '@chainsafe/libp2p-gossipsub'

/**
 * Main service for managing music rooms
 * Handles room creation, joining, playback sync, and leader election
 */
@Injectable()
export class MusicRoomsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = createLogger(MusicRoomsService.name)
  
  // Active rooms by roomId
  private rooms: Map<string, MusicRoomState> = new Map()
  
  // Current room the local user is in (one at a time)
  private currentRoomId: string | null = null
  
  // Our peer ID
  private ourPeerId: string = ''
  
  // Leader heartbeat interval
  private leaderHeartbeatInterval: ReturnType<typeof setInterval> | null = null
  
  // Room subscriptions (pubsub)
  private subscribedRooms: Set<string> = new Set()

  constructor(
    @Inject(SERVER_IO_PROVIDER) public readonly serverIoProvider: ServerIoProviderTypes,
    private readonly libp2pService: Libp2pService,
    private readonly compatiblePeersService: CompatiblePeersService,
    private readonly audioSourceService: AudioSourceService,
  ) {}

  async onModuleInit() {
    this.logger.info('Initializing MusicRoomsService')
    
    // Wait for libp2p
    await this.waitForLibp2p()
    
    this.logger.info('MusicRoomsService initialized')
  }

  async onModuleDestroy() {
    if (this.leaderHeartbeatInterval) {
      clearInterval(this.leaderHeartbeatInterval)
      this.leaderHeartbeatInterval = null
    }
    
    // Unsubscribe from all room topics
    for (const roomId of this.subscribedRooms) {
      await this.unsubscribeFromRoom(roomId)
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

  // ============================================================================
  // Room Management
  // ============================================================================

  /**
   * Create a new music room
   */
  async createRoom(payload: CreateMusicRoomPayload): Promise<CreateMusicRoomResponse> {
    this.logger.info(`Creating music room: ${payload.name}`)
    
    // Check if we have compatible peers (optional - can allow solo rooms)
    const compatiblePeers = this.compatiblePeersService.getCompatiblePeerCount()
    this.logger.info(`Compatible peers available: ${compatiblePeers}`)
    
    const roomId = uuidv4()
    
    const room: MusicRoom = {
      id: roomId,
      name: payload.name,
      createdBy: this.ourPeerId,
      createdAt: Date.now(),
      requiredAppId: MUSIC_APP_ID,
      minProtocolVersion: MUSIC_PROTOCOL_VERSION,
    }
    
    const session: MusicRoomSession = {
      roomId,
      leaderId: this.ourPeerId,
      leaderEpoch: 1,
      leaderHeartbeatAt: Date.now(),
      currentTrack: null,
      playbackState: 'stopped',
      startedAt: 0,
      pausedAt: null,
      pausePositionMs: null,
      queueVersion: 1,
    }
    
    const roomState: MusicRoomState = {
      room,
      session,
      queue: {
        roomId,
        tracks: [],
        version: 1,
      },
      participants: new Map(),
    }
    
    // Add ourselves as participant
    roomState.participants.set(this.ourPeerId, {
      peerId: this.ourPeerId,
      username: '', // TODO: Get from identity
      joinedAt: Date.now(),
      isLeader: true,
      isCompatible: true,
    })
    
    this.rooms.set(roomId, roomState)
    this.currentRoomId = roomId
    
    // Subscribe to room events
    await this.subscribeToRoom(roomId)
    
    // Start leader heartbeat
    this.startLeaderHeartbeat(roomId)
    
    // Notify frontend
    this.serverIoProvider.io.emit(MusicSocketEvents.MUSIC_ROOM_CREATED, { room })
    
    return {
      room,
      success: true,
    }
  }

  /**
   * Join an existing music room
   */
  async joinRoom(payload: JoinMusicRoomPayload): Promise<JoinMusicRoomResponse> {
    this.logger.info(`Joining music room: ${payload.roomId}`)
    
    const roomState = this.rooms.get(payload.roomId)
    
    if (!roomState) {
      // Room doesn't exist locally - try to fetch from network
      // For now, return error
      return {
        success: false,
        room: null,
        session: null,
        queue: [],
        participants: [],
        audioStream: null,
        error: 'Room not found',
      }
    }
    
    // Check if room is compatible
    if (roomState.room.requiredAppId !== MUSIC_APP_ID) {
      return {
        success: false,
        room: null,
        session: null,
        queue: [],
        participants: [],
        audioStream: null,
        error: 'Incompatible room',
      }
    }
    
    // Leave current room if any
    if (this.currentRoomId && this.currentRoomId !== payload.roomId) {
      await this.leaveRoom({ roomId: this.currentRoomId })
    }
    
    // Add ourselves as participant
    roomState.participants.set(this.ourPeerId, {
      peerId: this.ourPeerId,
      username: '', // TODO: Get from identity
      joinedAt: Date.now(),
      isLeader: false,
      isCompatible: true,
    })
    
    this.currentRoomId = payload.roomId
    
    // Subscribe to room events
    await this.subscribeToRoom(payload.roomId)
    
    // Get audio stream if there's a current track
    let audioStream = null
    if (roomState.session.currentTrack) {
      audioStream = await this.audioSourceService.resolveAudioStream(
        roomState.session.currentTrack.id
      )
    }
    
    // Notify frontend
    this.serverIoProvider.io.emit(MusicSocketEvents.PARTICIPANT_JOINED, {
      roomId: payload.roomId,
      participant: roomState.participants.get(this.ourPeerId),
    })
    
    return {
      success: true,
      room: roomState.room,
      session: roomState.session,
      queue: roomState.queue.tracks,
      participants: Array.from(roomState.participants.values()),
      audioStream,
    }
  }

  /**
   * Leave a music room
   */
  async leaveRoom(payload: LeaveMusicRoomPayload): Promise<void> {
    this.logger.info(`Leaving music room: ${payload.roomId}`)
    
    const roomState = this.rooms.get(payload.roomId)
    if (!roomState) return
    
    // Remove ourselves as participant
    roomState.participants.delete(this.ourPeerId)
    
    // If we were the leader, elect new leader
    if (roomState.session.leaderId === this.ourPeerId) {
      await this.electNewLeader(payload.roomId)
    }
    
    // Unsubscribe from room events
    await this.unsubscribeFromRoom(payload.roomId)
    
    // Stop heartbeat if we were leader
    if (this.leaderHeartbeatInterval) {
      clearInterval(this.leaderHeartbeatInterval)
      this.leaderHeartbeatInterval = null
    }
    
    // Clear current room
    if (this.currentRoomId === payload.roomId) {
      this.currentRoomId = null
    }
    
    // Notify frontend
    this.serverIoProvider.io.emit(MusicSocketEvents.PARTICIPANT_LEFT, {
      roomId: payload.roomId,
      peerId: this.ourPeerId,
    })
    
    // If no participants left, remove room
    if (roomState.participants.size === 0) {
      this.rooms.delete(payload.roomId)
      this.serverIoProvider.io.emit(MusicSocketEvents.MUSIC_ROOM_DELETED, {
        roomId: payload.roomId,
      })
    }
  }

  /**
   * Get all available rooms
   */
  getRooms(): MusicRoom[] {
    return Array.from(this.rooms.values()).map(r => r.room)
  }

  // ============================================================================
  // Playback Control (Leader only)
  // ============================================================================

  /**
   * Set playback state (play/pause/stop)
   */
  async setPlaybackState(payload: SetPlaybackStatePayload): Promise<void> {
    const roomState = this.rooms.get(payload.roomId)
    if (!roomState) return
    
    // Check if we're the leader
    if (roomState.session.leaderId !== this.ourPeerId) {
      this.logger.warn('Cannot set playback state: not leader')
      return
    }
    
    const now = Date.now()
    
    switch (payload.state) {
      case 'playing':
        if (roomState.session.playbackState === 'paused' && roomState.session.pausePositionMs) {
          // Resuming from pause
          roomState.session.startedAt = now - roomState.session.pausePositionMs
        } else {
          // Starting fresh
          roomState.session.startedAt = now
        }
        roomState.session.playbackState = 'playing'
        roomState.session.pausedAt = null
        roomState.session.pausePositionMs = null
        break
        
      case 'paused':
        if (roomState.session.playbackState === 'playing') {
          roomState.session.pausedAt = now
          roomState.session.pausePositionMs = now - roomState.session.startedAt
        }
        roomState.session.playbackState = 'paused'
        break
        
      case 'stopped':
        roomState.session.playbackState = 'stopped'
        roomState.session.startedAt = 0
        roomState.session.pausedAt = null
        roomState.session.pausePositionMs = null
        break
    }
    
    // Broadcast playback event
    const eventType = payload.state === 'playing' ? 'play' : 
                      payload.state === 'paused' ? 'pause' : 'stop'
    
    await this.broadcastPlaybackEvent(payload.roomId, {
      type: eventType,
      positionMs: payload.positionMs,
      timestamp: now,
      roomId: payload.roomId,
      leaderEpoch: roomState.session.leaderEpoch,
    })
    
    // Notify frontend
    this.serverIoProvider.io.emit(MusicSocketEvents.MUSIC_SESSION_UPDATED, {
      roomId: payload.roomId,
      session: roomState.session,
    })
  }

  /**
   * Add track to queue
   */
  async addToQueue(payload: AddToQueuePayload): Promise<AddToQueueResponse> {
    const roomState = this.rooms.get(payload.roomId)
    if (!roomState) {
      return { success: false, error: 'Room not found' }
    }
    
    // Get video metadata
    const metadata = await this.audioSourceService.getVideoMetadata(payload.videoId)
    if (!metadata) {
      return { success: false, error: 'Failed to get video metadata' }
    }
    
    const track: MusicTrack = {
      id: payload.videoId,
      title: metadata.title,
      artist: metadata.artist,
      thumbnailUrl: metadata.thumbnailUrl,
      durationMs: metadata.durationMs,
      addedBy: this.ourPeerId,
      addedAt: Date.now(),
      source: payload.source,
    }
    
    roomState.queue.tracks.push(track)
    roomState.queue.version++
    roomState.session.queueVersion++
    
    // If no current track, set this as current
    if (!roomState.session.currentTrack) {
      roomState.session.currentTrack = track
      roomState.session.playbackState = 'stopped'
    }
    
    // Notify frontend
    this.serverIoProvider.io.emit(MusicSocketEvents.MUSIC_QUEUE_UPDATED, {
      roomId: payload.roomId,
      queue: roomState.queue.tracks,
      version: roomState.queue.version,
    })
    
    return { success: true, track }
  }

  /**
   * Remove track from queue
   */
  async removeFromQueue(payload: RemoveFromQueuePayload): Promise<void> {
    const roomState = this.rooms.get(payload.roomId)
    if (!roomState) return
    
    const index = roomState.queue.tracks.findIndex(t => t.id === payload.trackId)
    if (index === -1) return
    
    roomState.queue.tracks.splice(index, 1)
    roomState.queue.version++
    roomState.session.queueVersion++
    
    // Notify frontend
    this.serverIoProvider.io.emit(MusicSocketEvents.MUSIC_QUEUE_UPDATED, {
      roomId: payload.roomId,
      queue: roomState.queue.tracks,
      version: roomState.queue.version,
    })
  }

  /**
   * Skip to next track
   */
  async skipTrack(payload: SkipTrackPayload): Promise<void> {
    const roomState = this.rooms.get(payload.roomId)
    if (!roomState) return
    
    // Check if we're the leader
    if (roomState.session.leaderId !== this.ourPeerId) {
      this.logger.warn('Cannot skip track: not leader')
      return
    }
    
    // Remove current track from queue
    if (roomState.session.currentTrack) {
      const index = roomState.queue.tracks.findIndex(
        t => t.id === roomState.session.currentTrack?.id
      )
      if (index !== -1) {
        roomState.queue.tracks.splice(index, 1)
        roomState.queue.version++
      }
    }
    
    // Set next track as current
    const nextTrack = roomState.queue.tracks[0] || null
    roomState.session.currentTrack = nextTrack
    roomState.session.playbackState = nextTrack ? 'stopped' : 'stopped'
    roomState.session.startedAt = 0
    roomState.session.queueVersion++
    
    // Broadcast skip event
    await this.broadcastPlaybackEvent(payload.roomId, {
      type: 'skip',
      trackId: nextTrack?.id,
      timestamp: Date.now(),
      roomId: payload.roomId,
      leaderEpoch: roomState.session.leaderEpoch,
    })
    
    // Notify frontend
    this.serverIoProvider.io.emit(MusicSocketEvents.MUSIC_SESSION_UPDATED, {
      roomId: payload.roomId,
      session: roomState.session,
    })
    
    this.serverIoProvider.io.emit(MusicSocketEvents.MUSIC_QUEUE_UPDATED, {
      roomId: payload.roomId,
      queue: roomState.queue.tracks,
      version: roomState.queue.version,
    })
  }

  // ============================================================================
  // Leader Election & Heartbeat
  // ============================================================================

  /**
   * Start leader heartbeat for a room
   */
  private startLeaderHeartbeat(roomId: string): void {
    if (this.leaderHeartbeatInterval) {
      clearInterval(this.leaderHeartbeatInterval)
    }
    
    this.leaderHeartbeatInterval = setInterval(() => {
      this.sendLeaderHeartbeat(roomId)
    }, DEFAULT_MUSIC_CONFIG.heartbeatIntervalMs)
  }

  /**
   * Send leader heartbeat
   */
  private async sendLeaderHeartbeat(roomId: string): Promise<void> {
    const roomState = this.rooms.get(roomId)
    if (!roomState) return
    
    // Only send if we're the leader
    if (roomState.session.leaderId !== this.ourPeerId) return
    
    const now = Date.now()
    roomState.session.leaderHeartbeatAt = now
    
    // Calculate current position
    let currentPositionMs = 0
    if (roomState.session.playbackState === 'playing') {
      currentPositionMs = now - roomState.session.startedAt
    } else if (roomState.session.playbackState === 'paused' && roomState.session.pausePositionMs) {
      currentPositionMs = roomState.session.pausePositionMs
    }
    
    const heartbeat: LeaderHeartbeat = {
      roomId,
      leaderId: this.ourPeerId,
      leaderEpoch: roomState.session.leaderEpoch,
      timestamp: now,
      currentPositionMs,
    }
    
    // Broadcast via pubsub
    await this.publishToRoom(roomId, 'heartbeat', heartbeat)
    
    // Also emit to frontend
    this.serverIoProvider.io.emit(MusicSocketEvents.LEADER_HEARTBEAT, heartbeat)
  }

  /**
   * Elect a new leader when current leader disconnects
   */
  private async electNewLeader(roomId: string): Promise<void> {
    const roomState = this.rooms.get(roomId)
    if (!roomState) return
    
    // Get compatible participants (excluding current leader)
    const candidates = Array.from(roomState.participants.values())
      .filter(p => p.isCompatible && p.peerId !== roomState.session.leaderId)
    
    if (candidates.length === 0) {
      // No candidates, room will be empty
      this.logger.info(`No leader candidates for room ${roomId}`)
      return
    }
    
    // Deterministic election: smallest peerId wins
    candidates.sort((a, b) => a.peerId.localeCompare(b.peerId))
    const newLeader = candidates[0]
    
    // Update session
    roomState.session.leaderId = newLeader.peerId
    roomState.session.leaderEpoch++
    roomState.session.leaderHeartbeatAt = Date.now()
    
    // Update participant
    newLeader.isLeader = true
    
    this.logger.info(`New leader elected for room ${roomId}: ${newLeader.peerId}`)
    
    // Notify frontend
    this.serverIoProvider.io.emit(MusicSocketEvents.MUSIC_SESSION_UPDATED, {
      roomId,
      session: roomState.session,
    })
  }

  // ============================================================================
  // Pubsub (Room Events)
  // ============================================================================

  private getRoomTopic(roomId: string): string {
    return `${MUSIC_ROOM_EVENTS_TOPIC_PREFIX}/${roomId}/events`
  }

  private async subscribeToRoom(roomId: string): Promise<void> {
    if (this.subscribedRooms.has(roomId)) return
    
    const pubsub = this.getPubsub()
    if (!pubsub) return
    
    const topic = this.getRoomTopic(roomId)
    
    try {
      pubsub.subscribe(topic)
      
      pubsub.addEventListener('message', (event: any) => {
        if (event.detail.topic === topic) {
          this.handleRoomMessage(roomId, event.detail)
        }
      })
      
      this.subscribedRooms.add(roomId)
      this.logger.info(`Subscribed to room topic: ${topic}`)
    } catch (error) {
      this.logger.error('Failed to subscribe to room topic', error)
    }
  }

  private async unsubscribeFromRoom(roomId: string): Promise<void> {
    const pubsub = this.getPubsub()
    if (!pubsub) return
    
    const topic = this.getRoomTopic(roomId)
    
    try {
      pubsub.unsubscribe(topic)
      this.subscribedRooms.delete(roomId)
    } catch (error) {
      this.logger.error('Failed to unsubscribe from room topic', error)
    }
  }

  private handleRoomMessage(roomId: string, message: any): void {
    try {
      const data = JSON.parse(new TextDecoder().decode(message.data))
      const roomState = this.rooms.get(roomId)
      
      if (!roomState) return
      
      // Handle different message types
      switch (data.type) {
        case 'heartbeat':
          this.handleLeaderHeartbeat(roomId, data)
          break
        case 'playback':
          this.handlePlaybackEvent(roomId, data)
          break
      }
    } catch (error) {
      this.logger.error('Error handling room message', error)
    }
  }

  private handleLeaderHeartbeat(roomId: string, heartbeat: LeaderHeartbeat): void {
    const roomState = this.rooms.get(roomId)
    if (!roomState) return
    
    // Ignore if not from current leader or older epoch
    if (heartbeat.leaderEpoch < roomState.session.leaderEpoch) return
    
    // Update leader heartbeat time
    roomState.session.leaderHeartbeatAt = heartbeat.timestamp
    
    // If we receive heartbeat from a new leader, update
    if (heartbeat.leaderId !== roomState.session.leaderId) {
      roomState.session.leaderId = heartbeat.leaderId
      roomState.session.leaderEpoch = heartbeat.leaderEpoch
      
      // Update participant leader status
      for (const [peerId, participant] of roomState.participants) {
        participant.isLeader = peerId === heartbeat.leaderId
      }
    }
    
    // Emit to frontend for sync
    this.serverIoProvider.io.emit(MusicSocketEvents.LEADER_HEARTBEAT, heartbeat)
  }

  private handlePlaybackEvent(roomId: string, event: PlaybackEvent): void {
    const roomState = this.rooms.get(roomId)
    if (!roomState) return
    
    // Ignore if not from leader or older epoch
    if (event.leaderEpoch < roomState.session.leaderEpoch) return
    
    // Apply playback event
    switch (event.type) {
      case 'play':
        roomState.session.playbackState = 'playing'
        roomState.session.startedAt = event.timestamp - (event.positionMs || 0)
        roomState.session.pausedAt = null
        roomState.session.pausePositionMs = null
        break
      case 'pause':
        roomState.session.playbackState = 'paused'
        roomState.session.pausedAt = event.timestamp
        roomState.session.pausePositionMs = event.positionMs || null
        break
      case 'stop':
        roomState.session.playbackState = 'stopped'
        roomState.session.startedAt = 0
        break
      case 'skip':
        // Find next track
        const nextTrack = roomState.queue.tracks.find(t => t.id === event.trackId)
        roomState.session.currentTrack = nextTrack || roomState.queue.tracks[0] || null
        roomState.session.startedAt = 0
        roomState.session.playbackState = 'stopped'
        break
      case 'track_change':
        const track = roomState.queue.tracks.find(t => t.id === event.trackId)
        roomState.session.currentTrack = track || null
        break
    }
    
    // Notify frontend
    this.serverIoProvider.io.emit(MusicSocketEvents.PLAYBACK_EVENT, event)
    this.serverIoProvider.io.emit(MusicSocketEvents.MUSIC_SESSION_UPDATED, {
      roomId,
      session: roomState.session,
    })
  }

  private async publishToRoom(roomId: string, type: string, data: any): Promise<void> {
    const pubsub = this.getPubsub()
    if (!pubsub) return
    
    const topic = this.getRoomTopic(roomId)
    const message = { type, ...data }
    
    try {
      const encoded = new TextEncoder().encode(JSON.stringify(message))
      await pubsub.publish(topic, encoded)
    } catch (error) {
      this.logger.error('Failed to publish to room', error)
    }
  }

  private async broadcastPlaybackEvent(roomId: string, event: PlaybackEvent): Promise<void> {
    await this.publishToRoom(roomId, 'playback', event)
    this.serverIoProvider.io.emit(MusicSocketEvents.PLAYBACK_EVENT, event)
  }
}
