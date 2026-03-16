import { createSelector } from 'reselect'
import { StoreKeys } from '../store.keys'
import { StoreState } from '../store.types'
import { MusicState } from './music.slice'

const selectMusicState = (state: StoreState) => state[StoreKeys.Music]

export const musicSelectors = {
  // Rooms
  selectRooms: createSelector(selectMusicState, (state: MusicState) => state.rooms),
  selectCurrentRoomId: createSelector(selectMusicState, (state: MusicState) => state.currentRoomId),
  selectCurrentRoom: createSelector(
    [selectMusicState, (_: StoreState, roomId: string) => roomId],
    (state: MusicState, roomId: string) => state.rooms.find((r) => r.id === roomId) || null
  ),
  
  // Session
  selectSession: createSelector(selectMusicState, (state: MusicState) => state.session),
  selectIsPlaying: createSelector(selectMusicState, (state: MusicState) => state.isPlaying),
  selectPlaybackPosition: createSelector(selectMusicState, (state: MusicState) => state.localPlaybackPosition),
  
  // Queue
  selectQueue: createSelector(selectMusicState, (state: MusicState) => state.queue),
  selectQueueVersion: createSelector(selectMusicState, (state: MusicState) => state.queueVersion),
  selectCurrentTrack: createSelector(selectMusicState, (state: MusicState) => 
    state.session?.currentTrack || null
  ),
  
  // Participants
  selectParticipants: createSelector(selectMusicState, (state: MusicState) => state.participants),
  selectLeader: createSelector(selectMusicState, (state: MusicState) => 
    state.participants.find((p) => p.isLeader) || null
  ),
  selectIsLeader: createSelector(selectMusicState, (state: MusicState) => 
    state.participants.find((p) => p.isLeader)?.peerId === state.session?.leaderId
  ),
  
  // Audio
  selectAudioStream: createSelector(selectMusicState, (state: MusicState) => state.audioStream),
  selectIsLoadingStream: createSelector(selectMusicState, (state: MusicState) => state.isLoadingStream),
  
  // Compatible peers
  selectCompatiblePeers: createSelector(selectMusicState, (state: MusicState) => state.compatiblePeers),
  selectCompatiblePeerCount: createSelector(selectMusicState, (state: MusicState) => state.compatiblePeers.length),
  selectHasCompatiblePeers: createSelector(selectMusicState, (state: MusicState) => state.compatiblePeers.length > 0),
  
  // Loading states
  selectIsCreatingRoom: createSelector(selectMusicState, (state: MusicState) => state.isCreatingRoom),
  selectIsJoiningRoom: createSelector(selectMusicState, (state: MusicState) => state.isJoiningRoom),
  
  // Errors
  selectError: createSelector(selectMusicState, (state: MusicState) => state.error),
}
