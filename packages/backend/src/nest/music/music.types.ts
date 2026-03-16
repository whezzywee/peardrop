import { MusicClientHello, MusicCapability, MusicRoom, MusicRoomSession, MusicRoomQueue, MusicRoomParticipant, AudioStream } from '@quiet/types'

export const MUSIC_PUBSUB_TOPIC = 'quiet-mod/music/v1/hello'
export const MUSIC_ROOM_EVENTS_TOPIC_PREFIX = 'music-room'

export interface CompatiblePeer {
  peerId: string
  username: string
  capabilities: MusicCapability[]
  lastSeen: number
}

export interface MusicRoomState {
  room: MusicRoom
  session: MusicRoomSession
  queue: MusicRoomQueue
  participants: Map<string, MusicRoomParticipant>
}

export interface AudioStreamCache {
  [trackId: string]: AudioStream
}

export interface MusicModuleConfig {
  appId: string
  protocolVersion: number
  heartbeatIntervalMs: number
  leaderTimeoutMs: number
  streamCacheTtlMs: number
}

export const DEFAULT_MUSIC_CONFIG: MusicModuleConfig = {
  appId: 'quiet-musicrooms',
  protocolVersion: 1,
  heartbeatIntervalMs: 5000,
  leaderTimeoutMs: 15000,
  streamCacheTtlMs: 6 * 60 * 60 * 1000, // 6 hours
}
