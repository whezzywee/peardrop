import React, { useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { music } from '@quiet/state-manager'

export const MusicRoom: React.FC = () => {
  const dispatch = useDispatch()
  const [newRoomName, setNewRoomName] = useState('')
  const [videoId, setVideoId] = useState('')

  // Selectors
  const rooms = useSelector(music.selectors.selectRooms)
  const currentRoomId = useSelector(music.selectors.selectCurrentRoomId)
  const session = useSelector(music.selectors.selectSession)
  const queue = useSelector(music.selectors.selectQueue)
  const participants = useSelector(music.selectors.selectParticipants)
  const audioStream = useSelector(music.selectors.selectAudioStream)
  const isPlaying = useSelector(music.selectors.selectIsPlaying)
  const isLeader = useSelector(music.selectors.selectIsLeader)
  const compatiblePeers = useSelector(music.selectors.selectCompatiblePeers)
  const isCreatingRoom = useSelector(music.selectors.selectIsCreatingRoom)
  const isJoiningRoom = useSelector(music.selectors.selectIsJoiningRoom)
  const error = useSelector(music.selectors.selectError)

  const handleCreateRoom = () => {
    if (newRoomName.trim()) {
      dispatch(music.actions.createRoom({ name: newRoomName.trim() }))
      setNewRoomName('')
    }
  }

  const handleJoinRoom = (roomId: string) => {
    dispatch(music.actions.joinRoom({ roomId }))
  }

  const handleLeaveRoom = () => {
    if (currentRoomId) {
      dispatch(music.actions.leaveRoom({ roomId: currentRoomId }))
    }
  }

  const handlePlay = () => {
    if (currentRoomId) {
      dispatch(music.actions.setPlaybackState({ roomId: currentRoomId, state: 'playing' }))
    }
  }

  const handlePause = () => {
    if (currentRoomId) {
      dispatch(music.actions.setPlaybackState({ roomId: currentRoomId, state: 'paused' }))
    }
  }

  const handleStop = () => {
    if (currentRoomId) {
      dispatch(music.actions.setPlaybackState({ roomId: currentRoomId, state: 'stopped' }))
    }
  }

  const handleAddToQueue = () => {
    if (currentRoomId && videoId.trim()) {
      dispatch(music.actions.addToQueue({ roomId: currentRoomId, videoId: videoId.trim(), source: 'youtube' }))
      setVideoId('')
    }
  }

  const handleSkip = () => {
    if (currentRoomId) {
      dispatch(music.actions.skipTrack({ roomId: currentRoomId }))
    }
  }

  // If not in a room, show room list
  if (!currentRoomId) {
    return (
      <div style={styles.container}>
        <h2 style={styles.title}>Music Rooms</h2>
        
        {error && <div style={styles.error}>{error}</div>}
        
        {/* Create room */}
        <div style={styles.section}>
          <h3>Create Room</h3>
          <input
            type="text"
            value={newRoomName}
            onChange={(e) => setNewRoomName(e.target.value)}
            placeholder="Room name"
            style={styles.input}
          />
          <button onClick={handleCreateRoom} disabled={isCreatingRoom} style={styles.button}>
            {isCreatingRoom ? 'Creating...' : 'Create'}
          </button>
        </div>

        {/* Compatible peers */}
        <div style={styles.section}>
          <h3>Compatible Peers ({compatiblePeers.length})</h3>
          {compatiblePeers.length === 0 ? (
            <p style={styles.muted}>No other modified clients detected</p>
          ) : (
            <ul style={styles.list}>
              {compatiblePeers.map((peer) => (
                <li key={peer.peerId} style={styles.listItem}>
                  {peer.peerId.slice(0, 8)}... - {peer.capabilities.join(', ')}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Available rooms */}
        <div style={styles.section}>
          <h3>Available Rooms ({rooms.length})</h3>
          {rooms.length === 0 ? (
            <p style={styles.muted}>No rooms available. Create one!</p>
          ) : (
            <ul style={styles.list}>
              {rooms.map((room) => (
                <li key={room.id} style={styles.listItem}>
                  <span>{room.name}</span>
                  <button 
                    onClick={() => handleJoinRoom(room.id)} 
                    disabled={isJoiningRoom}
                    style={styles.button}
                  >
                    Join
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    )
  }

  // In a room - show room view
  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>Room: {rooms.find(r => r.id === currentRoomId)?.name}</h2>
        <button onClick={handleLeaveRoom} style={styles.button}>Leave</button>
      </div>

      {error && <div style={styles.error}>{error}</div>}

      {/* Playback info */}
      <div style={styles.section}>
        <h3>Now Playing</h3>
        {session?.currentTrack ? (
          <div>
            <p><strong>{session.currentTrack.title}</strong></p>
            <p style={styles.muted}>{session.currentTrack.artist}</p>
            <p style={styles.muted}>State: {session.playbackState}</p>
          </div>
        ) : (
          <p style={styles.muted}>No track playing</p>
        )}

        {/* Audio player */}
        {audioStream?.streamUrl && (
          <audio
            key={audioStream.streamUrl}
            src={audioStream.streamUrl}
            autoPlay={isPlaying}
            controls
            style={styles.audio}
          />
        )}

        {/* Playback controls - leader only */}
        {isLeader && (
          <div style={styles.controls}>
            <button onClick={handlePlay} disabled={isPlaying} style={styles.button}>Play</button>
            <button onClick={handlePause} disabled={!isPlaying} style={styles.button}>Pause</button>
            <button onClick={handleStop} style={styles.button}>Stop</button>
            <button onClick={handleSkip} disabled={!session?.currentTrack} style={styles.button}>Skip</button>
          </div>
        )}
      </div>

      {/* Queue */}
      <div style={styles.section}>
        <h3>Queue ({queue.length})</h3>
        
        {/* Add to queue */}
        <div style={styles.addRow}>
          <input
            type="text"
            value={videoId}
            onChange={(e) => setVideoId(e.target.value)}
            placeholder="YouTube Video ID"
            style={styles.input}
          />
          <button onClick={handleAddToQueue} disabled={!videoId.trim()} style={styles.button}>
            Add
          </button>
        </div>

        {queue.length === 0 ? (
          <p style={styles.muted}>Queue is empty</p>
        ) : (
          <ul style={styles.list}>
            {queue.map((track, index) => (
              <li key={track.id} style={styles.listItem}>
                <span>
                  {index === 0 && session?.currentTrack?.id === track.id ? '▶ ' : ''}
                  {track.title} - {track.artist}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Participants */}
      <div style={styles.section}>
        <h3>Participants ({participants.length})</h3>
        <ul style={styles.list}>
          {participants.map((p) => (
            <li key={p.peerId} style={styles.listItem}>
              {p.peerId.slice(0, 8)}... {p.isLeader ? '👑' : ''} 
              {p.peerId === session?.leaderId ? ' (Leader)' : ''}
            </li>
          ))}
        </ul>
      </div>

      {/* Session info */}
      <div style={styles.section}>
        <h3>Session Info</h3>
        <p style={styles.muted}>Leader: {session?.leaderId?.slice(0, 12)}...</p>
        <p style={styles.muted}>Epoch: {session?.leaderEpoch}</p>
        <p style={styles.muted}>Queue Version: {session?.queueVersion}</p>
        <p style={styles.muted}>You are: {isLeader ? 'Leader' : 'Listener'}</p>
      </div>
    </div>
  )
}

// Minimal inline styles for barebones testing
const styles: { [key: string]: React.CSSProperties } = {
  container: {
    padding: '16px',
    backgroundColor: '#1a1a1a',
    color: '#fff',
    minHeight: '100%',
  },
  title: {
    margin: '0 0 16px 0',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '16px',
  },
  section: {
    marginBottom: '24px',
    padding: '12px',
    backgroundColor: '#2a2a2a',
    borderRadius: '4px',
  },
  input: {
    padding: '8px',
    marginRight: '8px',
    backgroundColor: '#333',
    border: '1px solid #444',
    color: '#fff',
    borderRadius: '4px',
  },
  button: {
    padding: '8px 16px',
    backgroundColor: '#4a4a4a',
    border: '1px solid #555',
    color: '#fff',
    borderRadius: '4px',
    cursor: 'pointer',
    marginRight: '4px',
  },
  list: {
    listStyle: 'none',
    padding: 0,
    margin: 0,
  },
  listItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 0',
    borderBottom: '1px solid #333',
  },
  controls: {
    marginTop: '12px',
    display: 'flex',
    gap: '8px',
  },
  addRow: {
    display: 'flex',
    marginBottom: '12px',
  },
  muted: {
    color: '#888',
    fontSize: '14px',
  },
  error: {
    padding: '8px',
    backgroundColor: '#442222',
    color: '#ff6666',
    borderRadius: '4px',
    marginBottom: '16px',
  },
  audio: {
    width: '100%',
    marginTop: '12px',
  },
}

export default MusicRoom
