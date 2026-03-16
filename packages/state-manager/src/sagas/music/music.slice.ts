import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import {
  MusicRoom,
  MusicRoomSession,
  MusicTrack,
  MusicRoomParticipant,
  AudioStream,
  CompatiblePeer,
  PlaybackEvent,
  LeaderHeartbeat,
} from '@quiet/types'
import { StoreKeys } from '../store.keys'

export interface MusicState {
  // All discovered rooms
  rooms: MusicRoom[]
  
  // Current room we're in
  currentRoomId: string | null
  
  // Current room session state
  session: MusicRoomSession | null
  
  // Queue for current room
  queue: MusicTrack[]
  queueVersion: number
  
  // Participants in current room
  participants: MusicRoomParticipant[]
  
  // Current audio stream
  audioStream: AudioStream | null
  
  // Compatible peers discovered
  compatiblePeers: CompatiblePeer[]
  
  // Loading states
  isCreatingRoom: boolean
  isJoiningRoom: boolean
  isLoadingStream: boolean
  
  // Errors
  error: string | null
  
  // Local playback state (for UI)
  localPlaybackPosition: number
  isPlaying: boolean
}

const initialState: MusicState = {
  rooms: [],
  currentRoomId: null,
  session: null,
  queue: [],
  queueVersion: 0,
  participants: [],
  audioStream: null,
  compatiblePeers: [],
  isCreatingRoom: false,
  isJoiningRoom: false,
  isLoadingStream: false,
  error: null,
  localPlaybackPosition: 0,
  isPlaying: false,
}

export const musicSlice = createSlice({
  name: StoreKeys.Music,
  initialState,
  reducers: {
    // Room management
    createRoom: (state, _action: PayloadAction<{ name: string }>) => {
      state.isCreatingRoom = true
      state.error = null
    },
    createRoomSuccess: (state, action: PayloadAction<{ room: MusicRoom }>) => {
      state.isCreatingRoom = false
      state.rooms.push(action.payload.room)
      state.currentRoomId = action.payload.room.id
    },
    createRoomFailure: (state, action: PayloadAction<{ error: string }>) => {
      state.isCreatingRoom = false
      state.error = action.payload.error
    },
    
    joinRoom: (state, _action: PayloadAction<{ roomId: string }>) => {
      state.isJoiningRoom = true
      state.error = null
    },
    joinRoomSuccess: (
      state,
      action: PayloadAction<{
        room: MusicRoom
        session: MusicRoomSession
        queue: MusicTrack[]
        participants: MusicRoomParticipant[]
        audioStream: AudioStream | null
      }>
    ) => {
      state.isJoiningRoom = false
      state.currentRoomId = action.payload.room.id
      state.session = action.payload.session
      state.queue = action.payload.queue
      state.participants = action.payload.participants
      state.audioStream = action.payload.audioStream
      state.isPlaying = action.payload.session.playbackState === 'playing'
      
      // Add room to list if not already there
      if (!state.rooms.find(r => r.id === action.payload.room.id)) {
        state.rooms.push(action.payload.room)
      }
    },
    joinRoomFailure: (state, action: PayloadAction<{ error: string }>) => {
      state.isJoiningRoom = false
      state.error = action.payload.error
    },
    
    leaveRoom: (state, _action: PayloadAction<{ roomId: string }>) => {},
    leaveRoomSuccess: (state, action: PayloadAction<{ roomId: string }>) => {
      if (state.currentRoomId === action.payload.roomId) {
        state.currentRoomId = null
        state.session = null
        state.queue = []
        state.participants = []
        state.audioStream = null
        state.isPlaying = false
        state.localPlaybackPosition = 0
      }
    },
    
    setRooms: (state, action: PayloadAction<{ rooms: MusicRoom[] }>) => {
      state.rooms = action.payload.rooms
    },
    
    // Session updates
    sessionUpdated: (state, action: PayloadAction<{ roomId: string; session: MusicRoomSession }>) => {
      if (state.currentRoomId === action.payload.roomId) {
        state.session = action.payload.session
        state.isPlaying = action.payload.session.playbackState === 'playing'
      }
    },
    
    // Queue updates
    queueUpdated: (state, action: PayloadAction<{ roomId: string; queue: MusicTrack[]; version: number }>) => {
      if (state.currentRoomId === action.payload.roomId) {
        state.queue = action.payload.queue
        state.queueVersion = action.payload.version
      }
    },
    
    addToQueue: (state, _action: PayloadAction<{ roomId: string; videoId: string; source: 'youtube' | 'ytmusic' }>) => {
      state.isLoadingStream = true
    },
    addToQueueSuccess: (state, action: PayloadAction<{ track: MusicTrack }>) => {
      state.isLoadingStream = false
      state.queue.push(action.payload.track)
    },
    addToQueueFailure: (state, action: PayloadAction<{ error: string }>) => {
      state.isLoadingStream = false
      state.error = action.payload.error
    },
    
    removeFromQueue: (state, _action: PayloadAction<{ roomId: string; trackId: string }>) => {},
    skipTrack: (state, _action: PayloadAction<{ roomId: string }>) => {},
    
    // Playback control
    setPlaybackState: (state, _action: PayloadAction<{ roomId: string; state: 'playing' | 'paused' | 'stopped'; positionMs?: number }>) => {},
    
    playbackEvent: (state, action: PayloadAction<PlaybackEvent>) => {
      if (state.session && state.currentRoomId === action.payload.roomId) {
        switch (action.payload.type) {
          case 'play':
            state.isPlaying = true
            break
          case 'pause':
          case 'stop':
            state.isPlaying = false
            break
        }
      }
    },
    
    leaderHeartbeat: (state, action: PayloadAction<LeaderHeartbeat>) => {
      if (state.currentRoomId === action.payload.roomId && state.session) {
        // Sync local position from leader
        state.localPlaybackPosition = action.payload.currentPositionMs
      }
    },
    
    // Participants
    participantJoined: (state, action: PayloadAction<{ roomId: string; participant: MusicRoomParticipant }>) => {
      if (state.currentRoomId === action.payload.roomId) {
        const existing = state.participants.find(p => p.peerId === action.payload.participant.peerId)
        if (!existing) {
          state.participants.push(action.payload.participant)
        }
      }
    },
    
    participantLeft: (state, action: PayloadAction<{ roomId: string; peerId: string }>) => {
      if (state.currentRoomId === action.payload.roomId) {
        state.participants = state.participants.filter(p => p.peerId !== action.payload.peerId)
      }
    },
    
    setParticipants: (state, action: PayloadAction<{ roomId: string; participants: MusicRoomParticipant[] }>) => {
      if (state.currentRoomId === action.payload.roomId) {
        state.participants = action.payload.participants
      }
    },
    
    // Compatible peers
    compatiblePeerDiscovered: (state, action: PayloadAction<{ peerId: string; capabilities: string[]; lastSeen: number }>) => {
      const existing = state.compatiblePeers.find(p => p.peerId === action.payload.peerId)
      if (existing) {
        existing.lastSeen = action.payload.lastSeen
      } else {
        state.compatiblePeers.push({
          peerId: action.payload.peerId,
          username: '',
          capabilities: action.payload.capabilities as any,
          lastSeen: action.payload.lastSeen,
        })
      }
    },
    
    compatiblePeerDisconnected: (state, action: PayloadAction<{ peerId: string }>) => {
      state.compatiblePeers = state.compatiblePeers.filter(p => p.peerId !== action.payload.peerId)
    },
    
    // Audio stream
    audioStreamResolved: (state, action: PayloadAction<{ stream: AudioStream }>) => {
      state.audioStream = action.payload.stream
      state.isLoadingStream = false
    },
    
    // Local playback position (updated by audio player)
    updateLocalPlaybackPosition: (state, action: PayloadAction<{ positionMs: number }>) => {
      state.localPlaybackPosition = action.payload.positionMs
    },
    
    // Clear error
    clearError: (state) => {
      state.error = null
    },
    
    // Reset state
    resetMusicState: () => initialState,
  },
})

export const musicActions = musicSlice.actions
export const musicReducer = musicSlice.reducer
