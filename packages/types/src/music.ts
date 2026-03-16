// -----------------------------------------------------------------------------
// Music Rooms Types
// -----------------------------------------------------------------------------

/**
 * Modified client identification for capability discovery
 */
export const MUSIC_APP_ID = 'quiet-musicrooms'
export const MUSIC_PROTOCOL_VERSION = 1

export interface MusicClientHello {
  appId: string
  protocolVersion: number
  capabilities: MusicCapability[]
  peerId: string
  timestamp: number
  signature: string
}

export type MusicCapability = 
  | 'music_rooms'
  | 'piped_audio'
  | 'leader_election_v1'

/**
 * Music Room metadata (rarely changes)
 */
export interface MusicRoom {
  id: string
  name: string
  createdBy: string
  createdAt: number
  requiredAppId: string
  minProtocolVersion: number
}

/**
 * Music Room session state (changes frequently)
 */
export interface MusicRoomSession {
  roomId: string
  leaderId: string
  leaderEpoch: number
  leaderHeartbeatAt: number
  currentTrack: MusicTrack | null
  playbackState: MusicPlaybackState
  startedAt: number // wall-clock timestamp when play started
  pausedAt: number | null // wall-clock timestamp when paused
  pausePositionMs: number | null // position when paused
  queueVersion: number
}

export type MusicPlaybackState = 'playing' | 'paused' | 'stopped'

/**
 * Track in queue
 */
export interface MusicTrack {
  id: string // YouTube video ID
  title: string
  artist: string
  thumbnailUrl: string
  durationMs: number
  addedBy: string
  addedAt: number
  source: 'youtube' | 'ytmusic'
}

/**
 * Resolved audio stream (from Piped/Invidious)
 */
export interface AudioStream {
  trackId: string
  streamUrl: string
  expiresAt: number
  mimeType: string
  quality: string
}

/**
 * Music room queue
 */
export interface MusicRoomQueue {
  roomId: string
  tracks: MusicTrack[]
  version: number
}

/**
 * Participant in a room
 */
export interface MusicRoomParticipant {
  peerId: string
  username: string
  joinedAt: number
  isLeader: boolean
  isCompatible: boolean
}

/**
 * Compatible peer discovered via handshake
 */
export interface CompatiblePeer {
  peerId: string
  username: string
  capabilities: MusicCapability[]
  lastSeen: number
}

/**
 * Leader heartbeat event
 */
export interface LeaderHeartbeat {
  roomId: string
  leaderId: string
  leaderEpoch: number
  timestamp: number
  currentPositionMs: number
}

/**
 * Playback event from leader
 */
export interface PlaybackEvent {
  roomId: string
  type: 'play' | 'pause' | 'stop' | 'seek' | 'skip' | 'track_change'
  trackId?: string
  positionMs?: number
  timestamp: number
  leaderEpoch: number
}

// -----------------------------------------------------------------------------
// Socket Actions for Music Rooms
// -----------------------------------------------------------------------------

export enum MusicSocketActions {
  // Room management
  CREATE_MUSIC_ROOM = 'createMusicRoom',
  JOIN_MUSIC_ROOM = 'joinMusicRoom',
  LEAVE_MUSIC_ROOM = 'leaveMusicRoom',
  GET_MUSIC_ROOMS = 'getMusicRooms',

  // Playback control (leader only)
  SET_PLAYBACK_STATE = 'setPlaybackState',
  ADD_TO_QUEUE = 'addToQueue',
  REMOVE_FROM_QUEUE = 'removeFromQueue',
  SKIP_TRACK = 'skipTrack',

  // Client handshake
  MUSIC_CLIENT_HELLO = 'musicClientHello',
}

export enum MusicSocketEvents {
  // Room events
  MUSIC_ROOM_CREATED = 'musicRoomCreated',
  MUSIC_ROOM_UPDATED = 'musicRoomUpdated',
  MUSIC_ROOM_DELETED = 'musicRoomDeleted',
  MUSIC_ROOMS_LIST = 'musicRoomsList',

  // Session events
  MUSIC_SESSION_UPDATED = 'musicSessionUpdated',
  MUSIC_QUEUE_UPDATED = 'musicQueueUpdated',
  PLAYBACK_EVENT = 'playbackEvent',
  LEADER_HEARTBEAT = 'leaderHeartbeat',

  // Participant events
  PARTICIPANT_JOINED = 'musicParticipantJoined',
  PARTICIPANT_LEFT = 'musicParticipantLeft',
  PARTICIPANTS_LIST = 'musicParticipantsList',

  // Client discovery
  COMPATIBLE_PEER_DISCOVERED = 'compatiblePeerDiscovered',
  COMPATIBLE_PEER_DISCONNECTED = 'compatiblePeerDisconnected',
}

// -----------------------------------------------------------------------------
// Socket Payloads
// -----------------------------------------------------------------------------

export interface CreateMusicRoomPayload {
  name: string
}

export interface CreateMusicRoomResponse {
  room: MusicRoom
  success: boolean
  error?: string
}

export interface JoinMusicRoomPayload {
  roomId: string
}

export interface JoinMusicRoomResponse {
  success: boolean
  room: MusicRoom | null
  session: MusicRoomSession | null
  queue: MusicTrack[]
  participants: MusicRoomParticipant[]
  audioStream: AudioStream | null
  error?: string
}

export interface LeaveMusicRoomPayload {
  roomId: string
}

export interface SetPlaybackStatePayload {
  roomId: string
  state: MusicPlaybackState
  positionMs?: number
}

export interface AddToQueuePayload {
  roomId: string
  videoId: string
  source: 'youtube' | 'ytmusic'
}

export interface AddToQueueResponse {
  success: boolean
  track?: MusicTrack
  error?: string
}

export interface RemoveFromQueuePayload {
  roomId: string
  trackId: string
}

export interface SkipTrackPayload {
  roomId: string
}

export interface MusicRoomsListPayload {
  rooms: MusicRoom[]
}
