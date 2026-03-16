import { put, take, call, takeEvery, select, fork, cancel, cancelled } from 'typed-redux-saga'
import { eventChannel } from 'redux-saga'
import { Socket } from 'socket.io-client'
import {
  MusicSocketActions,
  MusicSocketEvents,
  CreateMusicRoomResponse,
  JoinMusicRoomResponse,
  AddToQueueResponse,
  PlaybackEvent,
  LeaderHeartbeat,
} from '@quiet/types'
import { musicActions } from './music.slice'
import { StoreKeys } from '../store.keys'

interface MusicEvent {
  type: string
  payload: any
}

export function* musicSaga(socket: Socket): Generator {
  // Listen for music socket events
  yield* fork(listenForMusicEvents, socket)
  
  // Handle outgoing actions
  yield* takeEvery(musicActions.createRoom.type, handleCreateRoom, socket)
  yield* takeEvery(musicActions.joinRoom.type, handleJoinRoom, socket)
  yield* takeEvery(musicActions.leaveRoom.type, handleLeaveRoom, socket)
  yield* takeEvery(musicActions.setPlaybackState.type, handleSetPlaybackState, socket)
  yield* takeEvery(musicActions.addToQueue.type, handleAddToQueue, socket)
  yield* takeEvery(musicActions.removeFromQueue.type, handleRemoveFromQueue, socket)
  yield* takeEvery(musicActions.skipTrack.type, handleSkipTrack, socket)
}

function* listenForMusicEvents(socket: Socket): Generator {
  const channel = yield* call(createMusicEventChannel, socket)
  
  try {
    while (true) {
      const event = yield* take<MusicEvent>(channel)
      yield* handleMusicEvent(event)
    }
  } finally {
    if (yield* cancelled()) {
      channel.close()
    }
  }
}

function createMusicEventChannel(socket: Socket) {
  return eventChannel<MusicEvent>(emit => {
    // Room events
    socket.on(MusicSocketEvents.MUSIC_ROOM_CREATED, (data) => {
      emit({ type: MusicSocketEvents.MUSIC_ROOM_CREATED, payload: data })
    })
    
    socket.on(MusicSocketEvents.MUSIC_ROOM_UPDATED, (data) => {
      emit({ type: MusicSocketEvents.MUSIC_ROOM_UPDATED, payload: data })
    })
    
    socket.on(MusicSocketEvents.MUSIC_ROOM_DELETED, (data) => {
      emit({ type: MusicSocketEvents.MUSIC_ROOM_DELETED, payload: data })
    })
    
    socket.on(MusicSocketEvents.MUSIC_ROOMS_LIST, (data) => {
      emit({ type: MusicSocketEvents.MUSIC_ROOMS_LIST, payload: data })
    })
    
    // Session events
    socket.on(MusicSocketEvents.MUSIC_SESSION_UPDATED, (data) => {
      emit({ type: MusicSocketEvents.MUSIC_SESSION_UPDATED, payload: data })
    })
    
    socket.on(MusicSocketEvents.MUSIC_QUEUE_UPDATED, (data) => {
      emit({ type: MusicSocketEvents.MUSIC_QUEUE_UPDATED, payload: data })
    })
    
    socket.on(MusicSocketEvents.PLAYBACK_EVENT, (data: PlaybackEvent) => {
      emit({ type: MusicSocketEvents.PLAYBACK_EVENT, payload: data })
    })
    
    socket.on(MusicSocketEvents.LEADER_HEARTBEAT, (data: LeaderHeartbeat) => {
      emit({ type: MusicSocketEvents.LEADER_HEARTBEAT, payload: data })
    })
    
    // Participant events
    socket.on(MusicSocketEvents.PARTICIPANT_JOINED, (data) => {
      emit({ type: MusicSocketEvents.PARTICIPANT_JOINED, payload: data })
    })
    
    socket.on(MusicSocketEvents.PARTICIPANT_LEFT, (data) => {
      emit({ type: MusicSocketEvents.PARTICIPANT_LEFT, payload: data })
    })
    
    socket.on(MusicSocketEvents.PARTICIPANTS_LIST, (data) => {
      emit({ type: MusicSocketEvents.PARTICIPANTS_LIST, payload: data })
    })
    
    // Compatible peer events
    socket.on(MusicSocketEvents.COMPATIBLE_PEER_DISCOVERED, (data) => {
      emit({ type: MusicSocketEvents.COMPATIBLE_PEER_DISCOVERED, payload: data })
    })
    
    socket.on(MusicSocketEvents.COMPATIBLE_PEER_DISCONNECTED, (data) => {
      emit({ type: MusicSocketEvents.COMPATIBLE_PEER_DISCONNECTED, payload: data })
    })
    
    return () => {
      socket.off(MusicSocketEvents.MUSIC_ROOM_CREATED)
      socket.off(MusicSocketEvents.MUSIC_ROOM_UPDATED)
      socket.off(MusicSocketEvents.MUSIC_ROOM_DELETED)
      socket.off(MusicSocketEvents.MUSIC_ROOMS_LIST)
      socket.off(MusicSocketEvents.MUSIC_SESSION_UPDATED)
      socket.off(MusicSocketEvents.MUSIC_QUEUE_UPDATED)
      socket.off(MusicSocketEvents.PLAYBACK_EVENT)
      socket.off(MusicSocketEvents.LEADER_HEARTBEAT)
      socket.off(MusicSocketEvents.PARTICIPANT_JOINED)
      socket.off(MusicSocketEvents.PARTICIPANT_LEFT)
      socket.off(MusicSocketEvents.PARTICIPANTS_LIST)
      socket.off(MusicSocketEvents.COMPATIBLE_PEER_DISCOVERED)
      socket.off(MusicSocketEvents.COMPATIBLE_PEER_DISCONNECTED)
    }
  })
}

function* handleMusicEvent(event: MusicEvent): Generator {
  switch (event.type) {
    case MusicSocketEvents.MUSIC_ROOM_CREATED:
      yield* put(musicActions.createRoomSuccess({ room: event.payload.room }))
      break
      
    case MusicSocketEvents.MUSIC_ROOM_DELETED:
      yield* put(musicActions.leaveRoomSuccess({ roomId: event.payload.roomId }))
      break
      
    case MusicSocketEvents.MUSIC_ROOMS_LIST:
      yield* put(musicActions.setRooms({ rooms: event.payload.rooms }))
      break
      
    case MusicSocketEvents.MUSIC_SESSION_UPDATED:
      yield* put(musicActions.sessionUpdated({
        roomId: event.payload.roomId,
        session: event.payload.session,
      }))
      break
      
    case MusicSocketEvents.MUSIC_QUEUE_UPDATED:
      yield* put(musicActions.queueUpdated({
        roomId: event.payload.roomId,
        queue: event.payload.queue,
        version: event.payload.version,
      }))
      break
      
    case MusicSocketEvents.PLAYBACK_EVENT:
      yield* put(musicActions.playbackEvent(event.payload))
      break
      
    case MusicSocketEvents.LEADER_HEARTBEAT:
      yield* put(musicActions.leaderHeartbeat(event.payload))
      break
      
    case MusicSocketEvents.PARTICIPANT_JOINED:
      yield* put(musicActions.participantJoined({
        roomId: event.payload.roomId,
        participant: event.payload.participant,
      }))
      break
      
    case MusicSocketEvents.PARTICIPANT_LEFT:
      yield* put(musicActions.participantLeft({
        roomId: event.payload.roomId,
        peerId: event.payload.peerId,
      }))
      break
      
    case MusicSocketEvents.COMPATIBLE_PEER_DISCOVERED:
      yield* put(musicActions.compatiblePeerDiscovered(event.payload))
      break
      
    case MusicSocketEvents.COMPATIBLE_PEER_DISCONNECTED:
      yield* put(musicActions.compatiblePeerDisconnected(event.payload))
      break
  }
}

function* handleCreateRoom(socket: Socket, action: ReturnType<typeof musicActions.createRoom>): Generator {
  const response = yield* call(() => 
    new Promise<CreateMusicRoomResponse>((resolve) => {
      socket.emit(MusicSocketActions.CREATE_MUSIC_ROOM, action.payload, (res: CreateMusicRoomResponse) => {
        resolve(res)
      })
    })
  )
  
  if (response.success && response.room) {
    yield* put(musicActions.createRoomSuccess({ room: response.room }))
  } else {
    yield* put(musicActions.createRoomFailure({ error: response.error || 'Failed to create room' }))
  }
}

function* handleJoinRoom(socket: Socket, action: ReturnType<typeof musicActions.joinRoom>): Generator {
  const response = yield* call(() => 
    new Promise<JoinMusicRoomResponse>((resolve) => {
      socket.emit(MusicSocketActions.JOIN_MUSIC_ROOM, action.payload, (res: JoinMusicRoomResponse) => {
        resolve(res)
      })
    })
  )
  
  if (response.success && response.room && response.session) {
    yield* put(musicActions.joinRoomSuccess({
      room: response.room,
      session: response.session,
      queue: response.queue,
      participants: response.participants,
      audioStream: response.audioStream,
    }))
  } else {
    yield* put(musicActions.joinRoomFailure({ error: response.error || 'Failed to join room' }))
  }
}

function* handleLeaveRoom(socket: Socket, action: ReturnType<typeof musicActions.leaveRoom>): Generator {
  socket.emit(MusicSocketActions.LEAVE_MUSIC_ROOM, action.payload)
  yield* put(musicActions.leaveRoomSuccess({ roomId: action.payload.roomId }))
}

function* handleSetPlaybackState(socket: Socket, action: ReturnType<typeof musicActions.setPlaybackState>): Generator {
  socket.emit(MusicSocketActions.SET_PLAYBACK_STATE, action.payload)
}

function* handleAddToQueue(socket: Socket, action: ReturnType<typeof musicActions.addToQueue>): Generator {
  const response = yield* call(() => 
    new Promise<AddToQueueResponse>((resolve) => {
      socket.emit(MusicSocketActions.ADD_TO_QUEUE, action.payload, (res: AddToQueueResponse) => {
        resolve(res)
      })
    })
  )
  
  if (response.success && response.track) {
    yield* put(musicActions.addToQueueSuccess({ track: response.track }))
  } else {
    yield* put(musicActions.addToQueueFailure({ error: response.error || 'Failed to add to queue' }))
  }
}

function* handleRemoveFromQueue(socket: Socket, action: ReturnType<typeof musicActions.removeFromQueue>): Generator {
  socket.emit(MusicSocketActions.REMOVE_FROM_QUEUE, action.payload)
}

function* handleSkipTrack(socket: Socket, action: ReturnType<typeof musicActions.skipTrack>): Generator {
  socket.emit(MusicSocketActions.SKIP_TRACK, action.payload)
}
