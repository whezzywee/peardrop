import { Injectable, OnModuleInit } from '@nestjs/common'
import { Inject } from '@nestjs/common'
import {
  MusicSocketActions,
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
} from '@quiet/types'
import { MusicRoomsService } from './music-rooms.service'
import { SERVER_IO_PROVIDER } from '../const'
import { ServerIoProviderTypes } from '../types'
import { createLogger } from '../common/logger'

/**
 * Gateway for handling socket events for music rooms
 * Bridges between Socket.IO and MusicRoomsService
 */
@Injectable()
export class MusicGateway implements OnModuleInit {
  private readonly logger = createLogger(MusicGateway.name)

  constructor(
    @Inject(SERVER_IO_PROVIDER) public readonly serverIoProvider: ServerIoProviderTypes,
    private readonly musicRoomsService: MusicRoomsService,
  ) {}

  onModuleInit() {
    this.logger.info('Initializing MusicGateway')
    
    this.serverIoProvider.io.on('connection', socket => {
      this.logger.debug(`Socket connected: ${socket.id}`)
      
      // Room management
      socket.on(MusicSocketActions.CREATE_MUSIC_ROOM, async (payload: CreateMusicRoomPayload, callback) => {
        try {
          const response = await this.musicRoomsService.createRoom(payload)
          callback?.(response)
        } catch (error) {
          this.logger.error('Error creating room', error)
          callback?.({ success: false, room: null, error: 'Internal error' })
        }
      })
      
      socket.on(MusicSocketActions.JOIN_MUSIC_ROOM, async (payload: JoinMusicRoomPayload, callback) => {
        try {
          const response = await this.musicRoomsService.joinRoom(payload)
          callback?.(response)
        } catch (error) {
          this.logger.error('Error joining room', error)
          callback?.({ success: false, room: null, session: null, queue: [], participants: [], audioStream: null, error: 'Internal error' })
        }
      })
      
      socket.on(MusicSocketActions.LEAVE_MUSIC_ROOM, async (payload: LeaveMusicRoomPayload) => {
        try {
          await this.musicRoomsService.leaveRoom(payload)
        } catch (error) {
          this.logger.error('Error leaving room', error)
        }
      })
      
      socket.on(MusicSocketActions.GET_MUSIC_ROOMS, async (callback) => {
        try {
          const rooms = this.musicRoomsService.getRooms()
          callback?.({ rooms })
        } catch (error) {
          this.logger.error('Error getting rooms', error)
          callback?.({ rooms: [] })
        }
      })
      
      // Playback control
      socket.on(MusicSocketActions.SET_PLAYBACK_STATE, async (payload: SetPlaybackStatePayload) => {
        try {
          await this.musicRoomsService.setPlaybackState(payload)
        } catch (error) {
          this.logger.error('Error setting playback state', error)
        }
      })
      
      // Queue management
      socket.on(MusicSocketActions.ADD_TO_QUEUE, async (payload: AddToQueuePayload, callback) => {
        try {
          const response = await this.musicRoomsService.addToQueue(payload)
          callback?.(response)
        } catch (error) {
          this.logger.error('Error adding to queue', error)
          callback?.({ success: false, error: 'Internal error' })
        }
      })
      
      socket.on(MusicSocketActions.REMOVE_FROM_QUEUE, async (payload: RemoveFromQueuePayload) => {
        try {
          await this.musicRoomsService.removeFromQueue(payload)
        } catch (error) {
          this.logger.error('Error removing from queue', error)
        }
      })
      
      socket.on(MusicSocketActions.SKIP_TRACK, async (payload: SkipTrackPayload) => {
        try {
          await this.musicRoomsService.skipTrack(payload)
        } catch (error) {
          this.logger.error('Error skipping track', error)
        }
      })
      
      // Handle disconnect
      socket.on('disconnect', () => {
        this.logger.debug(`Socket disconnected: ${socket.id}`)
        // Note: We don't automatically leave rooms on disconnect
        // The user might reconnect
      })
    })
    
    this.logger.info('MusicGateway initialized')
  }
}
